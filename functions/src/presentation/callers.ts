import * as functions from 'firebase-functions'
import type { Transaction } from 'firebase-admin/firestore'
import { COLLECTIONS, PUBLISHER_ROLE } from './config'
import { db } from './firestore'
import type { Outcome } from './idempotency'

export type PublisherCaller = { deviceUid: string; ownerUid: string }

export type DeviceDoc = {
  ownerUid: string
  label: string
  status: 'active' | 'revoked'
  devicePublicKey: string
  createdAtMs: number
  lastSeenAtMs: number
  revokedAtMs?: number
  cleanupAfterMs?: number
}

function denied(message: string): never {
  throw new functions.https.HttpsError('permission-denied', message)
}

/**
 * Guard for pre-ISSUE-002 room/lock callables: presentation publisher and
 * viewer principals are not ordinary users and get no room authority.
 */
export function rejectPresentationPrincipal(context: functions.https.CallableContext): void {
  if (context.auth?.token.role !== undefined) denied('Presentation principals cannot use room operations.')
}

const NON_OWNER_PROVIDERS = new Set(['custom', 'anonymous'])

/**
 * Allowlist: an ordinary signed-in account — no role claim and not a custom-
 * token (device/viewer) or anonymous principal.
 */
export function requireOwnerUser(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.')
  const token = context.auth?.token
  const provider = token?.firebase?.sign_in_provider
  if (token?.role !== undefined || typeof provider !== 'string' || NON_OWNER_PROVIDERS.has(provider)) {
    denied('Owner account required.')
  }
  return uid
}

/** Claims minted by completePresentationPublisherAuth; device status is checked separately. */
export function requirePublisherClaims(context: functions.https.CallableContext): PublisherCaller {
  const uid = context.auth?.uid
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.')
  const token: Record<string, unknown> = context.auth?.token ?? {}
  if (token.role !== PUBLISHER_ROLE || token.deviceUid !== uid || typeof token.ownerUid !== 'string') {
    denied('Publisher device required.')
  }
  return { deviceUid: uid, ownerUid: token.ownerUid as string }
}

export function deviceRef(deviceUid: string) {
  return db.collection(COLLECTIONS.devices).doc(deviceUid)
}

/**
 * Transactionally confirm the device is active and still owned by the claimed
 * owner. Revocation takes effect immediately, even while an ID token is valid.
 */
export async function readActiveDevice(tx: Transaction, caller: PublisherCaller): Promise<Outcome<DeviceDoc>> {
  const snap = await tx.get(deviceRef(caller.deviceUid))
  const device = snap.data() as DeviceDoc | undefined
  if (!device || device.status !== 'active' || device.ownerUid !== caller.ownerUid) {
    return { ok: false, code: 'permission-denied', message: 'Publisher device is not active.' }
  }
  return { ok: true, value: device }
}
