> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 3B: UnifiedDataResolver - Companion Subscription & SYNC

## Context
Continuing from Step 3A, we now add Companion room subscription and SYNC_ROOM_STATE orchestration to the `UnifiedDataResolver`.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1, 2, and 3A must be complete

## Goal
Add to `UnifiedDataResolver`:
1. Companion room subscription via socket
2. SYNC_ROOM_STATE orchestration on mode switch
3. Companion CRUD operations with Firestore write-through

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 150-300)
frontend/src/context/UnifiedDataContext.tsx (from Step 3A)
frontend/src/context/CompanionConnectionContext.tsx
frontend/src/context/CompanionDataContext.tsx (lines 680-800, 1000-1100)
companion/src/main.ts (lines 925-1018)
```

## Task Description

### 1. Companion Room Subscription
```typescript
const { socket, isConnected, token, fetchToken } = useCompanionConnection()
const { effectiveMode } = useAppMode()

// Subscribe to Companion room when needed
const subscribeToCompanionRoom = useCallback(async (
  roomId: string,
  clientType: 'controller' | 'viewer'
) => {
  if (!socket || !isConnected) return

  let currentToken = token
  if (!currentToken) {
    currentToken = await fetchToken()
    if (!currentToken) return
  }

  // Set authority to pending while we sync
  setRoomAuthority(prev => ({
    ...prev,
    [roomId]: { source: 'pending', status: 'syncing', lastSyncAt: Date.now() }
  }))

  socket.emit('JOIN_ROOM', {
    type: 'JOIN_ROOM',
    roomId,
    token: currentToken,
    clientType,
    clientId,
  })
}, [socket, isConnected, token, fetchToken, clientId])
```

### 2. Socket Event Handlers
```typescript
useEffect(() => {
  if (!socket) return

  const handleSnapshot = (payload: RoomStateSnapshot) => {
    const translatedState = translateCompanionState(payload.state)
    setCompanionRooms(prev => ({
      ...prev,
      [payload.roomId]: buildRoomFromCompanion(payload.roomId, translatedState)
    }))
  }

  const handleDelta = (payload: RoomStateDelta) => {
    setCompanionRooms(prev => {
      const existing = prev[payload.roomId]
      if (!existing) return prev
      const nextState = {
        ...existing.state,
        ...translateCompanionState({
          ...existing.state,
          ...payload.changes,
        })
      }
      return { ...prev, [payload.roomId]: { ...existing, state: nextState } }
    })
  }

  const handleTimerCreated = (payload: { roomId: string; timer: Timer }) => {
    setCompanionTimers(prev => ({
      ...prev,
      [payload.roomId]: [...(prev[payload.roomId] ?? []), payload.timer]
        .sort((a, b) => a.order - b.order)
    }))
  }

  // Similar handlers for TIMER_UPDATED, TIMER_DELETED, TIMERS_REORDERED...

  socket.on('ROOM_STATE_SNAPSHOT', handleSnapshot)
  socket.on('ROOM_STATE_DELTA', handleDelta)
  socket.on('TIMER_CREATED', handleTimerCreated)
  // ... register other handlers

  return () => {
    socket.off('ROOM_STATE_SNAPSHOT', handleSnapshot)
    socket.off('ROOM_STATE_DELTA', handleDelta)
    socket.off('TIMER_CREATED', handleTimerCreated)
    // ... unregister other handlers
  }
}, [socket])
```

### 3. SYNC_ROOM_STATE Orchestration (Controller Only)
```typescript
const switchToCompanion = useCallback(async (roomId: string) => {
  if (!socket || !isConnected) return

  const firebaseRoom = firebaseContext.getRoom(roomId)
  const firebaseTimers = firebaseContext.getTimers(roomId)
  if (!firebaseRoom) return

  setRoomAuthority(prev => ({
    ...prev,
    [roomId]: { source: 'pending', status: 'syncing', lastSyncAt: Date.now() }
  }))

  // Compute current elapsed time from Firebase state
  const elapsedMs = firebaseRoom.state.isRunning && firebaseRoom.state.startedAt
    ? firebaseRoom.state.elapsedOffset + (Date.now() - firebaseRoom.state.startedAt)
    : firebaseRoom.state.elapsedOffset

  // Check staleness - smarter threshold based on timer state
  const isStale = isSnapshotStale(firebaseRoom, Date.now() - firebaseRoom.state.lastUpdate)
  if (isStale) {
    console.warn('[unified] Firebase snapshot too stale, using Companion state')
    // Don't send SYNC, just accept Companion's current state
    setRoomAuthority(prev => ({
      ...prev,
      [roomId]: { source: 'companion', status: 'ready', lastSyncAt: Date.now() }
    }))
    return
  }

  // Send SYNC_ROOM_STATE to Companion
  socket.emit('SYNC_ROOM_STATE', {
    type: 'SYNC_ROOM_STATE',
    roomId,
    timers: firebaseTimers,
    state: {
      activeTimerId: firebaseRoom.state.activeTimerId,
      isRunning: firebaseRoom.state.isRunning,
      currentTime: elapsedMs,
      lastUpdate: Date.now(),
    },
    sourceClientId: clientId,
    timestamp: Date.now(),
  })

  // Wait for acknowledgment (Companion sends ROOM_STATE_DELTA after SYNC)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[unified] SYNC_ROOM_STATE timeout')
      resolve()
    }, 3000)

    const onDelta = (payload: { roomId: string }) => {
      if (payload.roomId === roomId) {
        clearTimeout(timeout)
        socket.off('ROOM_STATE_DELTA', onDelta)
        resolve()
      }
    }
    socket.on('ROOM_STATE_DELTA', onDelta)
  })

  setRoomAuthority(prev => ({
    ...prev,
    [roomId]: { source: 'companion', status: 'ready', lastSyncAt: Date.now() }
  }))
}, [socket, isConnected, firebaseContext, clientId])
```

### 4. Smarter Staleness Check
```typescript
function isSnapshotStale(room: Room, ageMs: number): boolean {
  if (room.state.isRunning) {
    return ageMs > 30_000  // 30 seconds for running timers
  }
  if (room.state.elapsedOffset > 0) {
    return ageMs > 24 * 60 * 60 * 1000  // 24 hours for paused with progress
  }
  return false  // Fresh timer, any snapshot is fine
}
```

### 5. Companion CRUD with Firestore Write-Through
```typescript
const createTimer = useCallback(async (roomId: string, input: TimerInput) => {
  const authority = roomAuthority[roomId]

  if (authority?.source === 'companion' && socket?.connected) {
    // Optimistic update
    const tempId = crypto.randomUUID()
    const timer: Timer = { id: tempId, roomId, ...input, order: Date.now() }
    setCompanionTimers(prev => ({
      ...prev,
      [roomId]: [...(prev[roomId] ?? []), timer].sort((a, b) => a.order - b.order)
    }))

    // Emit to Companion
    socket.emit('CREATE_TIMER', {
      type: 'CREATE_TIMER',
      roomId,
      timer,
      clientId,
      timestamp: Date.now(),
    })

    // Firestore write-through (best-effort)
    if (navigator.onLine) {
      const timerRef = doc(db, 'rooms', roomId, 'timers', tempId)
      await setDoc(timerRef, timer).catch(() => {})
    }

    return timer
  }

  // Fallback to Firebase
  return firebaseContext.createTimer(roomId, input)
}, [roomAuthority, socket, clientId, firebaseContext])
```

## Execution Checklist
- [ ] Add socket event handlers for Companion room events
- [ ] Implement `subscribeToCompanionRoom()` with JOIN_ROOM
- [ ] Implement `switchToCompanion()` with SYNC_ROOM_STATE
- [ ] Implement `isSnapshotStale()` with smarter thresholds
- [ ] Implement Companion CRUD operations (createTimer, updateTimer, deleteTimer, etc.)
- [ ] Add Firestore write-through for all Companion CRUD operations
- [ ] Handle HANDSHAKE_ACK to complete subscription
- [ ] Handle HANDSHAKE_ERROR for rejection/takeover

## Acceptance Criteria
- [ ] Joining Companion room works for Controller and Viewer
- [ ] SYNC_ROOM_STATE sent when Controller switches Cloud → Companion
- [ ] Companion state updates reflect in UI immediately
- [ ] Firestore receives write-through for all Companion operations
- [ ] Staleness check uses correct thresholds (30s running, 24h paused)

## Notes
- Viewers should NOT send SYNC_ROOM_STATE (read-only)
- Viewers pick freshest data without "Syncing" state
- The `clientId` should be consistent across the session (use sessionStorage)
