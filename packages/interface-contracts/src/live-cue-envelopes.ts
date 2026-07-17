// rebuild-target: packages/interface-contracts

// LiveCue/presentation wire envelopes. Adopted byte/shape-faithful from
// `companion/src/main.ts` (Stage 1b Lane B slice B-1).
//
// The Companion is the EMITTER of all three events, so its strict
// `timestamp: number` is the source of truth: the server stamps its own clock
// on every emit. The frontend previously carried loose local duplicates in
// `frontend/src/context/UnifiedDataContext.tsx` with `timestamp?: number`;
// those dups are deleted in this slice — the receive side reads the strict
// type (expressions like `payload.timestamp ?? Date.now()` remain valid
// against a required `timestamp`).
//
// `cue` references the canonical `LiveCue` domain type from
// `@ontime/shared-types` (single source of truth). Split into a sibling module
// so the barrel `index.ts` stays under the 400-line production-file ceiling;
// re-exported from there so the `@ontime/interface-contracts` surface is
// unchanged.

import type { LiveCue } from '@ontime/shared-types';

/**
 * Server → client live-cue lifecycle broadcast
 * (`LIVE_CUE_CREATED` / `LIVE_CUE_UPDATED` / `LIVE_CUE_ENDED`).
 * Source: `companion/src/main.ts` `emitLiveCueCreated` / `emitLiveCueUpdated` /
 * `emitLiveCueEnded`. `timestamp` is REQUIRED (server clock).
 */
export type LiveCueEventPayload = {
  type: 'LIVE_CUE_CREATED' | 'LIVE_CUE_UPDATED' | 'LIVE_CUE_ENDED';
  roomId: string;
  cue: LiveCue;
  timestamp: number;
};

/**
 * Server → client presentation broadcast
 * (`PRESENTATION_LOADED` / `PRESENTATION_UPDATE`).
 * Source: `companion/src/main.ts` `emitPresentationLoaded` /
 * `emitPresentationUpdate`. `timestamp` is REQUIRED (server clock).
 */
export type PresentationEventPayload = {
  type: 'PRESENTATION_LOADED' | 'PRESENTATION_UPDATE';
  roomId: string;
  cue: LiveCue;
  timestamp: number;
};

/**
 * Server → client `PRESENTATION_CLEAR` broadcast.
 * Source: `companion/src/main.ts` `emitPresentationClear`. `cueId` is optional
 * (a clear may target the whole presentation surface); `timestamp` is
 * REQUIRED (server clock).
 */
export type PresentationClearPayload = {
  type: 'PRESENTATION_CLEAR';
  roomId: string;
  cueId?: string;
  timestamp: number;
};
