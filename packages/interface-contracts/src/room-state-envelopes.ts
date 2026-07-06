// rebuild-target: packages/interface-contracts

// Companion room-state projection + room-state wire envelopes. Adopted
// byte/shape-faithful from `companion/src/main.ts` (Stage 1b U1 slice 8).
//
// This module deliberately does NOT reuse `RoomState` from
// `@ontime/shared-types`. The companion clock-domain projection is a divergent
// shape (decision 4, Session sync 2026-07-06): it is anchored on
// `currentTime`/`lastUpdate` (the Companion elapsed-at-wall-clock model) rather
// than `startedAt`/`elapsedOffset` (the Cloud/Firebase wall-clock-anchor model),
// and it omits `clockMode`. Structurally unifying the two would be a lie.
// `CompanionRoomState` is therefore a distinct type that happens to share some
// field names with the shared-types `RoomState`; it is not assignable to or
// from it. The name `CompanionRoomState` carries that intent (vs. the generic
// `RoomState` used in `companion/src/main.ts` before adoption).
//
// Split out of the barrel so `index.ts` stays under the 400-line production-file
// ceiling; re-exported from there so the `@ontime/interface-contracts` surface
// is unchanged.
//
// Convention: the two server→client broadcasts (ROOM_STATE_SNAPSHOT,
// ROOM_STATE_DELTA) carry a REQUIRED `timestamp` (the server emits its own
// clock). The two client→server payloads (ROOM_STATE_PATCH, SYNC_ROOM_STATE)
// carry an OPTIONAL `timestamp` (the server stamps on receipt). This
// optional-vs-required asymmetry mirrors the timer/cue CRUD envelopes in
// `./timer-cue-envelopes.ts`.

import type { MessageColor, Timer } from '@ontime/shared-types';

/**
 * Companion clock-domain room-state projection. Adopted from the local
 * `RoomState` type that lived in `companion/src/main.ts` (and the duplicate
 * `CompanionRoomState` in `frontend/src/context/UnifiedDataContext.tsx`).
 *
 * Distinct from `RoomState` in `@ontime/shared-types`: this projection is
 * anchored on `currentTime`/`lastUpdate` and omits `startedAt`/`clockMode`.
 * The two types are NOT structurally assignable to each other; convert via an
 * explicit adapter (see `UnifiedDataContext.tsx`).
 */
export type CompanionRoomState = {
  activeTimerId: string | null;
  isRunning: boolean;
  currentTime: number;
  lastUpdate: number;
  elapsedOffset?: number;
  progress?: Record<string, number>;
  showClock?: boolean;
  message?: { text?: string; visible?: boolean; color?: MessageColor };
  title?: string;
  timezone?: string;
  activeLiveCueId?: string;
};

/**
 * Server → client `ROOM_STATE_SNAPSHOT` broadcast. Adopted from
 * `companion/src/main.ts`. `state` is the full Companion projection;
 * `timestamp` is REQUIRED (server clock, emitted on every snapshot).
 */
export type RoomStateSnapshot = {
  type: 'ROOM_STATE_SNAPSHOT';
  roomId: string;
  state: CompanionRoomState;
  timestamp: number;
};

/**
 * Server → client `ROOM_STATE_DELTA` broadcast. Adopted from
 * `companion/src/main.ts`. `changes` is a partial Companion projection;
 * `timestamp` is REQUIRED (server clock, emitted on every delta).
 */
export type RoomStateDelta = {
  type: 'ROOM_STATE_DELTA';
  roomId: string;
  changes: Partial<CompanionRoomState>;
  clientId?: string;
  timestamp: number;
};

/**
 * Client → server `ROOM_STATE_PATCH` payload. Adopted from
 * `companion/src/main.ts`. `changes` is a partial Companion projection;
 * `timestamp` is OPTIONAL (server stamps on receipt).
 */
export type RoomStatePatchPayload = {
  type: 'ROOM_STATE_PATCH';
  roomId: string;
  changes: Partial<CompanionRoomState>;
  clientId?: string;
  timestamp?: number;
};

/**
 * Client → server `SYNC_ROOM_STATE` payload. Adopted from
 * `companion/src/main.ts`. `state` is the full Companion projection;
 * `timers`/`sourceClientId`/`timestamp` are OPTIONAL. `timestamp` is OPTIONAL
 * (server stamps on receipt).
 */
export type SyncRoomStatePayload = {
  type: 'SYNC_ROOM_STATE';
  roomId: string;
  state: CompanionRoomState;
  timers?: Timer[];
  sourceClientId?: string;
  timestamp?: number;
};
