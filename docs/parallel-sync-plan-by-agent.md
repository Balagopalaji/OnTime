# Parallel Sync Documentation & Code Alignment Plan

## Implementation Plan: Documentation Rewrite & Code Alignment

Based on the GPT agent's feedback and your approval of the parallel sync architecture, here's the comprehensive plan to align docs and code.

---

## Overview

The GPT agent correctly identified that **docs and code are out of sync**. This plan focuses on documentation alignment and explicitly marks code gaps; implementation work remains tracked in the task list (Sections D–K) and is **out of scope for this doc-only phase**.

1\. **Documenting the TARGET architecture** (what we've agreed upon)

2\. **Explicitly marking code gaps** (what needs implementation)

3\. **Deprecating outdated docs** (preventing future confusion)

4\. **Creating a clear source of truth** (single place for agents to reference)

---

## Step-by-Step Implementation Plan

### **Phase 1: Documentation Hygiene (Critical - Do First)**

#### 1.1 Create Archive Deprecation Notice

**File:** `docs/archive/README-DEPRECATION-NOTICE.md` (status: verify against task list)

**Verify content matches:**

```markdown

# ⚠️ DEPRECATION NOTICE - ARCHIVE FOLDER

**All files in `/docs/archive/` are OUTDATED and preserved for historical reference only.**

## DO NOT Use Archive Files For:

- ❌ Understanding current architecture

- ❌ Making implementation decisions

- ❌ Planning new features

- ❌ Repo Prompt context

## Instead, Use:

- ✅ `docs/local-mode-plan.md` (to be rewritten - parallel sync architecture)

- ✅ `docs/backend-prd.md` (current data model)

- ✅ `docs/frontend-prd.md` (current UI specs)

- ✅ `docs/edge-cases.md` (to be created)

## Archive Contents

Phase 1 implementation guides (complete) + refactor prompts (complete).

**Last Updated:** TBD (verify)

**Status:** FROZEN

```

#### 1.2 Update AGENTS.md

**Location:** `AGENTS.md`

**Add section after existing content:**

```markdown

## 📁 Archive Policy (Critical for Context Selection)

**MANDATORY:** Files in `/docs/archive/` are **DEPRECATED** and MUST NOT be used as source of truth.

### Rules for All Agents

1\. **Never include archive files in Repo Prompt context** unless specifically debugging historical implementation

2\. **Never use archive docs for architecture decisions**

3\. **If an archive file conflicts with current docs, current docs win**

4\. **If unsure whether a doc is current, check `docs/README.md`** (to be created)

### Archive vs Current Docs

| Path | Status | Use |

|------|--------|-----|

| `docs/archive/**` | ❌ DEPRECATED | Historical reference only |
| `docs/local-mode-plan.md` | ⚠️ CURRENT (verify) | Parallel sync architecture (Phase 1D target) |
| `docs/edge-cases.md` | ⚠️ CURRENT (to be created) | Edge case handling (target) |
| `docs/frontend-prd.md` | ⚠️ PARTIAL | MVP spec; see Phase 1D notes |
| `docs/backend-prd.md` | ⚠️ PARTIAL | MVP spec; see Phase 1D notes |

### Current Sources of Truth (Post-Phase 1D)

```

docs/

├── local-mode-plan.md          ← Parallel Sync Architecture (TARGET; verify)

├── edge-cases.md               ← Edge Case Handling (TARGET; to be created)

├── frontend-prd.md             ← MVP PRD (add Phase 1D banner)

├── backend-prd.md              ← MVP PRD (add Phase 1D banner)

├── websocket-protocol.md       ← WebSocket Events (CURRENT)

└── archive/                    ← ALL DEPRECATED

    ├── README-DEPRECATION-NOTICE.md

    └── **/*.md (all historical)

```

### How to Verify Documentation Currency

Before using any doc:

1\. Check if it's in `/docs/archive/` → If YES, it's deprecated

2\. Check if it has "⚠️ DEPRECATED" banner → If YES, ignore it

3\. Check `docs/README.md` for current doc inventory → If NOT listed, ask user

### Update Frequency

- Archive docs: FROZEN (no updates)

- Current docs: Updated as architecture evolves

```

#### 1.3 Archive prd-alignment-analysis.md

**File to move:** `docs/prd-alignment-analysis.md` → `docs/archive/prd-alignment-analysis-DEPRECATED.md` (status: verify against task list)

**Verify deprecation banner:**

```markdown

---

**⚠️ DEPRECATED - TBD (verify)**

This analysis was written before Phase 1D completion. Migration strategy described here was superseded by the Unified Data Provider Architecture.

**Current architecture:** See `docs/local-mode-plan.md` (to be rewritten)

**Do not use this document** for implementation decisions.

---

```

#### 1.4 Add Banners to Archive Phase 1 Guides

**Files to update:** ALL files in `docs/archive/phase-1/*.md` and `docs/archive/phase-1/prompts/*.md`

**Add this banner at the top of EACH file:**

```markdown

---

**⚠️ IMPLEMENTATION COMPLETE - DEPRECATED**

This document describes Phase 1 implementation steps which are **now complete**.

**Current architecture:** See `docs/local-mode-plan.md` (to be rewritten with parallel sync)

**Last accurate:** TBD (verify)

**Use case:** Historical reference only; do NOT use for new development.

---

```

**Automation suggestion:**

```bash

# Add banner to all Phase 1 archive files

for file in docs/archive/phase-1/**/*.md; do

  echo "---" > temp.md

  echo "**⚠️ IMPLEMENTATION COMPLETE - DEPRECATED**" >> temp.md

  echo "" >> temp.md

  echo "This document describes Phase 1 implementation steps which are **now complete**." >> temp.md

  echo "" >> temp.md

  echo "**Current architecture:** See \`docs/local-mode-plan.md\` (to be rewritten with parallel sync)" >> temp.md

  echo "" >> temp.md

  echo "**Last accurate:** December 2024 (Phase 1D Step 3.5 completion)" >> temp.md

  echo "" >> temp.md

  echo "**Use case:** Historical reference only; do NOT use for new development." >> temp.md

  echo "---" >> temp.md

  echo "" >> temp.md

  cat "$file" >> temp.md

  mv temp.md "$file"

done

```

#### 1.5 Create docs/README.md

**File:** `docs/README.md` (NEW)

**Content:**

```markdown

# OnTime Documentation Index

**Last Updated:** TBD (verify)

## 📘 Current Documentation (Source of Truth)

### Architecture & Design

- **[local-mode-plan.md](local-mode-plan.md)** - Parallel Sync & Flawless Fallback Architecture (Phase 1D)

  - Read this for: Dual-connection model, timestamp arbitration, queue merging, staleness detection

  - Status: ⚠️ CURRENT (target rewrite; verify)

- **[edge-cases.md](edge-cases.md)** - Edge Case Handling

  - Read this for: Room lock conflicts, multi-device scenarios, template cloning

  - Status: ⚠️ CURRENT (to be created)

- **[websocket-protocol.md](websocket-protocol.md)** - WebSocket Event Schema

  - Read this for: Client→Server and Server→Client event definitions

  - Status: ⚠️ CURRENT (verify)

### Product Requirements

- **[frontend-prd.md](frontend-prd.md)** - Frontend MVP Specification

  - Status: ⚠️ PARTIALLY OUTDATED (Firebase-only MVP; see Phase 1D notes)

  - Todo: Add banner pointing to `local-mode-plan.md` for dual-sync behavior

- **[backend-prd.md](backend-prd.md)** - Backend MVP Specification

  - Status: ⚠️ PARTIALLY OUTDATED (Firebase-only MVP; see Phase 1D notes)

  - Todo: Add banner pointing to `local-mode-plan.md` for dual-sync behavior

### Feature Specs

- **[show-control-architecture.md](show-control-architecture.md)** - Phase 2 Show Control

- **[modularity-architecture.md](modularity-architecture.md)** - Tier-based Features

- **[undo-redo-future-plan.md](undo-redo-future-plan.md)** - Undo/Redo System

---

## 🗄️ Archived Documentation (Historical Reference Only)

**DO NOT use these for implementation decisions:**

- `archive/phase-1/*.md` - Phase 1A/1B/1C/1D implementation guides (COMPLETE)

- `archive/prd-alignment-analysis-DEPRECATED.md` - Pre-Phase 1D analysis (OBSOLETE)

- `archive/backend-implementation-plan.md` - Early backend plan (SUPERSEDED)

- `archive/offline-local-mode.md` - Early local mode design (SUPERSEDED by local-mode-plan.md)

**See:** `archive/README-DEPRECATION-NOTICE.md` for details.

---

## 🎯 Quick Reference by Task

| I need to... | Read this... |

|--------------|--------------|

| Understand parallel sync architecture | `local-mode-plan.md` |

| Handle room lock conflicts | `edge-cases.md` |

| Add a new WebSocket event | `websocket-protocol.md` |

| Understand Firebase MVP | `frontend-prd.md` + `backend-prd.md` (with caveats) |

| Debug Phase 1 implementation | `archive/phase-1/` (historical only) |

---

## 📝 Documentation Standards

### When Creating New Docs

- Add entry to this README

- Include "Last Updated" timestamp

- Mark status: ✅ CURRENT, ⚠️ PARTIAL, or ❌ DEPRECATED

### When Updating Docs

- Update "Last Updated" timestamp

- If architecture changes significantly, consider creating v2 doc and archiving old

### Deprecation Process

1\. Move to `archive/`

2\. Add deprecation banner

3\. Update this README to mark as ❌ DEPRECATED

4\. Update `AGENTS.md` if it affects agent context selection

```

---

### **Phase 2: Rewrite docs/local-mode-plan.md (CRITICAL)**

This is the **most important file** - it becomes the single source of truth.

#### 2.1 Add Top Banner

**At very top of file:**

```markdown

---

**📘 CURRENT SOURCE OF TRUTH - Phase 1D Parallel Sync Architecture**

This document describes the **target architecture** for OnTime's dual-connection (Companion + Firebase) system.

**Status:** Target architecture; some features in this doc are marked "**⚠️ TO BE IMPLEMENTED**" and require verification against code.

**Supersedes:**

- Provider-swapping model (old architecture)

- "Hybrid" as a distinct mode (now deprecated - use Auto/Cloud/Local)

- Firebase-only MVP specs (see PRD banners)

**Last Updated:** TBD (verify)

**Code Alignment:** See Section 9 "Code Gaps vs Target" for implementation status.

---

```

#### 2.2 Rewrite Section 2.1.1 (App Modes)

**Replace existing content with:**

```markdown

### 2.1.1 App Modes (Operator UX)

The UI exposes three modes to the operator:

| Mode | Behavior | Use Case |

|------|----------|----------|

| **Auto** | Smart selection: Local if Companion connected, else Cloud | Default for most users |

| **Local** | Prefer Companion for reads; write to both when online | Unreliable internet venues |

| **Cloud** | Prefer Firebase for reads; write to both if Companion connected | Remote-only shows |

**Key Principles:**

1\. **All modes dual-write when both systems are available**

   - If Companion connected: Write to Companion

   - If online: Write to Firebase

   - Neither is "primary" - they are **mutual backups**

2\. **Mode only affects READ preference** (which data to trust when timestamps conflict)

   - **Local mode:** Prefer Companion data (fresher Companion wins ties)

   - **Cloud mode:** Prefer Firebase data (fresher Firebase wins ties)

   - **Auto mode:** Pick freshest by timestamp (no bias)

3\. **Write-through ensures seamless fallback**

   - If Companion drops: Firebase already has latest state

   - If internet drops: Companion already has latest state

   - Operator can switch devices/modes without data loss

**⚠️ DEPRECATED:** "Hybrid" Mode

The term "Hybrid" has been removed. It was identical to "Local" when online (both write to Firebase + Companion). "Local" now describes this dual-write behavior.

**Seamless Mode Switching:**

Mode changes do **not** unmount data providers. Instead:

- `AppModeProvider` updates `effectiveMode`

- `UnifiedDataResolver` adjusts `roomAuthority` per room

- Running timers continue without interruption (state preserved in both systems)

- Optional UI: brief "Sync" LED indicator during authority handoff (align with task list G)

- Viewers pick freshest data by timestamp (no "Syncing" banner)

**⚠️ CODE GAP:** Current `AppModeContext` still exposes `hybrid` type. See Section 9.

```

#### 2.3 Replace Section 3.2 & 3.3 with Parallel Sync

**Delete existing sections 3.2 and 3.3, replace with:**

```markdown

### 3.2 Frontend Integration (Unified Data Provider)

> **Implementation Status:** ⚠️ Verify in code - provider nesting is expected but not confirmed here.

> **Code Gap:** Read preference and Companion participation in Cloud mode (see Section 9)

The frontend uses a **Unified Data Provider** architecture where Firebase and Companion connections run in parallel.

**Provider Nesting Structure:**

```tsx

<CompanionConnectionProvider>  {/* Socket + token management */}

  <AppModeProvider>             {/* Mode resolution + fallback triggers */}

    <FirebaseDataProvider>      {/* Always subscribed to Firestore */}

      <UnifiedDataResolver>     {/* Per-room authority coordination */}

        {children}

      </UnifiedDataResolver>

    </FirebaseDataProvider>

  </AppModeProvider>

</CompanionConnectionProvider>

```

**Component Responsibilities:**

1\. **`CompanionConnectionProvider`** (`CompanionConnectionContext.tsx`)

   - Manages WebSocket connection to `ws://localhost:4000`

   - Handles token refresh and handshake lifecycle

   - Exposes `socket`, `isConnected`, `handshakeStatus` to children

2\. **`AppModeProvider`** (`AppModeContext.tsx`)

   - Resolves `effectiveMode` based on socket state and network status

   - Triggers fallback to Cloud when Companion drops (sets `isDegraded` flag)

  - Sync mode changes across browser tabs via `BroadcastChannel`

3\. **`FirebaseDataProvider`** (`FirebaseDataContext.tsx`)

   - Always subscribed to Firestore (even in Local mode)

   - Provides baseline room data and timers for fallback

4\. **`UnifiedDataResolver`** (`UnifiedDataContext.tsx`)

   - **Per-Room Authority Tracking:** Maintains `roomAuthority` state  

     (`{ source: 'cloud' | 'companion' | 'pending', status: 'ready' | 'syncing' | 'degraded' }`)

   - **Data Resolution:** `getRoom(roomId)` and `getTimers(roomId)` select authoritative source

   - **Format Translation:** Converts Companion format to Firebase format transparently

   - **SYNC Orchestration:** Sends `SYNC_ROOM_STATE` when controller joins Companion room

**⚠️ CODE GAP:** Current implementation blocks Companion writes in Cloud mode (`shouldUseCompanion` returns false). See Section 9.

---

### 3.3 Parallel Sync & Flawless Fallback Architecture

> **⚠️ TARGET ARCHITECTURE:** This section describes the intended behavior. Some parts are not yet implemented (marked below).

#### Write Behavior (All Modes)

| Mode   | Companion Write    | Firebase Write     | Notes                                    |

|--------|--------------------|--------------------|------------------------------------------|

| Cloud  | Yes (if connected) | Yes                | **Both are mutual backups**              |

| Local  | Yes                | Yes (if online)    | **Both are mutual backups**              |

| Auto   | Depends on connection | Depends on connection | Smart selection based on availability |

**Implementation:**

```typescript

function writeTimerAction(action: TimerAction) {

  const companionAvailable = socket?.connected && handshakeStatus === 'ack'

  const cloudAvailable = navigator.onLine && firebase.user

  // Write to both when available

  if (companionAvailable) {

    socket.emit('TIMER_ACTION', action)

  } else {

    enqueueAction(action)  // Queue for when Companion reconnects

  }

  if (cloudAvailable) {

    await firebaseWrite(action).catch(() => {})  // Best-effort

  }

}

```

**⚠️ CODE GAP:** Current code doesn't write to Companion in Cloud mode. See Section 9.

---

#### Read Behavior (Timestamp Arbitration)

**⚠️ TARGET:** Pick freshest data by timestamp with mode bias.

**⚠️ CURRENT:** Code respects `roomAuthority` only; no timestamp comparison.

**Authority rule for confidence window (Auto mode):** When timestamps are within the confidence window, `roomAuthority` should be set by the last successful controller write source for that room (Companion or Firebase). If no controller has written yet, default to Firebase for safety.

**Target Logic:**

```typescript

function getRoom(roomId: string): Room | undefined {

  const authority = roomAuthority[roomId]

  const firebaseRoom = firebase.getRoom(roomId)

  const companionState = companionRooms[roomId]

  // Case 1: Only one source available

  if (!companionState) return firebaseRoom

  if (!firebaseRoom) return buildRoomFromCompanion(roomId, companionState)

  // Case 2: Both available - timestamp arbitration

  const firebaseTs = firebaseRoom.state.lastUpdate ?? 0

  const companionTs = companionState.lastUpdate ?? 0

  // Confidence window: prevent flickering during brief disconnects

  const confidenceMs = 2000  // 2 seconds (expandable to 4s for choppy links)

  if (Math.abs(firebaseTs - companionTs) < confidenceMs) {

    // Within confidence window - trust authority

    if (authority?.source === 'companion' && companionState) {

      return buildRoomFromCompanion(roomId, companionState, firebaseRoom)

    }

    return firebaseRoom

  }

  // Outside confidence window - pick freshest

  if (effectiveMode === 'local') {

    // Local mode: prefer Companion when timestamps tie

    return companionTs >= firebaseTs

      ? buildRoomFromCompanion(roomId, companionState, firebaseRoom)

      : firebaseRoom

  }

  if (effectiveMode === 'cloud') {

    // Cloud mode: prefer Firebase when timestamps tie

    return firebaseTs >= companionTs

      ? firebaseRoom

      : buildRoomFromCompanion(roomId, companionState, firebaseRoom)

  }

  // Auto mode: absolute freshest wins

  return companionTs > firebaseTs

    ? buildRoomFromCompanion(roomId, companionState, firebaseRoom)

    : firebaseRoom

}

```

**⚠️ TO BE IMPLEMENTED:** See Section 9.

---

#### Change Merging (Multi-Device Scenarios)

**Problem:** Device A offline makes Change 1 (timestamp 100); Device B online makes Change 2 (timestamp 200). Both changes should coexist if they're **orthogonal** (different change types or targets).

**Solution:** Group by change type + target, keep latest per group.

**⚠️ TARGET LOGIC:**

```typescript

type ChangeType = 

  | 'STATE_CHANGE'    // activeTimerId, isRunning, currentTime

  | 'TIMER_CRUD'      // createTimer, updateTimer, deleteTimer

  | 'TIMER_REORDER'   // order field changes

  | 'ROOM_CONFIG'     // title, timezone, config

function mergeQueuedEvents(queue: QueuedEvent[]): QueuedEvent[] {

  // Group by: change type + target ID

  const grouped = queue.reduce((acc, event) => {

    const key = `${event.type}:${event.timerId ?? event.roomId}`

    if (!acc[key]) acc[key] = []

    acc[key].push(event)

    return acc

  }, {} as Record<string, QueuedEvent[]>)

  // For each group, keep only LATEST by timestamp

  const merged = Object.values(grouped).map(group =>

    group.sort((a, b) => b.timestamp - a.timestamp)[0]

  )

  // Replay in chronological order

  return merged.sort((a, b) => a.timestamp - b.timestamp)

}

```

**Example:**

```

Device A (offline): Timer 1 state change +10min (ts: 100)

Device B (online):  Timer 2 created (ts: 200)

After merge:

- Change type "STATE_CHANGE:timer1" → Keep ts:100

- Change type "TIMER_CRUD:timer2" → Keep ts:200

- Both replay ✅

```

**⚠️ CURRENT CODE:** Queue replay is FIFO only (no grouping/deduplication). See Section 9.

---

#### Offline Queue Replay (Timestamp-Safe)

**⚠️ TARGET:** Merge by change type, then replay in timestamp order.

**⚠️ CURRENT:** FIFO replay with basic timestamp filtering.

**Target Logic:**

```typescript

const replayRoomQueue = useCallback((roomId: string) => {

  if (!socket) return

  const queue = loadQueue(roomId)

  if (!queue.length) return

  // Merge by change type (see above)

  const merged = mergeQueuedEvents(queue)

  // Replay merged events

  isReplayingRef.current = true

  merged.forEach(item => socket.emit(item.type, item))

  saveQueue(roomId, [])

  isReplayingRef.current = false

}, [socket])

```

**Queue Limits (Prevent Unbounded Growth):**

- Max 100 events per room

- Oldest dropped if exceeded (FIFO)

- UI: warning when >80% full; keep discreet and minimalist

**⚠️ TO BE IMPLEMENTED:** Per-change-type merge. See Section 9.

---

#### Firebase → Companion Sync

**⚠️ TARGET:** Detect Firebase changes while Companion has authority, push newer Firebase state to Companion.

**⚠️ CURRENT:** Not implemented.

**Target Logic:**

```typescript

useEffect(() => {

  // Run whenever both sources are available; not mode-gated
  Object.entries(roomAuthority).forEach(([roomId, auth]) => {

    if (auth.source !== 'companion') return

    const firebaseRoom = firebase.getRoom(roomId)

    const companionState = companionRooms[roomId]

    const firebaseTs = firebaseRoom?.state.lastUpdate ?? 0

    const companionTs = companionState?.lastUpdate ?? 0

    // If Firebase is newer, sync Firebase → Companion

    if (firebaseTs > companionTs + 2000) { // 2s grace

      emitSyncRoomState(roomId)

    }

  })

}, [firebase.rooms, companionRooms, roomAuthority, effectiveMode])

```

**⚠️ TO BE IMPLEMENTED:** See Section 9.

---

#### Staleness Detection (Plausibility-Based)

**⚠️ TARGET:** Accept snapshots if elapsed time is plausible (duration-aware + adjustment-log support).

**⚠️ CURRENT:** Fixed 30s/24h thresholds; no adjustment log.

**Target Logic:**

```typescript

type TimerAdjustment = {

  timestamp: number

  delta: number  // milliseconds added/subtracted

  deviceId: string

  reason: 'manual' | 'sync' | 'migration'

}

function isSnapshotPlausible(

  state: Room['state'],

  timer: Timer,

  snapshotTimestamp: number,

  now: number

): boolean {

  const age = now - snapshotTimestamp

  const snapshotElapsed = state.elapsedOffset ?? 0

  // Calculate total adjustments from authority sources

  const adjustments = timer.adjustmentLog?.filter(adj =>

    adj.timestamp > snapshotTimestamp &&

    adj.timestamp < now &&

    isAuthorityDevice(adj.deviceId)

  ) ?? []

  const totalAdjustments = adjustments.reduce((sum, adj) => sum + adj.delta, 0)

  // Adjusted expected = base + age + manual adjustments

  const adjustedExpected = snapshotElapsed + age + totalAdjustments

  // Allow 10% variance for clock drift

  const variance = Math.abs((snapshotElapsed + age) - adjustedExpected)

  const maxVariance = timer.duration * 1000 * 0.1

  if (variance > maxVariance) return false

  // Final check: Is adjusted time within 3x duration?

  return adjustedExpected <= (timer.duration * 1000 * 3)

}

```

**Example:** Operator adds 5min, adds 20min, subtracts 15min → net +10min. Snapshot 1 hour later expects 70min elapsed (0 + 60 + 10). If actual is 70min ✅ PLAUSIBLE; if 120min ✗ REJECTED (variance > 10%).

**⚠️ TO BE IMPLEMENTED:** Adjustment log + plausibility check. See Section 9.

---

#### Room Lock (Never Auto-Expire)

**⚠️ TARGET:** Prompt-based takeover with device name + time since last heartbeat.

**⚠️ CURRENT:** Companion server has single-controller lock; no heartbeat/prompt in web app.

**Target Logic:**

```typescript

type RoomLock = {

  deviceId: string

  lockedBy: string  // user email

  lockedAt: number

  lastHeartbeat: number

  deviceName: string  // e.g., "MacBook Pro"

}

async function claimRoomLock(roomId: string) {

  const room = firebase.getRoom(roomId)

  if (room?.lock) {

    const lockAge = Date.now() - room.lock.lastHeartbeat

    const lockAgeMinutes = Math.floor(lockAge / 60000)

    const confirmed = window.confirm(

      `⚠️ Room Lock Warning\n\n` +

      `Locked by: ${room.lock.lockedBy}\n` +

      `Device: ${room.lock.deviceName}\n` +

      `Last active: ${lockAgeMinutes}m ago\n\n` +

      `Taking over will disconnect their session. Continue?`

    )

    if (!confirmed) {

      subscribeToCompanionRoom(roomId, 'viewer')

      return false

    }

    socket.emit('CONTROLLER_TAKEOVER', {

      roomId,

      newDeviceId: clientId,

      takenFrom: room.lock.deviceId

    })

  }

  // Claim lock

  await setDoc(doc(db, 'rooms', roomId), {

    lock: {

      deviceId: clientId,

      lockedBy: firebase.user?.email,

      lockedAt: Date.now(),

      lastHeartbeat: Date.now(),

      deviceName: getDeviceName()  // "MacBook Pro"

    }

  }, { merge: true })

}

// Heartbeat every 30s

useEffect(() => {

  const interval = setInterval(() => {

    Object.keys(subscribedRooms).forEach(roomId => {

      setDoc(doc(db, 'rooms', roomId), {

        'lock.lastHeartbeat': Date.now()

      }, { merge: true })

    })

  }, 30_000)

  return () => clearInterval(interval)

}, [subscribedRooms])

```

**⚠️ TO BE IMPLEMENTED:** Room lock + heartbeat + `CONTROLLER_TAKEOVER` event. See Section 9.

```

#### 2.4 Add Section 3.6.1 (Browser Cache)

**Insert after Section 3.6:**

```markdown

### 3.6.1 Browser Cache (Frontend Resilience)

**Location:** Browser `localStorage`

- **Room Snapshots:** `ontime:companionRoomCache.v2`
- **Subscriptions:** `ontime:companionSubs.v2`
  - Last-seen room state + timers per subscribed room

  - Limited to 20 most recent (LRU eviction)

  - Used for offline resilience + instant page loads

- **Subscriptions:** `ontime:companionSubs.v2`

  - Which rooms subscribed to Companion (clientType: 'controller' | 'viewer')

  - Restored on page reload

- **Action Queue:** `ontime:queue:{roomId}`

  - Per-room pending timer actions when Companion disconnected

  - Replayed on reconnect in timestamp order

**Staleness Detection:**

See Section 3.3 "Staleness Detection (Plausibility-Based)" for full logic.

**Summary:**

- Running timers: Plausibility-based (3x duration grace)

- Paused timers with progress: 24-hour threshold

- Fresh timers (0 elapsed): Accept any age

If stale, `UnifiedDataResolver` falls back to Firebase.

```

#### 2.5 Add Section 9 (Code Gaps vs Target)

**Add new section at end of file:**

```markdown

---

## 9. Code Gaps vs Target Architecture

> **⚠️ CRITICAL:** This section documents where **docs describe target state** but **code is not yet implemented**.

### High Priority (Breaks Parallel Sync)

#### ❌ Companion Blocked in Cloud Mode

**Location:** `frontend/src/context/UnifiedDataContext.tsx`

**Issue:**

```typescript

const shouldUseCompanion = (roomId: string) => {

  if (effectiveMode === 'cloud') return false  // ❌ Blocks Companion entirely

  return Boolean(subscribedRooms[roomId])

}

```

**Target:** Allow Companion writes in Cloud mode (hot standby).

**Fix:** Remove `effectiveMode === 'cloud'` guard; allow Companion participation in all modes.

---

#### ❌ No Timestamp Arbitration

**Location:** `frontend/src/context/UnifiedDataContext.tsx` - `getRoom()`

**Issue:** Current code uses `roomAuthority` only; doesn't compare `lastUpdate` timestamps.

**Target:** Compare Firebase vs Companion timestamps with 2s confidence window (see Section 3.3).

**Fix:** Implement timestamp comparison logic in `getRoom()` and `getTimers()`.

---

#### ❌ Queue Replay is FIFO Only

**Location:** `frontend/src/context/UnifiedDataContext.tsx` - `replayRoomQueue()`

**Issue:** No per-change-type merge; replays all queued events in order.

**Target:** Group by change type + target, keep latest per group, then replay (see Section 3.3).

**Fix:** Add `mergeQueuedEvents()` function before replay.

---

### Medium Priority (Improves Reliability)

#### ⚠️ Firebase → Companion Sync Missing

**Location:** `frontend/src/context/UnifiedDataContext.tsx`

**Issue:** No listener for Firebase changes while Companion has authority.

**Target:** If Firebase `lastUpdate` > Companion `lastUpdate` + grace, emit `SYNC_ROOM_STATE` (see Section 3.3).

**Fix:** Add `useEffect` listening to `firebase.rooms` changes.

---

#### ⚠️ Naive Staleness Check

**Location:** `frontend/src/context/UnifiedDataContext.tsx` - `isSnapshotStale()`

**Issue:** Fixed 30s/24h thresholds; no adjustment log support.

**Target:** Plausibility-based check with adjustment log (3x duration, 10% variance) (see Section 3.3).

**Fix:** Replace current function with plausibility logic; add `adjustmentLog` to Timer type.

---

### Low Priority (Future Features)

#### ⏸️ Room Lock + Heartbeat Not Implemented

**Location:** `frontend/src/context/UnifiedDataContext.tsx`, `companion/src/main.ts`

**Issue:** Companion server has basic single-controller lock; no heartbeat or takeover prompt in web app.

**Target:** Heartbeat-based lock with "never auto-expire" prompt (see Section 3.3).

**Fix:** Add `lock.lastHeartbeat` field, heartbeat interval, takeover prompt, `CONTROLLER_TAKEOVER` event.

---

#### ⏸️ Deprecated Mode Type Still Exists

**Location:** `frontend/src/context/AppModeContext.tsx`

**Issue:**

```typescript

export type AppMode = 'auto' | 'cloud' | 'local' | 'hybrid'  // ❌ deprecated mode

```

**Target:** Remove `hybrid` from type; update UI to show only Auto/Cloud/Local.

**Fix:** Change type to `'auto' | 'cloud' | 'local'`; update downstream code/UX.

---

## Testing Implications

**Until these gaps are closed:**

- Cloud mode won't hot-standby Companion (writes only to Firebase)

- Multi-device scenarios may lose changes (no merge/arbitration)

- Offline shows may reject valid snapshots (naive staleness)

- Room lock conflicts won't prompt user (auto-takeover not graceful)

**Recommended testing sequence:**

1\. Fix Companion participation in Cloud mode (HIGH)

2\. Implement timestamp arbitration (HIGH)

3\. Add queue merge logic (HIGH)

4\. Add Firebase→Companion sync (MEDIUM)

5\. Implement plausibility check (MEDIUM)

6\. Add room lock prompt (LOW)

```

---

### **Phase 3: Create docs/edge-cases.md**

**File:** `docs/edge-cases.md` (NEW)

**Content:**

```markdown

# OnTime Edge Cases & Resolutions

**Last Updated:** TBD (verify)

**Status:** ⚠️ TARGET (to be created)

---

## 1. Room Lock Conflicts

### Scenario: Senior Offline, Junior Takes Over

**Timeline:**

```

0:00 - Senior goes offline (lock remains, heartbeat stops)

4:00 - Junior connects, sees "Room locked (offline)"

4:01 - Junior clicks "Take Over"

```

**Resolution:**

**⚠️ TARGET BEHAVIOR (Not Yet Implemented):**

- Lock never auto-expires (no timeout)

- Warning prompt shows:

  - Locked by: senior@example.com

  - Device: MacBook Pro

  - Last active: 4h 0m ago

- Junior must explicitly confirm takeover

- Senior's session notified if reconnects: "Room taken over by junior@example.com"

**Current State:** Companion server has basic single-controller lock; no heartbeat/prompt in web app. See `docs/local-mode-plan.md` Section 9.

**Design Decision:** User takes responsibility for takeover decision, not auto-expire logic.

---

## 2. Multi-Device Timer Adjustments

### Scenario: Operator Adds/Subtracts Time Mid-Show

**Timeline:**

```

0:00 - Timer starts (5 min duration)

0:05 - Operator changes duration to 60 min

1:00 - Snapshot arrives (age = 1 hour)

```

**Resolution:**

**⚠️ TARGET BEHAVIOR (Not Yet Implemented):**

- **Adjustment logging:** Timer has `adjustmentLog[]` tracking deltas

- **Plausibility check:**

  - Base elapsed: 0s

  - Age: 3600s (1 hour)

  - Adjustments: +55min = +3300s

  - Expected: 0 + 3600 + 3300 = 6900s ✅

  - Max plausible: 60min * 3 = 10800s ✅ ACCEPTED

**Current State:** Fixed 30s/24h staleness thresholds; no adjustment log. See `docs/local-mode-plan.md` Section 9.

---

## 3. Multi-Device Offline/Online Interleaving

### Scenario: Two Devices Make Different Changes

**Timeline:**

```

Device A (offline): Timer 1 state change +10min (timestamp: 100)

Device B (online):  Timer 2 created (timestamp: 200)

Both reconnect.

```

**Resolution:**

**⚠️ TARGET BEHAVIOR (Not Yet Implemented):**

- **Orthogonal changes coexist:** Group by change type + target

  - "STATE_CHANGE:timer1" → Keep timestamp 100

  - "TIMER_CRUD:timer2" → Keep timestamp 200

  - Both changes replay ✅

**Example:**

```typescript

// Merge algorithm

const grouped = {

  'STATE_CHANGE:timer1': [{ ts: 100, delta: +10min }],

  'TIMER_CRUD:timer2':   [{ ts: 200, timer: {...} }]

}

// Keep latest per group → both changes preserved

```

**Current State:** Queue replay is FIFO only; no grouping/deduplication. See `docs/local-mode-plan.md` Section 9.

---

## 4. Template Room Conflicts (Mitigation)

### Scenario: Two Juniors Clone Same Template

**⚠️ FUTURE MITIGATION (Phase 2):**

**Prevention:**

- **Forced rename on template creation**

- Prompt: "Name your room (templates must be renamed):"

- Default: `{template.title} - {date}`

- Blocks creation if user doesn't rename

**Benefit:** Eliminates 90% of lock conflicts by ensuring unique room IDs.

**Current State:** No template system. Manual room creation only.

---

## 5. Viewer Read Preference

### Scenario: Viewer Joins Room with Stale Companion Data

**Timeline:**

```

0:00 - Controller on Cloud makes change (Firebase ts: 100)

0:01 - Companion disconnected (last ts: 50)

0:02 - Viewer joins, sees stale Companion data

```

**Resolution:**

**⚠️ TARGET BEHAVIOR (Not Yet Implemented):**

- Compare `lastUpdate` timestamps from both sources

- Pick freshest data (Firebase ts:100 > Companion ts:50) → Use Firebase

- **2-second confidence window:** If timestamps within 2s, trust `roomAuthority` (prevents flickering)

**Current State:** Code respects `roomAuthority` only; no timestamp comparison. Viewer may see stale data. See `docs/local-mode-plan.md` Section 9.

---

## 6. Choppy Connection Handling

### Scenario: Internet Reconnects Every 30 Seconds

**Problem:** Frequent authority flips cause UI flickering.

**Resolution:**

**⚠️ TARGET BEHAVIOR (Partially Implemented):**

- **Confidence window:** Don't flip authority if timestamps within 2s (prevents ping-pong)

- **Expandable window:** If frequent reconnects detected, expand to 4s

- **Connection stability tracking:** Track reconnect frequency, adjust confidence window dynamically

**⚠️ CURRENT:** Confidence window behavior must be verified in code; dynamic expansion is not documented as implemented.

---

**Last Updated:** TBD (verify)

```

---

### **Phase 4: Update PRDs (Add Banners)**

#### 4.1 Add Banner to frontend-prd.md

**At very top of file:**

```markdown

---

**⚠️ MVP SPECIFICATION - PARTIALLY SUPERSEDED**

This document describes the **Firebase-only MVP** (pre-Phase 1D).

**For current dual-sync architecture**, see:

- `docs/local-mode-plan.md` - Parallel Sync & Flawless Fallback

- `docs/edge-cases.md` - Edge Case Handling

**Phase 1D Updates Not Reflected Here:**

- Dual-connection model (Companion + Firebase)

- Timestamp arbitration

- Queue merging

- Room lock prompt

**Status:** Use for high-level UI specs; defer to `local-mode-plan.md` for sync behavior.

**Last Updated:** Pre-Phase 1D (December 2024)

---

```

#### 4.2 Add Banner to backend-prd.md

**At very top of file:**

```markdown

---

**⚠️ MVP SPECIFICATION - PARTIALLY SUPERSEDED**

This document describes the **Firebase-only MVP** (pre-Phase 1D).

**For current dual-sync architecture**, see:

- `docs/local-mode-plan.md` - Parallel Sync & Flawless Fallback

- `docs/websocket-protocol.md` - WebSocket Events

**Phase 1D Updates Not Reflected Here:**

- Companion WebSocket server

- `SYNC_ROOM_STATE` event

- Room lock with heartbeat

- `CONTROLLER_TAKEOVER` event

**Status:** Use for data model; defer to `local-mode-plan.md` for sync protocol.

**Last Updated:** Pre-Phase 1D (December 2024)

---

```

---

## 📋 Final Implementation Checklist

Based on your `docs/parallel-sync-tasklist.md`, here's the updated status:

### **A) Documentation Hygiene**

- [ ] Create `docs/archive/README-DEPRECATION-NOTICE.md` (verify status in task list)

- [ ] Update `AGENTS.md` with archive policy (this plan)

- [ ] Move `prd-alignment-analysis.md` to archive (verify status in task list)

- [ ] Add deprecation banners to ALL `docs/archive/phase-1/*.md` files (automation script above)

- [ ] Create `docs/README.md` (this plan)

### **B) Rewrite `docs/local-mode-plan.md`**

- [ ] Add top banner (this plan - Section 2.1)

- [ ] Rewrite Section 2.1.1 (this plan - Section 2.2)

- [ ] Replace Section 3.2 & 3.3 with Parallel Sync (this plan - Section 2.3)

- [ ] Add Section 3.6.1 (Browser Cache) (this plan - Section 2.4)

- [ ] Add Section 9 (Code Gaps vs Target) (this plan - Section 2.5)

### **C) Create `docs/edge-cases.md`**

- [ ] Create file with 6 edge case scenarios (this plan - Phase 3)

### **D) Update PRDs**

- [ ] Add banner to `frontend-prd.md` (this plan - Phase 4.1)

- [ ] Add banner to `backend-prd.md` (this plan - Phase 4.2)

---

## 🎯 Summary

This plan provides:

1\. **Clear deprecation strategy** (archive notices, banners, AGENTS.md)

2\. **Honest documentation** (target state marked with ⚠️ CODE GAP)

3\. **Single source of truth** (`local-mode-plan.md` becomes canonical)

4\. **Edge case coverage** (new `edge-cases.md` file)

5\. **PRD context** (banners clarify what's superseded)

**The key insight:** Document the **target architecture** (what you've approved) while explicitly marking **code gaps** (what needs implementation). This prevents future agents from being confused about whether something is built.

**Ready to proceed with these documentation updates?**
