# Phase 1D Step 3.5 Refactor: Unified Data Provider Architecture

## Overview

This document details the refactoring required to implement "Seamless Switching + Dual Connections" as specified in Phase 1D Step 3.5. The core change is moving from **provider swapping** to a **dual-connection architecture** where Firebase and Companion run in parallel.

## Notes/Tests

- `frontend/src/__tests__/reorderRoom.mock.test.tsx` is skipped: MockDataContext timers/storage side effects keep Vitest alive; fix by refactoring MockDataContext for testability or stubbing/cleaning timers and storage listeners in a harness.

## Problem Statement

The current implementation in `DataProvider.tsx` completely swaps providers when switching modes:

```tsx
// CURRENT (problematic)
if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
  return <CompanionDataProvider>{children}</CompanionDataProvider>
}
return <FirebaseDataProvider>{children}</FirebaseDataProvider>
```

This causes:
- Timer state to "disappear" during mode switches
- Firebase subscriptions to tear down when switching to Local/Hybrid
- WebSocket state to be lost when switching back to Cloud
- Race conditions with localStorage snapshot timing

## Target Architecture

```tsx
<CompanionConnectionProvider>  {/* Socket + handshake only */}
  <AppModeProvider>             {/* Uses socket state for auto-resolution */}
    <FirebaseDataProvider>      {/* Always subscribed to Firestore */}
      <UnifiedDataResolver>     {/* Per-room authority + translation */}
        {children}
      </UnifiedDataResolver>
    </FirebaseDataProvider>
  </AppModeProvider>
</CompanionConnectionProvider>
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Firebase format is canonical | UI components already consume `startedAt/elapsedOffset`; minimizes code churn |
| Socket connection is top-level | Eliminates 2-3s handshake delay on mode switch |
| Per-room authority tracking | Supports multi-tab workflows (Room A in Local, Room B in Cloud) |
| Viewers pick freshest data | Latency > consistency for read-only clients |
| Controllers get "Syncing" state | Write continuity requires explicit sync verification |

## State Format Translation

**Companion format:** `{ currentTime, lastUpdate, isRunning }`
**Firebase format (canonical):** `{ startedAt, elapsedOffset, isRunning }`

Translation (Companion → Firebase):
```typescript
function translateCompanionToFirebase(companion: CompanionState): FirebaseState {
  return {
    isRunning: companion.isRunning,
    // Back-calculate startedAt so elapsed computes correctly
    startedAt: companion.isRunning ? (Date.now() - companion.currentTime) : null,
    elapsedOffset: companion.currentTime,
  }
}
```

---

## Implementation Steps

### Step 1: Extract CompanionConnectionProvider

**Goal:** Separate socket connection/handshake logic from room data subscription.

**Files to create:**
- `frontend/src/context/CompanionConnectionContext.tsx`

**Files to modify:**
- `frontend/src/context/CompanionDataContext.tsx` (extract from)

**What this provider exposes:**
```typescript
type CompanionConnectionContextValue = {
  socket: Socket | null
  isConnected: boolean
  handshakeStatus: 'idle' | 'pending' | 'ack' | 'error'
  companionMode: string
  capabilities: {
    powerpoint: boolean
    externalVideo: boolean
    fileOperations: boolean
  }
  systemInfo: {
    platform: string
    hostname: string
  } | null
  // Token management
  token: string | null
  fetchToken: () => Promise<string | null>
  clearToken: () => void
}
```

**Acceptance Criteria:**
- [ ] Socket connects to `ws://localhost:4000` on mount
- [ ] Exposes connection state without subscribing to any room
- [ ] Token fetched from `http://localhost:4001/api/token` on demand
- [ ] No room-specific logic (JOIN_ROOM, SYNC_ROOM_STATE, etc.)

**Repo Prompt Files:**
```
frontend/src/context/CompanionDataContext.tsx (lines 1-250, 397-528, 780-794)
frontend/src/context/CompanionConnectionContext.tsx (new file)
```

---

### Step 2: Modify AppModeProvider

**Goal:** Use real socket state instead of HTTP polling for Companion detection.

**Files to modify:**
- `frontend/src/context/AppModeContext.tsx`

**Changes:**
1. Remove `probeCompanion()` HTTP polling function
2. Consume `isConnected` from `CompanionConnectionProvider` via context
3. Keep existing `effectiveMode` resolution logic
4. Instant reaction to socket disconnect (no 3-second polling delay)

**Before:**
```typescript
const probeCompanion = async (timeoutMs = 600): Promise<boolean> => {
  // HTTP fetch to localhost:4001/api/token
}

useEffect(() => {
  const interval = window.setInterval(resolve, 3000) // Polling
  // ...
}, [])
```

**After:**
```typescript
const { isConnected } = useCompanionConnection()

useEffect(() => {
  // Instant resolution based on socket state
  const next = isConnected ? (isOnline ? 'hybrid' : 'local') : 'cloud'
  setEffectiveMode(next)
}, [isConnected, isOnline])
```

**Acceptance Criteria:**
- [ ] No HTTP polling for Companion detection
- [ ] Mode changes instantly when socket connects/disconnects
- [ ] `effectiveMode` still resolves correctly (auto → cloud/hybrid/local)

**Repo Prompt Files:**
```
frontend/src/context/AppModeContext.tsx
frontend/src/context/CompanionConnectionContext.tsx
```

---

### Step 3: Create UnifiedDataResolver

**Goal:** Central "brain" that manages per-room authority and coordinates data sources.

**Files to create:**
- `frontend/src/context/UnifiedDataContext.tsx`

**What this provider does:**
1. Consumes Firebase data from `FirebaseDataProvider` context
2. Subscribes to Companion rooms via socket (when mode requires it)
3. Translates Companion format → Firebase format
4. Manages per-room authority state machine
5. Orchestrates SYNC_ROOM_STATE on mode switches
6. Exposes unified `useDataContext()` to children

**Per-Room Authority State:**
```typescript
type RoomAuthority = {
  source: 'cloud' | 'companion' | 'pending'
  status: 'ready' | 'syncing' | 'degraded'
  lastSyncAt: number
}

type UnifiedDataContextValue = DataContextValue & {
  roomAuthority: Record<string, RoomAuthority>
  subscribeToCompanionRoom: (roomId: string, clientType: 'controller' | 'viewer') => void
  unsubscribeFromCompanionRoom: (roomId: string) => void
}
```

**Data Resolution Logic:**
```typescript
function getRoom(roomId: string): Room | undefined {
  const authority = roomAuthority[roomId]
  const firebaseRoom = firebaseContext.getRoom(roomId)
  const companionRoom = companionRooms[roomId]

  if (!authority || authority.source === 'cloud') {
    return firebaseRoom
  }

  if (authority.source === 'companion' && companionRoom) {
    // Translate and return Companion data in Firebase format
    return translateCompanionRoom(companionRoom)
  }

  // Pending/degraded: prefer Firebase as fallback
  return firebaseRoom
}
```

**SYNC_ROOM_STATE Orchestration (Controller only):**
```typescript
async function switchToCompanion(roomId: string) {
  setRoomAuthority(roomId, { source: 'pending', status: 'syncing' })

  const firebaseRoom = firebaseContext.getRoom(roomId)
  const firebaseTimers = firebaseContext.getTimers(roomId)

  // Send current Firebase state to Companion
  socket.emit('SYNC_ROOM_STATE', {
    type: 'SYNC_ROOM_STATE',
    roomId,
    timers: firebaseTimers,
    state: {
      activeTimerId: firebaseRoom.state.activeTimerId,
      isRunning: firebaseRoom.state.isRunning,
      currentTime: computeElapsedMs(firebaseRoom),
      lastUpdate: Date.now(),
    },
  })

  // Wait for Companion acknowledgment (ROOM_STATE_DELTA)
  await waitForCompanionSync(roomId)

  setRoomAuthority(roomId, { source: 'companion', status: 'ready' })
}
```

**Acceptance Criteria:**
- [ ] Per-room authority tracking works
- [ ] Firebase data always available as fallback
- [ ] Companion data translated to Firebase format
- [ ] SYNC_ROOM_STATE sent when Controller switches Cloud → Local/Hybrid
- [ ] "Syncing" state prevents UI flicker during transition
- [ ] Viewers pick freshest data without "Syncing" state

**Repo Prompt Files:**
```
frontend/src/context/UnifiedDataContext.tsx (new file)
frontend/src/context/FirebaseDataContext.tsx (lines 1-50, 160-340, 895-982)
frontend/src/context/CompanionConnectionContext.tsx
frontend/src/context/DataContext.tsx
companion/src/main.ts (lines 925-1018 - SYNC_ROOM_STATE handler)
```

---

### Step 4: Simplify CompanionDataContext

**Goal:** Remove redundant logic now handled by other providers.

**Files to modify:**
- `frontend/src/context/CompanionDataContext.tsx`

**What to remove:**
- Socket creation (moved to `CompanionConnectionProvider`)
- localStorage snapshot logic (`hydrateFromStorage`, `cloudRoomSnapshot`)
- `ignoringSnapshotForRoomRef` race condition workaround
- `justSwitchedFromCloud` session flag
- `queueMicrotask` timing hacks
- `pendingCloudSyncRef`

**What to keep (or move to UnifiedDataResolver):**
- Room subscription logic (`subscribeToRoom`)
- Timer CRUD operations
- Firestore write-through logic
- Queue management for offline

**Decision:** This file may be merged entirely into `UnifiedDataResolver` or kept as a thin utility for Companion-specific operations.

**Acceptance Criteria:**
- [ ] No socket creation in this file
- [ ] No localStorage snapshot reading
- [ ] No `ignoringSnapshotForRoomRef` or similar workarounds
- [ ] File is either deleted or significantly simplified

**Repo Prompt Files:**
```
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/UnifiedDataContext.tsx
```

---

### Step 5: Update DataProvider.tsx

**Goal:** Implement the nested provider structure.

**Files to modify:**
- `frontend/src/context/DataProvider.tsx`

**Before:**
```tsx
if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
  return <CompanionDataProvider>{children}</CompanionDataProvider>
}
return <FirebaseDataProvider>{children}</FirebaseDataProvider>
```

**After:**
```tsx
export const DataProvider = ({ children }: { children: ReactNode }) => {
  if (shouldUseMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return (
    <CompanionConnectionProvider>
      <AppModeProvider>
        <FirebaseDataProvider>
          <UnifiedDataResolver>
            {children}
          </UnifiedDataResolver>
        </FirebaseDataProvider>
      </AppModeProvider>
    </CompanionConnectionProvider>
  )
}
```

**Acceptance Criteria:**
- [ ] No conditional provider switching based on mode
- [ ] All four providers nested correctly
- [ ] Mock mode still works as escape hatch
**Notes (multi-client + viewer guard updates)**
- UnifiedDataContext enforces viewer read-only: timer/room mutations short-circuit for `clientType === 'viewer'`.
- SYNC storm fix: pending sync is cleared after the first SYNC emission or on incoming deltas; authority flips to ready so "syncing" banners clear when Companion is connected.
- Multi-client ready on web: controllers/viewers can join in parallel; if conflicts remain, update the Companion server to allow multiple sockets/broadcasts.
- Mode sync across tabs (localStorage/BroadcastChannel); dashboard shows cloud rooms even in local/hybrid (cached when offline).

**Repo Prompt Files:**
```
frontend/src/context/DataProvider.tsx
frontend/src/context/CompanionConnectionContext.tsx
frontend/src/context/AppModeContext.tsx
frontend/src/context/FirebaseDataContext.tsx
frontend/src/context/UnifiedDataContext.tsx
```

---

### Step 6: Update Controller/Viewer Pages

**Goal:** Remove manual subscription logic, rely on UnifiedDataResolver.

**Files to modify:**
- `frontend/src/routes/ControllerPage.tsx`
- `frontend/src/routes/ViewerPage.tsx`

**What to remove:**
- Manual `subscribeToRoom` calls
- `lastSubscribeRef` tracking
- localStorage snapshot saving (moved to UnifiedDataResolver)

**What to add:**
- Use `roomAuthority` from context to show "Syncing" banner (Controller only)

**Acceptance Criteria:**
- [ ] No manual Companion subscription in pages

---

## Status (Phase 1D Step 3.5)
- Step 6 (Page Updates) completed: Controller/Viewer now rely on UnifiedDataResolver, syncing banner scoped to pending Companion authority, viewer header hidden for minimal UI, dashboard tiles auto-refresh in local/hybrid.
- Step 7 (Validation) covered via lint/Vitest + manual multi-tab/mode/Companion restart checks.
- Open follow-up: `src/__tests__/reorderRoom.mock.test.tsx` remains skipped (MockDataContext side-effects); consider refactoring MockDataContext for testability if we want this restored.
- [ ] Controller shows "Syncing to Companion..." banner during transition
- [ ] Viewer works without "Syncing" state
- [ ] Both pages consume data via `useDataContext()` unchanged

**Repo Prompt Files:**
```
frontend/src/routes/ControllerPage.tsx (lines 1-100, 166-178)
frontend/src/routes/ViewerPage.tsx (lines 1-65)
frontend/src/context/UnifiedDataContext.tsx
```

---

### Step 7: Implement Smarter Staleness Check

**Goal:** Allow older snapshots for paused timers.

**Location:** `UnifiedDataResolver` (SYNC_ROOM_STATE logic)

**Logic:**
```typescript
function isSnapshotStale(room: Room, snapshotAge: number): boolean {
  if (room.state.isRunning) {
    return snapshotAge > 30_000  // 30 seconds for running timers
  }
  if (room.state.elapsedOffset > 0) {
    return snapshotAge > 24 * 60 * 60 * 1000  // 24 hours for paused with progress
  }
  return false  // Fresh timer, any snapshot is fine
}
```

**Acceptance Criteria:**
- [ ] Running timers use 30-second staleness threshold
- [ ] Paused timers with progress use 24-hour threshold
- [ ] Fresh timers accept any snapshot

---

## Testing Plan

### Unit Tests
- [ ] `CompanionConnectionProvider`: Socket connection lifecycle
- [ ] `UnifiedDataResolver`: Authority state transitions
- [ ] `UnifiedDataResolver`: Companion → Firebase translation accuracy
- [ ] Staleness check logic

### Integration Tests
- [ ] Switch Cloud → Local while timer running: timer continues
- [ ] Switch Local → Cloud while timer running: timer continues
- [ ] Switch modes while timer paused: state preserved
- [ ] Multi-tab: Room A (Local) + Room B (Cloud) work independently
- [ ] Companion disconnect: graceful fallback to Cloud
- [ ] Viewer receives updates from both sources

### Manual QA Scenarios
1. Start timer in Cloud mode, switch to Local, verify no time jump
2. Pause timer in Local mode, switch to Cloud, verify correct paused time
3. Open same room in two tabs with different modes
4. Kill Companion process while in Local mode, verify fallback
5. Disconnect internet while in Hybrid mode, verify Companion continues

---

## Files Summary

### New Files
- `frontend/src/context/CompanionConnectionContext.tsx`
- `frontend/src/context/UnifiedDataContext.tsx`

### Modified Files
- `frontend/src/context/AppModeContext.tsx`
- `frontend/src/context/DataProvider.tsx`
- `frontend/src/context/CompanionDataContext.tsx` (simplify or delete)
- `frontend/src/routes/ControllerPage.tsx`
- `frontend/src/routes/ViewerPage.tsx`

### Unchanged Files
- `frontend/src/context/FirebaseDataContext.tsx` (no changes needed)
- `companion/src/main.ts` (SYNC_ROOM_STATE already implemented)

---

## Repo Prompt Execution Order

Execute these steps sequentially. Each step should be a separate prompt.

1. **Step 1**: CompanionConnectionProvider extraction
2. **Step 2**: AppModeProvider modification
3. **Step 3**: UnifiedDataResolver creation (largest step, may need 2 prompts)
4. **Step 4**: CompanionDataContext simplification
5. **Step 5**: DataProvider restructure
6. **Step 6**: Controller/Viewer page updates
7. **Step 7**: Staleness check implementation

---

## Rollback Plan

If issues arise, the refactor can be rolled back by:
1. Reverting `DataProvider.tsx` to conditional provider switching
2. Removing new context files
3. Restoring original `CompanionDataContext.tsx`

The existing `CompanionDataContext.tsx` should be preserved in git history.
