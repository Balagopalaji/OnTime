# Timer Logic (Source of Truth)

Last Updated: 2025-12-27  
Status: CURRENT

## 1) State Surfaces
**Firebase (room.state, v2 doc or legacy field)**
- `activeTimerId: string | null`
- `isRunning: boolean`
- `startedAt: number | null` — epoch ms when the active timer started (anchor for running).
- `elapsedOffset: number` — base elapsed for the active timer at `startedAt` or when paused.
- `progress: Record<timerId, number>` — per-timer elapsed (ms); active timer is mirrored from live calc.
- `currentTime: number` — mirror of active timer elapsed at `lastUpdate` (used for confidence checks).
- `lastUpdate: number` — epoch ms when the last timer mutation was applied.
- `showClock, clockMode, message, activeLiveCueId` — UI fields (unchanged by timer math).

**Companion (local)**
- `activeTimerId: string | null`
- `isRunning: boolean`
- `currentTime: number` — elapsed-at-`lastUpdate` for the active timer.
- `lastUpdate: number` — epoch ms anchor for local elapsed calc.

## 2) Derived Elapsed
Let `now = Date.now()`.
- **Firebase running:** `elapsed = max(0, elapsedOffset + (now - startedAt))`
- **Firebase paused:** `elapsed = max(0, elapsedOffset)`
- **Companion running:** `elapsed = max(0, currentTime + (now - lastUpdate))`
- **Companion paused:** `elapsed = max(0, currentTime)`
- **Per-timer elapsed:** for the active timer use the live formula above; for others read `progress[timerId] ?? 0`.
- **Remaining (countdown):** `remainingMs = durationMs - elapsed`. Negative values indicate overtime and stay negative for display.
- **Status bands:** default (> warning), warning (<= `warningSec`), critical (<= `criticalSec`), overtime (remaining <= 0). `useTimerEngine` clamps progress to `[0, 2]` to bound overrun visuals.

## 3) Actions (Firebase + Companion equivalents)
All actions must update `currentTime` and `lastUpdate` alongside the running anchors to avoid stale mirrors.

- **Start (optionally switching timers)**
  - Inputs: `timerId` (target), optional `currentTime` when resuming from stored progress.
  - Updates: `activeTimerId = timerId`; `isRunning = true`; `elapsedOffset = clamp(providedOrStoredElapsed)`; `startedAt = now`; `currentTime = elapsedOffset`; `lastUpdate = now`.
  - If switching without provided elapsed, use stored per-timer progress; otherwise resume current elapsed.

- **Pause**
  - Compute `elapsed = liveElapsed(active)` using the running formula.
  - Updates: `isRunning = false`; `startedAt = null`; `elapsedOffset = elapsed`; `progress[activeId] = elapsed`; `currentTime = elapsed`; `lastUpdate = now`.

- **Reset**
  - Target the active timer (no-op if none).
  - Updates: `isRunning = false`; `startedAt = null`; `elapsedOffset = 0`; `progress[activeId] = 0`; `currentTime = 0`; `lastUpdate = now`.

- **Set Active Timer**
  - Use stored progress for the target timer (`progress[timerId] ?? 0`).
  - Updates: `activeTimerId = timerId`; `isRunning = false`; `startedAt = null`; `elapsedOffset = clamp(progress)`; `currentTime = same`; `lastUpdate = now`.

- **Nudge (Adjust Time)**
  - `deltaMs > 0` **adds** time back (reduces elapsed); `deltaMs < 0` subtracts time (increases elapsed).
  - `newElapsed = max(0, currentElapsed - deltaMs)` where `currentElapsed` is live for the active timer.
  - If running: keep `isRunning = true`, set `startedAt = now`, `elapsedOffset = newElapsed`.
  - If paused: `isRunning = false`, `startedAt = null`, `elapsedOffset = newElapsed`.
  - Always set `progress[activeId] = newElapsed`, `currentTime = newElapsed`, `lastUpdate = now`.

## 4) Parallel Sync Invariants (Cloud ↔ Companion)
- Every timer mutation must write a consistent tuple: `{activeTimerId, isRunning, elapsedOffset/currentTime, startedAt, lastUpdate, progress}`.
- Do not emit partial updates (e.g., changing `activeTimerId` without elapsed + anchors).
- When both sources are present, prefer the freshest `lastUpdate` and ensure `currentTime`/`elapsedOffset` match that anchor.
- Offline/Hold: queue events, replay in order, and coalesce where possible; queue size is bounded.
- Confidence: treat snapshots as stale if `now - snapshotTimestamp` exceeds 2s while running, or 24h while paused with progress. Overtime guard: if adjusted elapsed exceeds `duration * 3`, request a resync.

## 5) Edge Cases
- Clamp all elapsed values to `>= 0`.
- Negative or zero durations: treat `remainingMs` as `durationMs - elapsed` (overtime immediately when duration <= 0).
- Time jumps (sleep / clock change): calculations rely on `Date.now()`. Anchoring `lastUpdate` and `currentTime` on every mutation limits drift; consider a resync if drift is detected.
- Reordering / rundown: does not change elapsed; only `order` fields move.
- Multiple controllers: server enforces controller access; deltas include `clientId` for reconciliation.

## 6) Centralization Notes
- Shared formulas above should be the single reference for both Firebase and Companion paths.
- Frontend code paths should prefer a helper for: `computeElapsed`, `computeCompanionElapsed`, and `applyNudge(startedAt/isRunning/elapsedOffset, deltaMs, now)`, keeping the doc in lockstep.
