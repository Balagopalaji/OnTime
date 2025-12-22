# Timer Logic (Source of Truth)

Last Updated: 2025-12-22
Status: CURRENT

## 1. Core Fields (Firebase)
- state.activeTimerId: string | null
- state.isRunning: boolean
- state.startedAt: number | null (epoch ms)
- state.elapsedOffset: number (ms)
- state.progress: Record<timerId, elapsedMs>
- state.currentTime: number (ms, optional mirror)
- state.lastUpdate: number (ms)

## 2. Companion State
- activeTimerId: string | null
- isRunning: boolean
- currentTime: number (elapsed at lastUpdate)
- lastUpdate: number (ms)

## 3. Elapsed Calculation
- Running: elapsed = elapsedOffset + (now - startedAt)
- Paused: elapsed = elapsedOffset
- Companion running: elapsed = currentTime + (now - lastUpdate)
- Companion paused: elapsed = currentTime

## 4. Start / Pause / Reset
Start:
- isRunning = true
- startedAt = now
- elapsedOffset stays current elapsed

Pause:
- isRunning = false
- startedAt = null
- elapsedOffset = current elapsed

Reset:
- isRunning = false
- startedAt = null
- elapsedOffset = 0

Companion equivalents:
- Update currentTime to current elapsed
- Update lastUpdate to now

## 5. Set Active Timer
- Switch activeTimerId
- Stop running (isRunning = false)
- elapsedOffset = progress[newActiveId] or 0
- startedAt = null

Companion:
- activeTimerId = new id
- isRunning = false
- currentTime = elapsed for that timer
- lastUpdate = now

## 6. Nudge (Adjust Time)
- deltaMs > 0 adds time (reduces elapsed)
- newElapsed = max(0, currentElapsed - deltaMs)
- If running: keep isRunning true, set startedAt = now, elapsedOffset = newElapsed
- If paused: isRunning false, startedAt = null, elapsedOffset = newElapsed

Companion:
- currentTime = newElapsed
- lastUpdate = now

## 7. Parallel Sync Invariants
- Every timer control change writes to both Firebase and Companion when available.
- If offline, writes queue and replay on reconnect.
- Avoid partial updates (e.g., updating activeTimerId without elapsed/lastUpdate).
