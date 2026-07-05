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
 * Source: `companion/src/token-server.ts` — `res.end(JSON.stringify({ token, expiresAt }))`.
 */
export type TokenResponse = {
  token: string;
  expiresAt: number;
};

/**
 * `/api/status-window` GET success body.
 * Source: `companion/src/token-server.ts` —
 * `res.end(JSON.stringify({ success: true, headless: isHeadlessMode() }))`.
 * The `success` field is the literal discriminant `true` (not a boolean).
 */
export type StatusWindowResponse = {
  success: true;
  headless: boolean;
};

/**
 * Shared 403 error body emitted by both loopback routes.
 * Sources: `companion/src/token-server.ts` — `{ error: 'Forbidden' }` and
 * `{ error: 'Invalid origin' }` on the origin/validation paths.
 */
export type ApiErrorResponse = {
  error: string;
};

// ---------------------------------------------------------------------------
// Socket.IO join/heartbeat/client-state wire types. Byte/shape-faithful to the
// definitions adopted from `companion/src/main.ts` (Stage 1b U1 slice 3).
// Pure primitive object types — no domain/companion/shared-types references.
// ---------------------------------------------------------------------------

/**
 * `JOIN_ROOM` client→server payload. Adopted from companion/src/main.ts.
 */
export type JoinRoomPayload = {
  type: 'JOIN_ROOM';
  roomId: string;
  token: string;
  clientType?: 'controller' | 'viewer';
  clientId?: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  ownerId?: string;
  takeOver?: boolean;
  interfaceVersion?: string;
  reconnectStartedAt?: number;
};

/**
 * `HEARTBEAT` client→server payload. Adopted from companion/src/main.ts.
 */
export type HeartbeatPayload = {
  type: 'HEARTBEAT';
  roomId: string;
  clientId: string;
  timestamp: number;
};

/**
 * `ROOM_CLIENTS_STATE` server→client broadcast. Adopted from
 * companion/src/main.ts. The `clients` array carries per-client identity.
 */
export type RoomClientsState = {
  type: 'ROOM_CLIENTS_STATE';
  roomId: string;
  clients: Array<{
    clientId: string;
    deviceName?: string;
    userId?: string;
    userName?: string;
    clientType: 'controller' | 'viewer';
    role?: string;
    tokenId?: string;
    lastHeartbeat?: number;
  }>;
  timestamp: number;
};
