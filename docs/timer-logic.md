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

**IMPORTANT: Elapsed can be negative.** Negative elapsed represents "bonus time" — time added beyond the original duration. Do NOT clamp elapsed to >= 0.

- **Firebase running:** `elapsed = elapsedOffset + (now - startedAt)`
- **Firebase paused:** `elapsed = elapsedOffset`
- **Companion running:** `elapsed = currentTime + (now - lastUpdate)`
- **Companion paused:** `elapsed = currentTime`
- **Per-timer elapsed:** for the active timer use the live formula above; for others read `progress[timerId] ?? 0`.

**Remaining Time (Countdown):**
```
remainingMs = durationMs - elapsed
```
- `elapsed > 0`: Normal countdown, time used
- `elapsed = 0`: Timer at start (full duration remaining)
- `elapsed < 0`: Bonus time added (remaining > duration)
- `remaining <= 0`: Overtime (timer expired)

**Status bands:** default (> warning), warning (<= `warningSec`), critical (<= `criticalSec`), overtime (remaining <= 0). `useTimerEngine` clamps progress to `[0, 2]` to bound overrun visuals.

## 3) Actions (Firebase + Companion equivalents)
All actions must update `currentTime` and `lastUpdate` alongside the running anchors to avoid stale mirrors.

### Start (optionally switching timers)
- Inputs: `timerId` (target), optional `currentTime` when resuming from stored progress.
- **If switching to a different timer:**
  1. **Save old timer's progress first:** Compute elapsed for old active timer and write to `progress[oldTimerId]` in cache and Firebase.
  2. Load stored progress for target timer from `progress[timerId] ?? 0`.
- **If resuming same timer:** Use current live elapsed.
- Updates: `activeTimerId = timerId`; `isRunning = true`; `elapsedOffset = elapsed`; `startedAt = now`; `currentTime = elapsed`; `lastUpdate = now`.

### Pause
- Compute `elapsed = liveElapsed(active)` using the running formula.
- Updates: `isRunning = false`; `startedAt = null`; `elapsedOffset = elapsed`; `progress[activeId] = elapsed`; `currentTime = elapsed`; `lastUpdate = now`.
- **Pass elapsed to emit function** to avoid stale state when React state hasn't updated yet.

### Reset
- Target the active timer (no-op if none).
- Updates: `isRunning = false`; `startedAt = null`; `elapsedOffset = 0`; `progress[activeId] = 0`; `currentTime = 0`; `lastUpdate = now`.

### Set Active Timer
- Use stored progress for the target timer (`progress[timerId] ?? 0`).
- Updates: `activeTimerId = timerId`; `isRunning = false`; `startedAt = null`; `elapsedOffset = progress`; `currentTime = same`; `lastUpdate = now`.

### Nudge (Adjust Time)
- `deltaMs > 0` **adds** time back (reduces elapsed); `deltaMs < 0` subtracts time (increases elapsed).
- `newElapsed = currentElapsed - deltaMs` where `currentElapsed` is live for the active timer.
- **No clamping:** `newElapsed` can be negative (bonus time) or positive.
- If running: keep `isRunning = true`, set `startedAt = now`, `elapsedOffset = newElapsed`.
- If paused: `isRunning = false`, `startedAt = null`, `elapsedOffset = newElapsed`.
- Always set `progress[activeId] = newElapsed`, `currentTime = newElapsed`, `lastUpdate = now`.

### Update Timer Duration (Inline Edit)
When a timer's duration is changed (e.g., via inline edit in the rundown):
- **Always reset progress:** `progress[timerId] = 0` — the timer restarts from the new duration.
- **If it's the active timer:**
  - Set `elapsedOffset = 0`; `currentTime = 0`; `lastUpdate = now`.
  - If running: set `startedAt = now` (timer continues running from 0).
  - If paused: set `startedAt = null`.
  - The timer immediately shows the new duration as remaining time.
- **If it's not the active timer:**
  - Just reset `progress[timerId] = 0`.
  - When selected or started, it will begin from 0 with the new duration.

This ensures that changing a duration always gives the operator a fresh start with that segment.

## 4) Progress Caching & Merging
The frontend caches room snapshots (including progress maps) in localStorage for offline support and to prevent data loss during mode switches.

**Cache Write (on pause, reset, timer switch, duration change):**
- Update `cachedSnapshots[roomId].room.state.progress[timerId] = elapsed`
- On duration change: reset progress to 0 and update state if active timer
- Persist to localStorage immediately

**Cache Read (getRoom):**
- When building a room from Firebase or Companion, merge cached progress:
```typescript
const mergedProgress = { ...roomProgress, ...cachedProgress }
```
- Cached values take priority (they're more recent from local actions)
- This preserves bonus time (negative elapsed) when switching modes or refreshing

**Cache Invalidation:**
- Cache is updated on every timer action
- Max 20 rooms cached (LRU eviction)
- Unsubscribing from a room clears its cache entry

## 5) Parallel Sync Invariants (Cloud ↔ Companion)
- Every timer mutation must write a consistent tuple: `{activeTimerId, isRunning, elapsedOffset/currentTime, startedAt, lastUpdate, progress}`.
- Do not emit partial updates (e.g., changing `activeTimerId` without elapsed + anchors).
- When both sources are present, prefer the freshest `lastUpdate` and ensure `currentTime`/`elapsedOffset` match that anchor.
- Offline/Hold: queue events, replay in order, and coalesce where possible; queue size is bounded.
- Confidence: treat snapshots as stale if `now - snapshotTimestamp` exceeds 2s while running, or 24h while paused with progress. Overtime guard: if adjusted elapsed exceeds `duration * 3`, request a resync.

## 6) Edge Cases
- **Negative elapsed:** Allowed and expected when bonus time is added. Do NOT clamp.
- **Negative or zero durations:** treat `remainingMs` as `durationMs - elapsed` (overtime immediately when duration <= 0).
- **Time jumps (sleep / clock change):** calculations rely on `Date.now()`. Anchoring `lastUpdate` and `currentTime` on every mutation limits drift; consider a resync if drift is detected.
- **Reordering / rundown:** does not change elapsed; only `order` fields move.
- **Multiple controllers:** server enforces controller access; deltas include `clientId` for reconciliation.
- **Empty companion timers:** Fall back to cached timers to prevent rundown disappearing.

## 7) Shared Helpers (Recommended Extraction)
These functions should be extracted to a shared module used by both `FirebaseDataContext` and `UnifiedDataContext`:

```typescript
// timer-utils.ts

/**
 * Compute live elapsed time for Firebase state
 * @returns elapsed in ms (can be negative for bonus time)
 */
export function computeElapsed(state: {
  isRunning: boolean
  startedAt: number | null
  elapsedOffset: number
}, now: number = Date.now()): number {
  if (state.isRunning && typeof state.startedAt === 'number') {
    return state.elapsedOffset + (now - state.startedAt)
  }
  return state.elapsedOffset
}

/**
 * Compute live elapsed time for Companion state
 * @returns elapsed in ms (can be negative for bonus time)
 */
export function computeCompanionElapsed(state: {
  isRunning: boolean
  currentTime: number
  lastUpdate: number
}, now: number = Date.now()): number {
  if (state.isRunning) {
    return state.currentTime + (now - state.lastUpdate)
  }
  return state.currentTime
}

/**
 * Apply a nudge (time adjustment) to elapsed
 * @param currentElapsed - current elapsed in ms
 * @param deltaMs - positive adds time (reduces elapsed), negative subtracts
 * @returns new elapsed (can be negative for bonus time)
 */
export function applyNudge(currentElapsed: number, deltaMs: number): number {
  return currentElapsed - deltaMs
}

/**
 * Resolve elapsed for a specific timer (active or from progress map)
 */
export function resolveTimerElapsed(
  room: { state: { activeTimerId: string | null; isRunning: boolean; startedAt: number | null; elapsedOffset: number; progress?: Record<string, number> } },
  timerId: string,
  now: number = Date.now()
): number {
  if (room.state.activeTimerId === timerId) {
    return computeElapsed(room.state, now)
  }
  return room.state.progress?.[timerId] ?? 0
}

/**
 * Merge progress maps, with priority values taking precedence
 */
export function mergeProgress(
  base: Record<string, number>,
  priority: Record<string, number>
): Record<string, number> {
  return { ...base, ...priority }
}
```
