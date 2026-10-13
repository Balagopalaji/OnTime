import type { RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import { describe, expect, it, vi } from 'vitest'
import { createCredentialsClient } from './auth'
import type { CallResult, CloudClient, CloudError } from './cloud-client'
import type { StorageError } from './protocol'
import { createShareSession, toPublishResponse, type ShareStatus } from './share-session'
import type { SidecarStorage } from './sidecar-core'

const DEVICE_UID = `ppd_${'d'.repeat(24)}`
const VIEWER_URL = 'https://ontime.app/session/s1/view#token=' + 't'.repeat(43)
const candidate: RemoteSnapshotCandidateV1 = {
  schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs: Date.now(), availability: 'source-unavailable', payload: { reason: 'no-slideshow' },
}
const fail = (code: string, details: Record<string, unknown> = {}): CallResult<never> => ({ ok: false, error: { code, details } })
type Handler = (data: Record<string, unknown>) => CallResult<unknown>

function memoryStorage(initial: string | null = null, error: StorageError | null = null) {
  let stored = initial
  const storage: SidecarStorage = {
    seal: async (data) => (error ? { ok: false, error } : ((stored = data), { ok: true })),
    unseal: async () => (error ? { ok: false, error } : stored === null ? { ok: false, error: 'not-found' } : { ok: true, data: stored }),
    clear: async () => ((stored = null), { ok: true }),
  }
  return { storage, read: () => (stored === null ? null : JSON.parse(stored)) }
}
const saved = (sessionId: string | null) => JSON.stringify({ v: 1, deviceUid: DEVICE_UID, devicePrivateKey: 'cHJpdg', session: { refreshToken: 'refresh-0', sessionId } })

function fakeCloud(handlers: Record<string, Handler>) {
  let refresh: string | null = null
  const calls: Array<[string, Record<string, unknown>]> = []
  const client = {
    signInWithCustomToken: async () => ((refresh = 'refresh-1'), { ok: true, data: null }),
    restore: (token: string) => void (refresh = token),
    refreshToken: () => refresh,
    signOut: () => void (refresh = null),
    call: async (name: string, data: Record<string, unknown>) => {
      calls.push([name, data])
      return handlers[name]?.(data) ?? fail('unavailable')
    },
  } as unknown as CloudClient
  return { client, calls, names: () => calls.map(([name]) => name) }
}

const published = (data: Record<string, unknown>) => ({ ok: true as const, data: { acceptedSequence: data.sequence, publishedAtMs: Date.now() } })

function setup(options: { stored?: string | null; storageError?: StorageError; handlers?: Record<string, Handler>; cloud?: null } = {}) {
  const memory = memoryStorage(options.stored ?? null, options.storageError ?? null)
  const cloud = fakeCloud({
    createPresentationSession: () => ({ ok: true, data: { sessionId: 's1', epoch: 1, viewerUrl: VIEWER_URL } }),
    publishPresentationSnapshot: published,
    ...options.handlers,
  })
  const statuses: ShareStatus[] = []
  const links: string[] = []
  const approve = vi.fn(async () => ({ customToken: 'custom', deviceUid: DEVICE_UID, serverNowMs: 1, devicePrivateKey: 'cHJpdg' }))
  const share = createShareSession({
    cloud: options.cloud === null ? null : cloud.client,
    credentials: createCredentialsClient(memory.storage),
    approve,
    onStatus: (status) => statuses.push(status),
    onViewerLink: (url) => links.push(url),
    random: () => 0,
  })
  return { share, cloud, statuses, links, approve, memory }
}

describe('share session orchestration (sidecar)', () => {
  it('first share: approves the device, seals the session, creates the cloud session, shows the link, and publishes', async () => {
    const { share, cloud, statuses, links, approve, memory } = setup()
    share.offer(candidate)
    share.start()
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('live'))
    expect(approve).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['connecting', 'awaiting-approval', 'live'])
    expect(links).toEqual([VIEWER_URL])
    expect(cloud.names()).toEqual(['createPresentationSession', 'publishPresentationSnapshot'])
    expect(cloud.calls[1][1]).toMatchObject({ sessionId: 's1', epoch: 1, sequence: 1, availability: 'source-unavailable' })
    // Defect: the refresh token/session are not persisted, forcing re-approval or orphaning the session on restart.
    expect(memory.read()).toEqual({ v: 1, deviceUid: DEVICE_UID, devicePrivateKey: 'cHJpdg', session: { refreshToken: 'refresh-1', sessionId: 's1' } })
  })

  it('restart: resumes the sealed session into the server epoch and re-issues a revoked link', async () => {
    const { share, cloud, links, approve } = setup({
      stored: saved('s1'),
      handlers: {
        resumePresentationSession: () => ({ ok: true, data: { epoch: 3, viewerUrl: null } }),
        issuePresentationViewerLink: () => ({ ok: true, data: { viewerUrl: VIEWER_URL } }),
      },
    })
    share.offer(candidate)
    share.start()
    await vi.waitFor(() => expect(cloud.names()).toContain('publishPresentationSnapshot'))
    expect(approve).not.toHaveBeenCalled()
    expect(cloud.names()).toEqual(['resumePresentationSession', 'issuePresentationViewerLink', 'publishPresentationSnapshot'])
    expect(cloud.calls[2][1]).toMatchObject({ sessionId: 's1', epoch: 3, sequence: 1 })
    expect(links).toEqual([VIEWER_URL])
  })

  it('creates a fresh session when the sealed one has ended', async () => {
    const { share, cloud, memory } = setup({
      stored: saved('old'),
      handlers: { resumePresentationSession: () => fail('failed-precondition', { reason: 'session-ended' }) },
    })
    share.start()
    await vi.waitFor(() => expect(memory.read()?.session.sessionId).toBe('s1'))
    expect(cloud.names()).toEqual(['resumePresentationSession', 'createPresentationSession'])
  })

  it.each(['encryption-unavailable', 'corrupt', 'io'] as const)('disables sharing on %s storage without any cloud call or approval', async (error) => {
    // Defect: a plaintext fallback, or an approval loop that can never persist.
    const { share, cloud, statuses, approve } = setup({ storageError: error })
    share.start()
    await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'storage-unavailable']))
    expect(cloud.calls).toEqual([])
    expect(approve).not.toHaveBeenCalled()
  })

  it('a revoked device is signed out and its sealed credential cleared', async () => {
    const { share, statuses, memory } = setup({ stored: saved(null), handlers: { createPresentationSession: () => fail('permission-denied') } })
    share.start()
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('signed-out'))
    await vi.waitFor(() => expect(memory.read()).toBeNull())
  })

  it('pause during approval abandons the start (no session is created)', async () => {
    let approveNow = () => {}
    const { share, cloud, statuses, approve } = setup()
    approve.mockImplementation(() => new Promise((resolve) => (approveNow = () => resolve({ customToken: 'c', deviceUid: DEVICE_UID, serverNowMs: 1, devicePrivateKey: 'cHJpdg' }))))
    share.start()
    await vi.waitFor(() => expect(statuses).toContain('awaiting-approval'))
    share.pause()
    approveNow()
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.calls).toEqual([])
    expect(statuses.at(-1)).toBe('paused')
  })

  it('end: stops publishing, ends the cloud session, and forgets it', async () => {
    const { share, cloud, statuses, memory } = setup({ stored: saved(null), handlers: { endPresentationSession: () => ({ ok: true, data: { ended: true } }) } })
    share.offer(candidate)
    share.start()
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('live'))
    await share.end()
    share.offer({ ...candidate, payload: { reason: 'no-presentation' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(cloud.names()).toEqual(['createPresentationSession', 'publishPresentationSnapshot', 'endPresentationSession'])
    expect(cloud.calls[2][1]).toMatchObject({ sessionId: 's1' })
    expect(memory.read()?.session.sessionId).toBeNull()
    expect(statuses.at(-1)).toBe('ended')
  })

  it('sign-out revokes this device and clears the sealed credential', async () => {
    const { share, cloud, statuses, memory } = setup({ stored: saved('s1'), handlers: { resumePresentationSession: () => ({ ok: true, data: { epoch: 2, viewerUrl: VIEWER_URL } }) } })
    share.start()
    await vi.waitFor(() => expect(cloud.names()).toContain('resumePresentationSession'))
    await share.signOut()
    expect(cloud.calls.at(-1)).toEqual(['revokePresentationPublisherDevice', { deviceUid: DEVICE_UID, clientRequestId: expect.stringMatching(/^req_[0-9a-f]{24}$/) }])
    expect(memory.read()).toBeNull()
    expect(statuses.at(-1)).toBe('signed-out')
  })

  it('end and sign-out after a respawn (before any share) still reach the cloud', async () => {
    // Defect: End/Sign out in a fresh sidecar report success while the session/device stay live server-side.
    const ended = setup({ stored: saved('s1'), handlers: { endPresentationSession: () => ({ ok: true, data: { ended: true } }) } })
    await ended.share.end()
    expect(ended.cloud.calls).toEqual([['endPresentationSession', { sessionId: 's1', clientRequestId: expect.any(String) }]])
    expect(ended.statuses).toEqual(['ended'])
    const signedOut = setup({ stored: saved('s1') })
    await signedOut.share.signOut()
    expect(signedOut.cloud.names()).toEqual(['revokePresentationPublisherDevice'])
    expect(signedOut.memory.read()).toBeNull()
  })

  it('keeps the session (paused) when ending it fails, so End can be retried', async () => {
    // Defect: a failed end is reported as ended and the still-live session is forgotten.
    const { share, statuses, memory } = setup({ stored: saved('s1'), handlers: { endPresentationSession: () => fail('unavailable') } })
    await share.end()
    expect(statuses).toEqual(['paused'])
    expect(memory.read()?.session.sessionId).toBe('s1')
  })

  it('a stale start whose storage write fails does not halt the newer start', async () => {
    // Defect: the old run's late failure stops the new run's publisher.
    let release = () => {}
    let stall = true
    const memory = memoryStorage(saved(null))
    const realSeal = memory.storage.seal
    memory.storage.seal = (data) => (stall ? new Promise((resolve) => (release = () => resolve({ ok: false, error: 'io' }))) : realSeal(data))
    const cloud = fakeCloud({ createPresentationSession: () => ({ ok: true, data: { sessionId: 's1', epoch: 1, viewerUrl: VIEWER_URL } }), publishPresentationSnapshot: published })
    const statuses: ShareStatus[] = []
    const share = createShareSession({ cloud: cloud.client, credentials: createCredentialsClient(memory.storage), approve: vi.fn(), onStatus: (s) => statuses.push(s), onViewerLink: () => {}, random: () => 0 })
    share.start()
    await vi.waitFor(() => expect(cloud.names()).toEqual(['createPresentationSession']))
    share.pause()
    stall = false
    share.offer(candidate)
    share.start()
    release()
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('live'))
    await new Promise((r) => setTimeout(r, 20))
    expect(statuses).not.toContain('storage-unavailable')
    expect(statuses.at(-1)).toBe('live')
  })

  it('reports not-configured when the build has no cloud config', async () => {
    const { share, statuses } = setup({ cloud: null })
    share.start()
    await vi.waitFor(() => expect(statuses).toEqual(['not-configured']))
  })
})

describe('publish response mapping (callable error → recovery)', () => {
  const error = (code: string, details: Record<string, unknown> = {}): CloudError => ({ code, details })
  it.each([
    [error('failed-precondition', { reason: 'sequence-conflict', acceptedSequence: 4 }), { ok: false, reason: 'sequence-conflict', acceptedSequence: 4 }],
    [error('failed-precondition', { reason: 'clock-future', serverNowMs: 9 }), { ok: false, reason: 'clock-future', serverNowMs: 9 }],
    [error('failed-precondition', { reason: 'epoch-mismatch' }), { ok: false, reason: 'epoch-mismatch' }],
    [error('failed-precondition', { reason: 'session-ended' }), { ok: false, reason: 'session-ended' }],
    [error('not-found'), { ok: false, reason: 'session-ended' }],
    [error('permission-denied'), { ok: false, reason: 'denied' }],
    [error('resource-exhausted'), { ok: false, reason: 'transient' }],
    [error('failed-precondition', { reason: 'sequence-conflict' }), { ok: false, reason: 'transient' }],
  ])('maps %j', (cloudError, expected) => {
    expect(toPublishResponse({ ok: false, error: cloudError })).toEqual(expected)
  })
})
