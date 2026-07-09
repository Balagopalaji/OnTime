# FIX-100 — live-cue elapsed drift (minimal spec)

Captured from the orchestrated Loop brief (root cause verified on main; approach
oracle-confirmed). Branch: `backlog/fix-100-livecue-elapsed-drift`. Base SHA `29cd211`.

## Root cause
`companion/src/main.ts` `updateRoomActiveLiveCueId(roomId, activeLiveCueId)` sets
`{ ...state, activeLiveCueId, lastUpdate: now }` — bumps `lastUpdate` (overloaded:
timer anchor + arbitration freshness) but preserves `currentTime`. Canonical
running elapsed `resolveCompanionElapsedForState` = `currentTime + (now-lastUpdate)`
(running) / `currentTime` (paused). After the bump a RUNNING timer's stored elapsed
becomes `currentTime_old + 0`, discarding the accrued delta → active timer jumps
backward/stalls on every live-cue create/change/end.

## Approach
Re-anchor `currentTime` via `resolveCompanionElapsedForState(state, now)` BEFORE
bumping `lastUpdate`. Resolver returns base `currentTime` when `!isRunning` and
sanitizes non-finite values → safe unconditionally. Keep the `lastUpdate: now`
bump. Carry `currentTime`+`lastUpdate` in the `ROOM_STATE_DELTA` changes so the
emitted delta + stored state stay internally consistent.

## Scenarios (Given/When/Then)
- **S1** running: currentTime=5000, lastUpdate=now-3000 (3s accrued), activeLiveCueId changes → stored currentTime≈8000, lastUpdate=now; subsequent resolve continuous (no backward jump).
- **S2** paused (isRunning=false): currentTime=5000 unchanged; lastUpdate bumped.
- **S3** same activeLiveCueId: early-return, no state mutation, no delta, no elapsed change.
- **S4** non-finite/≤0 lastUpdate or currentTime on a running timer → resolver sanitizes → stored currentTime finite; never persist NaN/Infinity.

## Proposed Surface
- Re-anchor `currentTime` for RUNNING timers in `updateRoomActiveLiveCueId` before the `lastUpdate` bump, via `resolveCompanionElapsedForState`.
- `ROOM_STATE_DELTA.changes` carries `currentTime` + `lastUpdate` alongside `activeLiveCueId`.
- Keep `lastUpdate: now` bump; never persist non-finite `currentTime`.

## Constraints
- Timer-state tuple stays internally consistent (currentTime/lastUpdate/isRunning/activeTimerId/progress must not disagree). Companion `RoomState` has no `startedAt`.
- Keep in sync with `computeCompanionElapsed` in `packages/timer-core` (call-site change only; do NOT change the formula).
- `companion/src/main.ts` ≤ 7589 split-line baseline. LF endings. Do not weaken any gate.
