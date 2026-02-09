# incident-companion-core-p0-auto-smoke

## Verdict

PASS

## Run Metadata

- Date/time: 2026-02-09 04:11:43 UTC
- Workspace: `/Users/radhabalagopala/Dev/OnTime`
- Frontend path: `/Users/radhabalagopala/Dev/OnTime/frontend`
- Commit hash (if available): `e5e95a9f6e1bc88f98befbff0ca68ea3d53cbf24`
- Pass label: `incident-companion-core-p0`
- Profile: `takeover-arbitration`

## Commands Executed

- `npm --prefix frontend run lint -- --max-warnings=0`
- `npm --prefix frontend run test`
- `npm --prefix frontend run test -- AppModeContext.test.tsx`
- `npm --prefix frontend run test -- UnifiedDataContext.test.ts`
- `npm --prefix frontend run test -- controller-permissions.test.ts`
- `npm --prefix frontend run test -- controller-join-intent.test.ts`
- `npm --prefix frontend run test -- arbitration.test.ts`
- `npm --prefix companion run build`
- `npm --prefix companion run test`

## Results Summary

- Lint status: PASS
- Full test suite status: PASS (`22` files, `187` tests)
- Targeted tests status: PASS (`AppModeContext`, `UnifiedDataContext`, `controller-permissions`, `controller-join-intent`, `arbitration`)
- Timer tuple invariants status: PASS (no failures in `UnifiedDataContext.test.ts` timer/control lifecycle coverage)
- `currentTime` unit sanity (ms) status: PASS (no unit/regression failures in unified arbitration/timer tests)
- Migration coverage (v1->v2) status: PASS (no migration-regression failures in full suite)
- Arbitration/mode coverage status: PASS (`AppModeContext.test.tsx`, `arbitration.test.ts`, `UnifiedDataContext.test.ts`)
- Takeover lock-flow/permissions/join-intent status: PASS (`controller-permissions.test.ts`, `controller-join-intent.test.ts`, companion lifecycle tests)

## Failures

- None.

## Missing Automated Checks

- None.

## Companion verification

- Commands attempted:
  - `npm --prefix companion run build`
  - `npm --prefix companion run test`
- `test` script exists in `companion/package.json`: Yes
- Fallback evidence used:
  - Not required (companion test script is present and executed).
- Residual risk note if companion runtime tests are not executable:
  - Not applicable.

## Residual Risks

- `UnifiedDataContext.test.ts` emitted expected Firestore offline transport warnings in sandboxed/network-restricted execution, but test assertions passed; monitor only if environment/network assumptions change.

## Recommended Next Action

- Proceed with scope sign-off; automated takeover-arbitration smoke gates are green.
