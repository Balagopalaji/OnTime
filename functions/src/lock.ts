import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

const STALE_THRESHOLD_MS = 90_000;
const FORCE_TAKEOVER_TIMEOUT_MS = 30_000;
const HANDOVER_PRESENCE_FRESH_MS = 30_000;
const REAUTH_WINDOW_S = 300; // 5 minutes – how recently auth_time must be

if (admin.apps.length === 0) {
  admin.initializeApp();
}

type ControlPolicy = 'exclusive';

type ControllerLock = {
  clientId: string;
  userId: string;
  deviceName?: string;
  userName?: string;
  lockedAt: admin.firestore.Timestamp;
  lastHeartbeat: admin.firestore.Timestamp;
  controlPolicy?: ControlPolicy;
};

type ControlRequest = {
  requesterId: string;
  requesterClientId: string;
  requestedAt: admin.firestore.Timestamp;
  status: 'pending' | 'denied' | 'fulfilled' | 'expired';
};

type ControlRequestIdentity = Pick<ControlRequest, 'requesterId' | 'requesterClientId'>;

type ForceTakeoverDecisionInput = {
  nowMs: number;
  authTime: unknown;
  reauthenticated?: boolean;
  reauthRequired?: boolean;
  pinMatches: boolean;
  isStale: boolean;
  request: Partial<ControlRequest> | null;
  callerUserId: string;
  callerClientId: string;
};

type ForceTakeoverDecision = {
  authorized: boolean;
  reauthVerified: boolean;
  requestTimedOut: boolean;
};

type ControllerPresence = {
  clientId: string;
  userId: string;
  deviceName?: string;
  userName?: string;
  clientType?: 'controller' | 'viewer';
  lastHeartbeat?: admin.firestore.Timestamp;
};

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} is required`
    );
  }
  return value;
};

const optionalString = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be a string`
    );
  }
  return value;
};

const requireAuthUid = (context: functions.https.CallableContext): string => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
  }
  return context.auth.uid;
};

const resolveUserId = (
  dataUserId: unknown,
  context: functions.https.CallableContext
): string => {
  const authUid = requireAuthUid(context);
  if (typeof dataUserId === 'string' && dataUserId !== authUid) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'userId does not match authenticated user.'
    );
  }
  return authUid;
};

const toMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) {
    return value.toMillis();
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};

const isLockStale = (lock: Partial<ControllerLock>, now: admin.firestore.Timestamp) => {
  const lastHeartbeatMs = toMillis(lock.lastHeartbeat);
  const lockedAtMs = toMillis(lock.lockedAt);
  const baselineMs = lastHeartbeatMs ?? lockedAtMs;
  if (!baselineMs) return true;
  return now.toMillis() - baselineMs >= STALE_THRESHOLD_MS;
};

const hasFreshReauth = ({
  authTime,
  nowMs,
}: {
  authTime: unknown;
  nowMs: number;
}): boolean => {
  if (typeof authTime !== 'number' || !Number.isFinite(authTime) || authTime <= 0) {
    return false;
  }
  const nowS = Math.floor(nowMs / 1000);
  return nowS >= authTime && (nowS - authTime) <= REAUTH_WINDOW_S;
};

const isPendingRequestCallerMatch = ({
  request,
  callerUserId,
  callerClientId,
}: {
  request: Partial<ControlRequestIdentity>;
  callerUserId: string;
  callerClientId: string;
}): boolean => {
  const requesterClientId =
    typeof request.requesterClientId === 'string' ? request.requesterClientId : undefined;
  const requesterId = typeof request.requesterId === 'string' ? request.requesterId : undefined;

  // Timeout authorization is strictly requester-client bound. Legacy/malformed
  // requests without requesterClientId are denied.
  if (!requesterClientId) {
    return false;
  }
  if (requesterClientId !== callerClientId) {
    return false;
  }
  // requesterId, when present, must also match the authenticated caller.
  if (requesterId && requesterId !== callerUserId) {
    return false;
  }
  return true;
};

export const evaluateForceTakeoverDecision = (
  input: ForceTakeoverDecisionInput
): ForceTakeoverDecision => {
  const reauthRequested = Boolean(input.reauthenticated ?? input.reauthRequired);
  const reauthVerified = reauthRequested
    ? hasFreshReauth({ authTime: input.authTime, nowMs: input.nowMs })
    : false;

  let requestTimedOut = false;
  if (input.request?.status === 'pending') {
    const requestedAtMs = toMillis(input.request.requestedAt);
    if (requestedAtMs !== null) {
      const elapsedMs = input.nowMs - requestedAtMs;
      if (
        elapsedMs >= FORCE_TAKEOVER_TIMEOUT_MS &&
        isPendingRequestCallerMatch({
          request: input.request,
          callerUserId: input.callerUserId,
          callerClientId: input.callerClientId,
        })
      ) {
        requestTimedOut = true;
      }
    }
  }

  return {
    reauthVerified,
    requestTimedOut,
    authorized: input.pinMatches || input.isStale || requestTimedOut || reauthVerified,
  };
};

const buildLockData = (params: {
  clientId: string;
  userId: string;
  deviceName?: string;
  userName?: string;
  now: admin.firestore.Timestamp;
}): ControllerLock => {
  const data: any = {
    clientId: params.clientId,
    userId: params.userId,
    lockedAt: params.now,
    lastHeartbeat: params.now,
    controlPolicy: 'exclusive',
  };
  if (params.deviceName !== undefined) data.deviceName = params.deviceName;
  if (params.userName !== undefined) data.userName = params.userName;
  return data as ControllerLock;
};

const lockRef = (roomId: string) => admin.firestore().doc(`rooms/${roomId}/lock/current`);
const pinRef = (roomId: string) => admin.firestore().doc(`rooms/${roomId}/config/pin`);
const controlRequestRef = (roomId: string) =>
  admin.firestore().doc(`rooms/${roomId}/controlRequest/current`);
const clientRef = (roomId: string, clientId: string) =>
  admin.firestore().doc(`rooms/${roomId}/clients/${clientId}`);

export const acquireLock = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const clientId = requireString(data?.clientId, 'clientId');
  const userId = resolveUserId(data?.userId, context);
  const deviceName = optionalString(data?.deviceName, 'deviceName');
  const userName = optionalString(data?.userName, 'userName');
  const forceIfStale = Boolean(data?.forceIfStale);
  const now = admin.firestore.Timestamp.now();

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(roomId));
    if (!snap.exists) {
      const newLock = buildLockData({ clientId, userId, deviceName, userName, now });
      tx.set(lockRef(roomId), newLock);
      return { success: true, lock: newLock };
    }

    const existing = snap.data() as ControllerLock;
    if (existing.clientId === clientId && existing.userId === userId) {
      tx.update(lockRef(roomId), { lastHeartbeat: now });
      return {
        success: true,
        lock: { ...existing, lastHeartbeat: now },
      };
    }

    if (isLockStale(existing, now)) {
      if (forceIfStale) {
        const newLock = buildLockData({
          clientId,
          userId,
          deviceName,
          userName,
          now,
        });
        tx.set(lockRef(roomId), newLock);
        return { success: true, lock: newLock };
      }
      return { success: false, error: 'LOCK_STALE', staleLock: existing };
    }

    return { success: false, error: 'CONTROLLER_TAKEN', currentLock: existing };
  });
});

export const releaseLock = functions.https.onCall(async (data, context) => {
  const authUid = requireAuthUid(context);
  const roomId = requireString(data?.roomId, 'roomId');
  const clientId = requireString(data?.clientId, 'clientId');

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(roomId));
    if (!snap.exists) {
      return { success: true };
    }
    const existing = snap.data() as ControllerLock;
    if (existing.clientId !== clientId || existing.userId !== authUid) {
      return { success: false, error: 'NOT_LOCK_HOLDER' };
    }
    tx.delete(lockRef(roomId));
    return { success: true };
  });
});

export const updateHeartbeat = functions.https.onCall(async (data, context) => {
  const authUid = requireAuthUid(context);
  const roomId = requireString(data?.roomId, 'roomId');
  const clientId = requireString(data?.clientId, 'clientId');
  const now = admin.firestore.Timestamp.now();

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(roomId));
    if (!snap.exists) {
      return { success: false, error: 'NOT_LOCK_HOLDER' };
    }
    const existing = snap.data() as ControllerLock;
    if (existing.clientId !== clientId || existing.userId !== authUid) {
      return { success: false, error: 'NOT_LOCK_HOLDER' };
    }
    tx.update(lockRef(roomId), { lastHeartbeat: now });
    return { success: true };
  });
});

export const requestControl = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const requesterClientId = requireString(data?.clientId, 'clientId');
  const requesterId = resolveUserId(data?.userId, context);
  const now = admin.firestore.Timestamp.now();

  const lockSnap = await lockRef(roomId).get();
  if (!lockSnap.exists) {
    return { success: false, error: 'NO_ACTIVE_LOCK' };
  }
  const existingLock = lockSnap.data() as ControllerLock;
  if (existingLock.userId === requesterId && existingLock.clientId === requesterClientId) {
    return { success: false, error: 'ALREADY_LOCK_HOLDER' };
  }

  const request: ControlRequest = {
    requesterId,
    requesterClientId,
    requestedAt: now,
    status: 'pending',
  };

  await controlRequestRef(roomId).set(request, { merge: true });
  return { success: true, request };
});

export const denyControl = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const authUid = requireAuthUid(context);

  return admin.firestore().runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef(roomId));
    if (!lockSnap.exists) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only the lock holder can deny control requests.'
      );
    }
    const existingLock = lockSnap.data() as ControllerLock;
    if (existingLock.userId !== authUid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only the lock holder can deny control requests.'
      );
    }

    const requestSnap = await tx.get(controlRequestRef(roomId));
    if (!requestSnap.exists) {
      return { success: true };
    }

    const existingRequest = requestSnap.data() as ControlRequest;
    tx.set(controlRequestRef(roomId), {
      ...existingRequest,
      status: 'denied',
    });

    return { success: true };
  });
});

export const handoverLock = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const targetClientId = requireString(data?.targetClientId, 'targetClientId');
  const clientId = requireString(data?.clientId, 'clientId');
  const userId = resolveUserId(data?.userId, context);
  const now = admin.firestore.Timestamp.now();

  return admin.firestore().runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef(roomId));
    if (!lockSnap.exists) {
      return { success: false, error: 'NO_ACTIVE_LOCK' };
    }

    const existingLock = lockSnap.data() as ControllerLock;
    if (existingLock.clientId !== clientId || existingLock.userId !== userId) {
      return { success: false, error: 'NOT_LOCK_HOLDER' };
    }

    const targetSnap = await tx.get(clientRef(roomId, targetClientId));
    if (!targetSnap.exists) {
      return { success: false, error: 'TARGET_NOT_FOUND' };
    }

    const target = targetSnap.data() as ControllerPresence;
    if (!target?.userId || !target.clientId || target.clientType !== 'controller') {
      return { success: false, error: 'TARGET_NOT_FOUND' };
    }

    const lastHeartbeatMs = toMillis(target.lastHeartbeat);
    if (!lastHeartbeatMs || now.toMillis() - lastHeartbeatMs > HANDOVER_PRESENCE_FRESH_MS) {
      return { success: false, error: 'TARGET_OFFLINE' };
    }

    const newLock = buildLockData({
      clientId: target.clientId,
      userId: target.userId,
      deviceName: target.deviceName,
      userName: target.userName,
      now,
    });
    tx.set(lockRef(roomId), newLock);
    tx.delete(controlRequestRef(roomId));
    return { success: true, lock: newLock };
  });
});

export const forceTakeover = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const clientId = requireString(data?.clientId, 'clientId');
  const userId = resolveUserId(data?.userId, context);
  const deviceName = optionalString(data?.deviceName, 'deviceName');
  const userName = optionalString(data?.userName, 'userName');
  const pin = optionalString(data?.pin, 'pin');
  const reauthenticated = Boolean(data?.reauthenticated ?? data?.reauthRequired);
  const now = admin.firestore.Timestamp.now();
  const authTime: unknown = context.auth?.token?.auth_time;

  return admin.firestore().runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef(roomId));
    const requestSnap = await tx.get(controlRequestRef(roomId));
    const pinSnap = await tx.get(pinRef(roomId));

    if (!lockSnap.exists) {
      const newLock = buildLockData({ clientId, userId, deviceName, userName, now });
      tx.set(lockRef(roomId), newLock);
      if (requestSnap.exists) {
        tx.delete(controlRequestRef(roomId));
      }
      return { success: true, lock: newLock };
    }

    const existingLock = lockSnap.data() as ControllerLock;
    const isStale = isLockStale(existingLock, now);

    let pinMatches = false;
    if (pin && pinSnap.exists) {
      const storedPin = pinSnap.data()?.value;
      pinMatches = typeof storedPin === 'string' && storedPin === pin;
    }

    const request = requestSnap.exists ? (requestSnap.data() as ControlRequest) : null;
    const decision = evaluateForceTakeoverDecision({
      nowMs: now.toMillis(),
      authTime,
      reauthenticated,
      pinMatches,
      isStale,
      request,
      callerUserId: userId,
      callerClientId: clientId,
    });

    if (decision.requestTimedOut && request) {
      tx.set(controlRequestRef(roomId), {
        ...request,
        status: 'expired',
      });
    }

    if (!decision.authorized) {
      return { success: false, error: 'PERMISSION_DENIED' };
    }

    const newLock = buildLockData({ clientId, userId, deviceName, userName, now });
    tx.set(lockRef(roomId), newLock);
    if (requestSnap.exists) {
      tx.delete(controlRequestRef(roomId));
    }

    return { success: true, lock: newLock, previousHolder: existingLock };
  });
});

export const syncLockFromCompanion = functions.https.onCall(async (data, context) => {
  const roomId = requireString(data?.roomId, 'roomId');
  const clientId = requireString(data?.clientId, 'clientId');
  const userId = resolveUserId(data?.userId, context);
  const deviceName = optionalString(data?.deviceName, 'deviceName');
  const userName = optionalString(data?.userName, 'userName');
  const lockedAtMs = data?.lockedAt;
  if (typeof lockedAtMs !== 'number' || lockedAtMs <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'lockedAt is required');
  }
  const now = admin.firestore.Timestamp.now();
  const lockedAt = admin.firestore.Timestamp.fromMillis(lockedAtMs);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(roomId));

    if (!snap.exists) {
      const lockData: ControllerLock = {
        clientId,
        userId,
        lockedAt,
        lastHeartbeat: now,
        controlPolicy: 'exclusive',
        ...(deviceName !== undefined && { deviceName }),
        ...(userName !== undefined && { userName }),
      };
      tx.set(lockRef(roomId), lockData);
      return { success: true };
    }

    const existing = snap.data() as ControllerLock;

    if (existing.userId !== userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Cannot sync lock for a different user.'
      );
    }

    const existingLockedAtMs = toMillis(existing.lockedAt) ?? 0;
    if (lockedAtMs < existingLockedAtMs) {
      return { success: true }; // cloud is already newer, no-op
    }

    const updateData: Record<string, unknown> = {
      clientId,
      lockedAt,
      lastHeartbeat: now,
      controlPolicy: 'exclusive',
    };
    if (deviceName !== undefined) updateData.deviceName = deviceName;
    if (userName !== undefined) updateData.userName = userName;
    tx.update(lockRef(roomId), updateData);
    return { success: true };
  });
});
