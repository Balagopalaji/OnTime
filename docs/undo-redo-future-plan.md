# Undo/Redo System - Future Implementation Plan

## Current State (December 2025)

**Status:** Stubbed out (disabled)

Undo/redo was temporarily disabled to unblock builds. The app compiles and runs, but undo/redo buttons do nothing.

### What Was Done
- **Stubbed methods** in `FirebaseDataContext.tsx` and `MockDataContext.tsx`
- Created minimal `undoStack.ts` with helper functions (no real undo logic)
- App builds (`npm run build ✅`) and lints (`npm run lint ✅`)

### Key Files
- `frontend/src/context/FirebaseDataContext.tsx` - Undo/redo now logs no-ops
- `frontend/src/context/MockDataContext.tsx` - Adjusted typings, references stack helpers
- `frontend/src/lib/undoStack.ts` - Minimal placeholder with `toMillis` and push/pop helpers

### Current Behavior
- Undo/redo shortcuts/buttons call stubs
- No state changes occur
- No errors or crashes

### Important Notes
- **`undoStack.ts` is a minimal placeholder**: Removing it before the new system is in place will break imports. Keep it until the command-pattern replacement is complete.
- **Public API to preserve**: The following methods should remain available with the same signatures to avoid breaking UI components:
  - `undoLatest()` - Undo the most recent action
  - `redoLatest()` - Redo the most recently undone action
  - `undoRoomDelete(roomId)` - Restore a deleted room
  - `canUndo` (boolean) - Whether undo is available
  - `canRedo` (boolean) - Whether redo is available

---

## Why This Was Acceptable

- **No production users** - Safe to disable temporarily
- **Unblocked development** - Critical builds were failing
- **Phase 1A priority** - Companion App implementation is more urgent

---

## When to Tackle This

**Timeline:** After Phase 1A/1B/1C (Companion App foundation), **before production launch**.

**Why wait?**
- Phase 1A-1C is the critical path (offline mode, show control foundation)
- Undo/redo is a "nice to have" feature, not a blocker
- Implementing it properly (Command Pattern) takes time; better to do it right later than rush it now

**Trigger to implement:** When preparing for beta testing or first real users.

---

## Future Implementation Plan

### Design: Command Pattern

Replace inline undo stack logic with a proper command-based system.

#### 1. Command Interface
```typescript
interface Command {
  type: string;           // 'CREATE_TIMER', 'UPDATE_ROOM', etc.
  id: string;            // Unique command ID
  label: string;         // "Create Timer 'Sermon'"
  
  execute(): Promise<void>;
  undo(): Promise<void>;
  
  // Optional: Optimistic UI
  applyOptimistic?(): void;
  rollbackOptimistic?(): void;
}
```

#### 2. Per-Action Commands
Create specific command classes:
- `CreateTimerCommand`
- `UpdateTimerCommand`
- `DeleteTimerCommand`
- `ReorderTimersCommand`
- `UpdateMessageCommand`
- `DeleteRoomCommand` (special handling)

#### 3. useUndoRedo Hook
```typescript
function useUndoRedo(roomId: string) {
  // Per-room undo stacks (isolated)
  const [past, setPast] = useState<Command[]>([]);
  const [future, setFuture] = useState<Command[]>([]);
  
  // Persist to localStorage per room/user
  // localStorage key: `undo:${userId}:${roomId}`
  
  const executeCommand = async (cmd: Command) => {
    await cmd.execute();
    setPast([...past, cmd]);
    setFuture([]); // Clear redo stack
  };
  
  const undoLatest = async () => {
    const cmd = past[past.length - 1];
    await cmd.undo();
    setPast(past.slice(0, -1));
    setFuture([cmd, ...future]);
  };
  
  const redoLatest = async () => { /* ... */ };
}
```

#### 4. Integration Points
- **Data Providers:** Inject commands instead of direct Firestore/Mock calls
- **UI Components:** Call `executeCommand(new CreateTimerCommand(...))` instead of `createTimer(...)`
- **Public API:** Keep existing method names (`undoLatest`, `redoLatest`, `undoRoomDelete`) for UI continuity

#### 5. Persistence Strategy
- **Storage:** `localStorage` (per-room, per-user)
- **Key format:** `undo:{userId}:{roomId}`
- **Debounce:** Write to localStorage every 2 seconds (avoid excessive writes)
- **Serialization:** Store command metadata (type, timestamp, args), not entire objects

---

## Implementation Checklist (Future Phase)

### Step 1: Core Command System
- [ ] Define `Command` interface in `frontend/src/lib/commands/types.ts`
- [ ] Create base `AbstractCommand` class with common logic
- [ ] Implement `useUndoRedo` hook with per-room stacks

### Step 2: Per-Action Commands
- [ ] `CreateTimerCommand` (includes optimistic UI)
- [ ] `UpdateTimerCommand`
- [ ] `DeleteTimerCommand`
- [ ] `ReorderTimersCommand`
- [ ] `UpdateMessageCommand`
- [ ] `CreateRoomCommand`
- [ ] `UpdateRoomCommand`
- [ ] `DeleteRoomCommand` (special handling with confirmation)

### Step 3: Data Provider Integration
- [ ] Update `FirebaseDataContext` to use commands
- [ ] Update `MockDataContext` to use commands
- [ ] Remove stubbed undo logic
- [ ] Add `executeCommand` method to provider interface

### Step 4: Persistence & Optimization
- [ ] Implement localStorage persistence
- [ ] Add debouncing for writes
- [ ] Handle localStorage quota errors gracefully
- [ ] Add command serialization/deserialization

### Step 5: Testing
- [ ] Unit tests for each command (execute/undo)
- [ ] Integration tests for command sequences
- [ ] Test per-room isolation (no cross-room side effects)
- [ ] Test localStorage persistence across sessions

---

## Design Decisions

### Per-Room Isolation
**Why:** Prevents accidental undo of actions in other rooms when switching contexts.

**Implementation:** Each room has independent `past` and `future` stacks.

### Optimistic UI (Optional)
**Why:** Provides instant feedback while Firestore writes complete.

**Implementation:** 
- `applyOptimistic()` updates local state immediately
- `execute()` writes to Firestore
- `rollbackOptimistic()` reverts if Firestore write fails

### Command Metadata Only
**Why:** Storing full objects in localStorage can hit quota limits and cause stale data issues.

**Implementation:** Serialize minimal command metadata (type, args, timestamp), reconstruct commands on load.

---

## Notes for Future Agents

- **No production users:** Undo/redo is not a blocker for Phase 1A (Companion App)
- **Docs unchanged:** This detour didn't affect architecture docs
- **Clean slate:** When implementing, you can ignore the current stub logic entirely
- **Test thoroughly:** Per-room isolation is critical to avoid user confusion

---

## Cross-References

- Current stubs: `frontend/src/context/FirebaseDataContext.tsx`
- Minimal helpers: `frontend/src/lib/undoStack.ts`
- Related: Phase 1A doesn't depend on undo/redo

---

**Last Updated:** December 11, 2025  
**Status:** Planned, not yet implemented  
**Priority:** Low (after Phase 1A Companion App)
