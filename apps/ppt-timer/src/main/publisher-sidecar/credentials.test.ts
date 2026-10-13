import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inProcessSpawner } from '../../../test/publisher-sidecar-harness'
import { APPROVAL_WAIT_MS, approveDevice, createCredentialsClient, type AuthCallables } from './auth'
import { isAllowedApprovalUrl, parseAuthCallbackUrl } from './approval'
import { createCredentialBroker, type CredentialFs, type SafeStorageLike } from './credential-store'
import { createSidecarLauncher } from './launcher'
import { STORAGE_TIMEOUT_MS } from './sidecar-core'

const PATH = '/user/data/publisher-credential.bin'
const DEVICE_UID = `ppd_${'d'.repeat(24)}`

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const CHALLENGE = 'c'.repeat(32)
const CODE = 'k'.repeat(43)

/** Reversible stand-in for Electron safeStorage (DPAPI/Keychain boundary). */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from([...Buffer.from(text, 'utf8')].map((b) => b ^ 0x5a)),
    decryptString: (bytes) => {
      if (bytes.length === 0) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      return Buffer.from([...bytes].map((b) => b ^ 0x5a)).toString('utf8')
    },
  }
}

function memoryFs(): CredentialFs & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  return {
    files,
    readFile: async (p) => {
      const data = files.get(p)
      if (!data) throw missing()
      return data
    },
    writeFile: async (p, data) => void files.set(p, Buffer.from(data)),
    rename: async (from, to) => {
      const data = files.get(from)
      if (!data) throw missing()
      files.set(to, data)
      files.delete(from)
    },
    rm: async (p) => {
      if (!files.delete(p)) throw missing()
    },
  }
}

describe('credential broker (main process, safeStorage)', () => {
  it('seals to a versioned, encrypted, atomically replaced file and unseals it', async () => {
    // Defect: credentials land in plaintext (settings JSON, logs) or a torn file.
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    const secret = '{"v":1,"refreshToken":"secret-refresh"}'
    expect(await broker.seal(secret)).toEqual({ ok: true })
    const stored = fs.files.get(PATH) as Buffer
    expect(stored.subarray(0, 6).toString('utf8')).toBe('ODPC1\n')
    expect(stored.toString('utf8')).not.toContain('secret-refresh')
    expect([...fs.files.keys()]).toEqual([PATH])
    expect(await broker.unseal()).toEqual({ ok: true, data: secret })
  })

  it('refuses to store anything when encryption is unavailable (no plaintext fallback)', async () => {
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(false), fs, filePath: PATH })
    expect(await broker.seal('{"v":1}')).toEqual({ ok: false, error: 'encryption-unavailable' })
    expect(fs.files.size).toBe(0)
  })

  it.each([
    ['missing file', undefined, { ok: false, error: 'not-found' }],
    ['foreign header', Buffer.from('PLAIN{"refreshToken":"x"}'), { ok: false, error: 'corrupt' }],
    ['undecryptable body', Buffer.from('ODPC1\n'), { ok: false, error: 'corrupt' }],
  ])('reports %s as an enumerated error', async (_label, content, expected) => {
    const fs = memoryFs()
    if (content) fs.files.set(PATH, content)
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    expect(await broker.unseal()).toEqual(expected)
  })

  it('rejects oversize payloads and keeps the previous file when the atomic rename fails', async () => {
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    expect(await broker.seal('x'.repeat(16 * 1024 + 1))).toEqual({ ok: false, error: 'too-large' })
    await broker.seal('{"v":1,"n":1}')
    fs.rename = async () => Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    expect(await broker.seal('{"v":1,"n":2}')).toEqual({ ok: false, error: 'io' })
    expect(await broker.unseal()).toEqual({ ok: true, data: '{"v":1,"n":1}' })
  })

  it('applies seal and clear in request order, so sign-out cannot be undone by an in-flight refresh', async () => {
    // Defect: clear() lands between a seal's write and rename, and the rename resurrects the credential.
    const fs = memoryFs()
    const rename = fs.rename
    let releaseRename = () => {}
    fs.rename = (from, to) => new Promise<void>((resolve) => (releaseRename = () => resolve(rename(from, to))))
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    const sealing = broker.seal('{"v":1,"n":"refresh"}')
    const clearing = broker.clear()
    await vi.waitFor(() => expect(fs.files.size).toBe(1))
    releaseRename()
    expect(await sealing).toEqual({ ok: true })
    expect(await clearing).toEqual({ ok: true })
    expect(fs.files.size).toBe(0)
    expect(await broker.unseal()).toEqual({ ok: false, error: 'not-found' })
  })

  it('keeps the last of two concurrent seals and reports both truthfully', async () => {
    // Defect: concurrent seals share one temp file, so one reports ok while its bytes are lost.
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    expect(await Promise.all([broker.seal('{"n":1}'), broker.seal('{"n":2}')])).toEqual([{ ok: true }, { ok: true }])
    expect(await broker.unseal()).toEqual({ ok: true, data: '{"n":2}' })
    expect([...fs.files.keys()]).toEqual([PATH])
  })

  it('clears idempotently and never logs', async () => {
    const log = vi.spyOn(console, 'log')
    const error = vi.spyOn(console, 'error')
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    await broker.seal('{"v":1,"refreshToken":"secret"}')
    expect(await broker.clear()).toEqual({ ok: true })
    expect(await broker.clear()).toEqual({ ok: true })
    expect(await broker.unseal()).toEqual({ ok: false, error: 'not-found' })
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

describe('approval URL and callback parsing (main process)', () => {
  it.each([
    [`https://ontime.app/publisher/device/approve?challenge=${CHALLENGE}`, 'https://ontime.app', true],
    [`https://evil.example/publisher/device/approve?challenge=${CHALLENGE}`, 'https://ontime.app', false],
    [`http://localhost:5173/publisher/device/approve?challenge=${CHALLENGE}`, 'http://localhost:5173', true],
    [`https://ontime.app/publisher/device/approve?challenge=${CHALLENGE}&code=x`, 'https://ontime.app', false],
    ['file:///C:/Windows/System32/calc.exe', 'https://ontime.app', false],
  ])('opens %s for origin %s: %s', (url, origin, expected) => {
    // Defect: a compromised sidecar makes main open an arbitrary page or file.
    expect(isAllowedApprovalUrl(url, origin)).toBe(expected)
  })

  it.each([
    [`downstage-ppt-timer://publisher-auth?challenge=${CHALLENGE}&code=${CODE}`, { challengeId: CHALLENGE, code: CODE }],
    [`downstage-ppt-timer://publisher-auth/?challenge=${CHALLENGE}&code=${CODE}`, { challengeId: CHALLENGE, code: CODE }],
    [`other-app://publisher-auth?challenge=${CHALLENGE}&code=${CODE}`, null],
    [`downstage-ppt-timer://open-deck?path=C:\\deck.pptx`, null],
    [`downstage-ppt-timer://publisher-auth?challenge=${CHALLENGE}&code=short`, null],
    [`downstage-ppt-timer://publisher-auth?challenge=${CHALLENGE}&code=${CODE}&x=1`, null],
  ])('parses callback %s', (url, expected) => {
    // Defect: the app's protocol handler becomes a general command channel.
    expect(parseAuthCallbackUrl(url, 'downstage-ppt-timer')).toEqual(expected)
  })
})

describe('device approval flow (sidecar)', () => {
  function callables(overrides: Partial<AuthCallables> = {}): AuthCallables {
    return {
      beginAuth: vi.fn(async () => ({ challengeId: CHALLENGE, approvalUrl: `https://ontime.app/publisher/device/approve?challenge=${CHALLENGE}`, expiresAtMs: 1_000 + 300_000 })),
      completeAuth: vi.fn(async () => ({ customToken: 'custom-token', deviceUid: DEVICE_UID, serverNowMs: 2_000 })),
      ...overrides,
    }
  }

  it('runs PKCE through the system browser and completes with the callback code', async () => {
    const c = callables()
    const opened: string[] = []
    const result = await approveDevice({
      callables: c,
      requestApproval: (url) => void opened.push(url),
      waitForCallback: async (challengeId, timeoutMs) =>
        challengeId === CHALLENGE && timeoutMs === APPROVAL_WAIT_MS ? CODE : Promise.reject(new Error('mismatch')),
    })
    expect(result).toMatchObject({ customToken: 'custom-token', deviceUid: DEVICE_UID })
    expect(opened).toEqual([`https://ontime.app/publisher/device/approve?challenge=${CHALLENGE}`])
    const begin = (c.beginAuth as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const complete = (c.completeAuth as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(begin.callbackScheme).toBe('downstage-ppt-timer')
    expect(complete).toMatchObject({ challengeId: CHALLENGE, authorizationCode: CODE })
    // RFC 7636 S256: the challenge sent at begin is SHA-256 of the verifier sent at completion.
    expect(createHash('sha256').update(complete.codeVerifier, 'ascii').digest('base64url')).toBe(begin.codeChallenge)
    expect(complete.devicePublicKey).toMatch(/^[A-Za-z0-9_-]{32,2048}$/)
    expect(result.devicePrivateKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.stringify(opened)).not.toContain(complete.codeVerifier)
  })

  it('expires with the challenge when the owner never approves', async () => {
    await expect(
      approveDevice({
        callables: callables(),
        requestApproval: () => {},
        waitForCallback: () => Promise.reject(new Error('approval-expired')),
      }),
    ).rejects.toThrow('approval-expired')
  })

  it.each([
    ['malformed device UID', { customToken: 'custom-token', deviceUid: 'ppd_device', serverNowMs: 2_000 }],
    ['missing token', { customToken: '', deviceUid: DEVICE_UID, serverNowMs: 2_000 }],
    ['non-finite clock', { customToken: 'custom-token', deviceUid: DEVICE_UID, serverNowMs: Number.NaN }],
  ])('rejects a completion with a %s instead of persisting an unloadable credential', async (_label, completion) => {
    // Defect: a credential that load() will call corrupt is saved, silently signing out every restart.
    const c = callables({ completeAuth: vi.fn(async () => completion) })
    await expect(approveDevice({ callables: c, requestApproval: () => {}, waitForCallback: async () => CODE })).rejects.toThrow('approval-invalid')
  })

  it('refuses an approval URL outside the approval contract', async () => {
    const c = callables({ beginAuth: vi.fn(async () => ({ challengeId: CHALLENGE, approvalUrl: 'https://ontime.app/login?next=evil', expiresAtMs: 2_000 })) })
    await expect(approveDevice({ callables: c, requestApproval: () => {}, waitForCallback: async () => CODE })).rejects.toThrow('approval-rejected')
  })
})

describe('sealed credentials through the protocol (sidecar ↔ main broker)', () => {
  it('seals, loads, and clears the device credential only via main, and treats corrupt data as signed out', async () => {
    const fs = memoryFs()
    const broker = createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH })
    const { spawn, cores } = inProcessSpawner()
    const connection = await createSidecarLauncher({ spawn, broker }).start()
    const client = createCredentialsClient(cores[0].storage)
    expect(await client.load()).toEqual({ ok: false, error: 'not-found' })
    const credential = { v: 1 as const, deviceUid: DEVICE_UID, devicePrivateKey: 'cHJpdmF0ZQ', session: { any: 'json' } }
    expect(await client.save(credential)).toEqual({ ok: true })
    expect(fs.files.get(PATH)?.toString('utf8')).not.toContain('ppd_')
    expect(await client.load()).toEqual({ ok: true, credential })
    fs.files.set(PATH, Buffer.concat([Buffer.from('ODPC1\n'), fakeSafeStorage().encryptString('{"v":2}')]))
    expect(await client.load()).toEqual({ ok: false, error: 'corrupt' })
    expect(await client.clear()).toEqual({ ok: true })
    expect(fs.files.size).toBe(0)
    await connection.shutdown(500)
  })

  it.each([
    ['plain oversize', 'x'.repeat(17 * 1024)],
    ['escape-inflated', '\u0001'.repeat(3_000)],
    ['invalid shape', null],
  ])('refuses a %s credential locally without a protocol violation', async (label, session) => {
    // Defect: an oversize SEAL_REQUEST is a protocol violation, so main kills the sidecar (crash loop).
    const fs = memoryFs()
    const { spawn, cores } = inProcessSpawner()
    const connection = await createSidecarLauncher({ spawn, broker: createCredentialBroker({ safeStorage: fakeSafeStorage(), fs, filePath: PATH }) }).start()
    const exits: string[] = []
    connection.onExit((reason) => void exits.push(reason))
    const client = createCredentialsClient(cores[0].storage)
    const credential = { v: 1 as const, deviceUid: label === 'invalid shape' ? 'nope' : DEVICE_UID, devicePrivateKey: 'cHJpdmF0ZQ', session }
    expect(await client.save(credential)).toEqual({ ok: false, error: label === 'invalid shape' ? 'corrupt' : 'too-large' })
    expect(await client.load()).toEqual({ ok: false, error: 'not-found' })
    expect(exits).toEqual([])
    await connection.shutdown(500)
  })

  it('settles storage requests as io when the broker fails or never answers', async () => {
    // Defect: load()/save() hang forever and sharing is stuck in "starting" with no error.
    const { spawn, cores } = inProcessSpawner()
    const broker = {
      seal: () => Promise.reject(new Error('EIO')),
      unseal: () => new Promise<never>(() => {}),
      clear: () => Promise.resolve({ ok: true as const }),
    }
    const connection = await createSidecarLauncher({ spawn, broker }).start()
    expect(await cores[0].storage.seal('{"v":1}')).toEqual({ ok: false, error: 'io' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const loading = cores[0].storage.unseal()
    vi.advanceTimersByTime(STORAGE_TIMEOUT_MS)
    expect(await loading).toEqual({ ok: false, error: 'io' })
    vi.useRealTimers()
    await connection.shutdown(500)
  })

  it('relays the approval URL out and only the matching one-time code back in', async () => {
    const { spawn, cores } = inProcessSpawner()
    const connection = await createSidecarLauncher({ spawn }).start()
    const events: unknown[] = []
    connection.onEvent((event) => void events.push(event))
    const url = `https://ontime.app/publisher/device/approve?challenge=${CHALLENGE}`
    cores[0].requestApproval(url)
    await vi.waitFor(() => expect(events).toEqual([expect.objectContaining({ kind: 'AUTH_REQUIRED', url })]))

    // Defect: another challenge's code (e.g. from an expired attempt) completes this approval.
    await expect(cores[0].waitForCallback('s'.repeat(32), 5)).rejects.toThrow('approval-expired')
    const code = cores[0].waitForCallback(CHALLENGE, 1_000)
    expect(await connection.send({ kind: 'AUTH_CALLBACK', challengeId: 's'.repeat(32), code: 'x'.repeat(43) })).toEqual({ ok: true })
    expect(await connection.send({ kind: 'AUTH_CALLBACK', challengeId: CHALLENGE, code: CODE })).toEqual({ ok: true })
    expect(await code).toBe(CODE)
    await connection.shutdown(500)
  })
})
