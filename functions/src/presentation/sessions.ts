import * as functions from 'firebase-functions'
import type { Transaction } from 'firebase-admin/firestore'
import {
  ACTIVE_WINDOW_MS,
  COLLECTIONS,
  INACTIVE_CLEANUP_MS,
  MAX_ACTIVE_SESSIONS_PER_OWNER,
  serverSecret,
  viewerUrl,
} from './config'
import { deriveViewerLinkToken, isCurrentLinkNonce, linkTokenHash, randomUrlSafe } from './crypto'
import { readActiveDevice, requirePublisherClaims, type PublisherCaller } from './callers'
import { db } from './firestore'
import { runIdempotent, unwrap, type Outcome } from './idempotency'
import { PATTERNS, parseRequest } from './requests'
import { RATE_LIMITS, enforceRateLimit } from './rate-limit'

/** Server-only session document (clients are denied; see endpoints data model). */
export type SessionDoc = {
  ownerUid: string
  publisherDeviceUid: string
  epoch: number
  lastSequence: number
  lastPublishRequestHash: string | null
  lastPublishResult: { acceptedSequence: number; publishedAtMs: number } | null
  status: 'active' | 'ended'
  sourceKind: 'powerpoint'
  roomId?: string
  viewerGeneration: number
  /** Nonce from which the current viewer-link token is derived; null after the link is revoked. */
  viewerLinkNonce: string | null
  /** Current link document ID (token hash); stored so link updates survive a server-secret rotation. */
  viewerLinkDocId: string | null
  activeWindowExpiresAtMs: number
  lastPublishAtMs: number | null
  createdAtMs: number
  cleanupAfterMs: number
}

export const sessionRef = (sessionId: string) => db.collection(COLLECTIONS.sessions).doc(sessionId)
export const viewerStateRef = (sessionId: string) => db.collection(COLLECTIONS.viewerStates).doc(sessionId)
export const linkRef = (tokenHash: string) => db.collection(COLLECTIONS.links).doc(tokenHash)
export const snapshotRef = (sessionId: string) => db.collection(COLLECTIONS.snapshots).doc(sessionId)

export function viewerLinkFor(sessionId: string, linkNonce: string): { token: string; tokenHash: string; url: string } {
  const token = deriveViewerLinkToken(serverSecret(), sessionId, linkNonce)
  return { token, tokenHash: linkTokenHash(token), url: viewerUrl(sessionId, token) }
}

/** URL for the session's current link, or null when revoked or minted under a rotated secret. */
export function currentViewerUrl(sessionId: string, linkNonce: string | null, linkDocId: string | null): string | null {
  if (linkNonce === null || !isCurrentLinkNonce(serverSecret(), sessionId, linkNonce, linkDocId)) return null
  return viewerLinkFor(sessionId, linkNonce).url
}

function cleanupAfter(activeWindowExpiresAtMs: number): number {
  return activeWindowExpiresAtMs + INACTIVE_CLEANUP_MS
}

/** Active sessions for the owner, excluding `exceptSessionId`, read inside the transaction. */
async function activeSessionCount(tx: Transaction, ownerUid: string, nowMs: number, exceptSessionId?: string) {
  const query = db
    .collection(COLLECTIONS.sessions)
    .where('ownerUid', '==', ownerUid)
    .where('status', '==', 'active')
  const snap = await tx.get(query)
  return snap.docs.filter((doc) => doc.id !== exceptSessionId && (doc.get('activeWindowExpiresAtMs') as number) > nowMs).length
}

const capReached: Outcome<never> = {
  ok: false,
  code: 'resource-exhausted',
  message: `At most ${MAX_ACTIVE_SESSIONS_PER_OWNER} active presentation sessions per account.`,
}

type CreatedSession = { sessionId: string; linkNonce: string; viewerGeneration: number; epoch: number; activeWindowExpiresAtMs: number }

export const createPresentationSession = functions.https.onCall(async (data, context) => {
  const caller = requirePublisherClaims(context)
  const request = parseRequest(data, {
    clientRequestId: { pattern: PATTERNS.clientRequestId },
    roomId: { pattern: PATTERNS.roomId, optional: true },
  })
  await enforceRateLimit(RATE_LIMITS.createPerOwner, caller.ownerUid, { failOpen: false })
  const nowMs = Date.now()
  const { outcome, replayed } = await runIdempotent(
    { scope: caller.deviceUid, clientRequestId: request.clientRequestId, operation: 'createPresentationSession', request, nowMs },
    async (tx): Promise<Outcome<CreatedSession>> => {
      const device = await readActiveDevice(tx, caller)
      if (!device.ok) return device
      if ((await activeSessionCount(tx, caller.ownerUid, nowMs)) >= MAX_ACTIVE_SESSIONS_PER_OWNER) return capReached

      const sessionId = randomUrlSafe(15)
      const linkNonce = randomUrlSafe(16)
      const linkDocId = viewerLinkFor(sessionId, linkNonce).tokenHash
      const activeWindowExpiresAtMs = nowMs + ACTIVE_WINDOW_MS
      const cleanupAfterMs = cleanupAfter(activeWindowExpiresAtMs)
      const session: SessionDoc = {
        ownerUid: caller.ownerUid,
        publisherDeviceUid: caller.deviceUid,
        epoch: 1,
        lastSequence: 0,
        lastPublishRequestHash: null,
        lastPublishResult: null,
        status: 'active',
        sourceKind: 'powerpoint',
        ...(request.roomId === undefined ? {} : { roomId: request.roomId }),
        viewerGeneration: 1,
        viewerLinkNonce: linkNonce,
        viewerLinkDocId: linkDocId,
        activeWindowExpiresAtMs,
        lastPublishAtMs: null,
        createdAtMs: nowMs,
        cleanupAfterMs,
      }
      tx.create(sessionRef(sessionId), session)
      tx.create(viewerStateRef(sessionId), {
        status: 'active',
        sourceKind: 'powerpoint',
        viewerGeneration: 1,
        activeWindowExpiresAtMs,
        lastPublishAtMs: null,
        cleanupAfterMs,
      })
      tx.create(linkRef(linkDocId), {
        sessionId,
        viewerGeneration: 1,
        status: 'active',
        expiresAtMs: activeWindowExpiresAtMs,
        cleanupAfterMs,
      })
      return { ok: true, value: { sessionId, linkNonce, viewerGeneration: 1, epoch: 1, activeWindowExpiresAtMs } }
    },
  )
  const created = unwrap(outcome)
  if (replayed) await assertReplayCurrent(created.sessionId, created.linkNonce)
  return {
    sessionId: created.sessionId,
    viewerUrl: viewerLinkFor(created.sessionId, created.linkNonce).url,
    viewerGeneration: created.viewerGeneration,
    epoch: created.epoch,
    activeWindowExpiresAtMs: created.activeWindowExpiresAtMs,
  }
})

/**
 * A replayed create/resume result is returned only while it still describes
 * the session: active, same link (not rotated, secret unchanged), same epoch.
 */
export async function assertReplayCurrent(sessionId: string, linkNonce: string | null, epoch?: number): Promise<void> {
  const session = (await sessionRef(sessionId).get()).data() as SessionDoc | undefined
  const current =
    session !== undefined &&
    session.status === 'active' &&
    session.viewerLinkNonce === linkNonce &&
    (linkNonce === null || isCurrentLinkNonce(serverSecret(), sessionId, linkNonce, session.viewerLinkDocId)) &&
    (epoch === undefined || session.epoch === epoch)
  if (!current) {
    throw new functions.https.HttpsError('failed-precondition', 'Session changed since this request; retry with a new clientRequestId.')
  }
}

/**
 * Safe ended state: session rejects publish/snapshot reads, the current viewer
 * generation sees `ended`, and the last snapshot (titles/labels) is deleted.
 */
export function writeSessionEnded(tx: Transaction, sessionId: string, nowMs: number): void {
  const cleanupAfterMs = nowMs + INACTIVE_CLEANUP_MS
  tx.update(sessionRef(sessionId), { status: 'ended', endedAtMs: nowMs, cleanupAfterMs })
  tx.update(viewerStateRef(sessionId), { status: 'ended', cleanupAfterMs })
  tx.delete(snapshotRef(sessionId))
}

/** Owning active device, still-active session; used by resume and later link/publish/end operations. */
export async function readOwnedSession(
  tx: Transaction,
  caller: PublisherCaller,
  sessionId: string,
): Promise<Outcome<SessionDoc>> {
  const device = await readActiveDevice(tx, caller)
  if (!device.ok) return device
  const session = (await tx.get(sessionRef(sessionId))).data() as SessionDoc | undefined
  if (!session) return { ok: false, code: 'not-found', message: 'Unknown presentation session.' }
  if (session.publisherDeviceUid !== caller.deviceUid || session.ownerUid !== caller.ownerUid) {
    return { ok: false, code: 'permission-denied', message: 'Another device publishes this session.' }
  }
  if (session.status !== 'active') {
    return { ok: false, code: 'failed-precondition', message: 'Presentation session has ended.', details: { reason: 'session-ended' } }
  }
  return { ok: true, value: session }
}

type ResumedSession = {
  sessionId: string
  linkNonce: string | null
  linkDocId: string | null
  epoch: number
  activeWindowExpiresAtMs: number
}

export const resumePresentationSession = functions.https.onCall(async (data, context) => {
  const caller = requirePublisherClaims(context)
  const request = parseRequest(data, {
    sessionId: { pattern: PATTERNS.sessionId },
    clientRequestId: { pattern: PATTERNS.clientRequestId },
  })
  await enforceRateLimit(RATE_LIMITS.resumePerDevice, caller.deviceUid, { failOpen: false })
  const nowMs = Date.now()
  const { outcome, replayed } = await runIdempotent(
    { scope: caller.deviceUid, clientRequestId: request.clientRequestId, operation: 'resumePresentationSession', request, nowMs },
    async (tx): Promise<Outcome<ResumedSession>> => {
      const owned = await readOwnedSession(tx, caller, request.sessionId)
      if (!owned.ok) return owned
      const session = owned.value
      // Re-activating an expired window counts against the per-owner cap.
      if (session.activeWindowExpiresAtMs <= nowMs) {
        const others = await activeSessionCount(tx, caller.ownerUid, nowMs, request.sessionId)
        if (others >= MAX_ACTIVE_SESSIONS_PER_OWNER) return capReached
      }
      const epoch = session.epoch + 1
      const activeWindowExpiresAtMs = nowMs + ACTIVE_WINDOW_MS
      const cleanupAfterMs = cleanupAfter(activeWindowExpiresAtMs)
      tx.update(sessionRef(request.sessionId), {
        epoch,
        lastSequence: 0,
        lastPublishRequestHash: null,
        lastPublishResult: null,
        activeWindowExpiresAtMs,
        cleanupAfterMs,
      })
      tx.update(viewerStateRef(request.sessionId), { activeWindowExpiresAtMs, cleanupAfterMs })
      if (session.viewerLinkDocId !== null) {
        tx.update(linkRef(session.viewerLinkDocId), { expiresAtMs: activeWindowExpiresAtMs, cleanupAfterMs })
      }
      return {
        ok: true,
        value: {
          sessionId: request.sessionId,
          linkNonce: session.viewerLinkNonce,
          linkDocId: session.viewerLinkDocId,
          epoch,
          activeWindowExpiresAtMs,
        },
      }
    },
  )
  const resumed = unwrap(outcome)
  if (replayed) await assertReplayCurrent(resumed.sessionId, resumed.linkNonce, resumed.epoch)
  return {
    epoch: resumed.epoch,
    // null when the link was revoked or the secret rotated; the publisher issues a new one explicitly.
    viewerUrl: currentViewerUrl(resumed.sessionId, resumed.linkNonce, resumed.linkDocId),
    activeWindowExpiresAtMs: resumed.activeWindowExpiresAtMs,
  }
})
