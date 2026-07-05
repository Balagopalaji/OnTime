// rebuild-target: packages/interface-contracts

// Pure Socket.IO control-request wire types shared between the Companion server
// and its clients. Plain TypeScript types only — no runtime schema library
// (decision D2, docs/rebuild-plan.md). Adopted byte/shape-faithful from
// `companion/src/main.ts` (Stage 1b U1 first slice).

export type RequestControlPayload = {
  type: 'REQUEST_CONTROL';
  roomId: string;
  clientId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  timestamp: number;
};

export type ControlRequestReceived = {
  type: 'CONTROL_REQUEST_RECEIVED';
  roomId: string;
  requesterId: string;
  requesterName?: string;
  requesterUserId?: string;
  requesterUserName?: string;
  timestamp: number;
};

export type ForceTakeoverPayload = {
  type: 'FORCE_TAKEOVER';
  roomId: string;
  clientId: string;
  pin?: string;
  reauthenticated?: boolean;
  timestamp: number;
};

export type HandOverPayload = {
  type: 'HAND_OVER';
  roomId: string;
  targetClientId: string;
  timestamp: number;
};

export type DenyControlPayload = {
  type: 'DENY_CONTROL';
  roomId: string;
  requesterId: string;
  timestamp: number;
};

export type ControlRequestDenied = {
  type: 'CONTROL_REQUEST_DENIED';
  roomId: string;
  requesterId: string;
  timestamp: number;
  reason?: string;
  deniedByName?: string;
  deniedByUserId?: string;
  deniedByUserName?: string;
};

export type RoomPinState = {
  type: 'ROOM_PIN_STATE';
  roomId: string;
  pin: string | null;
  updatedAt: number;
};

export type SetRoomPinPayload = {
  type: 'SET_ROOM_PIN';
  roomId: string;
  pin?: string | null;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// HTTP response contracts for the loopback token server
// (companion/src/token-server.ts). Byte/shape-faithful to the JSON.stringify
// bodies emitted by `/api/token` and `/api/status-window`. Adopted in U1 slice 2.
// ---------------------------------------------------------------------------

/**
 * `/api/token` GET success body.
 * Source: token-server.ts:179 `res.end(JSON.stringify({ token, expiresAt }))`.
 */
export type TokenResponse = {
  token: string;
  expiresAt: number;
};

/**
 * `/api/status-window` GET success body.
 * Source: token-server.ts:217
 * `res.end(JSON.stringify({ success: true, headless: isHeadlessMode() }))`.
 * The `success` field is the literal discriminant `true` (not a boolean).
 */
export type StatusWindowResponse = {
  success: true;
  headless: boolean;
};

/**
 * Shared 403 error body emitted by both loopback routes.
 * Sources: token-server.ts:115 (`{ error: 'Forbidden' }`), :121
 * (`{ error: 'Invalid origin' }`), :187, :193.
 */
export type ApiErrorResponse = {
  error: string;
};
