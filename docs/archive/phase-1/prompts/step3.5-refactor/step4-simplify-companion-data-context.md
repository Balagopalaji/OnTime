# Step 4: Simplify CompanionDataContext

## Context
We have created `CompanionConnectionProvider` (Step 1) and `UnifiedDataResolver` (Steps 3A/3B). The original `CompanionDataContext.tsx` now has redundant code that can be removed.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1, 2, 3A, and 3B must be complete

## Goal
Remove redundant logic from `CompanionDataContext.tsx` that is now handled by other providers. This file may be deleted entirely or kept as a thin utility.

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 280-330)
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/CompanionConnectionContext.tsx
frontend/src/context/UnifiedDataContext.tsx
```

## What to Remove

### 1. Socket Creation (Now in CompanionConnectionProvider)
- Lines 407-411: `const socket = io('http://localhost:4000', ...)`
- Lines 473-528: `connect`, `disconnect`, `connect_error` handlers

### 2. LocalStorage Snapshot Logic (No longer needed)
- Lines 555-633: `hydrateFromStorage`, `cloudRoomSnapshot` reading
- `justSwitchedFromCloud` session flag checks

### 3. Race Condition Workarounds (No longer needed)
- Line 679-688: `ignoringSnapshotForRoomRef` logic
- `queueMicrotask` timing hacks in HANDSHAKE_ACK handler

### 4. Pending Cloud Sync (Moved to UnifiedDataResolver)
- `pendingCloudSyncRef` and related logic

### 5. Token Storage (Now in CompanionConnectionProvider)
- Line 85: `TOKEN_KEY` constant
- Lines 232-243: `clearStoredToken` function
- Token fetching logic

## What to Keep (If File Is Preserved)

If keeping the file as a utility:
- Firestore write-through helper functions
- Queue management for offline operations
- Any Companion-specific helpers not moved elsewhere

## Decision: Keep or Delete?

**Option A: Delete Entirely**
If all functionality is now in `CompanionConnectionProvider` + `UnifiedDataResolver`, delete this file.

**Option B: Keep as Utility**
If there are Companion-specific helpers that don't fit elsewhere, keep a slimmed-down version.

**Recommendation:** Start with Option A (delete). If something is missing, it will surface in testing.

## Execution Checklist
- [ ] Identify all code that moved to `CompanionConnectionProvider`
- [ ] Identify all code that moved to `UnifiedDataResolver`
- [ ] Remove or comment out redundant code
- [ ] Verify no orphaned imports
- [ ] If keeping file: ensure it exports only necessary utilities
- [ ] If deleting file: update all imports that reference it

## Acceptance Criteria
- [ ] No duplicate socket creation code
- [ ] No localStorage snapshot reading for SYNC
- [ ] No `ignoringSnapshotForRoomRef` workaround
- [ ] File either deleted or significantly smaller (< 200 lines)
- [ ] No breaking changes to existing functionality

## Notes
- This is a cleanup step - be conservative
- Run the app after changes to verify nothing broke
- Git history preserves the old code if needed
