---
CURRENT SOURCE OF TRUTH - Phase 1D Parallel Sync Architecture
This document describes the target architecture for OnTime's dual-connection (Companion + Firebase) system.
Status: Target architecture; some features are marked "TO BE IMPLEMENTED".
Supersedes: prior single-provider model, "Hybrid" mode, Firebase-only MVP specs (see PRD banners).
Last Updated: 2025-12-22
Code Alignment: See Section 9 "Code Gaps vs Target Architecture".
---

# Implementation Plan: Local Mode Foundation (Phase 1)

## 1. Goal
Establish a stable, offline-capable "Local Mode" where the OnTime Controller and Viewers communicate via a local Companion App (WebSocket Relay) instead of Firebase. This serves as the foundation for future Show Control features.

## 2. Architecture

### 2.1 Dual-Connection Transport Layer (Parallel Sync)
The frontend maintains two transport mechanisms in parallel:
1.  **Firebase (Cloud):** Persistence and remote access.
2.  **Companion (Local):** Low-latency LAN communication and offline resilience.

**Key principle:** When both are available, write to both. Read preference is mode-driven with timestamp arbitration.

### 2.1.1 App Modes (Operator UX)
The UI exposes three modes to the operator:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Auto** | Smart selection: prefer freshest data by timestamp | Default for most users |
| **Local** | Prefer Companion for reads; write to both when online | Unreliable internet venues |
| **Cloud** | Prefer Firebase for reads; write to both if Companion connected | Remote-only shows |

**Key principles:**
1. **All modes dual-write when both systems are available**
   - If Companion connected: write to Companion
   - If online: write to Firebase
   - Neither is "primary" - they are mutual backups
2. **Mode only affects read preference**
   - Local mode: prefer Companion when timestamps tie
   - Cloud mode: prefer Firebase when timestamps tie
   - Auto mode: freshest timestamp wins
3. **Write-through ensures seamless fallback**
   - If Companion drops: Firebase already has latest state
   - If internet drops: Companion already has latest state
   - Operator can switch devices/modes without data loss

**Hybrid term deprecated:** "Hybrid" is removed. Local now describes dual-write behavior when online.

**Seamless mode switching:**
- `AppModeProvider` updates `effectiveMode`
- `UnifiedDataResolver` adjusts `roomAuthority` per room
- Running timers continue without interruption (state preserved in both systems)
- Controllers show a brief "Sync" LED indicator during authority handoff
- Viewers pick freshest data by timestamp (no "Syncing" banner)

**CODE GAP:** `AppModeContext` still exposes `hybrid`. See Section 9.

### 2.2 The Companion App (Electron)
A lightweight Node.js/Electron application running on the operator's machine.
*   **Server:** Runs a WebSocket server (e.g., `socket.io`) on port 4000.
*   **State:** Maintains an in-memory copy of the `RoomState`.
*   **Relay:** Broadcasts state changes to all connected clients (Controller, Viewers).
*   **API:** Exposes HTTP endpoints for file operations.
*   **Security:** Token-based authentication for LAN connections.
*   **Distribution (Phase 1 definition-of-done):** Companion is a separate desktop app installed on the **Controller/operator machine only** (Viewers do not install Companion). Local Mode requires Companion; cloud/Firebase mode does not.
*   **Modes:** Configurable operation modes to minimize resource usage:
    *   **Minimal Mode:** WebSocket relay only (timers, offline sync). ~20-50 MB RAM, 1-2% CPU.
    *   **Show Control Mode:** Adds PowerPoint/presentation monitoring via COM API. ~75-100 MB RAM, 3-5% CPU.
    *   **Full Production Mode:** All sensors including external video player monitoring. ~100-150 MB RAM, 5-10% CPU.

## 3. Technical Specifications

### 3.1 WebSocket Protocol (Event Schema)

**Source of truth:** `docs/websocket-protocol.md`. The list below is a summary and may be incomplete.

**Client → Server Events:**
*   `JOIN_ROOM`: `{ type: "JOIN_ROOM", roomId: string, token: string }`
*   `TIMER_ACTION`: `{ type: "TIMER_START" | "TIMER_PAUSE" | "TIMER_RESET", roomId: string, timerId: string }`
*   `TIMER_UPDATE`: `{ type: "TIMER_UPDATE", roomId: string, timerId: string, changes: Partial<Timer> }`
*   `SET_ACTIVE_TIMER`: `{ type: "SET_ACTIVE_TIMER", roomId: string, timerId: string }`

**Example: TIMER_START**
```json
{
  "type": "TIMER_START",
  "roomId": "abc123",
  "timerId": "timer-1",
  "timestamp": 1234567890
}
```

**Server → Client Events:**
*   `ROOM_STATE_SNAPSHOT`: `{ type: "ROOM_STATE_SNAPSHOT", roomId: string, state: RoomState }`
*   `ROOM_STATE_DELTA`: `{ type: "ROOM_STATE_DELTA", roomId: string, changes: Partial<RoomState> }`
*   `ERROR`: `{ type: "ERROR", code: string, message: string }`

### 3.2 Frontend Integration (Unified Data Provider)

> **Implementation status:** Verify in code. Provider nesting is expected but not confirmed here.
> **Code gap:** Read preference and Companion participation in Cloud mode (see Section 9).

The frontend uses a Unified Data Provider architecture where Firebase and Companion connections run in parallel.

**Provider nesting structure:**

```tsx
<CompanionConnectionProvider>  {/* Socket + token management */}
  <AppModeProvider>            {/* Mode resolution + fallback triggers */}
    <FirebaseDataProvider>     {/* Always subscribed to Firestore */}
      <UnifiedDataResolver>    {/* Per-room authority coordination */}
        {children}
      </UnifiedDataResolver>
    </FirebaseDataProvider>
  </AppModeProvider>
</CompanionConnectionProvider>
```

**Connection policy:** On app load, always attempt Companion connection; Firebase listeners stay active in all modes. If either source is unavailable, the app degrades gracefully and continues on the remaining source.

**Component responsibilities:**
1. **CompanionConnectionProvider** (`CompanionConnectionContext.tsx`)
   - Manages WebSocket connection to `ws://localhost:4000`
   - Handles token refresh and handshake lifecycle
   - Exposes `socket`, `isConnected`, `handshakeStatus` to children
2. **AppModeProvider** (`AppModeContext.tsx`)
   - Resolves `effectiveMode` based on socket state and network status
   - Triggers fallback to Cloud when Companion drops (sets `isDegraded` flag)
   - Syncs mode changes across browser tabs via `BroadcastChannel`
3. **FirebaseDataProvider** (`FirebaseDataContext.tsx`)
   - Always subscribed to Firestore (even in Local mode)
   - Provides baseline room data and timers for fallback
4. **UnifiedDataResolver** (`UnifiedDataContext.tsx`)
   - Per-room authority tracking (`roomAuthority`)
   - Data resolution: `getRoom(roomId)` and `getTimers(roomId)` select authoritative source
   - Format translation: converts Companion format to Firebase format transparently
   - Sync orchestration: sends `SYNC_ROOM_STATE` when controller joins Companion room

### 3.3 Parallel Sync & Flawless Fallback Architecture

**Target behavior:** This section describes intended behavior. Items marked "TO BE IMPLEMENTED" are not yet in code.

**Mutual backups:** When both are available, always write to both; reads pick freshest by timestamp with a 2s confidence window (expandable to 4s on choppy links).

#### Write behavior (all modes)

| Mode  | Companion write | Firebase write | Notes |
|-------|-----------------|----------------|-------|
| Cloud | Yes (if connected) | Yes | Both are mutual backups |
| Local | Yes | Yes (if online) | Both are mutual backups |
| Auto  | Depends on connection | Depends on connection | Smart selection based on availability |

**Implementation sketch:**

```ts
function writeTimerAction(action: TimerAction) {
  const companionAvailable = socket?.connected && handshakeStatus === 'ack'
  const cloudAvailable = navigator.onLine && firebase.user

  if (companionAvailable) {
    socket.emit('TIMER_ACTION', action)
  } else {
    enqueueAction(action) // Queue for when Companion reconnects
  }

  if (cloudAvailable) {
    void firebaseWrite(action).catch(() => {}) // Best-effort
  }
}
```

**CODE GAP:** Current code blocks Companion writes in Cloud mode. See Section 9.

#### Read behavior (timestamp arbitration)

**Target:** Pick freshest data by timestamp with mode bias.
**Current:** Code respects `roomAuthority` only; no timestamp comparison.

**Viewer sync guard:** While `authority.status === 'syncing'`, viewers fall back to Firebase until status is `ready`, then apply timestamp arbitration.

**Authority rule for confidence window (Auto mode):** Within the confidence window (2s), trust `roomAuthority`. This prevents flickering when both sources update near-simultaneously. If no `roomAuthority` is set (fresh room, no writes yet), default to Firebase until the first controller write establishes authority.

**Target logic:**

```ts
function getRoom(roomId: string): Room | undefined {
  const authority = roomAuthority[roomId]
  const firebaseRoom = firebase.getRoom(roomId)
  const companionState = companionRooms[roomId]

  if (!companionState) return firebaseRoom
  if (!firebaseRoom) return buildRoomFromCompanion(roomId, companionState)

  const firebaseTs = firebaseRoom.state.lastUpdate ?? 0
  const companionTs = companionState.lastUpdate ?? 0
  const confidenceMs = 2000 // Expand to 4000ms on choppy links

  if (Math.abs(firebaseTs - companionTs) < confidenceMs) {
    if (authority?.source === 'companion') {
      return buildRoomFromCompanion(roomId, companionState, firebaseRoom)
    }
    return firebaseRoom
  }

  if (effectiveMode === 'local') {
    return companionTs >= firebaseTs
      ? buildRoomFromCompanion(roomId, companionState, firebaseRoom)
      : firebaseRoom
  }

  if (effectiveMode === 'cloud') {
    return firebaseTs >= companionTs
      ? firebaseRoom
      : buildRoomFromCompanion(roomId, companionState, firebaseRoom)
  }

  return companionTs > firebaseTs
    ? buildRoomFromCompanion(roomId, companionState, firebaseRoom)
    : firebaseRoom
}
```

**TO BE IMPLEMENTED:** Timestamp arbitration with confidence window.

#### Change merging (multi-device scenarios)

**Problem:** Device A offline makes Change 1 (ts: 100); Device B online makes Change 2 (ts: 200). Orthogonal changes should coexist.

**Solution:** Group by change type + target, keep latest per group.

```ts
type ChangeType =
  | 'STATE_CHANGE'   // activeTimerId, isRunning, currentTime
  | 'TIMER_CRUD'     // createTimer, updateTimer, deleteTimer
  | 'TIMER_REORDER'  // order field changes
  | 'ROOM_CONFIG'    // title, timezone, config

function mergeQueuedEvents(queue: QueuedEvent[]): QueuedEvent[] {
  const grouped = queue.reduce((acc, event) => {
    const key = `${event.type}:${event.timerId ?? event.roomId}`
    if (!acc[key]) acc[key] = []
    acc[key].push(event)
    return acc
  }, {} as Record<string, QueuedEvent[]>)

  const merged = Object.values(grouped).map(group =>
    group.sort((a, b) => b.timestamp - a.timestamp)[0]
  )

  return merged.sort((a, b) => a.timestamp - b.timestamp)
}
```

**TO BE IMPLEMENTED:** Per-change-type merge.

#### Offline queue replay (timestamp-safe)

**Target:** Merge by change type, then replay in timestamp order.
**Current:** FIFO replay with basic timestamp filtering.

```ts
const replayRoomQueue = useCallback((roomId: string) => {
  if (!socket) return
  const queue = loadQueue(roomId)
  if (!queue.length) return

  const merged = mergeQueuedEvents(queue)

  isReplayingRef.current = true
  merged.forEach(item => socket.emit(item.type, item))
  saveQueue(roomId, [])
  isReplayingRef.current = false
}, [socket])
```

**Queue limits:**
- Max 100 events per room
- Oldest dropped if exceeded (FIFO)
- UI warning when >80% full; keep discreet and minimalist

**TO BE IMPLEMENTED:** Per-change-type merge before replay.

#### Firebase to Companion sync

**Target:** Detect Firebase changes while Companion has authority, push newer Firebase state to Companion.
**Current:** Not implemented.

```ts
useEffect(() => {
  Object.entries(roomAuthority).forEach(([roomId, auth]) => {
    if (auth.source !== 'companion') return
    const firebaseRoom = firebase.getRoom(roomId)
    const companionState = companionRooms[roomId]
    const firebaseTs = firebaseRoom?.state.lastUpdate ?? 0
    const companionTs = companionState?.lastUpdate ?? 0

    if (firebaseTs > companionTs + 2000) {
      emitSyncRoomState(roomId)
    }
  })
}, [firebase.rooms, companionRooms, roomAuthority, effectiveMode])
```

**TO BE IMPLEMENTED:** Firebase to Companion sync (not mode-gated).

#### Staleness detection (plausibility-based)

**Target:** Accept snapshots if elapsed time is plausible (duration-aware + adjustment-log support).
**Current:** Fixed 30s/24h thresholds; no adjustment log.

```ts
type TimerAdjustment = {
  timestamp: number
  delta: number
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
  const adjustments = timer.adjustmentLog?.filter(adj =>
    adj.timestamp > snapshotTimestamp &&
    adj.timestamp < now &&
    isAuthorityDevice(adj.deviceId)
  ) ?? []
  const totalAdjustments = adjustments.reduce((sum, adj) => sum + adj.delta, 0)
  const adjustedExpected = snapshotElapsed + age + totalAdjustments
  const variance = Math.abs((snapshotElapsed + age) - adjustedExpected)
  const maxVariance = timer.duration * 1000 * 0.1
  if (variance > maxVariance) return false
  return adjustedExpected <= (timer.duration * 1000 * 3)
}
```

**TO BE IMPLEMENTED:** Adjustment log + plausibility check.

#### Room lock (never auto-expire)

**Target:** Prompt-based takeover with device name + time since last heartbeat.
**Current:** Companion server has single-controller lock; no heartbeat or prompt in web app.

```ts
type RoomLock = {
  deviceId: string
  lockedBy: string
  lockedAt: number
  lastHeartbeat: number
  deviceName: string
}

async function claimRoomLock(roomId: string) {
  const room = firebase.getRoom(roomId)
  if (room?.lock) {
    const lockAge = Date.now() - room.lock.lastHeartbeat
    const lockAgeMinutes = Math.floor(lockAge / 60000)
    const confirmed = window.confirm(
      `Room lock warning\n\n` +
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

  await setDoc(doc(db, 'rooms', roomId), {
    lock: {
      deviceId: clientId,
      lockedBy: firebase.user?.email,
      lockedAt: Date.now(),
      lastHeartbeat: Date.now(),
      deviceName: getDeviceName()
    }
  }, { merge: true })
}

useEffect(() => {
  const interval = setInterval(() => {
    Object.keys(subscribedRooms).forEach(roomId => {
      setDoc(doc(db, 'rooms', roomId), {
        'lock.lastHeartbeat': Date.now()
      }, { merge: true })
    })
  }, 30000)
  return () => clearInterval(interval)
}, [subscribedRooms])
```

**TO BE IMPLEMENTED:** Room lock + heartbeat + `CONTROLLER_TAKEOVER` event.

### 3.4 File Operations API (Required for Phase 2)
*   `POST /api/open`: Opens local file in default OS app. Body: `{ path: string }`.
*   `GET /api/file/exists`: Checks file existence. Query: `?path=...`.
*   `GET /api/file/metadata`: Extracts duration/resolution. Query: `?path=...`.

**Video metadata note:** Duration/resolution extraction should use a bundled `ffprobe` binary in production Companion builds so end users do not need separate FFmpeg installs. The bundled `ffprobe` MUST come from an **LGPL-only** FFmpeg build (no GPL / no “nonfree” components) unless explicitly approved and documented. If `ffprobe` is not present (dev builds/edge cases), return a warning and fallback to size-only metadata.

### 3.5 Security & Authentication
*   **Token:** Companion exposes a short-lived token via `GET /api/token` (loopback only + Origin allowlist).
*   **Handshake:** Clients provide token in `JOIN_ROOM` payload.
*   **HTTP auth:** File operations require `Authorization: Bearer <token>`.
*   **Validation:** Server rejects invalid/expired tokens and invalid Origins; never logs raw tokens.

### 3.5.1 Room Lock (Target + Current)
**Target behavior:**
- Lock never auto-expires
- Heartbeat updates `lock.lastHeartbeat` every 30s
- Takeover requires explicit confirmation with device name + last active time
- Uses `CONTROLLER_TAKEOVER` event

**Current behavior:**
- Single-controller per room; unlimited viewers
- Second controller rejected by default (`HANDSHAKE_ERROR: CONTROLLER_TAKEN`)
- Optional takeover (`JOIN_ROOM.takeOver=true`) disconnects existing controller and claims the lock

### 3.6 State Initialization
*   **Cache Location (Platform-Specific):**
    *   Windows: `%APPDATA%\OnTime\cache\rooms.json`
    *   macOS: `~/Library/Application Support/OnTime/cache/rooms.json`
    *   Linux: `~/.config/ontime/cache/rooms.json`
*   **Startup:** Companion loads state from local cache.
*   **Sync:** If online, fetches latest from Firebase to update cache.
*   **Fallback:** If offline + no cache, starts empty.

### 3.6.1 Browser Cache (Frontend Resilience)

**Location:** Browser `localStorage`

- **Room snapshots:** `ontime:companionRoomCache.v1`
  - Last-seen room state + timers per subscribed room
  - Limited to 20 most recent (LRU eviction)
  - Used for offline resilience and fast page loads
- **Subscriptions:** `ontime:companionSubs.v1`
  - Rooms subscribed to Companion (clientType: `controller` | `viewer`)
  - Restored on page reload
- **Action queue:** `ontime:queue:{roomId}`
  - Per-room pending timer actions when Companion disconnected
  - Replayed on reconnect in timestamp order

**Staleness detection summary:**
- Running timers: plausibility-based (3x duration grace)
- Paused timers with progress: 24-hour threshold
- Fresh timers (0 elapsed): accept any age

If stale, `UnifiedDataResolver` falls back to Firebase.

### 3.7 Feature Flags & Modularity
*   **Room Configuration:** Each room has feature flags determining available capabilities.
*   **Tier-Based Access:**
    *   **Basic Tier:** Core timers, offline mode (Companion Minimal)
    *   **Show Control Tier:** PowerPoint integration, live cues, dual-header UI
    *   **Production Tier:** External video monitoring, multi-operator roles
*   **Data Model:** Advanced features use optional fields and subcollections to minimize sync overhead for basic users.
*   **UI Adaptation:** Controller automatically hides/shows features based on room tier and active capabilities.

## 4. Phased Implementation Strategy

### Phase 1A: Proof of Concept (Weeks 1-2)
*   **Goal:** Basic WebSocket relay. Timer syncs over LAN.
*   **Scope:**
    *   Electron App Skeleton (Port 4000) with Minimal Mode.
    *   WebSocket Server (No Auth).
    *   Unified Data Provider (Companion + Firebase) baseline.
    *   Basic `ROOM_STATE_*` broadcast.
    *   Feature flag infrastructure (room config).

### Phase 1B: Production Hardening (Weeks 3-5)
*   **Goal:** Reliable, secure local mode.
*   **Scope:**
    *   Token-based Authentication.
    *   State Initialization (Cache).
    *   Offline Queue & Conflict Resolution.
    *   Parallel Sync Logic.

### Phase 1C: File Operations (Weeks 6-7)
*   **Goal:** Ready for Show Control.
*   **Scope:**
    *   Implement `/api/open` and metadata endpoints.
    *   Secure path validation.
    *   Attachment system integration.

## 5. Edge Cases & Implementation Notes

### 5.1 Firestore Security Rules Update
With the new data model separation, security rules must be updated:

```javascript
match /rooms/{roomId} {
  // Room config: Public read for viewers (share-by-roomId), owner write.
  // If we ever need "private rooms", change reads to authenticated-only and gate viewer access explicitly.
  allow read: if true;
  allow write: if isOwner(roomId);
  
  // RoomState subcollection (v2): public read for viewers, owner write.
  match /state/current {
    allow read: if true;
    allow write: if isOwner(roomId);
  }

  // Timers: public read for viewers, owner write.
  match /timers/{timerId} {
    allow read: if true;
    allow write: if isOwner(roomId);
  }
  
  // LiveCues: Show Control tier+ only (auth read + owner write).
  match /liveCues/{cueId} {
    allow read: if isAuthenticated() && hasShowControlTier(roomId);
    allow write: if isOwner(roomId) && hasShowControlTier(roomId);
  }

  // Migration backups (rollback support): owner-only.
  match /migrationBackups/{backupId} {
    allow read, write: if isOwner(roomId);
  }
}
```

**Action:** Update `firebase/firestore.rules` during Phase 1C (production hardening) and deploy rules before enabling migration/rollback in production.

### 5.2 Tier Upgrade Cache Invalidation
**Scenario:** User upgrades from Basic → Show Control mid-session.

**Solution:** Use Firestore real-time listener on Room config:
```typescript
const roomRef = doc(db, 'rooms', roomId);
onSnapshot(roomRef, (snap) => {
  const room = snap.data() as Room;
  if (room.tier !== currentTier) {
    updateFeatureFlags(room.features);
    reloadUI();  // Show newly unlocked features
  }
});
```

**Why:** `onSnapshot` provides instant tier changes without polling. Firestore doesn't charge extra reads for real-time updates after initial subscription.

**Action:** Implement in `FirebaseDataContext` during Phase 1A.

## 6. Verification Plan
*   **Phase 1A:** Disconnect internet -> Start Timer -> Viewer updates <50ms. Verify tier upgrade triggers UI reload.
*   **Phase 1B:** Restart Companion -> State persists. Internet drops -> Changes queued -> Reconnect -> Syncs.
*   **Phase 1C:** Click "Open Video" in Controller -> VLC launches.
*   **Phase 1 (Ops sanity):** Attempt to connect two controllers to the same room:
    - Second controller rejected unless `takeOver=true`.

## 7. Testing and Risks

**Code gaps to validate:**
- Companion participation in Cloud mode
- Timestamp arbitration with confidence window
- Per-change-type queue merge and timestamp replay
- Firebase to Companion sync (when Firebase is newer)
- Plausibility-based staleness detection with adjustment log
- Room lock prompt + heartbeat + `CONTROLLER_TAKEOVER`
- Removal of `hybrid` in app mode types

**Regression risks:**
- Mode switch continuity (no timer resets, no provider churn)
- Queue replay correctness (no duplicate or missing actions)
- Staleness acceptance (valid snapshots should not be rejected)
- Viewer freshness (viewers should not see stale Companion data)

---

## 9. Code Gaps vs Target Architecture

### ❌ High Priority (Breaks Parallel Sync)
- **Companion blocked in Cloud mode**
  - Location: `frontend/src/context/UnifiedDataContext.tsx` (`shouldUseCompanion`)
  - Issue: Guard blocks Companion when `effectiveMode === 'cloud'`
  - Fix: Allow Companion participation in all modes (hot standby writes)
- **No timestamp arbitration**
  - Location: `frontend/src/context/UnifiedDataContext.tsx` (`getRoom`/`getTimers`)
  - Issue: Authority-only reads; no `lastUpdate` comparison
  - Fix: Implement freshest-by-timestamp with confidence window
- **Queue replay is FIFO only**
  - Location: `frontend/src/context/UnifiedDataContext.tsx` (`replayRoomQueue`)
  - Issue: No per-change-type merge before replay
  - Fix: Group by change type + target, keep latest, replay in timestamp order

### ⚠️ Medium Priority (Reliability)
- **Firebase to Companion sync missing**
  - Location: `frontend/src/context/UnifiedDataContext.tsx`
  - Issue: No detection of newer Firebase state while Companion has authority
  - Fix: Emit `SYNC_ROOM_STATE` when Firebase is newer (not mode-gated)
- **Naive staleness check**
  - Location: `frontend/src/context/UnifiedDataContext.tsx` (`isSnapshotStale`)
  - Issue: Fixed 30s/24h thresholds; no adjustment log
  - Fix: Plausibility-based check with adjustment log and 3x duration cap

### ⏸️ Low Priority (Future)
- **Room lock + heartbeat not implemented**
  - Location: `frontend/src/context/UnifiedDataContext.tsx`, `companion/src/main.ts`
  - Issue: No heartbeat, no takeover prompt in web app
  - Fix: Add `lock.lastHeartbeat`, heartbeat interval, takeover prompt, `CONTROLLER_TAKEOVER`
- **Deprecated mode type still in code**
  - Location: `frontend/src/context/AppModeContext.tsx`
  - Issue: `hybrid` still present in type/logic
  - Fix: Remove `hybrid`; use `auto | cloud | local`

**Open gaps vs code checklist**
- [ ] Companion participates in Cloud mode (hot standby writes)
- [ ] Timestamp arbitration with confidence window
- [ ] Per-change-type merge before queue replay
- [ ] Firebase to Companion sync when Firebase is newer
- [ ] Plausibility-based staleness detection
- [ ] Viewer reads use Firebase during `authority.status === 'syncing'`
- [ ] Room lock prompt + heartbeat + `CONTROLLER_TAKEOVER`
- [ ] Remove `hybrid` from app mode types
