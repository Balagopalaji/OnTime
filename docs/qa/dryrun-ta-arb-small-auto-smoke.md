# dryrun-ta-arb-small-auto-smoke

## Verdict

PASS

Gate recommendation: PASS

## Run Metadata

- Date/time: 2026-02-08T11:29:30Z
- Workspace: `/Users/radhabalagopala/Dev/OnTime`
- Frontend path: `/Users/radhabalagopala/Dev/OnTime/frontend`
- Commit hash (if available): `5795f86`
- Pass label: `dryrun-ta-arb-small`
- Profile: `takeover-arbitration`

## Commands Executed

- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run lint`
- `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test`
- Profile-specific targeted tests (`takeover-arbitration`):
  - `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- AppModeContext.test.tsx`
  - `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- UnifiedDataContext.test.ts`
  - `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-permissions.test.ts`
  - `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- controller-join-intent.test.ts`
  - `cd /Users/radhabalagopala/Dev/OnTime/frontend && npm run test -- arbitration.test.ts`
- Companion verification:
  - `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run build`
  - `cd /Users/radhabalagopala/Dev/OnTime/companion && cat package.json`

## Results Summary

- Lint status: PASS (`eslint .` exited 0).
- Full test suite status: PASS (`21/21` files, `166/166` tests passed).
- Targeted tests status: PASS
  - `AppModeContext.test.tsx`: `7/7` passed
  - `UnifiedDataContext.test.ts`: `30/30` passed
  - `controller-permissions.test.ts`: `8/8` passed
  - `controller-join-intent.test.ts`: `6/6` passed
  - `arbitration.test.ts`: `10/10` passed
- Timer tuple invariants status: PASS (full suite including context/timer tests passed; no tuple invariant failures surfaced).
- `currentTime` unit sanity (ms) status: PASS (no unit/assertion failures in full suite).
- Migration coverage (v1->v2) status: PASS WITH NO FAILURES OBSERVED IN AUTOMATED SUITE (no migration-related failures in executed suites).
- Arbitration/mode coverage status: PASS (`AppModeContext`, `UnifiedDataContext`, `arbitration` tests passed).
- Takeover lock-flow/permissions/join-intent status: PASS (`controller-permissions` and `controller-join-intent` tests passed).

## Failures

- None.

## Missing Automated Checks

- None in requested command set.

## Companion verification

- Commands attempted:
  - `cd /Users/radhabalagopala/Dev/OnTime/companion && npm run build`
  - `cd /Users/radhabalagopala/Dev/OnTime/companion && cat package.json`
- `test` script exists in `companion/package.json`: No.
- Fallback evidence used:
  - No companion test script exists in companion/package.json
  - Exact targeted evidence command/output used (or explicit note that only build evidence is available): `cat package.json` showed scripts `dev`, `build`, `build:viewer`, `dist`, `dist:dev`, `fetch-ffprobe`, `lint` and no `test`; companion `npm run build` exited 0.
- Residual risk note if companion runtime tests are not executable:
  - Companion runtime behavior is only covered by build evidence in this pass because no companion automated test script exists.

## Residual Risks

- Companion runtime regressions may not be detected by TypeScript build-only verification.

## Recommended Next Action

- Proceed with sign-off scope for takeover-arbitration automated gates.
- Add companion automated runtime tests (`npm run test`) in a future pass to reduce residual risk.
