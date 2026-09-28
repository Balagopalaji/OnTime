import * as functions from 'firebase-functions'
import {
  DISCONNECT_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
  computePreCommitTransit,
  parsePublishSnapshotRequestV1,
  parseRemoteSnapshotV1,
  type PublishSnapshotRequestV1,
  type RemoteSnapshotV1,
} from '@ontime/remote-viewer-contracts'
import { PUBLISHER_ROLE } from './config'
import { requestHash } from './crypto'
import { readActiveDevice, requireOwnerUser, requirePublisherClaims } from './callers'
import { db } from './firestore'
import { runIdempotent, unwrap, type Outcome } from './idempotency'
import { PATTERNS, parseRequest } from './requests'
import { readOwnedSession, sessionRef, snapshotRef, viewerStateRef, writeSessionEnded, type SessionDoc } from './sessions'

/**
 * Publish snapshot / End session (endpoints matrix). The request is parsed by
 * the shared strict contract, reconstructed, server-stamped, re-validated as a
 * stored snapshot, and committed only as the exact next sequence of the
 * current epoch. The sidecar keeps one sequence in flight, so an identical
 * same-sequence retry returns the stored result.
 */

type PublishResult = { acceptedSequence: number; publishedAtMs: number }

/** Machine-readable publish rejection reasons (HttpsError `details.reason`). */
export type PublishRejectReason = 'window-expired' | 'epoch-mismatch' | 'sequence-conflict' | 'sequence-gap' | 'clock-future' | 'session-ended'

function reject(code: functions.https.FunctionsErrorCode, message: string): Outcome<never> {
  return { ok: false, code, message }
}

function precondition(reason: PublishRejectReason, message: string, extra: Record<string, unknown> = {}): Outcome<never> {
  return { ok: false, code: 'failed-precondition', message, details: { reason, ...extra } }
}

/**
 * Idempotency identity of a publish: everything except the timing inputs the
 * sidecar recomputes before every call (including retries). `observedAtMs`
 * already identifies the observation.
 */
function publishIdentityHash(request: PublishSnapshotRequestV1): string {
  const { observationAgeMs: _age, sentAtEstimatedServerMs: _sentAt, ...identity } = request
  return requestHash('publishPresentationSnapshot', identity)
}

/** Build the stored snapshot from a parsed request plus server-owned fields. */
function toStoredSnapshot(request: PublishSnapshotRequestV1, publishedAtMs: number, preCommitTransitMs: number): RemoteSnapshotV1 {
  const { sentAtEstimatedServerMs: _sentAt, ...rest } = request
  const candidate: unknown = {
    ...rest,
    preCommitTransitMs,
    publishedAtMs,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    staleAfterMs: STALE_AFTER_MS,
    disconnectAfterMs: DISCONNECT_AFTER_MS,
  }
  const parsed = parseRemoteSnapshotV1(candidate)
  if (!parsed.ok) throw new Error(`stored snapshot failed validation: ${parsed.error.code} ${parsed.error.path}`)
  return parsed.value
}

export const publishPresentationSnapshot = functions.https.onCall(async (data, context) => {
  const caller = requirePublisherClaims(context)
  const parsed = parsePublishSnapshotRequestV1(data)
  if (!parsed.ok) {
    throw new functions.https.HttpsError('invalid-argument', `Invalid snapshot: ${parsed.error.code} at ${parsed.error.path || 'request'}`)
  }
  const request = parsed.value
  const hash = publishIdentityHash(request)

  const outcome = await db.runTransaction(async (tx): Promise<Outcome<PublishResult>> => {
    const owned = await readOwnedSession(tx, caller, request.sessionId)
    if (!owned.ok) return owned
    const session = owned.value
    const nowMs = Date.now()
    if (session.activeWindowExpiresAtMs <= nowMs) return precondition('window-expired', 'Session window expired; resume it first.')
    if (request.epoch !== session.epoch) return precondition('epoch-mismatch', 'Stale or unknown epoch.')

    if (request.sequence === session.lastSequence) {
      if (session.lastPublishResult !== null && session.lastPublishRequestHash === hash) return { ok: true, value: session.lastPublishResult }
      // The sequence committed with an earlier body: the sidecar advances to acceptedSequence + 1.
      return precondition('sequence-conflict', 'Sequence already used for a different snapshot.', {
        acceptedSequence: session.lastSequence,
      })
    }
    if (request.sequence !== session.lastSequence + 1) return precondition('sequence-gap', 'Sequence must be the next in this epoch.')

    const transit = computePreCommitTransit({
      sentAtEstimatedServerMs: request.sentAtEstimatedServerMs,
      publishedAtMs: nowMs,
      staleAfterMs: STALE_AFTER_MS,
    })
    if (transit.kind === 'future') {
      return precondition('clock-future', 'Send estimate is ahead of server time; resync the clock offset.', { serverNowMs: nowMs })
    }
    if (transit.kind !== 'measured') {
      functions.logger.warn('presentation publish transit fallback', {
        operation: 'publishPresentationSnapshot',
        sessionId: request.sessionId,
        epoch: request.epoch,
        sequence: request.sequence,
        transit: transit.kind,
      })
    }

    const snapshot = toStoredSnapshot(request, nowMs, transit.transitMs)
    const result: PublishResult = { acceptedSequence: request.sequence, publishedAtMs: nowMs }
    tx.set(snapshotRef(request.sessionId), { snapshot, cleanupAfterMs: session.cleanupAfterMs })
    tx.update(sessionRef(request.sessionId), {
      lastSequence: request.sequence,
      lastPublishRequestHash: hash,
      lastPublishResult: result,
      lastPublishAtMs: nowMs,
    })
    tx.update(viewerStateRef(request.sessionId), { lastPublishAtMs: nowMs })
    return { ok: true, value: result }
  })
  return unwrap(outcome)
})

/**
 * Owner or owning device ends the session: safe `ended` viewer state, later
 * publishes and snapshot reads rejected, cleanup in seven days. Idempotent.
 */
export const endPresentationSession = functions.https.onCall(async (data, context) => {
  const request = parseRequest(data, {
    sessionId: { pattern: PATTERNS.sessionId },
    clientRequestId: { pattern: PATTERNS.clientRequestId },
  })
  const isDevice = context.auth?.token.role === PUBLISHER_ROLE
  const device = isDevice ? requirePublisherClaims(context) : undefined
  const ownerUid = isDevice ? undefined : requireOwnerUser(context)
  const nowMs = Date.now()
  const { outcome } = await runIdempotent(
    {
      scope: device?.deviceUid ?? (ownerUid as string),
      clientRequestId: request.clientRequestId,
      operation: 'endPresentationSession',
      request,
      nowMs,
    },
    async (tx): Promise<Outcome<{ ended: true }>> => {
      if (device) {
        const active = await readActiveDevice(tx, device)
        if (!active.ok) return active
      }
      const session = (await tx.get(sessionRef(request.sessionId))).data() as SessionDoc | undefined
      if (!session) return reject('not-found', 'Unknown presentation session.')
      const manages = device ? session.publisherDeviceUid === device.deviceUid : session.ownerUid === ownerUid
      if (!manages) return reject('permission-denied', 'Not allowed to manage this session.')
      if (session.status !== 'ended') writeSessionEnded(tx, request.sessionId, nowMs)
      return { ok: true, value: { ended: true } }
    },
  )
  return unwrap(outcome)
})
