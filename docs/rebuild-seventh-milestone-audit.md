---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-07-08
Scope: 7th milestone audit of the rebuild — narrow scope (code-touching PRs #80–#95).
---

# OnTime Rebuild — 7th Milestone Audit

Fresh-context Fable-style audit, 2026-07-08, over the cumulative diff from the 6th-audit head (`1cb421c`) to `origin/main` (`50cbafc`). **Narrow scope per owner**: code-touching PRs only — **#84, #88, #91** (plus **#82**, confirmed same class). Docs/ledger/CI PRs excluded except where a doc defines a contract used as context. Evidence basis: `git diff -w` (to strip #91 CRLF churn) over `companion/src`, `packages/`, `frontend/src`; full reads of `handleSeedCompanionCache`, `getRoomState`, `isValidSeedRoomStatePayload`, `resolveRoomStatePatchForCompanionClock`, `handleRoomStateSnapshot`, `handleRoomStateDelta`, the arbitration core, and `main.seed.test.ts`.

## Verdict: **GO**

The three in-scope PRs are correct on the axes that matter. Nothing blocks the next carve wave (U4/U5/U7).

## Finding

### MINOR-1 — Snapshot arbitration false-rejects live snapshots that carry companion `lastUpdate: 0` (N2 watch; #88-introduced)
**Location:** `frontend/src/context/UnifiedDataContext.tsx` → `handleRoomStateSnapshot`.
**Status:** Fixed in **#97** (`resolveSnapshotTimestamp`).

**Issue.** `snapshotTs = payload.state.lastUpdate ?? payload.timestamp ?? Date.now()`. The `??` only falls through on nullish values. After #88, `getRoomState` defaults `lastUpdate: 0` (`companion/src/main.ts` getRoomState) **and persists it**; JOIN emits `state: getRoomState(...)`, so snapshots for any room absent from `roomStateStore` carry `lastUpdate: 0`. Because `0` is non-nullish, the fallback to the live envelope `timestamp` never fires — `snapshotTs` becomes `0`, loses arbitration to any real Cloud ts (~1.7e12 ms) → `cloud newer` → `isStale` → **snapshot dropped**. The **delta path is not affected** (deltas are partial; `changes.lastUpdate` is usually `undefined` → falls through to the fresh `payload.timestamp`).

**Impact — latent, safe in the dangerous direction.** (a) A `0` snapshot does **not** overwrite a real one (it loses). (b) A `0` snapshot is **not** fed in as fresh (treated as epoch-stale). The harm is the reverse failure mode — a live snapshot that *should* apply is dropped. Currently masked because `lastUpdate: 0` coincides with empty-default state (dropping is harmless) and pure-local-mode wins regardless, but the invariant is fragile: `updateRoomActiveLiveCueId` writes via `{ ...state, activeLiveCueId }` **without bumping `lastUpdate`**, so a meaningful `activeLiveCueId` can coexist with `lastUpdate: 0`.

**Root cause.** #88 fixed the producer (default → `0`) to fix the seed gate but did not update the consumer. Seed-investigation owner decision #3 explicitly flagged this ("`getRoomState` default `lastUpdate: 0` … also affects frontend snapshot arbitration (`snapshotTs`), so decide with that consumer in view") — #88 resolved the producer side only.

**Fix (#97).** `??` → `||` so `0` falls through to the live envelope `timestamp` (a real `lastUpdate` is always truthy). Extracted as `resolveSnapshotTimestamp` (pure; contract in JSDoc) with regression + precedence + fallback tests.

## Per-PR confirmations

### #84 — adopt companion room-state envelopes — **CLEAN**
Wire-shape sound. Companion adopts `CompanionRoomState` / `RoomStateSnapshot` / `RoomStateDelta` / `RoomStatePatchPayload` / `SyncRoomStatePayload` from `@ontime/interface-contracts` via **`import type` only** → zero runtime coupling, no ESM/CJS mismatch. The removed inline defs are field-identical to the adopted package envelopes. Required `timestamp` on broadcasts honored at emit sites. `CompanionRoomState` deliberately stays distinct from shared-types `RoomState` (companion clock-domain vs cloud wall-clock-anchor — documented decision 4): correct, not a unification lie. Frontend adapter boundary (`toCompanionRoomState` / `translateCompanionStateToFirebase`) preserved.

### #88 — validate and normalize seed room state — **CLEAN except MINOR-1**
- **Overwrite gate correct:** `incomingTs > localTs` with both defaulting to `0` → a real cloud seed beats the sentinel `0`, and a missing timestamp (`0`) cannot clobber a real one. Fixes investigation finding #2.
- **Lean projection prevents rich-field pollution:** explicit field projection replaces `{ ...existing, ...entry.state }`; `startedAt`/`elapsedOffset`/`progress`/`clockMode` can never enter the store via seed. Fixes investigation findings #1/#3.
- **Validator sound:** `isValidSeedRoomStatePayload` requires `currentTime` + `lastUpdate` finite (rejects partial pairs), rejects rich fields via `hasOwnProperty` (absent-vs-undefined aware), validates `message` shape.
- **T5 PATCH fix correct (not a regression):** `resolveRoomStatePatchForCompanionClock` activeTimerId-only branch resolves `currentTime → 0` instead of reading permanently-stale seeded `progress`. Safe — frontend patches always include `currentTime`; the branch is only hit by third-party clients, for whom `0` is the right default.
- **Frontend seed projection correct:** `toSeedRoomState` skips rooms lacking a truthy `lastUpdate`, projects STORED anchors (not computed), omits rich fields. Matches the investigation's recommended seed contract.
- **Tests are real-handler, not mirror:** `main.seed.test.ts` drives the actual `handleSeedCompanionCache` / validator / patch resolver / `getRoomState` (T1–T6). The only gap was the N2 snapshot interaction (MINOR-1).

### #91 — finish LF normalization — **CLEAN (zero behavior churn)**
Both LF commits verified whitespace-only via `git diff -w`: first pass shows only `.gitattributes`; the follow-up commit is empty under `-w`. No logic touched.

### #82 (scope note) — adopt timer and cue wire envelopes — **CLEAN**
Not in the owner's listed scope but verified as the **same sound class as #84**: type-only adoption (`import type` of `TimerCreated`/`CueUpdated`/… + removal of inline payload defs), `timer-cue-envelopes.ts` created in the package, +353 lines of package tests, no runtime change to companion/frontend.

## Prior-finding dispositions (from the 6th audit)
- **LOW-1 (lockfile drift):** resolved by **#81**.
- **L-C / U8 / M-C:** remain open and correctly unclaimed (not in this batch's scope).
- Investigation findings #1 (seed auth, LAN-conditional) and #5 (legacy-item gate) remain tracked, unchanged by #88.

## Notes
`updateRoomActiveLiveCueId` not bumping `lastUpdate` is pre-existing and out of scope — noted only as the invariant-breaker that gave MINOR-1 teeth. Owner decision #2 (`progress` in seed) was resolved coherently by dropping `progress` from seed (validator rejects it) **and** removing its only reader (T5).
