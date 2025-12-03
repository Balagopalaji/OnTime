# Delete/Undo Tasklist (Rooms + Timer Segments)

## Objectives
- Soft-delete UX: inline placeholder for ~10s, no confirm dialogs.
- Undo persists beyond 10s and across refresh (localStorage-backed stacks).
- Pending deletes stay hidden across refresh until undone; redo/overflow finalizes.
- Support for dashboard rooms (global stack) and controller timer segments (per-room stack).
- Stack cap (e.g., 10); overflow finalizes oldest pending delete.
- Clear undo stacks on logout/clear; consistent Firestore timestamp handling.

## Tasklist v1 (Initial Draft)
1) **Types & Utilities**
   - Add undo stack types (room delete snapshot, timer delete snapshot, timestamps).
   - Add localStorage helpers for stack load/save + cap/overflow handling.
   - Expose shared `now()` and Firestore timestamp normalization helper (re-use `toMillis`).

2) **DataContext API Surface**
   - Extend `DataContextValue` with: soft delete room/timer requests, undo/redo (global + per-room), pending delete lookups for UI, and stack hydration.
   - Wire through `DataProvider` to Firebase/Mock providers.

3) **FirebaseDataContext Implementation**
   - On room delete: snapshot room + timers, push to stack (expiresAt for 10s visual), hide room locally; finalize delete on redo or overflow (soft delete).
   - On timer delete: snapshot timer (and ordering/progress) per room, push to per-room stack, hide locally; finalize delete on redo or overflow (soft delete).
   - Undo: clear pending entry so room/timer reappears (no immediate Firestore restore needed in soft-delete mode).
   - Redo: finalize delete immediately; drop stack entry.
   - Hydration: on mount, load stacks, hide pending items, keep listeners; ensure no resurrection unless undone.
   - Cap handling: pushing beyond cap finalizes/drops oldest pending entry.

4) **MockDataContext Parity**
   - Mirror soft delete/undo/redo logic with in-memory state + persisted stacks.
   - Ensure ordering/progress restored and pending items hidden on refresh.

5) **Auth Logout Handling**
   - Clear undo stacks (rooms + per-room timers) on logout or when mock auth clears.

6) **Dashboard UI (DashboardPage.tsx)**
   - Filter out pending-deleted rooms from list; render placeholder card in slot with 10s visual timer and Undo button.
   - Add undo/redo controls + keyboard shortcuts (e.g., meta+z / meta+shift+z) tied to room stack.
   - Ensure refresh preserves hidden state unless undone.

7) **Controller Timer UI**
   - In timer list (RundownPanel/TimerPanel), hide pending-deleted timers; render inline placeholder row with 10s visual + Undo.
   - Add per-room undo/redo controls + shortcuts; ensure ordering is preserved on undo.

8) **Testing & QA**
   - Add unit tests for stack helpers (push/pop/overflow/persistence).
   - Add integration tests for mock provider soft delete/undo/redo (rooms and timers) including refresh hydration.
   - Manual checks: 10s visual timeout hides placeholder only; undo works after 10s and after refresh; redo finalizes.

## Self-Critique of v1
- Missing explicit redo stack model; need clear behavior (dual-stack vs LIFO) for UI/shortcuts.
- Room restore requires timers + state snapshot; not called out clearly (progress, activeTimerId, startedAt).
- Per-room timer stack persistence keys not defined; room vs timer stack keys should include userId for multi-user safety.
- Overflow policy unclear for already-finalized entries; need explicit finalize-on-evict.
- Countdown visuals are mentioned but not scoped (component/state responsibility).
- Testing lacks Firestore path coverage (ensuring deletes/restore write correct collections).

## Tasklist v2 (Refined After Critique)
1) **Stack Model & Persistence**
   - Choose dual-stack undo/redo semantics: `undoStack` (LIFO) + `redoStack`; delete push clears redoStack.
   - Persistence keys: `stagetime.undo.rooms.<uid>` and `stagetime.undo.timers.<uid>.<roomId>`.
   - Stack entry: `{ id, kind: 'room' | 'timer', roomId, payload, createdAt, expiresAt }`.
   - Cap at 10 per stack: overflow evicts oldest undoStack entry and finalizes if still pending.
   - Add helpers: load/save, pushWithCap(evictCallback), popUndo/pushRedo, clearAll(uid).

2) **Snapshot Fidelity**
   - Room delete payload: full room object + timers array + progress/state (activeTimerId, elapsedOffset, isRunning, startedAt, progress, showClock, message).
   - Timer delete payload: full timer object + its order + relevant progress value.
   - Always use `toMillis`/`now()` when persisting timestamps to avoid null/never.

3) **DataContext API**
   - New methods: `requestDeleteRoom(roomId)`, `requestDeleteTimer(roomId, timerId)`, `undoRoomDelete()`, `redoRoomDelete()`, `undoTimerDelete(roomId)`, `redoTimerDelete(roomId)`.
   - Expose `pendingDeletes: { rooms: Set<string>; timers: Record<string, Set<string>> }` and `placeholders: { rooms: Record<string, number>; timers: Record<string, Record<string, number>> }` for 10s UI countdowns.
   - Hydration method (internal) that runs on provider mount.

4) **FirebaseDataContext**
   - Hydrate stacks on mount using current user id; filter rooms/timers out of selectors if pending.
   - On delete request: push stack, hide locally, set 10s expiresAt; schedule finalize (deleteDoc) if still pending.
   - Undo: recreate room doc + timers (setDoc) restoring state/progress; undo timer restores doc + order/progress; clear pending sets.
   - Redo: finalize immediately (deleteDoc) and drop entry.
   - Overflow eviction triggers finalize for evicted pending entry.
   - Ensure listeners remain; selectors filter pending items so no resurrection after refresh.

5) **MockDataContext**
   - Mirror Firebase logic with in-memory operations; use same stack helpers and persistence keys.
   - Finalize = remove from state; undo = reinsert with preserved order/progress.

6) **AuthContext Cleanup**
   - On logout (or mock logout), clear persisted undo stacks for the user.

7) **Dashboard UI (DashboardPage.tsx)**
   - Integrate `pendingDeletes` to hide rooms; render placeholder card with countdown (from expiresAt) and Undo button.
   - Add Undo/Redo buttons and shortcuts (meta+z / meta+shift+z) calling room undo/redo API; disable when stacks empty.
   - Ensure placeholders auto-dismiss visually at 10s but remain undoable via buttons/shortcuts.

8) **Controller Timer UI**
   - In timer list, hide pending timers; insert placeholder row with countdown + Undo.
   - Add per-room undo/redo controls + shortcuts wired to timer stack; preserve order on undo.

9) **Testing & QA**
   - Unit tests for stack helper (push cap/evict finalize, undo/redo flows, persistence load/save).
   - Mock provider integration tests: delete -> placeholder hidden; undo after 10s; refresh retains hidden; redo finalizes.
   - Manual Firestore path checks (room/timer deletes and restores) and keyboard shortcut behavior.

10) **Documentation**
    - Update README or docs with brief behavior summary and env expectations (no confirm dialogs, 10s visual, undo persistent).

## Tasklist v3 – Extend Undo/Redo to Creations
1) **Types & Helpers**
   - Extend undo entry model to include `action: 'create' | 'delete'` for rooms and timers (update `src/context/undoTypes.ts`, `src/lib/undoStack.ts`).
2) **Providers (Firebase + Mock)**
   - On createRoom/createTimer, push a `create` entry (cap 10, clear redo). Undo create hides/removes the new item; redo create restores it. Overflow eviction finalizes removal. Keep existing soft-delete behavior unchanged.
3) **UI**
   - No new placeholders for create; reuse existing undo/redo buttons and shortcuts in `DashboardPage.tsx`, `ControllerPage.tsx`, and `components/controller/RundownPanel.tsx` to operate on the unified stacks.
4) **Docs/Tests**
   - Note that undo/redo now covers both creates and deletes; deletes finalize on redo/overflow; creates remove on undo and re-add on redo. Add/update helper/provider tests if present.

## Tasklist v3.1 – Undo/Redo for Edits
1) **Actions**: Add `action: 'update'` entries with before/patch payloads for room meta (title/timezone) and timers (title/duration/speaker/type/order).
2) **Providers**: Push update entries on `updateRoomMeta`/`updateTimer`; undo applies `before`, redo reapplies `patch`; placeholders remain delete-only.
3) **UI**: No new UI required; existing undo/redo controls act on the unified stack (Controller now has room undo/redo buttons; Dashboard already has them).
4) **Tests/Docs**: Note edit support; add helper/provider tests if available. Note Firestore rules must allow owner updates for undo/redo writes.
