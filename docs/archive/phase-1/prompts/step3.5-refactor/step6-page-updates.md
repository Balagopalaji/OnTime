# Step 6: Update Controller/Viewer Pages

## Context
The providers are restructured. Now we update the page components to remove manual subscription logic and use the new authority state.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1-5 must be complete

## Goal
1. Remove manual Companion subscription code from pages
2. Add "Syncing" banner to Controller page
3. Simplify Viewer page data consumption

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 370-420)
frontend/src/routes/ControllerPage.tsx
frontend/src/routes/ViewerPage.tsx
frontend/src/context/UnifiedDataContext.tsx
```

## ControllerPage Changes

### Remove Manual Subscription
```tsx
// REMOVE this code (lines 166-177)
useEffect(() => {
  if (selectedMode === 'cloud') return
  if (!roomId) return
  const token = window.localStorage.getItem('ontime:companionToken')
  // ...
  subscribeToRoom?.(roomId, token, 'controller')
}, [roomId, selectedMode, subscribeToRoom])
```

### Remove localStorage Snapshot Saving
```tsx
// REMOVE this code (lines 77-99)
useEffect(() => {
  if (!roomId || !room) return
  try {
    const payload: CloudRoomSnapshot = { /* ... */ }
    window.localStorage.setItem(`ontime:cloudRoomSnapshot:${roomId}`, JSON.stringify(payload))
  } catch { /* ... */ }
}, [room, roomId, selectedMode, timers])
```

### Add Syncing Banner
```tsx
import { useUnifiedData } from '../context/UnifiedDataContext'

// In component:
const { getRoomAuthority } = useUnifiedData()
const authority = roomId ? getRoomAuthority(roomId) : undefined

// In JSX:
{authority?.status === 'syncing' && (
  <div className="flex items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
    <Loader2 className="h-4 w-4 animate-spin" />
    Syncing to {authority.source === 'companion' ? 'Companion' : 'Cloud'}...
  </div>
)}

{authority?.status === 'degraded' && (
  <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
    <AlertTriangle size={16} />
    Running in degraded mode. Changes may not sync.
  </div>
)}
```

### Remove lastSubscribeRef
```tsx
// REMOVE
const lastSubscribeRef = useRef<string | null>(null)
```

## ViewerPage Changes

### Remove Manual Subscription
```tsx
// REMOVE this code (lines 25-34)
useEffect(() => {
  if (selectedMode === 'cloud') return
  if (!roomId) return
  const token = window.localStorage.getItem('ontime:companionToken')
  // ...
  subscribeToRoom?.(roomId, token, 'viewer')
}, [roomId, selectedMode, subscribeToRoom])
```

### Simplify Data Consumption
```tsx
// BEFORE: Conditional data selection
const effectiveRoom = selectedMode !== 'cloud' ? localRoom : room
const effectiveTimers = selectedMode !== 'cloud' ? localTimers : timers

// AFTER: Just use unified context (it handles the selection internally)
const { getRoom, getTimers } = useDataContext()
const room = roomId ? getRoom(roomId) : undefined
const timers = roomId ? getTimers(roomId) : []
```

### Remove Duplicate Hooks
```tsx
// REMOVE: These are now handled by UnifiedDataResolver
const localRoom = selectedMode !== 'cloud' && roomId ? ctx.getRoom(roomId) : undefined
const localTimers = selectedMode !== 'cloud' && roomId ? ctx.getTimers(roomId) : []
const { room, loading: roomLoading, connectionStatus: roomStatus } = useRoom(roomId)
const { timers, loading: timersLoading, connectionStatus: timerStatus } = useTimers(roomId)
```

### No Syncing Banner for Viewers
Viewers should NOT show the "Syncing" banner - they just display whatever data is freshest.

## Execution Checklist

### ControllerPage
- [ ] Remove `lastSubscribeRef`
- [ ] Remove manual subscription `useEffect`
- [ ] Remove localStorage snapshot saving `useEffect`
- [ ] Import `useUnifiedData` for authority state
- [ ] Add "Syncing" banner when `authority.status === 'syncing'`
- [ ] Add "Degraded" banner when `authority.status === 'degraded'`

### ViewerPage
- [ ] Remove `lastSubscribeRef`
- [ ] Remove manual subscription `useEffect`
- [ ] Remove conditional data selection logic
- [ ] Simplify to use `useDataContext()` directly
- [ ] Remove duplicate `useRoom` and `useTimers` hooks if redundant

## Acceptance Criteria
- [ ] ControllerPage renders without manual subscription code
- [ ] ControllerPage shows "Syncing" banner during mode transition
- [ ] ViewerPage renders using unified data context
- [ ] No localStorage snapshot saving in page components
- [ ] Both pages work in Cloud, Hybrid, and Local modes

## Notes
- Test all three modes after this change
- The "Syncing" banner should only appear briefly during transitions
- Viewer experience should be unchanged (instant data display)
