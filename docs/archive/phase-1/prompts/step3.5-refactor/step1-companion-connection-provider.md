> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 1: Extract CompanionConnectionProvider

## Context
We are refactoring Phase 1D Step 3.5 to implement a Unified Data Provider Architecture. The current implementation swaps providers entirely when switching modes, causing timers to "disappear". The fix requires running Firebase and Companion connections in parallel.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`

## Goal
Extract socket connection/handshake logic from `CompanionDataContext.tsx` into a new `CompanionConnectionProvider` that **only** manages the WebSocket connection - no room data subscription.

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 1-100)
frontend/src/context/CompanionDataContext.tsx (lines 1-250, 397-528)
```

## Task Description

Create a new file `frontend/src/context/CompanionConnectionContext.tsx` that:

1. **Manages socket.io connection** to `ws://localhost:4000`
2. **Handles token fetching** from `http://localhost:4001/api/token`
3. **Tracks connection/handshake status** but does NOT subscribe to any room
4. **Exposes context** for other providers to consume

### Context Shape
```typescript
type CompanionConnectionContextValue = {
  socket: Socket | null
  isConnected: boolean
  handshakeStatus: 'idle' | 'pending' | 'ack' | 'error'
  companionMode: string  // 'minimal', 'showcontrol', etc.
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

### What to Extract from CompanionDataContext.tsx
- Socket creation (`io('http://localhost:4000', ...)`) - lines 407-411
- `connect`, `disconnect`, `connect_error` handlers - lines 473-528
- Token storage constants (`TOKEN_KEY`) - line 85
- `clearStoredToken` function - lines 232-243
- `companionMode`, `capabilities` state - lines 218-223
- `handshakeStatus` state - line 224

### What NOT to Include
- Room subscription logic (`subscribeToRoom`, `JOIN_ROOM`)
- Timer CRUD operations
- Firestore write-through
- Queue management
- `ROOM_STATE_SNAPSHOT`, `ROOM_STATE_DELTA` handlers

## Execution Checklist
- [ ] Create `CompanionConnectionContext.tsx` with socket connection logic
- [ ] Create `CompanionConnectionProvider` component
- [ ] Create `useCompanionConnection` hook
- [ ] Socket connects on mount, disconnects on unmount
- [ ] `fetchToken()` fetches from `http://localhost:4001/api/token`
- [ ] Token stored in localStorage and sessionStorage
- [ ] Connection status updates on socket events
- [ ] No room-specific logic in this provider

## Acceptance Criteria
- [ ] Socket connects to `ws://localhost:4000` when provider mounts
- [ ] `isConnected` reflects actual socket state
- [ ] `fetchToken()` returns token or null
- [ ] Provider can be used without any room context
- [ ] Existing `CompanionDataContext` still works (we'll refactor it in Step 4)

## Notes
- This provider will be the **outermost** provider in the final architecture
- Other providers will consume `useCompanionConnection()` to access the socket
- Do NOT modify `CompanionDataContext.tsx` in this step (that's Step 4)
