> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 7: Testing & Validation

## Context
All code changes are complete. This step validates the refactor works correctly across all scenarios.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1-6 must be complete

## Goal
Verify the Unified Data Provider architecture works correctly in all mode combinations and edge cases.

## Test Scenarios

### 1. Basic Mode Switching
- [ ] Start in Cloud mode, switch to Local while timer paused → timer state preserved
- [ ] Start in Cloud mode, switch to Hybrid while timer paused → timer state preserved
- [ ] Start in Local mode, switch to Cloud → timer state preserved
- [ ] Start in Hybrid mode, switch to Cloud → timer state preserved

### 2. Running Timer Continuity
- [ ] Start timer in Cloud, switch to Local → timer continues without jump
- [ ] Start timer in Local, switch to Cloud → timer continues without jump
- [ ] Start timer in Hybrid, disconnect internet → timer continues in Local

### 3. Multi-Tab Scenarios
- [ ] Open Room A in Tab 1 (Local mode)
- [ ] Open Room B in Tab 2 (Cloud mode)
- [ ] Verify both rooms work independently
- [ ] Switch Tab 1 to Cloud → Room A works, Tab 2 unaffected

### 4. Companion Disconnect/Reconnect
- [ ] Running timer in Local mode
- [ ] Kill Companion process
- [ ] Verify fallback to Cloud within 5 seconds
- [ ] Restart Companion
- [ ] Verify auto-reconnect and mode restoration

### 5. Network Disconnect/Reconnect
- [ ] Running timer in Hybrid mode
- [ ] Disconnect network
- [ ] Verify continues via Companion (Local mode)
- [ ] Reconnect network
- [ ] Verify syncs to Firestore and mode restores to Hybrid

### 6. Viewer Experience
- [ ] Open Viewer in separate browser
- [ ] Controller in Local mode, Viewer sees updates
- [ ] Switch Controller to Cloud, Viewer continues working
- [ ] No "Syncing" banner on Viewer

### 7. Edge Cases
- [ ] Rapid mode switching (Cloud → Local → Cloud → Local quickly)
- [ ] Mode switch with no active timer
- [ ] Mode switch with multiple timers in rundown
- [ ] Start timer immediately after mode switch

## Manual QA Checklist

### Pre-Test Setup
1. Start Companion app locally
2. Open app in browser (http://localhost:5173)
3. Create a test room with 3+ timers
4. Open DevTools Console to watch logs

### Test Execution
```
[ ] 1. Cloud → Local (timer paused)
    Expected: No visible change, timer remains paused at same position
    Check console for: "[unified] switchToCompanion", "SYNC_ROOM_STATE"

[ ] 2. Cloud → Local (timer running)
    Expected: Timer continues smoothly, no time jump
    Check console for: SYNC_ROOM_STATE with correct currentTime

[ ] 3. Local → Cloud (timer running)
    Expected: Timer continues, "Syncing to Cloud" banner briefly appears
    Check console for: Firestore write confirmation

[ ] 4. Kill Companion while in Local
    Expected: Falls back to Cloud within 5s, "Degraded" banner appears
    Check console for: "[unified] Companion disconnected, falling back"

[ ] 5. Viewer in separate tab
    Expected: Receives updates from both Cloud and Companion seamlessly
    Check: No "Syncing" banner on Viewer

[ ] 6. Rapid mode toggle (5x in 10 seconds)
    Expected: No crashes, final mode is correct
    Check console for: No unhandled promise rejections
```

## Automated Test Suggestions

### Unit Tests (Jest/Vitest)
```typescript
describe('UnifiedDataResolver', () => {
  it('defaults to cloud authority', () => {})
  it('translates Companion state to Firebase format', () => {})
  it('handles SYNC_ROOM_STATE timeout gracefully', () => {})
  it('uses correct staleness thresholds', () => {})
})

describe('translateCompanionState', () => {
  it('calculates startedAt correctly for running timer', () => {})
  it('sets startedAt to null for paused timer', () => {})
})
```

### Integration Tests (Playwright/Cypress)
```typescript
describe('Mode Switching', () => {
  it('preserves timer state when switching Cloud to Local', () => {})
  it('shows Syncing banner during transition', () => {})
  it('recovers from Companion disconnect', () => {})
})
```

## Acceptance Criteria (Final)

### Functional
- [ ] Switching Cloud ↔ Hybrid/Local never visually "drops" timers
- [ ] Running timers continue at correct elapsed time during switch
- [ ] Multi-tab workflows work correctly
- [ ] Companion disconnect triggers fallback within 5 seconds
- [ ] Viewers work without "Syncing" state

### Performance
- [ ] Mode switch completes in < 500ms
- [ ] No noticeable lag when switching
- [ ] Memory usage stable (no leaks from provider re-creation)

### Error Handling
- [ ] SYNC_ROOM_STATE timeout handled gracefully
- [ ] Network errors don't crash the app
- [ ] Invalid Companion responses handled

## Rollback Criteria

If any of these occur, consider rollback:
- Timers disappear during mode switch (regression)
- Running timer jumps by > 2 seconds during switch
- App crashes on mode change
- Companion connection can't be established

## Notes
- Document any issues found in a GitHub issue
- If rollback needed, use git to restore `DataProvider.tsx` and related files
- The previous implementation is preserved in git history
