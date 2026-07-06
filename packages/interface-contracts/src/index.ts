// rebuild-target: packages/interface-contracts

// Pure Socket.IO control-request wire types shared between the Companion server
// and its clients. Plain TypeScript types only — no runtime schema library
// (decision D2, docs/rebuild-plan.md). Adopted byte/shape-faithful from
// `companion/src/main.ts` (Stage 1b U1 first slice).

import type { ControllerLock } from '@ontime/shared-types';

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

// ---------------------------------------------------------------------------
// Server → Client `HANDSHAKE_ERROR` payload. Adopted from
// `companion/src/main.ts` (the strict `handleJoinRoom` emit shape) in
// Stage 1b U1 slice 4. `HANDSHAKE_PENDING` is a Companion-only fourth code
// over the three (`INVALID_TOKEN`, `INVALID_PAYLOAD`, `CONTROLLER_TAKEN`)
// currently listed in docs/interface.md §3.3 — recorded here per plan D6
// (docs/rebuild-plan.md); the doc reconciliation is the M-C follow-up.
// ---------------------------------------------------------------------------

/**
 * Server → Client `HANDSHAKE_ERROR` payload.
 * Source: `companion/src/main.ts` `handleJoinRoom` emits at the seven
 * rejection sites. `HANDSHAKE_PENDING` is Companion-only (see header above).
 */
export type HandshakeError = {
  type: 'HANDSHAKE_ERROR';
  code: 'INVALID_TOKEN' | 'INVALID_PAYLOAD' | 'CONTROLLER_TAKEN' | 'HANDSHAKE_PENDING';
  message: string;
};

// ---------------------------------------------------------------------------
// Server → Client `HANDSHAKE_ACK` payload. Adopted from
// `companion/src/main.ts` (the `createHandshakeAck` emit shape) in Stage 1b
// U1 slice 5. `success` is the literal discriminant `true` (not a boolean),
// matching the wire body; `companionMode` is a closed 3-value union inlined
// from companion's `CompanionMode`; `systemInfo.platform` inlines the
// `NodeJS.Platform` union so this package stays `@types/node`-free (the
// frontend app build does not auto-load `@types/node`).
// ---------------------------------------------------------------------------

/**
 * Server → Client `HANDSHAKE_ACK` payload.
 * Source: `companion/src/main.ts` `createHandshakeAck`. `success` is the
 * literal discriminant `true` (the companion always emits `true` on this path).
 * `companionMode` is the 3-value union from companion's `CompanionMode`.
 * `systemInfo.platform` inlines `NodeJS.Platform` to keep this package free of
 * `@types/node` (see header above).
 */
export type HandshakeAck = {
  type: 'HANDSHAKE_ACK';
  success: true;
  roomId?: string;
  companionMode: 'minimal' | 'show_control' | 'production';
  companionVersion: string;
  interfaceVersion: string;
  capabilities: {
    powerpoint: boolean;
    externalVideo: boolean;
    fileOperations: boolean;
  };
  systemInfo: {
    platform:
      | 'aix'
      | 'android'
      | 'darwin'
      | 'freebsd'
      | 'haiku'
      | 'linux'
      | 'openbsd'
      | 'sunos'
      | 'win32'
      | 'cygwin'
      | 'netbsd';
    hostname: string;
  };
};

// ---------------------------------------------------------------------------
// Self-contained control/timer/cue wire types. Adopted byte/shape-faithful from
// `companion/src/main.ts` in Stage 1b U1 slice 6. These are the
// self-contained payloads and error envelopes whose definitions close over no
// domain-heavy (Timer/Cue/RoomState) type: only primitive fields, the shared
// `ControllerLock` shape, and closed literal unions. Domain-heavy timer/cue/
// room-state/presentation types stay in `companion/src/main.ts` until their
// own U1 slices.
//
// NOTE: `ControllerLockStatePayload` (server→client broadcast of the current
// lock) is a DIFFERENT type from `ControllerLockState` in
// `@ontime/shared-types`, which is the client-side display-state union
// ('authoritative' | 'read-only' | 'requesting' | 'displaced'). The wire
// payload is therefore suffixed `...Payload` here to avoid colliding with the
// shared-types display union.
// ---------------------------------------------------------------------------

/**
 * Client→server `TIMER_ACTION` action kind.
 * Source: `companion/src/main.ts`.
 */
export type TimerActionKind = 'START' | 'PAUSE' | 'RESET';

/**
 * Client→server `TIMER_ACTION` payload.
 * Source: `companion/src/main.ts`.
 */
export type TimerActionPayload = {
  type: 'TIMER_ACTION';
  action: TimerActionKind;
  roomId: string;
  timerId: string;
  timestamp?: number;
  clientId?: string;
  currentTime?: number; // Optional: elapsed time to use when starting (for stored progress)
};

/**
 * Server→client `TIMER_ERROR` envelope.
 * Source: `companion/src/main.ts` `emitTimerError`.
 */
export type TimerError = {
  type: 'TIMER_ERROR';
  roomId: string;
  code: 'INVALID_PAYLOAD' | 'INVALID_FIELDS' | 'NOT_FOUND';
  message: string;
  clientId?: string;
  timestamp: number;
};

/**
 * Server→client `CUE_ERROR` envelope.
 * Source: `companion/src/main.ts` `emitCueError`.
 */
export type CueError = {
  type: 'CUE_ERROR';
  roomId: string;
  code: 'INVALID_PAYLOAD' | 'INVALID_FIELDS' | 'NOT_FOUND';
  message: string;
  clientId?: string;
  timestamp: number;
};

/**
 * Reason a pending control request was cleared. Adopted from
 * `companion/src/control-lock-utils.ts` (where it originated) and
 * `companion/src/main.ts` (which re-exported it). Crosses the wire as the
 * optional `reason` field of `ControlRequestStatus`.
 */
export type ControlRequestClearReason =
  | 'lock_changed'
  | 'request_denied'
  | 'requester_disconnected'
  | 'timeout'
  | 'room_unsubscribed'
  | 'superseded';

/**
 * Server→client `CONTROL_REQUEST_STATUS` payload.
 * Source: `companion/src/main.ts` `emitControlRequestStatusToRequester` /
 * `emitControlRequestStatusToController`.
 */
export type ControlRequestStatus = {
  type: 'CONTROL_REQUEST_STATUS';
  roomId: string;
  requesterId: string;
  status: 'queued' | 'cleared';
  reason?: ControlRequestClearReason;
  requestedAt: number;
  timestamp: number;
};

/**
 * Server→client `CONTROLLER_LOCK_STATE` broadcast payload.
 * Source: `companion/src/main.ts` `emitControllerLockState` /
 * `emitControllerLockStateToSocket`. Named `...Payload` to distinguish it from
 * the `ControllerLockState` display-state union in `@ontime/shared-types`
 * ('authoritative' | 'read-only' | 'requesting' | 'displaced').
 *
 * The `lock` field references the canonical `ControllerLock` domain type from
 * `@ontime/shared-types` (single source of truth). The type-only import is
 * CJS-safe because `@ontime/shared-types` no longer declares `"type": "module"`.
 */
export type ControllerLockStatePayload = {
  type: 'CONTROLLER_LOCK_STATE';
  roomId: string;
  lock: ControllerLock | null;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Timer and Cue CRUD wire envelopes (Stage 1b U1 slice 7). These are the
// domain-referencing payloads and broadcasts whose definitions close over the
// `Timer`/`Cue` shapes from `@ontime/shared-types` (now that #78 moved those
// domain types into shared-types, this edge is CJS-safe — see
// ControllerLockStatePayload header above). Kept in a sibling module so this
// barrel stays under the 400-line production-file ceiling; re-exported here so
// the package surface (`@ontime/interface-contracts`) is unchanged.
// `RoomState`/`SyncRoomStatePayload`/`LiveCue`/presentation envelopes are
// INTENTIONALLY EXCLUDED: RoomState is a divergent projection (decision 4,
// Session sync 2026-07-06), and the LiveCue/presentation cluster is sequenced
// after the timer-side work.
// ---------------------------------------------------------------------------
export * from './timer-cue-envelopes';
