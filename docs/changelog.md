## Date: 2026-02-09

### Scope/Pass label
reconnect-fallback-contract-clarification

### Summary
- Clarified the reconnect room rejoin contract in `docs/local-mode.md` to explicitly define two scenarios: cold-start reconnect with no active intents and normal reconnect with active intent(s).
- No runtime behavior change; documentation now matches implemented `includeAllWhenNoIntents` reconnect fallback behavior.

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/docs/local-mode.md`
- `/Users/radhabalagopala/Dev/OnTime/docs/changelog.md`

### Risks / Regression potential
- Docs-only clarification; no code-path or runtime logic modifications.

### Verification (commands + pass/fail)
- `code/doc contract spot-check (UnifiedDataContext reconnect path at line 3984)`: PASS

### Follow-ups
- None.

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
- Commit refs (optional): f48a470, d090ba1

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/DashboardPage.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.test.ts`
- `/Users/radhabalagopala/Dev/OnTime/docs/local-mode.md`
- `/Users/radhabalagopala/Dev/OnTime/docs/changelog.md`

### Risks / Regression potential
- No direct `DashboardPage` assertion exists in the current automated verification scope.
- No dedicated companion runtime test script is available; companion verification in this pass remains build-only evidence.

### Verification (commands + pass/fail)
- `re-sweep`: GO (Gate PASS)
- `prd-contract-check`: PASS WITH NOTES
- `smoke-checks-auto`: PASS WITH NOTES (report: `/Users/radhabalagopala/Dev/OnTime/docs/qa/bug-offline-companion-room-bootstrap-auto-smoke.md`)

### Follow-ups
- Bug IDs touched this pass: `bug-offline-companion-room-bootstrap`
- Ledger updates needed: set `first_fixed_in=f48a470`; keep status `monitoring` until dashboard assertion coverage and companion runtime script coverage are added.

## Date: 2026-02-09

### Scope/Pass label
ack-latency-recovery

### Summary
- Findings fixed: added join replay watchdog recovery to clear stalled in-flight joins, requeue to tail deterministically, and resume queue processing under ACK latency.
- Commit refs (optional): none

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.test.ts`

### Risks / Regression potential
- Watchdog behavior is validated in unit/integration tests but not yet exercised in full LAN runtime soak conditions.
- Companion reconnect behavior remains sensitive to real network turbulence beyond automated suite coverage.

### Verification (commands + pass/fail)
- `prd-contract-check (ack-latency-recovery scope)`: PASS WITH NOTES
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run lint -- --max-warnings=0`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- AppModeContext.test.tsx`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- UnifiedDataContext.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-permissions.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-join-intent.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- arbitration.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run build`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run test`: PASS
- `smoke-checks-auto report`: PASS (`/Users/radhabalagopala/Dev/OnTime/docs/qa/ack-latency-recovery-auto-smoke.md`)

### Follow-ups
- Bug IDs touched this pass: `ack-lat-002`
- Ledger updates needed: set `first_fixed_in=pending`; status `monitoring` until commit SHA is assigned and LAN/runtime soak verification is captured.
- Add targeted reconnect soak evidence for repeated delayed `HANDSHAKE_ACK` under packet loss.

## Date: 2026-02-09

### Scope/Pass label
secure-reauth-force-takeover-remediation

### Summary
- Findings fixed: aligned cloud force-takeover reauth contract to canonical `reauthenticated`, preserved temporary backward-compat alias `reauthRequired`, and updated docs to clarify server-side `auth_time` verification plus local/cloud auth-path parity.
- Commit refs (optional): none

### Files touched
- `/Users/radhabalagopala/Dev/OnTime/functions/src/lock.ts`
- `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- `/Users/radhabalagopala/Dev/OnTime/docs/interface.md`
- `/Users/radhabalagopala/Dev/OnTime/docs/local-mode.md`
- `/Users/radhabalagopala/Dev/OnTime/functions/lib/lock.js`
- `/Users/radhabalagopala/Dev/OnTime/docs/qa/secure-reauth-force-takeover-remediation-auto-smoke.md`

### Risks / Regression potential
- Backward-compat alias support (`reauthRequired`) is temporary and must be removed only after all callers migrate to canonical `reauthenticated`.
- Full suite remains green, but sandbox Firestore connectivity warnings still appear in test stderr and should continue to be monitored.

### Verification (commands + pass/fail)
- `prd-contract-check (secure-reauth-force-takeover-remediation scope)`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/functions && npm run build`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run lint -- --max-warnings=0`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- AppModeContext.test.tsx`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- UnifiedDataContext.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-permissions.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-join-intent.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- arbitration.test.ts`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run build`: PASS
- `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run test`: PASS
- `smoke-checks-auto report`: PASS (`/Users/radhabalagopala/Dev/OnTime/docs/qa/secure-reauth-force-takeover-remediation-auto-smoke.md`)

### Follow-ups
- Bug IDs touched this pass: `secure-reauth-force-takeover-remediation`
- Ledger updates needed: set `first_fixed_in=pending`; status `monitoring` until legacy alias removal is completed in a future cleanup pass.
- Plan alias-removal pass after confirming no remaining callers depend on `reauthRequired`.

## Regression Ledger
| bug_id | first_fixed_in | regressed_in | root_cause_class | status |
|---|---|---|---|---|
| bug-ctrl-selected-reset | 07ad171 | none | scope drift | monitoring |
| bug-offline-companion-room-bootstrap | f48a470 | none | reconnect/bootstrap guardrail gap | monitoring |
| ack-lat-002 | pending | none | state race | monitoring |
| secure-reauth-force-takeover-remediation | pending | none | contract drift | monitoring |
