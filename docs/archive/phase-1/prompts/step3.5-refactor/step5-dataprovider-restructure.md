> ⚠️ Deprecated
> Historical Phase 1 prompt. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Step 5: Restructure DataProvider

## Context
All new providers are ready. Now we update `DataProvider.tsx` to implement the nested provider structure instead of conditional swapping.

**Reference:** `docs/phase-1d-step3.5-refactor-plan.md`
**Prerequisites:** Steps 1, 2, 3A, 3B, and 4 must be complete

## Goal
Replace the conditional provider-swapping with the nested dual-connection architecture.

## Files to Include in Repo Prompt
```
docs/phase-1d-step3.5-refactor-plan.md (lines 330-370)
frontend/src/context/DataProvider.tsx
frontend/src/context/CompanionConnectionContext.tsx
frontend/src/context/AppModeContext.tsx
frontend/src/context/FirebaseDataContext.tsx
frontend/src/context/UnifiedDataContext.tsx
```

## Current Structure (Problematic)
```tsx
// DataProvider.tsx
export function useDataContext() {
  const { effectiveMode } = useAppMode()
  if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
    return <CompanionDataProvider>{children}</CompanionDataProvider>
  }
  return <FirebaseDataProvider>{children}</FirebaseDataProvider>
}
```

## Target Structure
```tsx
// DataProvider.tsx
export const DataProvider = ({ children }: { children: ReactNode }) => {
  // Mock mode escape hatch
  const shouldUseMock = useShouldUseMock()
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

// Re-export the unified hook as useDataContext for compatibility
export { useUnifiedData as useDataContext } from './UnifiedDataContext'
```

## Provider Nesting Order (Important!)

```
CompanionConnectionProvider  ← Outermost (maintains socket)
  └── AppModeProvider        ← Uses socket state for auto mode
      └── FirebaseDataProvider  ← Always active
          └── UnifiedDataResolver  ← The "brain"
              └── App Components
```

**Why this order:**
1. `CompanionConnectionProvider` at top: Socket connects early, no delay on mode switch
2. `AppModeProvider` inside connection: Can use socket state instead of HTTP polling
3. `FirebaseDataProvider` always active: Provides backup data even in Local mode
4. `UnifiedDataResolver` innermost: Has access to both Firebase and Companion data

## Execution Checklist
- [ ] Import all new providers
- [ ] Remove conditional provider-swapping logic
- [ ] Implement nested provider structure
- [ ] Re-export `useDataContext` from UnifiedDataContext
- [ ] Keep mock mode escape hatch
- [ ] Verify TypeScript types are compatible

## Acceptance Criteria
- [ ] All four providers render in correct order
- [ ] `useDataContext()` returns unified data
- [ ] Mode changes don't cause provider unmounting
- [ ] Mock mode still works
- [ ] App renders without errors

## Notes
- This is the critical integration step
- Test thoroughly after this change
- If something breaks, check provider order first
