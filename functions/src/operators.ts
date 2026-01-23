import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const ALLOWED_ROLES = new Set(['lx', 'ax', 'vx', 'sm', 'foh', 'custom']);

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} is required`
    );
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const requireAuthUid = (context: functions.https.CallableContext): string => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
  }
  return context.auth.uid;
};

const normalizeInviteCode = (value: string): string => value.trim().toUpperCase();

export const joinAsOperator = functions.https.onCall(async (data, context) => {
  const uid = requireAuthUid(context);
  const roomId = requireString(data?.roomId, 'roomId');
  const inviteCode = requireString(data?.inviteCode, 'inviteCode');
  const odRole = requireString(data?.odRole, 'odRole');
  const odRoleLabel = optionalString(data?.odRoleLabel);

  if (!ALLOWED_ROLES.has(odRole)) {
    return { success: false, error: 'INVALID_ROLE' };
  }

  const inviteSnap = await db.doc(`rooms/${roomId}/config/invite`).get();
  if (!inviteSnap.exists) {
    return { success: false, error: 'INVALID_INVITE' };
  }

  const invite = inviteSnap.data() as { code?: string; enabled?: boolean };
  const expected = normalizeInviteCode(invite.code ?? '');
  const provided = normalizeInviteCode(inviteCode);
  if (!invite.enabled || expected !== provided) {
    return { success: false, error: 'INVALID_INVITE' };
  }

  const blockedSnap = await db.doc(`rooms/${roomId}/blocked/${uid}`).get();
  if (blockedSnap.exists) {
    return { success: false, error: 'BLOCKED' };
  }

  const payload: Record<string, unknown> = {
    odUserId: uid,
    odRole,
    approvedAt: FieldValue.serverTimestamp(),
    approvedVia: 'invite_code',
  };

  const displayName = optionalString(context.auth?.token?.name);
  if (displayName) payload.displayName = displayName;
  const email = optionalString(context.auth?.token?.email);
  if (email) payload.email = email;
  if (odRole === 'custom' && odRoleLabel) {
    payload.odRoleLabel = odRoleLabel;
  }

  await db.doc(`rooms/${roomId}/operators/${uid}`).set(payload, { merge: true });

  return { success: true };
});
