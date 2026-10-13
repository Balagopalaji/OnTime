import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLOUD_REQUEST_TIMEOUT_MS, cloudUrls, createCloudClient, parseCloudConfig, type CloudConfig, type FetchLike } from './cloud-client'

afterEach(() => vi.useRealTimers())

const PROD: CloudConfig = { apiKey: 'AIzaKey', projectId: 'ontime-prod', region: 'us-central1', emulatorHost: null }
const EMU: CloudConfig = { ...PROD, projectId: 'demo-ontime', emulatorHost: '127.0.0.1' }

type Request = { url: string; headers: Record<string, string>; body: string }
function fakeFetch(responses: Array<{ status: number; body: unknown } | 'network'>) {
  const requests: Request[] = []
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, headers: init.headers, body: init.body })
    const next = responses.shift()
    if (!next || next === 'network') throw new Error('ECONNRESET')
    return { status: next.status, json: async () => next.body }
  }
  return { fetch, requests }
}
const signedIn = { status: 200, body: { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600' } }

describe('cloud config and URLs', () => {
  it.each([
    [PROD, true],
    [EMU, true],
    [{ ...PROD, emulatorHost: 'evil.example' }, false],
    [{ ...PROD, projectId: 'Bad/Project' }, false],
    [{ ...PROD, extra: 1 }, false],
  ])('parses %j: %s', (config, valid) => {
    // Defect: main-supplied startup data redirects credentials to an arbitrary host.
    expect(parseCloudConfig(config) !== null).toBe(valid)
  })

  it('targets production Google endpoints or the local emulators only', () => {
    expect(cloudUrls(PROD).callable('publishPresentationSnapshot')).toBe('https://us-central1-ontime-prod.cloudfunctions.net/publishPresentationSnapshot')
    expect(cloudUrls(PROD).refresh).toBe('https://securetoken.googleapis.com/v1/token?key=AIzaKey')
    expect(cloudUrls(EMU).signIn).toBe('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaKey')
    expect(cloudUrls(EMU).callable('x')).toBe('http://127.0.0.1:5002/demo-ontime/us-central1/x')
  })
})

describe('cloud client', () => {
  it('signs in with a custom token and calls with the bearer ID token', async () => {
    const { fetch, requests } = fakeFetch([signedIn, { status: 200, body: { result: { acceptedSequence: 1 } } }])
    const client = createCloudClient({ config: PROD, fetch })
    expect(await client.signInWithCustomToken('custom')).toEqual({ ok: true, data: null })
    expect(JSON.parse(requests[0].body)).toEqual({ token: 'custom', returnSecureToken: true })
    expect(await client.call('publishPresentationSnapshot', { a: 1 })).toEqual({ ok: true, data: { acceptedSequence: 1 } })
    expect(requests[1].headers.Authorization).toBe('Bearer id-1')
    expect(JSON.parse(requests[1].body)).toEqual({ data: { a: 1 } })
    expect(client.refreshToken()).toBe('refresh-1')
  })

  it('restores from a persisted refresh token and persists the rotated one', async () => {
    // Defect: a restart forces re-approval, or a rotated refresh token is lost.
    const { fetch, requests } = fakeFetch([
      { status: 200, body: { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' } },
      { status: 200, body: { result: { ok: 1 } } },
    ])
    const client = createCloudClient({ config: PROD, fetch })
    client.restore('refresh-1')
    expect(await client.call('refreshPresentationPublisherDevice', {})).toEqual({ ok: true, data: { ok: 1 } })
    expect(requests[0].body).toBe('grant_type=refresh_token&refresh_token=refresh-1')
    expect(requests[1].headers.Authorization).toBe('Bearer id-2')
    expect(client.refreshToken()).toBe('refresh-2')
  })

  it('refreshes an ID token near expiry before calling', async () => {
    let clock = 0
    const { fetch, requests } = fakeFetch([
      signedIn,
      { status: 200, body: { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' } },
      { status: 200, body: { result: null } },
    ])
    const client = createCloudClient({ config: PROD, fetch, now: () => clock })
    await client.signInWithCustomToken('custom')
    clock = 3_600_000 - 5 * 60_000
    await client.call('x', {})
    expect(requests.map((r) => r.url.split('?')[0].split('/').pop())).toEqual(['accounts:signInWithCustomToken', 'token', 'x'])
    expect(requests[2].headers.Authorization).toBe('Bearer id-2')
  })

  it('maps callable errors to code + details (publish details.reason drives recovery)', async () => {
    const { fetch } = fakeFetch([
      signedIn,
      { status: 400, body: { error: { status: 'FAILED_PRECONDITION', message: 'x', details: { reason: 'sequence-conflict', acceptedSequence: 4 } } } },
    ])
    const client = createCloudClient({ config: PROD, fetch })
    await client.signInWithCustomToken('custom')
    expect(await client.call('publishPresentationSnapshot', {})).toEqual({
      ok: false,
      error: { code: 'failed-precondition', details: { reason: 'sequence-conflict', acceptedSequence: 4 } },
    })
  })

  it('treats network failures and 5xx/429 refreshes as transient, and a rejected refresh as signed out', async () => {
    // Defect: an outage signs the device out (forcing re-approval), or a revoked device retries forever.
    const network = fakeFetch(['network'])
    const transient = createCloudClient({ config: PROD, fetch: network.fetch })
    transient.restore('refresh-1')
    expect(await transient.call('x', {})).toEqual({ ok: false, error: { code: 'unavailable', details: {} } })

    const revoked = fakeFetch([{ status: 400, body: { error: { message: 'TOKEN_EXPIRED' } } }])
    const client = createCloudClient({ config: PROD, fetch: revoked.fetch })
    client.restore('refresh-1')
    expect(await client.call('x', {})).toEqual({ ok: false, error: { code: 'unauthenticated', details: {} } })
  })

  it.each([
    ['captive-portal HTML 200', { status: 200, body: undefined }],
    ['proxy 403 without a Secure Token error', { status: 403, body: { message: 'Forbidden' } }],
    ['407 proxy auth', { status: 407, body: null }],
  ])('keeps the device signed in when a refresh fails ambiguously (%s)', async (_label, response) => {
    // Defect: hotel Wi-Fi wipes the sealed credential and forces browser re-approval.
    const { fetch } = fakeFetch([response])
    const client = createCloudClient({ config: PROD, fetch })
    client.restore('refresh-1')
    expect(await client.call('x', {})).toEqual({ ok: false, error: { code: 'unavailable', details: {} } })
    expect(client.refreshToken()).toBe('refresh-1')
  })

  it('settles a hung request as unavailable after the request timeout', async () => {
    // Defect: a stalled socket leaves the publisher "live" for minutes while nothing is published.
    vi.useFakeTimers()
    const client = createCloudClient({ config: PROD, fetch: () => new Promise(() => {}) })
    const pending = client.call('beginPresentationPublisherAuth', {}, false)
    await vi.advanceTimersByTimeAsync(CLOUD_REQUEST_TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, error: { code: 'unavailable', details: {} } })
  })

  it('reports each refresh-token rotation so it can be sealed', async () => {
    const rotations: string[] = []
    const { fetch } = fakeFetch([signedIn, { status: 200, body: { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' } }, { status: 200, body: { result: null } }])
    const client = createCloudClient({ config: PROD, fetch, onRefreshTokenChanged: (token) => void rotations.push(token) })
    await client.signInWithCustomToken('custom')
    client.restore('refresh-1')
    await client.call('x', {})
    expect(rotations).toEqual(['refresh-1', 'refresh-2'])
  })

  it('force-refreshes once after an unauthenticated callable response, then gives up', async () => {
    const { fetch, requests } = fakeFetch([
      signedIn,
      { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } },
      { status: 200, body: { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' } },
      { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } },
    ])
    const client = createCloudClient({ config: PROD, fetch })
    await client.signInWithCustomToken('custom')
    expect(await client.call('x', {})).toEqual({ ok: false, error: { code: 'unauthenticated', details: {} } })
    expect(requests).toHaveLength(4)
  })

  it('calls unauthenticated endpoints without a bearer token', async () => {
    const { fetch, requests } = fakeFetch([{ status: 200, body: { result: { challengeId: 'c' } } }])
    const client = createCloudClient({ config: PROD, fetch })
    expect(await client.call('beginPresentationPublisherAuth', {}, false)).toEqual({ ok: true, data: { challengeId: 'c' } })
    expect(requests[0].headers.Authorization).toBeUndefined()
  })
})
