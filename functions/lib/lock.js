"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceTakeover = exports.handoverLock = exports.denyControl = exports.requestControl = exports.updateHeartbeat = exports.releaseLock = exports.acquireLock = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const STALE_THRESHOLD_MS = 90000;
const FORCE_TAKEOVER_TIMEOUT_MS = 30000;
const HANDOVER_PRESENCE_FRESH_MS = 30000;
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const requireString = (value, fieldName) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new functions.https.HttpsError('invalid-argument', `${fieldName} is required`);
    }
    return value;
};
const optionalString = (value, fieldName) => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', `${fieldName} must be a string`);
    }
    return value;
};
const requireAuthUid = (context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    return context.auth.uid;
};
const resolveUserId = (dataUserId, context) => {
    const authUid = requireAuthUid(context);
    if (typeof dataUserId === 'string' && dataUserId !== authUid) {
        throw new functions.https.HttpsError('permission-denied', 'userId does not match authenticated user.');
    }
    return authUid;
};
const toMillis = (value) => {
    if (!value)
        return null;
    if (value instanceof admin.firestore.Timestamp) {
        return value.toMillis();
    }
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    return null;
};
const isLockStale = (lock, now) => {
    const lastHeartbeatMs = toMillis(lock.lastHeartbeat);
    const lockedAtMs = toMillis(lock.lockedAt);
    const baselineMs = lastHeartbeatMs !== null && lastHeartbeatMs !== void 0 ? lastHeartbeatMs : lockedAtMs;
    if (!baselineMs)
        return true;
    return now.toMillis() - baselineMs >= STALE_THRESHOLD_MS;
};
const buildLockData = (params) => {
    const data = {
        clientId: params.clientId,
        userId: params.userId,
        lockedAt: params.now,
        lastHeartbeat: params.now,
        controlPolicy: 'exclusive',
    };
    if (params.deviceName !== undefined)
        data.deviceName = params.deviceName;
    if (params.userName !== undefined)
        data.userName = params.userName;
    return data;
};
const lockRef = (roomId) => db.doc(`rooms/${roomId}/lock/current`);
const pinRef = (roomId) => db.doc(`rooms/${roomId}/config/pin`);
const controlRequestRef = (roomId) => db.doc(`rooms/${roomId}/controlRequest/current`);
const clientRef = (roomId, clientId) => db.doc(`rooms/${roomId}/clients/${clientId}`);
exports.acquireLock = functions.https.onCall(async (data, context) => {
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const clientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    const userId = resolveUserId(data === null || data === void 0 ? void 0 : data.userId, context);
    const deviceName = optionalString(data === null || data === void 0 ? void 0 : data.deviceName, 'deviceName');
    const userName = optionalString(data === null || data === void 0 ? void 0 : data.userName, 'userName');
    const forceIfStale = Boolean(data === null || data === void 0 ? void 0 : data.forceIfStale);
    const now = admin.firestore.Timestamp.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef(roomId));
        if (!snap.exists) {
            const newLock = buildLockData({ clientId, userId, deviceName, userName, now });
            tx.set(lockRef(roomId), newLock);
            return { success: true, lock: newLock };
        }
        const existing = snap.data();
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
exports.releaseLock = functions.https.onCall(async (data, context) => {
    const authUid = requireAuthUid(context);
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const clientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef(roomId));
        if (!snap.exists) {
            return { success: true };
        }
        const existing = snap.data();
        if (existing.clientId !== clientId || existing.userId !== authUid) {
            return { success: false, error: 'NOT_LOCK_HOLDER' };
        }
        tx.delete(lockRef(roomId));
        return { success: true };
    });
});
exports.updateHeartbeat = functions.https.onCall(async (data, context) => {
    const authUid = requireAuthUid(context);
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const clientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    const now = admin.firestore.Timestamp.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef(roomId));
        if (!snap.exists) {
            return { success: false, error: 'NOT_LOCK_HOLDER' };
        }
        const existing = snap.data();
        if (existing.clientId !== clientId || existing.userId !== authUid) {
            return { success: false, error: 'NOT_LOCK_HOLDER' };
        }
        tx.update(lockRef(roomId), { lastHeartbeat: now });
        return { success: true };
    });
});
exports.requestControl = functions.https.onCall(async (data, context) => {
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const requesterClientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    const requesterId = resolveUserId(data === null || data === void 0 ? void 0 : data.userId, context);
    const now = admin.firestore.Timestamp.now();
    const lockSnap = await lockRef(roomId).get();
    if (!lockSnap.exists) {
        return { success: false, error: 'NO_ACTIVE_LOCK' };
    }
    const existingLock = lockSnap.data();
    if (existingLock.userId === requesterId && existingLock.clientId === requesterClientId) {
        return { success: false, error: 'ALREADY_LOCK_HOLDER' };
    }
    const request = {
        requesterId,
        requesterClientId,
        requestedAt: now,
        status: 'pending',
    };
    await controlRequestRef(roomId).set(request, { merge: true });
    return { success: true, request };
});
exports.denyControl = functions.https.onCall(async (data, context) => {
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const authUid = requireAuthUid(context);
    return db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef(roomId));
        if (!lockSnap.exists) {
            throw new functions.https.HttpsError('permission-denied', 'Only the lock holder can deny control requests.');
        }
        const existingLock = lockSnap.data();
        if (existingLock.userId !== authUid) {
            throw new functions.https.HttpsError('permission-denied', 'Only the lock holder can deny control requests.');
        }
        const requestSnap = await tx.get(controlRequestRef(roomId));
        if (!requestSnap.exists) {
            return { success: true };
        }
        const existingRequest = requestSnap.data();
        tx.set(controlRequestRef(roomId), {
            ...existingRequest,
            status: 'denied',
        });
        return { success: true };
    });
});
exports.handoverLock = functions.https.onCall(async (data, context) => {
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const targetClientId = requireString(data === null || data === void 0 ? void 0 : data.targetClientId, 'targetClientId');
    const clientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    const userId = resolveUserId(data === null || data === void 0 ? void 0 : data.userId, context);
    const now = admin.firestore.Timestamp.now();
    return db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef(roomId));
        if (!lockSnap.exists) {
            return { success: false, error: 'NO_ACTIVE_LOCK' };
        }
        const existingLock = lockSnap.data();
        if (existingLock.clientId !== clientId || existingLock.userId !== userId) {
            return { success: false, error: 'NOT_LOCK_HOLDER' };
        }
        const targetSnap = await tx.get(clientRef(roomId, targetClientId));
        if (!targetSnap.exists) {
            return { success: false, error: 'TARGET_NOT_FOUND' };
        }
        const target = targetSnap.data();
        if (!(target === null || target === void 0 ? void 0 : target.userId) || !target.clientId || target.clientType !== 'controller') {
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
exports.forceTakeover = functions.https.onCall(async (data, context) => {
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const clientId = requireString(data === null || data === void 0 ? void 0 : data.clientId, 'clientId');
    const userId = resolveUserId(data === null || data === void 0 ? void 0 : data.userId, context);
    const deviceName = optionalString(data === null || data === void 0 ? void 0 : data.deviceName, 'deviceName');
    const userName = optionalString(data === null || data === void 0 ? void 0 : data.userName, 'userName');
    const pin = optionalString(data === null || data === void 0 ? void 0 : data.pin, 'pin');
    const reauthenticated = Boolean(data === null || data === void 0 ? void 0 : data.reauthenticated);
    const now = admin.firestore.Timestamp.now();
    return db.runTransaction(async (tx) => {
        var _a;
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
        const existingLock = lockSnap.data();
        const isStale = isLockStale(existingLock, now);
        let pinMatches = false;
        if (pin && pinSnap.exists) {
            const storedPin = (_a = pinSnap.data()) === null || _a === void 0 ? void 0 : _a.value;
            pinMatches = typeof storedPin === 'string' && storedPin === pin;
        }
        let requestTimedOut = false;
        if (requestSnap.exists) {
            const request = requestSnap.data();
            if (request.status === 'pending') {
                const requestedAtMs = toMillis(request.requestedAt);
                if (requestedAtMs) {
                    const elapsedMs = now.toMillis() - requestedAtMs;
                    if (elapsedMs >= FORCE_TAKEOVER_TIMEOUT_MS) {
                        tx.set(controlRequestRef(roomId), {
                            ...request,
                            status: 'expired',
                        });
                        requestTimedOut = true;
                    }
                }
            }
        }
        const authorized = pinMatches || reauthenticated || isStale || requestTimedOut;
        if (!authorized) {
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
