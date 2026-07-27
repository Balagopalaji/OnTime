---
issue: ISSUE-001
branch: backlog/ISSUE-001-standalone-ppt-timer
worktree: /private/tmp/ontime-issue001-ppt-timer
base_branch: main
base_sha: 5d70067722c3bb9a5992a4471f607c926b2c9094
phase: H5 standalone app — Electron shell + integration complete (H5-7 done)
current_task: H5-8 closeout (automated gates green; Windows user-testing + spec-conformance recorded-pending)
review_cycles: 1
stable_findings: []
worktree_preflight: dirty (H5-PRE..H5-7 uncommitted work-in-progress) at base 5d70067; resumed after GLM 429 quota interruption, then completed the Electron shell/integration in a fresh session; re-verified via typecheck/test/build before and after (see Validation log)
---

# ISSUE-001 H5 Loop — First runnable standalone PowerPoint Video Timer app

## Metadata

- Spec: `docs/spec/standalone-powerpoint-video-timer.spec.md`
- Deep Plan: `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md` (Stage 5)
- H1–H4 are complete on this branch (`packages/ppt-bridge`, `packages/presentation-core`, Companion adoption, before-quit shutdown gate). H5 builds the standalone Electron app at `apps/ppt-timer` that consumes those packages directly.
- Consumed APIs (do NOT modify except the approved H5-PRE affinity emission): `@ontime/ppt-bridge` (`createPptBridgeClient`, `PowerPointSession`, `PptBridgeClient`, `BridgePollOutcome` types, `BridgeDiagnosticSink`); `@ontime/presentation-core` (`projectPowerPointView`, `PowerPointViewState`, machine/source-state types).
- Boundary: `apps/ppt-timer` may import only `@ontime/ppt-bridge` + `@ontime/presentation-core`. Forbidden: firebase, cloud-adapter, local-sync, companion, frontend, functions, Socket.IO, interface-contracts, general timer-core code. Hardened dependency rule `ppt-timer-standalone` in `.dependency-cruiser.cjs`; static check in `scripts/check-rebuild-guardrails.mjs` `checkProductBoundaries`.
- Guardrails: every production file under `apps/` ≤ 400 lines; imports by `@ontime/*` alias; no inline remaining/elapsed formulas (format the pre-computed `view.timeMs`); no banned bug patterns.
- Host: macOS. Windows/Office execution evidence stays **pending** throughout; never fabricated. disk is 100% full → reuse already-installed root deps (electron 31.7.7, vite 7.3.5, typescript ~5.9.3, vitest 4.0.10); use `--package-lock-only` for the lockfile entry, no fresh `npm install`.

## Readiness (Phase 1)

- Inline gate: **implementable**. Spec scenarios S-001..S-033 all observable; Proposed Surface complete; Stage 5 has files/dependencies/acceptance-tests/commands/stop-conditions/non-goals. Open Questions OQ-1..OQ-4 are private-beta/public-release gates, not H5 blockers; OQ-1 (URL) neutralized by hiding the CTA when unset (no hardcoded stagetime.app).
- Independent Oracle (chat `new-chat-C38684`, mode=plan) initially returned **blocked** on S-012 only, claiming no canonical affinity signal. Verified against ground truth: the protocol *defines* `affinityMismatch`/`processCount`/`selectedPid`/`comPid` (validated root fields) and `projectPowerPointView` takes `multipleInstanceWarning`, but the native helper emits none and Companion does not surface multi-instance. Oracle lacked the protocol type as ground truth.
- User decision (authorized Option A): implement the narrow canonical helper extension now — emit `processCount` + `selectedPid` from existing values; derive `comPid` via `Application.HWND` + existing `GetWindowThreadProcessId` if reliably readable, else omit; `affinityMismatch = processCount>1 || comPid!==selectedPid`; never infer from `instanceId` churn. Keep Companion behavior unchanged; add focused contract/validation/app tests; continue H5 without stopping.
- Oracle decomposition corrections folded in: Vite/build config lives in H5-0 (each step has working commands); H5-2 split (schema pure vs store async I/O); H5-5 sequenced after settings/display DTOs stabilize; H5-7 split (main/preload vs renderer integration); session-host is a thin coordinator (no new poll/retry/debounce).

## Task ledger

| Task | Source | Files/surface | Status |
|---|---|---|---|
| H5-PRE | Spec S-012/S-026 + user Option A | `packages/ppt-bridge/native/windows-ppt-probe/Program.cs`; bridge contract test + fixture | **complete** (TS gate green; native compile pending) |
| H5-0 | Stage 5 scaffold | `apps/ppt-timer/{package.json,tsconfig*.json,vitest.config.ts,vite.config.ts,.gitignore}`, root `package.json` workspaces (`apps/*`), lockfile entry, strengthened `ppt-timer-standalone` boundary rule | **complete** (re-verified: guardrails PASS, boundaries PASS 241 modules/555 deps) |
| H5-1 | §8 mapping, S-001..S-016 | `apps/ppt-timer/src/renderer/view.ts` (`describeView`, `formatTime`) + tests | **complete** (re-verified: 20/20 tests) |
| H5-2 | S-018/019/021/023 | `apps/ppt-timer/src/main/settings-schema.ts`, `settings-store.ts` + tests | **complete** (re-verified: 11/11 + 8/8 tests) |
| H5-3 | S-020/022 | `apps/ppt-timer/src/main/window-placement.ts` + tests | **complete** (re-verified: 14/14 tests) |
| H5-4 | S-025/026 | `apps/ppt-timer/src/main/diagnostics.ts` + tests | **complete** (re-verified: 6/6 tests) |
| H5-5 | S-014/033 | `apps/ppt-timer/src/shared/ipc-contract.ts` + tests | **complete** (re-verified: 8/8 tests) |
| H5-6 | S-002/013/017/027 | `apps/ppt-timer/src/main/session-host.ts` + tests | **complete** (re-verified: 8/8 tests) |
| H5-6b (undocumented, found on resume) | thin wiring for H5-7 | `apps/ppt-timer/src/main/{controllers.ts,helper-discovery.ts,security.ts,ipc.ts,config.ts}`, `src/preload/preload.ts` + tests (controllers/helper-discovery/security have tests; `ipc.ts` did not) | **complete** (re-verified: controllers 9/9, helper-discovery 5/5, security 4/4 tests; `ipc.ts` untested on resume) |
| H5-7 | S-019/024/033 | `apps/ppt-timer/src/main/main.ts` (new), `src/main/ipc.test.ts` (new), `src/renderer/{index.html,main.ts,styles.css,main.test.ts}` (new); sender-hardened `src/main/ipc.ts` | **complete** (114/114 app tests, typecheck+build green; 4 review findings fixed) |
| H5-8 | closeout | build verification, full-diff review, guardrails, ci-local, doc sync | **automated gates complete**; Windows user-testing + spec-conformance recorded-pending |

## H5-7 evidence — Electron shell + integration

- **`src/main/main.ts` (new, 260 lines, untested composition root):** effectful glue only; computes no timing/geometry itself. Wires the pure modules to real Electron APIs:
  - Settings: `createSettingsStore` over `node:fs/promises`, file at `app.getPath('userData')/settings.json`; recovery on load records a sanitized `settings_recovered` diagnostic.
  - Single settings source of truth in main: controller-triggered saves inject the **live** window bounds (`saveFromController`) and the window `moved`/`resized` handlers persist bounds through the same `currentSettings`, so a control change can never clobber a live drag/resize and vice-versa.
  - Session host wired with `onView` → `pushView()` (sends composed `AppView` on `ppt-timer:view`); helper candidates from `discoverHelperCandidates({ resourcesPath, envPath: PPT_PROBE_PATH })`.
  - Window: `restoreBounds` on create; `MIN_WINDOW_SIZE` floor; `alwaysOnTop` from settings; hardened `webPreferences` from `BROWSER_SECURITY`; renderer loaded from `VITE_DEV_SERVER_URL` (dev) or `dist/renderer/index.html` (prod).
  - Placement revalidation on `display-added|removed|metrics-changed` (registered **after** `app.whenReady()` because Electron `screen` is ready-gated).
  - `WindowEffects`: `setAlwaysOnTop`, preset via `window-placement.applyPreset`, move via `window-placement.moveToDisplay`, all against the matched display work area.
  - Shutdown gate: `before-quit` always `preventDefault()`, idempotent `quitting` guard, `Promise.race([host.shutdown(), 2s timeout])` then exactly-once `app.exit(0)`; `window-all-closed` → `app.quit()` (no tray).
- **`src/renderer/main.ts` (new, 174 lines):** plain TS renderer; renders the immutable `AppView` via `describeView` and sends closed-union actions through `window.ontime` (preload). `mountApp` drops any view with a lower `revision` than the last rendered, so a late `getView()` cannot restore stale timing after an `unavailable` push (S-013). User-derived strings use `textContent` only. CTA omitted entirely when `ctaAvailable` is false (S-033). Auto-mount guarded by `window.ontime` presence so tests never trigger it.
- **`src/renderer/index.html` (new):** local-only shell with a restrictive CSP (`default-src 'none'`), loads `main.ts` as a module.
- **`src/renderer/styles.css` (new):** compact dark chrome; no web fonts / remote assets.
- **`src/main/ipc.ts` (hardened):** `get-view` now validates `event.sender` against the main window's contents, matching `dispatch` (S-033 review fix).
- **New tests:** `src/main/ipc.test.ts` (9: sender allow/deny on both channels, valid/malformed/foreign dispatch, openUpsell URL stripping, unbind); `src/renderer/main.test.ts` (12: all status states incl. unavailable-clears-time and multi-instance overlay, every control dispatch, CTA visibility, mountApp initial render + stale-revision drop).

## Review and escape ledger

- Full-diff review performed via independent Oracle (`ask_oracle` chat `new-chat-1BA929`; `mode=review` rejected once with `sourceCaptureFailed` per the known selection-freeze limit, so `mode=chat` over the frozen 16-file selection was used). Four findings, all verified against ground truth and fixed this pass:
  - **P1 — `ipc.ts` `get-view` unvalidated sender:** only `dispatch` checked `event.sender`; `get-view` exposed presentation state to any WebContents. Fixed: same `isAllowedSender` gate on `get-view`; added allow/deny tests.
  - **P1 — `renderer/main.ts` `mountApp` ignored `revision`:** a late-resolving `getView()` could overwrite a newer pushed view and restore stale timing after `unavailable` (S-013). Fixed: monotonic `lastRevision` guard drops older views; added a stale-drop regression test.
  - **P2 — `main.ts` `before-quit` repeated event:** the `quitting` short-circuit returned without `preventDefault()`, so a second quit could bypass the helper-close gate/grace period. Fixed: `preventDefault()` unconditionally, then idempotent guard.
  - **P2 — `main.ts` fire-and-forget settings writes:** a failed disk write could surface as an unhandled rejection. Fixed: `reportWriteError` catch at the composition boundary (logged, never thrown); `saveFromController` now returns a never-rejecting promise.
- Oracle confirmed clean: settings clobber/divergence (no field loss in either order), quit timeout/idempotence, init ordering/TDZ (`onView`→`pushView`→`controllers` all assigned before `host.start()`), `screen` readiness, S-017 (no renderer extrapolation), XSS (`textContent` only).
- Boundary: dependency-cruiser `ppt-timer-standalone` rule passes on-disk (245 modules, 0 violations); no forbidden imports (firebase/cloud/local-sync/companion/frontend/functions/socket.io/interface-contracts/shared-types/timer-core); all `apps/ppt-timer` production files ≤400 lines (max `main.ts` 260).

## H5-7/H5-8 validation log

- App workspace: `npm run typecheck --workspace apps/ppt-timer` PASS; `npm run test --workspace apps/ppt-timer` PASS **114/114** (12 files; +21 over the H5-6b baseline of 93: 9 IPC + 12 renderer); `npm run build --workspace apps/ppt-timer` PASS (CJS `dist/main/*.js` incl. `main.js`, `dist/preload/preload.js`, `dist/renderer/index.html` + hashed assets; preload/renderer load paths resolve from `dist/main`).
- Shared-capability regression (H5 consumes these): `@ontime/ppt-bridge` **33/33**; `@ontime/presentation-core` **100/100**; `companion` **164/164** (no change from H4 baseline).
- Guardrails: `npm run guardrails` PASS (static ratchet 7/10 baseline; boundaries 245 modules / 575 deps, 0 violations).
- `npm run ci-local` PASS — all 24 checks (rebuild boundary/pattern, presentation-core + ppt-bridge typecheck/tests/CJS build+smoke, Companion typecheck/tests, frontend lint/typecheck/240 tests, timer-core/shared-types/local-sync/interface-contracts/lock-view-model, whitespace). Note: `ci-local.mjs` does not yet run the `apps/ppt-timer` workspace; per Stage 5 the app gate is a separate command (run above) and wiring `apps/` into `ci-local`/CI is Stage 6 scope — deliberately not touched here.
- **Windows/native/user-facing evidence remains recorded-pending** (macOS host; no Windows/Office/dotnet): the H5-PRE native `Program.cs` affinity emission is not compiled/run against live PowerPoint; the packaged helper-resource path (`resourcesPath/ppt-probe.exe`) is not exercised; `before-quit` real STA-helper close/orphan check is not run against a live helper (non-Windows path returns the resolved sentinel); and Stage-5 user-facing smoke (all UI states, settings survive restart, helper exits on close) is not performed. Do not mark these fixed/green without Windows execution. Spec-conformance matrix (`docs/spec/standalone-powerpoint-video-timer.conformance.md`) not yet produced — remaining H5-8 closeout item.
- No commit/push/PR/issue-status change performed; work remains uncommitted on `backlog/ISSUE-001-standalone-ppt-timer` at base `5d70067`.

## H5-PRE evidence

- `Program.cs`: after `instanceId`, emit `processCount` (pptProcesses.Length) + `selectedPid` (pptPid) on every running-PowerPoint outcome; after `pptActive=true`, read `Application.HWND` via existing `TryGetProp` → `Convert.ToInt64` → existing `GetWindowThreadProcessId` → emit `comPid` + `affinityMismatch = processCount>1 || comPid!=selectedPid` only when `comPid!=0`; any HWND read failure omits comPid/affinityMismatch (never guesses, never uses instanceId churn).
- Contract fixture `packages/ppt-bridge/test/fixtures/affinity-mismatch.json` + 3 new tests in `validate-response.test.ts` (preserve affinity on observation; accept on no_slideshow; reject malformed types).
- Validation: `npm run typecheck --workspace @ontime/ppt-bridge` PASS; `npm run test --workspace @ontime/ppt-bridge` PASS **33/33** (was 30; +3).
- Native build/parity PENDING: no `dotnet`/Windows/Office on this host. The C# is syntactically reviewed (balanced braces, in-scope `pptProcesses`/`pptPid`, existing `TryGetProp`/`GetWindowThreadProcessId`); real emission of `processCount`/`selectedPid`/`comPid`/`affinityMismatch` against live PowerPoint is not yet exercised. Companion behavior is unchanged (it ignores these previously-unsent fields).

## Validation and resume log

- Base SHA recorded: `5d70067722c3bb9a5992a5992a4471f607c926b2c9094` (clean).
- Resume instruction: continue from the in-progress H5-PRE helper edit. Do not commit/push/PR/change issue status without explicit ask. Record Windows/native execution as pending.

## Context exception log

- Oracle H5 plan export at the task-named path `prompt-exports/oracle-plan-2026-07-28-080944-plan-h5-app-817c4d-bbdb.md` does not exist; substituted via `ask_oracle` mode=plan (chat `new-chat-C38684`), satisfying the Phase-1 independent-verdict requirement.
- Oracle initially lacked `packages/ppt-bridge/src/protocol.ts` as ground truth and overstated the S-012 gap; the orchestrator verified the affinity fields exist in the protocol and validate-response, then escalated the scope decision to the user rather than accepting the block or guessing.
