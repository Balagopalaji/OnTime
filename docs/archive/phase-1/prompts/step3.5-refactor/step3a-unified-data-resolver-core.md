> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 3A: Create UnifiedDataResolver - Core Structure

## Context
We are refactoring Phase 1D Step 3.5. This is the largest step, split into two parts:
- **3A (this prompt):** Core structure, per-room authority, data resolution
- **3B (next prompt):** SYNC_ROOM_STATE orchestration, Companion subscription

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1 and 2 must be complete

## Goal
Create the `UnifiedDataResolver` - the central "brain" that:
1. Manages per-room authority state
2. Decides whether to serve Firebase or Companion data
3. Translates Companion format → Firebase format

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 150-250)
frontend/src/context/DataContext.tsx
frontend/src/context/FirebaseDataContext.tsx (lines 1-50, 160-340, 895-982)
```

## Task Description

Create a new file `frontend/src/context/UnifiedDataContext.tsx` with:

### 1. Per-Room Authority State
```typescript
type RoomAuthority = {
  source: 'cloud' | 'companion' | 'pending'
  status: 'ready' | 'syncing' | 'degraded'
  lastSyncAt: number
}

// State in the provider
const [roomAuthority, setRoomAuthority] = useState<Record<string, RoomAuthority>>({})
```

### 2. Context Shape
```typescript
type UnifiedDataContextValue = DataContextValue & {
  // Authority info for UI (e.g., "Syncing" banner)
  getRoomAuthority: (roomId: string) => RoomAuthority | undefined
  // Manual authority control (for debugging/enterprise)
  forceCloudAuthority: (roomId: string) => void
  forceCompanionAuthority: (roomId: string) => void
}
```

### 3. Data Resolution Logic
```typescript
// Consume Firebase data from parent context
const firebaseContext = useFirebaseData()  // From FirebaseDataProvider

// Local state for Companion data (populated in Step 3B)
const [companionRooms, setCompanionRooms] = useState<Record<string, Room>>({})
const [companionTimers, setCompanionTimers] = useState<Record<string, Timer[]>>({})

// Resolution function
const getRoom = useCallback((roomId: string): Room | undefined => {
  const authority = roomAuthority[roomId]
  const firebaseRoom = firebaseContext.getRoom(roomId)
  const companionRoom = companionRooms[roomId]

  // Default to cloud if no authority set
  if (!authority || authority.source === 'cloud') {
    return firebaseRoom
  }

  // Companion-authoritative: translate and return
  if (authority.source === 'companion' && companionRoom) {
    return companionRoom  // Already translated in Step 3B
  }

  // Pending/degraded: prefer Firebase as fallback
  return firebaseRoom
}, [roomAuthority, firebaseContext, companionRooms])
```

### 4. State Translation Helper
```typescript
/**
 * Translate Companion state format to Firebase format.
 * Companion: { currentTime, lastUpdate, isRunning }
 * Firebase:  { startedAt, elapsedOffset, isRunning }
 */
function translateCompanionState(companionState: {
  currentTime: number
  lastUpdate: number
  isRunning: boolean
  activeTimerId: string | null
}): Room['state'] {
  return {
    activeTimerId: companionState.activeTimerId,
    isRunning: companionState.isRunning,
    // Back-calculate startedAt so elapsed computes correctly
    startedAt: companionState.isRunning
      ? Date.now() - companionState.currentTime
      : null,
    elapsedOffset: companionState.currentTime,
    progress: {},  // Will be populated from Companion events
    showClock: false,
    clockMode: '24h',
    message: { text: '', visible: false, color: 'green' },
  }
}
```

### 5. Passthrough Methods
For methods that don't depend on authority (CRUD operations), delegate to the appropriate context:
```typescript
const createTimer = useCallback(async (roomId: string, input: TimerInput) => {
  const authority = roomAuthority[roomId]
  if (authority?.source === 'companion') {
    // Will be implemented in Step 3B - Companion CRUD
    return companionCreateTimer(roomId, input)
  }
  return firebaseContext.createTimer(roomId, input)
}, [roomAuthority, firebaseContext])
```

## Execution Checklist
- [ ] Create `UnifiedDataContext.tsx` with context and provider
- [ ] Implement `RoomAuthority` type and state
- [ ] Implement `getRoom()` with authority-based resolution
- [ ] Implement `getTimers()` with authority-based resolution
- [ ] Implement `translateCompanionState()` helper
- [ ] Implement passthrough for all `DataContextValue` methods
- [ ] Export `useUnifiedData` hook (or override `useDataContext`)
- [ ] Leave Companion subscription as stub (implemented in Step 3B)

## Acceptance Criteria
- [ ] Provider renders without errors
- [ ] Default authority is `cloud` (Firebase data served)
- [ ] `getRoomAuthority()` returns correct state
- [ ] `translateCompanionState()` produces valid Firebase-format state
- [ ] All `DataContextValue` methods are available (some as stubs)

## Notes
- This step creates the skeleton; Step 3B adds Companion subscription logic
- The `companionRooms` and `companionTimers` state will be populated in Step 3B
- Companion CRUD operations are stubs in this step
