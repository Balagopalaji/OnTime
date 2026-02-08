## Date: 2026-02-08

### Scope/Pass label
bug-ctrl-selected-reset

### Summary
- Findings fixed: selected/active timer reconciliation now resolves invalid selected timer state to a valid active timer target, and invalid timer ID guard prevents controller timer targeting from using stale/non-existent IDs.
- Commit refs (optional): 07ad171, 8712e61

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/ControllerPage.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.test.ts`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/controller-timer-target.ts`
- `/Users/radhabalagopala/Dev/OnTime/docs/timer-logic.md`

### Risks / Regression potential
- Companion evidence is build-only for this pass; no companion runtime test coverage was executed in this verification set.
- No dedicated companion test script is currently available, so companion-side regression detection remains partially manual.

### Verification (commands + pass/fail)
- `re-sweep (full mode)`: PASS (GO WITH NOTES)
- `prd-contract-check`: PASS
- `smoke-checks-auto`: PASS WITH NOTES (report: `/Users/radhabalagopala/Dev/OnTime/docs/qa/bug-ctrl-selected-reset-auto-smoke.md`)
- `docs-sync-orchestrator`: UPDATE_REQUIRED resolved via `/Users/radhabalagopala/Dev/OnTime/docs/timer-logic.md`

### Follow-ups
- Bug IDs touched this pass: `bug-ctrl-selected-reset`
- Ledger updates needed: set `first_fixed_in=07ad171`; keep status `monitoring` due to companion test-script gap and smoke PASS WITH NOTES.
- Add companion executable test script coverage to reduce build-only evidence risk.

## Date: 2026-02-08

### Scope/Pass label
bug-offline-companion-room-bootstrap

### Summary
- Findings fixed: offline pre-ACK bootstrap deadlock, dashboard visibility for companion-origin local-owner rooms, and deterministic helper coverage additions.

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/DashboardPage.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.test.ts`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/CompanionConnectionContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/companion/src/main.ts`
- `/Users/radhabalagopala/Dev/OnTime/docs/local-mode.md`

### Risks / Regression potential
- No direct `DashboardPage` assertion exists in the current automated verification scope.
- No dedicated companion runtime test script is available; companion verification in this pass remains build-only evidence.

### Verification (commands + pass/fail)
- `re_sweep`: GO (Gate PASS)
- `prd-contract-check`: PASS WITH NOTES
- `smoke-checks-auto`: PASS WITH NOTES (report: `/Users/radhabalagopala/Dev/OnTime/docs/qa/bug-offline-companion-room-bootstrap-auto-smoke.md`)

### Follow-ups
- Bug IDs touched this pass: `bug-offline-companion-room-bootstrap`
- Ledger update pending commit SHA assignment for `first_fixed_in`; keep status `monitoring` until dashboard assertion coverage and companion runtime script coverage are added.

## Regression Ledger
| bug_id | first_fixed_in | regressed_in | root_cause_class | status |
|---|---|---|---|---|
| bug-ctrl-selected-reset | 07ad171 | none | scope drift | monitoring |
| bug-offline-companion-room-bootstrap | pending | none | reconnect/bootstrap guardrail gap | monitoring |
