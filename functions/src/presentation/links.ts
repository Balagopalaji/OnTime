import * as functions from 'firebase-functions'
import type { Transaction } from 'firebase-admin/firestore'
import { PUBLISHER_ROLE, VIEWER_ROLE, serverSecret } from './config'
import { isCurrentLinkNonce, linkTokenHash, randomUrlSafe, sha256Hex } from './crypto'
import { readActiveDevice, requireOwnerUser, requirePublisherClaims, type PublisherCaller } from './callers'
import { adminAuth } from './firestore'
import { runIdempotent, unwrap, type Outcome } from './idempotency'
import { PATTERNS, parseRequest } from './requests'
import {
  assertReplayCurrent,
  linkRef,
  readOwnedSession,
  sessionRef,
  viewerLinkFor,
  viewerStateRef,
  type SessionDoc,
} from './sessions'

/**
 * Viewer links (endpoints: Issue/rotate, Revoke, Resolve). A link is an
 * opaque token whose hash names `/presentationViewerLinks/{hash}`; the viewer
 * generation is the only access generation, and rules compare it on every read.
 */

type LinkDoc = { sessionId: string; viewerGeneration: number; status: 'active' | 'revoked'; expiresAtMs: number }
type IssuedLink = { sessionId: string; linkNonce: string; viewerGeneration: number; expiresAtMs: number }

const sessionRequest = {
  sessionId: { pattern: PATTERNS.sessionId },
  clientRequestId: { pattern: PATTERNS.clientRequestId },
}

/** Create a fresh link for `generation` and point the session at it. Call after all reads. */
function writeNewLink(tx: Transaction, sessionId: string, session: SessionDoc, generation: number): IssuedLink {
  const linkNonce = randomUrlSafe(16)
  const linkDocId = viewerLinkFor(sessionId, linkNonce).tokenHash
  tx.create(linkRef(linkDocId), {
    sessionId,
    viewerGeneration: generation,
    status: 'active',
    expiresAtMs: session.activeWindowExpiresAtMs,
    cleanupAfterMs: session.cleanupAfterMs,
  })
  tx.update(sessionRef(sessionId), { viewerLinkNonce: linkNonce, viewerLinkDocId: linkDocId })
  return { sessionId, linkNonce, viewerGeneration: generation, expiresAtMs: session.activeWindowExpiresAtMs }
}

async function readCurrentLink(tx: Transaction, session: SessionDoc): Promise<LinkDoc | undefined> {
  if (session.viewerLinkDocId === null) return undefined
  return (await tx.get(linkRef(session.viewerLinkDocId))).data() as LinkDoc | undefined
}

function presentIssued(issued: IssuedLink) {
  return {
    viewerUrl: viewerLinkFor(issued.sessionId, issued.linkNonce).url,
    viewerGeneration: issued.viewerGeneration,
    expiresAtMs: issued.expiresAtMs,
  }
}

async function runLinkOperation(
  operation: string,
  data: unknown,
  context: functions.https.CallableContext,
  body: (tx: Transaction, caller: PublisherCaller, session: SessionDoc, sessionId: string) => Promise<Outcome<IssuedLink>>,
) {
  const caller = requirePublisherClaims(context)
  const request = parseRequest(data, sessionRequest)
  const nowMs = Date.now()
  const { outcome, replayed } = await runIdempotent(
    { scope: caller.deviceUid, clientRequestId: request.clientRequestId, operation, request, nowMs },
    async (tx) => {
      const owned = await readOwnedSession(tx, caller, request.sessionId)
      if (!owned.ok) return owned
      // A link past the active window could never resolve; the publisher must resume first.
      if (owned.value.activeWindowExpiresAtMs <= nowMs) {
        return { ok: false, code: 'failed-precondition', message: 'Session window expired; resume it first.' }
      }
      return body(tx, caller, owned.value, request.sessionId)
    },
  )
  const issued = unwrap(outcome)
  if (replayed) await assertReplayCurrent(issued.sessionId, issued.linkNonce)
  return presentIssued(issued)
}

/**
 * Return the current active link, or mint one at the current generation after
 * a revoke or a server-secret rotation (whose re-derived URL would not resolve).
 */
export const issuePresentationViewerLink = functions.https.onCall((data, context) =>
  runLinkOperation('issuePresentationViewerLink', data, context, async (tx, _caller, session, sessionId) => {
    const link = await readCurrentLink(tx, session)
    const nonce = session.viewerLinkNonce
    if (
      nonce !== null &&
      link?.status === 'active' &&
      link.viewerGeneration === session.viewerGeneration &&
      isCurrentLinkNonce(serverSecret(), sessionId, nonce, session.viewerLinkDocId)
    ) {
      return {
        ok: true,
        value: { sessionId, linkNonce: nonce, viewerGeneration: session.viewerGeneration, expiresAtMs: session.activeWindowExpiresAtMs },
      }
    }
    if (link && session.viewerLinkDocId !== null) tx.update(linkRef(session.viewerLinkDocId), { status: 'revoked' })
    return { ok: true, value: writeNewLink(tx, sessionId, session, session.viewerGeneration) }
  }),
)

/** Increment the generation: old links and already-signed-in viewers lose access. */
export const rotatePresentationViewerLink = functions.https.onCall((data, context) =>
  runLinkOperation('rotatePresentationViewerLink', data, context, async (tx, _caller, session, sessionId) => {
    const link = await readCurrentLink(tx, session)
    const generation = session.viewerGeneration + 1
    if (link && session.viewerLinkDocId !== null) tx.update(linkRef(session.viewerLinkDocId), { status: 'revoked' })
    tx.update(sessionRef(sessionId), { viewerGeneration: generation })
    tx.update(viewerStateRef(sessionId), { viewerGeneration: generation })
    return { ok: true, value: writeNewLink(tx, sessionId, session, generation) }
  }),
)

/**
 * Owner or owning device revokes the link: the generation increments and no
 * link remains, so current viewers' reads are denied (rendered access-ended).
 * Allowed on ended sessions to cut off the safe ended-state read.
 */
export const revokePresentationViewerLink = functions.https.onCall(async (data, context) => {
  const request = parseRequest(data, sessionRequest)
  const isDevice = context.auth?.token.role === PUBLISHER_ROLE
  const device = isDevice ? requirePublisherClaims(context) : undefined
  const ownerUid = isDevice ? undefined : requireOwnerUser(context)
  const scope = device?.deviceUid ?? (ownerUid as string)
  const { outcome } = await runIdempotent(
    { scope, clientRequestId: request.clientRequestId, operation: 'revokePresentationViewerLink', request, nowMs: Date.now() },
    async (tx): Promise<Outcome<{ revoked: true; viewerGeneration: number }>> => {
      if (device) {
        const active = await readActiveDevice(tx, device)
        if (!active.ok) return active
      }
      const session = (await tx.get(sessionRef(request.sessionId))).data() as SessionDoc | undefined
      if (!session) return { ok: false, code: 'not-found', message: 'Unknown presentation session.' }
      const manages = device ? session.publisherDeviceUid === device.deviceUid : session.ownerUid === ownerUid
      if (!manages) return { ok: false, code: 'permission-denied', message: 'Not allowed to manage this session.' }
      const link = await readCurrentLink(tx, session)
      const generation = session.viewerGeneration + 1
      if (link && session.viewerLinkDocId !== null) tx.update(linkRef(session.viewerLinkDocId), { status: 'revoked' })
      tx.update(sessionRef(request.sessionId), { viewerGeneration: generation, viewerLinkNonce: null, viewerLinkDocId: null })
      tx.update(viewerStateRef(request.sessionId), { viewerGeneration: generation })
      return { ok: true, value: { revoked: true, viewerGeneration: generation } }
    },
  )
  return unwrap(outcome)
})

/**
 * Exchange an opaque link token for a read-only viewer custom token. Every
 * failure is the same `permission-denied`, so the endpoint is not an oracle.
 * One viewer principal per session generation bounds Auth user growth.
 */
export const resolvePresentationViewerLink = functions.https.onCall(async (data) => {
  const request = parseRequest(data, {
    sessionId: { pattern: PATTERNS.sessionId },
    token: { pattern: PATTERNS.viewerToken },
  })
  const nowMs = Date.now()
  const linkDocId = linkTokenHash(request.token)
  const [linkSnap, sessionSnap] = await Promise.all([linkRef(linkDocId).get(), sessionRef(request.sessionId).get()])
  const link = linkSnap.data() as LinkDoc | undefined
  const session = sessionSnap.data() as SessionDoc | undefined
  const valid =
    link !== undefined &&
    session !== undefined &&
    link.sessionId === request.sessionId &&
    link.status === 'active' &&
    session.viewerLinkDocId === linkDocId &&
    link.viewerGeneration === session.viewerGeneration &&
    session.status === 'active' &&
    nowMs < link.expiresAtMs &&
    nowMs < session.activeWindowExpiresAtMs
  if (!valid || !session) throw new functions.https.HttpsError('permission-denied', 'Viewer link is not valid.')

  const viewerUid = `ppv_${sha256Hex(`${request.sessionId}|${session.viewerGeneration}`).slice(0, 40)}`
  const customToken = await adminAuth().createCustomToken(viewerUid, {
    role: VIEWER_ROLE,
    sessionId: request.sessionId,
    viewerGeneration: session.viewerGeneration,
  })
  return { customToken, serverNowMs: Date.now(), activeWindowExpiresAtMs: session.activeWindowExpiresAtMs }
})
