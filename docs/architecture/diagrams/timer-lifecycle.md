# Timer Lifecycle

**Verified against files:**
- `docs/timer-logic.md` (authoritative spec)
- `frontend/src/utils/timer-utils.ts` (elapsed calculations)
- `frontend/src/types/index.ts` (Timer, RoomState types)

**Last verified:** 2026-02-06

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: Room created

    Idle --> ActivePaused: SET_ACTIVE(timerId)
    Idle --> ActiveRunning: START(timerId)

    ActivePaused --> ActiveRunning: START
    ActivePaused --> ActivePaused: RESET (zeroes elapsed, keeps active)
    ActivePaused --> ActivePaused: NUDGE / DURATION_EDIT

    ActiveRunning --> ActivePaused: PAUSE
    ActiveRunning --> ActivePaused: RESET (zeroes elapsed, keeps active)
    ActiveRunning --> ActiveRunning: NUDGE / DURATION_EDIT
    ActiveRunning --> ActiveRunning: START(differentTimerId)

    note right of Idle
        activeTimerId = null
        isRunning = false
    end note

    note right of ActivePaused
        activeTimerId = timerId
        isRunning = false
        elapsedOffset = 0 or progress[timerId]
        startedAt = null
    end note

    note right of ActiveRunning
        activeTimerId = timerId
        isRunning = true
        startedAt = now
        elapsedOffset = base elapsed
    end note
```

## Elapsed Time Calculation

```mermaid
flowchart LR
    subgraph Running
        R1[elapsedOffset] --> R2[+ now - startedAt]
        R2 --> R3[= elapsed]
    end

    subgraph Paused
        P1[elapsedOffset] --> P2[= elapsed]
    end

    R3 --> Remaining
    P2 --> Remaining

    Remaining[durationMs - elapsed = remaining]
```

## Key Invariants

| Action | Updates to RoomState |
|--------|---------------------|
| START | `activeTimerId`, `isRunning=true`, `startedAt=now`, `elapsedOffset`, `progress[old]`, `currentTime`, `lastUpdate` |
| PAUSE | `isRunning=false`, `startedAt=null`, `elapsedOffset=elapsed`, `progress[active]=elapsed`, `currentTime`, `lastUpdate` |
| RESET | `isRunning=false`, `startedAt=null`, `elapsedOffset=0`, `progress[active]=0`, `currentTime=0`, `lastUpdate`; restores `originalDuration` if set |
| SET_ACTIVE | `activeTimerId`, `isRunning=false`, `elapsedOffset=progress[id]`, `currentTime`, `lastUpdate` |
| NUDGE | Modifies `timer.duration` (not elapsed); sets `originalDuration` on first nudge |
| DURATION_EDIT | Resets `progress[id]=0`; if active: `elapsedOffset=0`, `currentTime=0`, `lastUpdate=now` |

---

## Assumptions / Limits

1. **Elapsed can be negative** — represents "bonus time" added via nudge. Do NOT clamp.
2. **Single active timer per room** — `activeTimerId` is singular.
3. **Progress map is authoritative for non-active timers** — `progress[timerId]` stores paused elapsed.
4. **Nudge adjusts duration, not elapsed** — for reliable cross-browser sync via timer doc path.
5. **Duration edit always resets progress** — changing duration gives a fresh start.
6. **Diagram does not cover:** multi-controller arbitration, offline queue replay, staleness detection.
