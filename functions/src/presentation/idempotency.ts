import * as functions from 'firebase-functions'
import type { Transaction } from 'firebase-admin/firestore'
import { COLLECTIONS, REQUEST_RESULT_TTL_MS } from './config'
import { requestHash, sha256Hex } from './crypto'
import { db } from './firestore'

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: functions.https.FunctionsErrorCode; message: string }

/**
 * Outcomes that a later retry may legitimately change (cap freed, target
 * created) or that name no resource are not persisted.
 */
const NON_DURABLE_CODES = new Set<functions.https.FunctionsErrorCode>(['resource-exhausted', 'not-found'])

export function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new functions.https.HttpsError(outcome.code, outcome.message)
  return outcome.value
}

/**
 * Run `body` inside one transaction together with a durable request result at
 * `/presentationRequestResults/{sha256(scope, clientRequestId)}`. A retry with the
 * same normalized request returns the stored outcome (success or error)
 * without re-running `body`; reusing the ID for a different request is
 * `already-exists`. `body` must perform all its reads before its writes.
 */
export async function runIdempotent<T>(
  key: { scope: string; clientRequestId: string; operation: string; request: unknown; nowMs: number },
  body: (tx: Transaction) => Promise<Outcome<T>>,
): Promise<{ outcome: Outcome<T>; replayed: boolean }> {
  // Hashed so `_`-containing scopes and IDs cannot collide.
  const ref = db.collection(COLLECTIONS.requestResults).doc(sha256Hex(`${key.scope}\n${key.clientRequestId}`))
  const hash = requestHash(key.operation, key.request)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) {
      const stored = snap.data() as { operation: string; requestHash: string; outcome: Outcome<T> }
      if (stored.operation !== key.operation || stored.requestHash !== hash) {
        return {
          outcome: { ok: false, code: 'already-exists', message: 'clientRequestId was used for a different request.' },
          replayed: true,
        }
      }
      return { outcome: stored.outcome, replayed: true }
    }
    const outcome = await body(tx)
    if (!outcome.ok && NON_DURABLE_CODES.has(outcome.code)) return { outcome, replayed: false }
    tx.set(ref, {
      operation: key.operation,
      requestHash: hash,
      outcome,
      createdAtMs: key.nowMs,
      cleanupAfterMs: key.nowMs + REQUEST_RESULT_TTL_MS,
    })
    return { outcome, replayed: false }
  })
}
