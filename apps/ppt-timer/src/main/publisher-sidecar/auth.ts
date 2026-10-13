/**
 * Sidecar-owned publisher-device approval and credential persistence (Deep
 * Plan "Credential lifecycle"). PKCE + a one-time callback code prove the
 * approving owner used this machine; the resulting credential is stored only
 * through main's safeStorage broker and never logged, shown, or sent to the
 * renderer.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { isApprovalUrl, type StorageError } from './protocol'
import type { SidecarStorage } from './sidecar-core'

export type AuthCallables = {
  beginAuth(request: { clientRequestId: string; codeChallenge: string; callbackScheme: string }): Promise<{
    challengeId: string
    approvalUrl: string
    expiresAtMs: number
  }>
  completeAuth(request: {
    clientRequestId: string
    challengeId: string
    authorizationCode: string
    codeVerifier: string
    devicePublicKey: string
  }): Promise<{ customToken: string; deviceUid: string; serverNowMs: number }>
}

export type ApprovedDevice = { customToken: string; deviceUid: string; serverNowMs: number; devicePrivateKey: string }

/** The server's challenge TTL, measured locally: `expiresAtMs` is server-clock and skew must not shorten the wait. */
export const APPROVAL_WAIT_MS = 5 * 60_000

const DEVICE_UID = /^ppd_[A-Za-z0-9_-]{16,64}$/
const requestId = () => `req_${randomBytes(12).toString('hex')}`

export async function approveDevice(options: {
  callables: AuthCallables
  requestApproval: (url: string) => void
  waitForCallback: (challengeId: string, timeoutMs: number) => Promise<string>
  callbackScheme?: string
}): Promise<ApprovedDevice> {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const devicePublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const devicePrivateKey = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')

  const begun = await options.callables.beginAuth({
    clientRequestId: requestId(),
    codeChallenge,
    callbackScheme: options.callbackScheme ?? 'downstage-ppt-timer',
  })
  if (!isApprovalUrl(begun.approvalUrl) || new URL(begun.approvalUrl).searchParams.get('challenge') !== begun.challengeId) {
    throw new Error('approval-rejected')
  }
  options.requestApproval(begun.approvalUrl)
  const code = await options.waitForCallback(begun.challengeId, APPROVAL_WAIT_MS)
  const { customToken, deviceUid, serverNowMs } = await options.callables.completeAuth({
    clientRequestId: requestId(),
    challengeId: begun.challengeId,
    authorizationCode: code,
    codeVerifier,
    devicePublicKey,
  })
  if (!customToken || typeof customToken !== 'string' || !DEVICE_UID.test(deviceUid) || !Number.isFinite(serverNowMs)) {
    throw new Error('approval-invalid')
  }
  return { customToken, deviceUid, serverNowMs, devicePrivateKey }
}

/** The sealed device credential (opaque to main). `session` is the Firebase user's persisted state (S6c). */
export type DeviceCredential = { v: 1; deviceUid: string; devicePrivateKey: string; session: unknown }

function parseCredential(data: string): DeviceCredential | null {
  try {
    const value = JSON.parse(data) as Record<string, unknown>
    const keys = Object.keys(value).sort().join(',')
    if (keys !== 'devicePrivateKey,deviceUid,session,v' || value.v !== 1) return null
    if (typeof value.deviceUid !== 'string' || !DEVICE_UID.test(value.deviceUid)) return null
    if (typeof value.devicePrivateKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.devicePrivateKey)) return null
    return { v: 1, deviceUid: value.deviceUid, devicePrivateKey: value.devicePrivateKey, session: value.session }
  } catch {
    return null
  }
}

export function createCredentialsClient(storage: SidecarStorage) {
  return {
    async load(): Promise<{ ok: true; credential: DeviceCredential } | { ok: false; error: StorageError }> {
      const result = await storage.unseal()
      if (!result.ok) return result
      const credential = parseCredential(result.data)
      return credential ? { ok: true, credential } : { ok: false, error: 'corrupt' }
    },
    /** Refuses (as `corrupt`) a credential that load() could not read back. */
    save: (credential: DeviceCredential) => {
      const data = JSON.stringify(credential)
      return parseCredential(data) ? storage.seal(data) : Promise.resolve({ ok: false as const, error: 'corrupt' as const })
    },
    clear: () => storage.clear(),
  }
}
