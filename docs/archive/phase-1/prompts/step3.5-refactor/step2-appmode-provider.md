---
IMPLEMENTATION COMPLETE - DEPRECATED
This document describes Phase 1 implementation steps which are now complete.
Current architecture: See `docs/local-mode-plan.md` (parallel sync)
Last accurate: December 2024 (Phase 1D Step 3.5 completion)
Use case: Historical reference only; do NOT use for new development.
---

> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 2: Modify AppModeProvider

## Context
We are refactoring Phase 1D Step 3.5. In Step 1, we created `CompanionConnectionProvider`. Now we modify `AppModeProvider` to use real socket state instead of HTTP polling.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisite:** Step 1 (CompanionConnectionProvider) must be complete

## Goal
Remove HTTP polling (`probeCompanion()`) and use the socket connection state from `CompanionConnectionProvider` for mode resolution.

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 100-150)
frontend/src/context/AppModeContext.tsx
frontend/src/context/CompanionConnectionContext.tsx
```

## Task Description

Modify `frontend/src/context/AppModeContext.tsx` to:

1. **Remove** the `probeCompanion()` HTTP polling function (lines 30-45)
2. **Remove** the polling interval (line 111)
3. **Consume** `isConnected` from `CompanionConnectionProvider`
4. **Update** `effectiveMode` resolution to use socket state directly

### Before
```typescript
const probeCompanion = async (timeoutMs = 600): Promise<boolean> => {
  // HTTP fetch to localhost:4001/api/token
}

useEffect(() => {
  const resolve = async () => {
    const companionReachable = await probeCompanion()
    // ...
  }
  const interval = window.setInterval(resolve, 3000)
  // ...
}, [])
```

### After
```typescript
import { useCompanionConnection } from './CompanionConnectionContext'

// Inside AppModeProvider:
const { isConnected } = useCompanionConnection()

useEffect(() => {
  if (isDegraded) return
  if (mode !== 'auto') {
    setEffectiveMode(mode)
    return
  }

  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
  const next: EffectiveAppMode = isConnected
    ? (isOnline ? 'hybrid' : 'local')
    : 'cloud'
  setEffectiveMode(next)
}, [isConnected, isDegraded, mode])
```

## Execution Checklist
- [ ] Import `useCompanionConnection` from `CompanionConnectionContext`
- [ ] Remove `probeCompanion()` function
- [ ] Remove polling interval
- [ ] Use `isConnected` for mode resolution
- [ ] Keep `online`/`offline` event listeners for internet status
- [ ] Keep `triggerCompanionFallback` and `isDegraded` logic

## Acceptance Criteria
- [ ] No HTTP polling to `localhost:4001/api/token`
- [ ] Mode changes instantly when socket connects/disconnects
- [ ] `effectiveMode` resolves correctly: `auto` → `cloud`/`hybrid`/`local`
- [ ] Fallback to Cloud still works when `isDegraded` is true
- [ ] Internet online/offline detection still works

## Notes
- `AppModeProvider` must be rendered **inside** `CompanionConnectionProvider` for this to work
- The final provider nesting order is handled in Step 5
- For now, you may need to temporarily wrap the app differently for testing
