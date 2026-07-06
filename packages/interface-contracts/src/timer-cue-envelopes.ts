// rebuild-target: packages/interface-contracts

// Timer and Cue CRUD wire envelopes. Adopted byte/shape-faithful from
// `companion/src/main.ts` (Stage 1b U1 slice 7). These are the
// domain-referencing payloads and broadcasts whose definitions close over the
// `Timer`/`Cue` shapes from `@ontime/shared-types` (now that #78 moved those
// domain types into shared-types, this edge is CJS-safe — see the
// `ControllerLockStatePayload` header in `./index.ts`). Split out of the barrel
// so `index.ts` stays under the 400-line production-file ceiling; re-exported
// from there so the `@ontime/interface-contracts` surface is unchanged.
//
// Convention: the four client→server CREATE/UPDATE/DELETE/REORDER payloads
// carry an OPTIONAL `timestamp` (the server stamps on receipt); the matching
// server→client broadcasts (CREATED/UPDATED/DELETED/REORDERED) carry a REQUIRED
// `timestamp` (the server emits its own clock).

import type { Cue, Timer } from '@ontime/shared-types';

// --- Timer: client → server payloads (timestamp optional, server-stamped) ---

/** `CREATE_TIMER`. `timer` is `Partial<Timer>`; server assigns `id`/`roomId`/`order`. */
export type CreateTimerPayload = {
  type: 'CREATE_TIMER';
  roomId: string;
  timer: Partial<Timer>;
  clientId?: string;
  timestamp?: number;
};

/** `UPDATE_TIMER`. `changes` is `Partial<Timer>`. */
export type UpdateTimerPayload = {
  type: 'UPDATE_TIMER';
  roomId: string;
  timerId: string;
  changes: Partial<Timer>;
  clientId?: string;
  timestamp?: number;
};

/** `DELETE_TIMER`. */
export type DeleteTimerPayload = {
  type: 'DELETE_TIMER';
  roomId: string;
  timerId: string;
  clientId?: string;
  timestamp?: number;
};

/** `REORDER_TIMERS`. `timerIds` is the full desired order. */
export type ReorderTimersPayload = {
  type: 'REORDER_TIMERS';
  roomId: string;
  timerIds: string[];
  clientId?: string;
  timestamp?: number;
};

// --- Timer: server → client broadcasts (timestamp required, server clock) ---

/** `TIMER_CREATED`. `timer` is the canonical created `Timer`. */
export type TimerCreated = {
  type: 'TIMER_CREATED';
  roomId: string;
  timer: Timer;
  clientId?: string;
  timestamp: number;
};

/** `TIMER_UPDATED`. `changes` is `Partial<Timer>`. */
export type TimerUpdated = {
  type: 'TIMER_UPDATED';
  roomId: string;
  timerId: string;
  changes: Partial<Timer>;
  clientId?: string;
  timestamp: number;
};

/** `TIMER_DELETED`. */
export type TimerDeleted = {
  type: 'TIMER_DELETED';
  roomId: string;
  timerId: string;
  clientId?: string;
  timestamp: number;
};

/** `TIMERS_REORDERED`. `timerIds` is the new full order. */
export type TimersReordered = {
  type: 'TIMERS_REORDERED';
  roomId: string;
  timerIds: string[];
  clientId?: string;
  timestamp: number;
};

// --- Cue: client → server payloads (timestamp optional, server-stamped) ---

/** `CREATE_CUE`. `cue` is `Partial<Cue>`; server assigns `id`/`roomId`/`order`. */
export type CreateCuePayload = {
  type: 'CREATE_CUE';
  roomId: string;
  cue: Partial<Cue>;
  clientId?: string;
  timestamp?: number;
};

/** `UPDATE_CUE`. `changes` is `Partial<Cue>`. */
export type UpdateCuePayload = {
  type: 'UPDATE_CUE';
  roomId: string;
  cueId: string;
  changes: Partial<Cue>;
  clientId?: string;
  timestamp?: number;
};

/** `DELETE_CUE`. */
export type DeleteCuePayload = {
  type: 'DELETE_CUE';
  roomId: string;
  cueId: string;
  clientId?: string;
  timestamp?: number;
};

/** `REORDER_CUES`. `cueIds` is the full desired order. */
export type ReorderCuesPayload = {
  type: 'REORDER_CUES';
  roomId: string;
  cueIds: string[];
  clientId?: string;
  timestamp?: number;
};

// --- Cue: server → client broadcasts (timestamp required, server clock) ---

/** `CUE_CREATED`. `cue` is the canonical created `Cue`. */
export type CueCreated = {
  type: 'CUE_CREATED';
  roomId: string;
  cue: Cue;
  clientId?: string;
  timestamp: number;
};

/** `CUE_UPDATED`. `changes` is `Partial<Cue>`. */
export type CueUpdated = {
  type: 'CUE_UPDATED';
  roomId: string;
  cueId: string;
  changes: Partial<Cue>;
  clientId?: string;
  timestamp: number;
};

/** `CUE_DELETED`. */
export type CueDeleted = {
  type: 'CUE_DELETED';
  roomId: string;
  cueId: string;
  clientId?: string;
  timestamp: number;
};

/** `CUES_REORDERED`. `cueIds` is the new full order. */
export type CuesReordered = {
  type: 'CUES_REORDERED';
  roomId: string;
  cueIds: string[];
  clientId?: string;
  timestamp: number;
};
