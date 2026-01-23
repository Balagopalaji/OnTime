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
exports.joinAsOperator = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const functions = __importStar(require("firebase-functions"));
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const ALLOWED_ROLES = new Set(['lx', 'ax', 'vx', 'sm', 'foh', 'custom']);
const requireString = (value, fieldName) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new functions.https.HttpsError('invalid-argument', `${fieldName} is required`);
    }
    return value.trim();
};
const optionalString = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};
const requireAuthUid = (context) => {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    return context.auth.uid;
};
const normalizeInviteCode = (value) => value.trim().toUpperCase();
exports.joinAsOperator = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const uid = requireAuthUid(context);
    const roomId = requireString(data === null || data === void 0 ? void 0 : data.roomId, 'roomId');
    const inviteCode = requireString(data === null || data === void 0 ? void 0 : data.inviteCode, 'inviteCode');
    const odRole = requireString(data === null || data === void 0 ? void 0 : data.odRole, 'odRole');
    const odRoleLabel = optionalString(data === null || data === void 0 ? void 0 : data.odRoleLabel);
    if (!ALLOWED_ROLES.has(odRole)) {
        return { success: false, error: 'INVALID_ROLE' };
    }
    const inviteSnap = await db.doc(`rooms/${roomId}/config/invite`).get();
    if (!inviteSnap.exists) {
        return { success: false, error: 'INVALID_INVITE' };
    }
    const invite = inviteSnap.data();
    const expected = normalizeInviteCode((_a = invite.code) !== null && _a !== void 0 ? _a : '');
    const provided = normalizeInviteCode(inviteCode);
    if (!invite.enabled || expected !== provided) {
        return { success: false, error: 'INVALID_INVITE' };
    }
    const blockedSnap = await db.doc(`rooms/${roomId}/blocked/${uid}`).get();
    if (blockedSnap.exists) {
        return { success: false, error: 'BLOCKED' };
    }
    const payload = {
        odUserId: uid,
        odRole,
        approvedAt: firestore_1.FieldValue.serverTimestamp(),
        approvedVia: 'invite_code',
    };
    const displayName = optionalString((_c = (_b = context.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.name);
    if (displayName)
        payload.displayName = displayName;
    const email = optionalString((_e = (_d = context.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email);
    if (email)
        payload.email = email;
    if (odRole === 'custom' && odRoleLabel) {
        payload.odRoleLabel = odRoleLabel;
    }
    await db.doc(`rooms/${roomId}/operators/${uid}`).set(payload, { merge: true });
    return { success: true };
});
