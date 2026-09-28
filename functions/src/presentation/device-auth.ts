import * as functions from 'firebase-functions'
import {
  CHALLENGE_TTL_MS,
  COLLECTIONS,
  PUBLISHER_ROLE,
  REVOKED_DEVICE_AUDIT_MS,
  approvalUrl,
  publisherCallbackScheme,
} from './config'
import { randomUrlSafe, sha256Hex, timingSafeEqualString, verifyPkceS256 } from './crypto'
import {
  deviceRef,
  readActiveDevice,
  requireOwnerUser,
  requirePublisherClaims,
  type DeviceDoc,
} from './callers'
import { adminAuth, db } from './firestore'
import { runIdempotent, unwrap, type Outcome } from './idempotency'
import { writeSessionEnded } from './sessions'
import { PATTERNS, parseRequest } from './requests'
import { RATE_LIMITS, enforceRateLimit, ipScope } from './rate-limit'

/**
 * Publisher-device approval (endpoints: Begin/Approve/Complete/Refresh/Revoke).
 * The app starts a PKCE challenge, the signed-in owner approves it in the web
 * app, and the app proves the verifier to receive a dedicated device
 * principal — never the owner's own session.
 *
 * Approval also mints a one-time authorization code that reaches only the
 * approving machine through the registered app callback URI. Completion needs
 * both code and verifier, so an attacker who starts a flow and lures an owner
 * into approving it cannot finish it.
 */

type ChallengeDoc = {
  codeChallenge: string
  callbackScheme: string
  status: 'pending' | 'approved' | 'denied' | 'consumed' | 'failed'
  approvedOwnerUid?: string
  /** SHA-256 of the one-time code handed to the approving machine's app callback. */
  authorizationCodeHash?: string
  deviceUid?: string
  createdAtMs: number
  expiresAtMs: number
  cleanupAfterMs: number
}

const challengeRef = (challengeId: string) => db.collection(COLLECTIONS.challenges).doc(challengeId)

export const beginPresentationPublisherAuth = functions.https.onCall(async (data, context) => {
  const request = parseRequest(data, {
    clientRequestId: { pattern: PATTERNS.clientRequestId },
    codeChallenge: { pattern: PATTERNS.codeChallenge },
    callbackScheme: { pattern: PATTERNS.callbackScheme },
  })
  await enforceRateLimit(RATE_LIMITS.publisherAuthPerIp, ipScope(context.rawRequest?.ip), { failOpen: false })
  if (request.callbackScheme !== publisherCallbackScheme()) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid request field: callbackScheme')
  }
  const nowMs = Date.now()
  const { outcome } = await runIdempotent(
    {
      scope: `begin_${request.codeChallenge}`,
      clientRequestId: request.clientRequestId,
      operation: 'beginPresentationPublisherAuth',
      request,
      nowMs,
    },
    async (tx): Promise<Outcome<{ challengeId: string; expiresAtMs: number }>> => {
      const challengeId = randomUrlSafe(24)
      const challenge: ChallengeDoc = {
        codeChallenge: request.codeChallenge,
        callbackScheme: request.callbackScheme,
        status: 'pending',
        createdAtMs: nowMs,
        expiresAtMs: nowMs + CHALLENGE_TTL_MS,
        cleanupAfterMs: nowMs + CHALLENGE_TTL_MS,
      }
      tx.create(challengeRef(challengeId), challenge)
      return { ok: true, value: { challengeId, expiresAtMs: challenge.expiresAtMs } }
    },
  )
  const begun = unwrap(outcome)
  return { challengeId: begun.challengeId, approvalUrl: approvalUrl(begun.challengeId), expiresAtMs: begun.expiresAtMs }
})

export const approvePresentationPublisherAuth = functions.https.onCall(async (data, context) => {
  const ownerUid = requireOwnerUser(context)
  const request = parseRequest(data, {
    challengeId: { pattern: PATTERNS.challengeId },
    decision: { pattern: PATTERNS.decision },
  })
  const nowMs = Date.now()
  type Decision = { status: 'approved'; callbackUrl: string } | { status: 'denied' }
  const outcome = await db.runTransaction(async (tx): Promise<Outcome<Decision>> => {
    const ref = challengeRef(request.challengeId)
    const challenge = (await tx.get(ref)).data() as ChallengeDoc | undefined
    if (!challenge) return { ok: false, code: 'not-found', message: 'Unknown approval request.' }
    if (challenge.status !== 'pending') return { ok: false, code: 'failed-precondition', message: 'Approval already decided.' }
    if (nowMs > challenge.expiresAtMs) return { ok: false, code: 'deadline-exceeded', message: 'Approval request expired.' }
    if (request.decision === 'deny') {
      tx.update(ref, { status: 'denied', approvedOwnerUid: ownerUid, decidedAtMs: nowMs })
      return { ok: true, value: { status: 'denied' } }
    }
    const code = randomUrlSafe(32)
    tx.update(ref, { status: 'approved', approvedOwnerUid: ownerUid, authorizationCodeHash: sha256Hex(code), decidedAtMs: nowMs })
    const query = `challenge=${encodeURIComponent(request.challengeId)}&code=${code}`
    return { ok: true, value: { status: 'approved', callbackUrl: `${challenge.callbackScheme}://publisher-auth?${query}` } }
  })
  return unwrap(outcome)
})

export const completePresentationPublisherAuth = functions.https.onCall(async (data, context) => {
  const request = parseRequest(data, {
    clientRequestId: { pattern: PATTERNS.clientRequestId },
    challengeId: { pattern: PATTERNS.challengeId },
    authorizationCode: { pattern: PATTERNS.authorizationCode },
    codeVerifier: { pattern: PATTERNS.codeVerifier },
    devicePublicKey: { pattern: PATTERNS.devicePublicKey },
  })
  await enforceRateLimit(RATE_LIMITS.publisherAuthPerIp, ipScope(context.rawRequest?.ip), { failOpen: false })
  const nowMs = Date.now()
  const { outcome } = await runIdempotent(
    {
      scope: `challenge_${request.challengeId}`,
      clientRequestId: request.clientRequestId,
      operation: 'completePresentationPublisherAuth',
      request,
      nowMs,
    },
    async (tx): Promise<Outcome<{ deviceUid: string; ownerUid: string }>> => {
      const ref = challengeRef(request.challengeId)
      const challenge = (await tx.get(ref)).data() as ChallengeDoc | undefined
      if (!challenge) return { ok: false, code: 'not-found', message: 'Unknown approval request.' }
      if (challenge.status !== 'approved' || !challenge.approvedOwnerUid) {
        return { ok: false, code: 'failed-precondition', message: 'Approval is not available.' }
      }
      if (nowMs > challenge.expiresAtMs) return { ok: false, code: 'deadline-exceeded', message: 'Approval request expired.' }
      const codeMatches =
        challenge.authorizationCodeHash !== undefined &&
        timingSafeEqualString(sha256Hex(request.authorizationCode), challenge.authorizationCodeHash)
      if (
        !codeMatches ||
        challenge.callbackScheme !== publisherCallbackScheme() ||
        !verifyPkceS256(request.codeVerifier, challenge.codeChallenge)
      ) {
        // One attempt only: a wrong verifier burns the challenge.
        tx.update(ref, { status: 'failed', decidedAtMs: nowMs })
        return { ok: false, code: 'permission-denied', message: 'Approval proof rejected.' }
      }
      const deviceUid = `ppd_${randomUrlSafe(18)}`
      const device: DeviceDoc = {
        ownerUid: challenge.approvedOwnerUid,
        label: 'PPT Timer',
        status: 'active',
        devicePublicKey: request.devicePublicKey,
        createdAtMs: nowMs,
        lastSeenAtMs: nowMs,
      }
      tx.create(deviceRef(deviceUid), device)
      tx.update(ref, { status: 'consumed', deviceUid, consumedAtMs: nowMs })
      return { ok: true, value: { deviceUid, ownerUid: challenge.approvedOwnerUid } }
    },
  )
  const { deviceUid, ownerUid } = unwrap(outcome)
  // A lost-response retry re-mints only for a still-active device inside the challenge window.
  const device = (await deviceRef(deviceUid).get()).data() as DeviceDoc | undefined
  if (!device || device.status !== 'active' || Date.now() - device.createdAtMs > CHALLENGE_TTL_MS) {
    throw new functions.https.HttpsError('failed-precondition', 'Approval is no longer available.')
  }
  const customToken = await adminAuth().createCustomToken(deviceUid, { role: PUBLISHER_ROLE, ownerUid, deviceUid })
  return { customToken, deviceUid, serverNowMs: Date.now() }
})

export const refreshPresentationPublisherDevice = functions.https.onCall(async (data, context) => {
  const caller = requirePublisherClaims(context)
  parseRequest(data, { clientRequestId: { pattern: PATTERNS.clientRequestId } })
  await enforceRateLimit(RATE_LIMITS.refreshPerDevice, caller.deviceUid, { failOpen: false })
  const nowMs = Date.now()
  const outcome = await db.runTransaction(async (tx) => {
    const device = await readActiveDevice(tx, caller)
    if (device.ok) tx.update(deviceRef(caller.deviceUid), { lastSeenAtMs: nowMs })
    return device
  })
  unwrap(outcome)
  return { status: 'active' as const, serverNowMs: nowMs }
})

export const revokePresentationPublisherDevice = functions.https.onCall(async (data, context) => {
  const request = parseRequest(data, {
    deviceUid: { pattern: PATTERNS.deviceUid },
    clientRequestId: { pattern: PATTERNS.clientRequestId },
  })
  const callerUid = context.auth?.uid
  if (!callerUid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.')
  // The owner revokes (lost device) or the device revokes itself (sign-out).
  const isSelf = callerUid === request.deviceUid && requirePublisherClaims(context).deviceUid === request.deviceUid
  const ownerUid = isSelf ? undefined : requireOwnerUser(context)
  const nowMs = Date.now()
  const outcome = await db.runTransaction(async (tx): Promise<Outcome<{ status: 'revoked' }>> => {
    const ref = deviceRef(request.deviceUid)
    const device = (await tx.get(ref)).data() as DeviceDoc | undefined
    if (!device) return { ok: false, code: 'not-found', message: 'Unknown device.' }
    if (!isSelf && device.ownerUid !== ownerUid) return { ok: false, code: 'permission-denied', message: 'Not the device owner.' }
    // A revoked device's sessions end immediately: viewers see `ended` and the owner's cap frees.
    const sessions = await tx.get(
      db.collection(COLLECTIONS.sessions)
        .where('publisherDeviceUid', '==', request.deviceUid)
        .where('status', '==', 'active'),
    )
    if (device.status !== 'revoked') {
      tx.update(ref, { status: 'revoked', revokedAtMs: nowMs, cleanupAfterMs: nowMs + REVOKED_DEVICE_AUDIT_MS })
    }
    for (const session of sessions.docs) writeSessionEnded(tx, session.id, nowMs)
    return { ok: true, value: { status: 'revoked' } }
  })
  const result = unwrap(outcome)
  await adminAuth().revokeRefreshTokens(request.deviceUid)
  return result
})
