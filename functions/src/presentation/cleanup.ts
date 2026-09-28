import * as functions from 'firebase-functions'
import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { COLLECTIONS } from './config'
import { presentationViewerUid } from './crypto'
import { adminAuth, db } from './firestore'

/**
 * Scheduled cleanup of expired presentation data (endpoints: Cleanup).
 * Sessions and devices have no TTL: this job owns their deletion so every
 * dependant and Auth principal (ppv_/ppd_) is removed. Leaf collections carry
 * TTL as a safety net; rate-limit buckets are TTL-only (1 s publish windows).
 * Retry-safe, unit by unit: a session's Auth principals (resumed from a
 * persisted cursor) go before its documents, so a failure or timeout keeps
 * earlier units' progress and retries only the rest next run.
 */

export const CLEANUP_BATCH_SIZE = 200
const WRITE_BATCH_LIMIT = 400
const AUTH_DELETE_LIMIT = 1000
const AUTH_CALL_SPACING_MS = 1_100

/** Leaf collections swept by their own `cleanupAfterMs` (devices are handled with their principals). */
const SWEPT_COLLECTIONS = [
  COLLECTIONS.snapshots,
  COLLECTIONS.viewerStates,
  COLLECTIONS.links,
  COLLECTIONS.requestResults,
  COLLECTIONS.challenges,
] as const

export type CleanupMetrics = {
  sessions: number
  failedSessions: number
  /** deleteUsers uids processed this run (already-missing users count as processed). */
  authUsersProcessed: number
  swept: Record<string, number>
  /** True when a batch filled, the Auth budget ran out, or Auth throttled — more remains. */
  backlog: boolean
}

type AuthDeleteResult = { successCount: number; errors: Array<{ index: number; error: { code: string } }> }

export type AuthDeleteDeps = {
  deleteUsers: (uids: string[]) => Promise<AuthDeleteResult>
  sleep: (ms: number) => Promise<void>
  /** deleteUsers calls allowed per run (Auth allows ~1 call/s). */
  maxChunks: number
}

const THROTTLE_CODES = new Set(['auth/quota-exceeded', 'auth/too-many-requests'])

const defaultAuthDeps: AuthDeleteDeps = {
  deleteUsers: (uids) => adminAuth().deleteUsers(uids),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxChunks: 20,
}

/** Shared per-run Auth budget and ~1 call/s pacing across every cleanup unit. */
export type AuthPacer = { deps: AuthDeleteDeps; calls: number; processed: number }

export function createAuthPacer(deps: AuthDeleteDeps): AuthPacer {
  return { deps, calls: 0, processed: 0 }
}

/**
 * Delete one unit's Auth users in 1000-uid chunks through the shared pacer.
 * Per-user failures (other than already-missing) are isolated in `failed`;
 * throttling or an exhausted budget defers the remainder. `onChunk` receives
 * the exclusive end index of each chunk while no failure has occurred yet.
 */
export async function deleteUidsInChunks(
  uids: string[],
  pacer: AuthPacer,
  onChunk?: (endIndex: number) => unknown,
): Promise<{ completed: Set<string>; failed: Set<string>; deferred: boolean }> {
  const completed = new Set<string>()
  const failed = new Set<string>()
  for (let start = 0; start < uids.length; start += AUTH_DELETE_LIMIT) {
    if (pacer.calls >= pacer.deps.maxChunks) return { completed, failed, deferred: true }
    if (pacer.calls > 0) await pacer.deps.sleep(AUTH_CALL_SPACING_MS)
    pacer.calls += 1
    const chunk = uids.slice(start, start + AUTH_DELETE_LIMIT)
    let result: AuthDeleteResult
    try {
      result = await pacer.deps.deleteUsers(chunk)
    } catch (error) {
      if (THROTTLE_CODES.has((error as { code?: string }).code ?? '')) return { completed, failed, deferred: true }
      throw error
    }
    const failedIndexes = new Set(result.errors.filter((e) => e.error.code !== 'auth/user-not-found').map((e) => e.index))
    chunk.forEach((uid, index) => (failedIndexes.has(index) ? failed : completed).add(uid))
    pacer.processed += chunk.length
    // Progress covers only a clean prefix, so a failed uid is always retried next run.
    if (failed.size === 0) await onChunk?.(start + chunk.length)
  }
  return { completed, failed, deferred: false }
}

function expired(collection: string, nowMs: number, batchSize: number) {
  return db.collection(collection).where('cleanupAfterMs', '<=', nowMs).limit(batchSize).get()
}

async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += WRITE_BATCH_LIMIT) {
    const batch = db.batch()
    refs.slice(start, start + WRITE_BATCH_LIMIT).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
}

async function deleteSessionDocs(sessionId: string, sessionRef: DocumentReference): Promise<void> {
  const links = await db.collection(COLLECTIONS.links).where('sessionId', '==', sessionId).get()
  await deleteRefs([
    db.collection(COLLECTIONS.snapshots).doc(sessionId),
    db.collection(COLLECTIONS.viewerStates).doc(sessionId),
    ...links.docs.map((link) => link.ref),
  ])
  await sessionRef.delete()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function alertFailure(message: string, alert: string, fields: Record<string, unknown>, error?: unknown): void {
  functions.logger.error(message, { alert, ...fields, ...(error === undefined ? {} : { error: errorMessage(error) }) })
}

/**
 * One session: its viewer principals from the persisted cursor onward, then its
 * documents (session last). Returns false when Auth work must stop this run.
 */
async function cleanupSession(session: QueryDocumentSnapshot, pacer: AuthPacer, metrics: CleanupMetrics): Promise<boolean> {
  const generation = (session.get('viewerGeneration') as number | undefined) ?? 0
  const cleanedThrough = (session.get('viewerAuthCleanedThrough') as number | undefined) ?? 0
  const uids = Array.from({ length: Math.max(0, generation - cleanedThrough) }, (_, i) =>
    presentationViewerUid(session.id, cleanedThrough + i + 1),
  )
  try {
    const auth = await deleteUidsInChunks(uids, pacer, (end) =>
      session.ref.update({ viewerAuthCleanedThrough: cleanedThrough + end }),
    )
    if (auth.failed.size > 0) {
      metrics.failedSessions += 1
      alertFailure('presentation session cleanup failed', 'cleanup-session-failed', { sessionId: session.id, failedUsers: auth.failed.size })
    }
    if (auth.deferred || auth.failed.size > 0) return !auth.deferred
    await deleteSessionDocs(session.id, session.ref)
    metrics.sessions += 1
  } catch (error) {
    metrics.failedSessions += 1
    alertFailure('presentation session cleanup failed', 'cleanup-session-failed', { sessionId: session.id }, error)
  }
  return true
}

export async function runPresentationCleanup(
  nowMs = Date.now(),
  batchSize = CLEANUP_BATCH_SIZE,
  authDeps: AuthDeleteDeps = defaultAuthDeps,
): Promise<CleanupMetrics> {
  const metrics: CleanupMetrics = { sessions: 0, failedSessions: 0, authUsersProcessed: 0, swept: {}, backlog: false }
  const pacer = createAuthPacer(authDeps)
  const [sessions, devices] = await Promise.all([
    expired(COLLECTIONS.sessions, nowMs, batchSize),
    expired(COLLECTIONS.devices, nowMs, batchSize),
  ])
  metrics.backlog ||= sessions.size === batchSize || devices.size === batchSize

  // Unit by unit: a unit's principals, then its documents, so progress survives a timeout.
  let authOpen = true
  for (const session of sessions.docs) {
    if (!authOpen) break
    authOpen = await cleanupSession(session, pacer, metrics)
  }
  if (authOpen && !devices.empty) {
    try {
      const auth = await deleteUidsInChunks(devices.docs.map((device) => device.id), pacer)
      const clean = devices.docs.filter((device) => auth.completed.has(device.id))
      await deleteRefs(clean.map((device) => device.ref))
      if (clean.length > 0) metrics.swept[COLLECTIONS.devices] = clean.length
      if (auth.failed.size > 0) alertFailure('presentation device cleanup failed', 'cleanup-auth-failed', { failedUsers: auth.failed.size })
      authOpen = !auth.deferred
    } catch (error) {
      alertFailure('presentation device cleanup failed', 'cleanup-auth-failed', {}, error)
    }
  }
  metrics.backlog ||= !authOpen
  metrics.authUsersProcessed = pacer.processed

  for (const collection of SWEPT_COLLECTIONS) {
    const docs = await expired(collection, nowMs, batchSize)
    metrics.backlog ||= docs.size === batchSize
    if (docs.empty) continue
    await deleteRefs(docs.docs.map((doc) => doc.ref))
    metrics.swept[collection] = docs.size
  }
  return metrics
}

// 20 paced Auth calls (~25 s) plus batched deletes fit well inside an explicit 540 s budget.
export const cleanupExpiredPresentationSessions = functions
  .runWith({ timeoutSeconds: 540 })
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    const metrics = await runPresentationCleanup()
    const alert = metrics.failedSessions > 0 ? 'cleanup-session-failed' : metrics.backlog ? 'cleanup-backlog' : undefined
    const log = alert ? functions.logger.warn : functions.logger.info
    log('presentation cleanup', { ...metrics, alert })
  })
