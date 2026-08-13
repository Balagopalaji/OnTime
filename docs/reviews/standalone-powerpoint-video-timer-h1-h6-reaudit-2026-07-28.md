# Standalone PowerPoint Video Timer H1–H6 remediation re-audit — 2026-07-28

## Verdict

**FAIL / NO-GO.** This was a fresh re-audit of the complete current worktree against baseline `fceb200`; prior verdict assumptions were not reused.

The remediation closes all **three original P0 findings** and all **eight original P1 findings** at source. Of the original P2s, **P2-02, P2-04, and P2-05 are fixed**, while **P2-01 and P2-03 are partial**. Two **new P1 source defects** were found:

1. the packaged app still honors development environment overrides that can replace both the local renderer and the packaged helper; and
2. three root-workspace workflows still run `npm ci` on Node 20 even though the newly pinned Electron 43 dependency declares Node `>=22.12.0`.

PASS is therefore prohibited: new P1s remain, and not all accepted remediation is correctly complete/covered.

### Status summary

| Group | FIXED | PARTIAL | NOT_FIXED |
|---|---:|---:|---:|
| P0-01..03 | 3 | 0 | 0 |
| P1-01..08 | 8 | 0 | 0 |
| P2-01..05 | 3 | 2 | 0 |
| New findings | 0 | 0 | 2 new P1 defects |

## Audit basis, method, and status rules

- Baseline: `fceb200`.
- Current committed branch head: `4fd0827`.
- Audited current scope: the complete worktree, including the uncommitted H6/remediation diff. At audit start this was 113 changed files versus `fceb200`, including 55 uncommitted files (42 modified, 13 untracked).
- The prior audit was read only to recover the exact P0-01..03, P1-01..08, and P2-01..05 contracts and stable signatures. Every disposition below was then re-established from current source and fresh validation.
- Current spec/plan sources used: `docs/spec/standalone-powerpoint-video-timer.spec.md`, `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`, and the current non-archived source-of-truth docs identified by `AGENTS.md`.
- `docs/archive/**` was excluded.
- `FIXED` means the cited source defect is absent and its targeted local checks pass. Windows-only execution evidence that cannot be produced on this host is listed separately and does not get relabeled as a source defect.
- `PARTIAL` means meaningful remediation exists, but the original contract is still reachable as a current source defect or the claimed fix is incomplete.
- `NOT_FIXED` means the original defect remains substantially unchanged.

### Inspected scope

The re-audit inspected the complete implementation surface relevant to the request, including:

- canonical native ownership and protocol: `packages/ppt-bridge/native/**`, bridge protocol/validation/session/process lifecycle, fixtures, and tests;
- canonical presentation behavior: `packages/presentation-core/src/powerpoint-*` and tests;
- Companion adapters, detection/candidate flow, quit gate, lifecycle tests, current unchanged D1–D12/C1–C16 characterization suites, package build, and installer workflow;
- all standalone app main/preload/renderer/shared modules, settings/display/diagnostics/security/IPC tests, builder config, manifest tooling, package pins, and Windows workflow;
- root dependency boundaries, CJS build tooling, lockfile engines, guardrails, and Controller/Companion/standalone CI Node versions;
- the full current diff versus `fceb200` and the complete uncommitted H6/remediation surface.

## Original P0 findings

### P0-01 — FIXED

**Stable signature:** `P0|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|critical slideshow COM failure remains nominal observation`

**Current code evidence**

- `Program.Poll` now defines the typed marker `slideshow_state_unavailable` and emits it whenever a positively reported slideshow cannot supply its window, presentation/view, current show position, slides collection, or current slide (`Program.cs:19,157-202`).
- `validatePowerPointResponse` records any non-empty `pptError` and returns `kind:'com_unavailable'` without an observation (`validate-response.ts:194-203,235-238`).
- `PowerPointSession` maps `com_unavailable` to an operational failure, and the reducer replaces the visible source with `{kind:'unavailable'}` in that reduction (`powerpoint-session.ts:54-61`; `powerpoint-machine.ts:203-207`). The warm video cache is not projected on this path.

**Test evidence**

- Validator regression: `packages/ppt-bridge/test/validate-response.test.ts:154-165`.
- Live numeric → typed partial-COM failure → same-poll unavailable/no `timeMs`: `apps/ppt-timer/src/main/session-host.test.ts:170-193`.
- Fresh bridge and app suites passed (55 and 164 tests respectively).

**Boundary note:** the legacy D6 warm-cache behavior remains for nominal observations (`powerpoint-normalize.ts:137-172`; characterization at `powerpoint-normalize.test.ts:357-397`). The fixed critical-COM outcome bypasses normalization, so that preserved Companion behavior no longer defeats failure clearing.

### P0-02 — FIXED

**Stable signature:** `P0|packages/ppt-bridge/src/validate-response.ts|missing instanceId accepted as observation`

**Current code evidence**

- Every foreground/background payload now requires a positive integer `instanceId`; missing, zero, negative, fractional, or nonnumeric values return `invalid_payload` (`validate-response.ts:224-229`).
- `invalid_payload` takes the session operational-failure path and clears visible numeric timing (`powerpoint-session.ts:54-61`; `powerpoint-machine.ts:203-207`).
- The older raw reducer guard remains for Companion compatibility, but native JSON cannot reach it with an invalid running identity.

**Test evidence**

- Validator matrix: `packages/ppt-bridge/test/validate-response.test.ts:167-176`.
- Live → missing identity → unavailable/no numeric time: `apps/ppt-timer/src/main/session-host.test.ts:195-208`.
- Fresh bridge/app suites passed.

### P0-03 — FIXED

**Stable signature:** `P0|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|primary identity not emitted or projected`

**Current code evidence**

- The helper emits `protocolVersion:1` and records the selected primary index while choosing the scalar timing source; it then emits `primaryVideoIndex`, `primaryVideoId` when available, and scalars from that same entry (`Program.cs:11,53-56,244-270,303-333`).
- Protocol-v1 validation rejects a non-empty media list with absent, out-of-range, missing-ID, or contradictory explicit primary metadata (`validate-response.ts:52-82,230-234`).
- The bridge session carries protocol/id/index into `PowerPointPollResult` (`powerpoint-session.ts:31-40`). Normalization caches/restores the explicit identity with its video list (`powerpoint-normalize.ts:250-280`).
- `projectPowerPointView` uses the snapshot primary and disables heuristic fallback for protocol v1; scalar timing and selected label/status consequently stay associated (`powerpoint-view.ts:71-99,117-139`).
- Standalone diagnostics reads selected identity from the normalized snapshot (`session-host.ts:155-178`) rather than independently selecting media.

**Test evidence**

- Native-shaped fixture carries id/index/scalars: `packages/ppt-bridge/test/fixtures/multiple-video.json:1-38`.
- Protocol-v1 rejection matrix: `validate-response.test.ts:178-191`.
- Bridge projection: `packages/ppt-bridge/test/session.test.ts:24-43`.
- Core projection with a helper primary different from the playing/heuristic candidate: `powerpoint-view.test.ts:401-419`.
- End-to-end validator → host → normalized cache → view/diagnostics association: `session-host.test.ts:210-269`.
- Fresh core/bridge/app suites passed.

**Companion note:** Companion continues to omit the new protocol/id/index fields from its legacy `LiveCue` compatibility payload, preserving its pre-feature public event shape. Its scalar timing still comes from the helper-selected primary, and the unchanged D1–D12/C1–C16/fixture event suites pass. No Companion event-order or payload regression was found.

## Original P1 findings

### P1-01 — FIXED (source); Windows launch evidence pending

**Stable signature:** `P1|packages/ppt-bridge/scripts/build-windows.ps1|native runtime files omitted from installer`

- Publish now includes `-p:IncludeNativeLibrariesForSelfExtract=true` together with self-contained, single-file, untrimmed win-x64 flags (`build-windows.ps1:22-31`).
- Builder still intentionally packages only `ppt-probe.exe` (`apps/ppt-timer/electron-builder.yml:32-39`).
- The Windows workflow now fails if the publish directory lacks the exe or contains loose DLLs (`ppt-timer-build.yml:75-96`).
- Static/command coverage is at `native-build-scripts.test.ts:129-155`; that suite passed.
- Actual clean-Windows no-runtime launch remains Stage 7 evidence, not a current source defect.

### P1-02 — FIXED

**Stable signature:** `P1|packages/presentation-core/package.json|Windows npm build:cjs uses rm/printf`

- Both runtime packages now use `node ../../scripts/build-cjs.mjs` (`packages/presentation-core/package.json:14-18`; `packages/ppt-bridge/package.json:13-17`).
- The checked-in script uses `rmSync`, `mkdirSync`, `writeFileSync`, and `spawnSync(process.execPath, ...)` (`scripts/build-cjs.mjs:8-28`), with no POSIX shell commands.
- `native-build-scripts.test.ts:57-103` executes the builder against a temporary package.
- The ordered production sequence (core build, bridge build, bridge CJS smoke) passed locally. A deliberately parallel audit invocation raced the dependent builds and failed; it is not the workflow order and was superseded by the successful ordered run.

### P1-03 — FIXED

**Stable signature:** `P1|apps/ppt-timer/scripts/build-manifest.mjs|raw Windows path passed to import()`

- The entrypoint converts the resolved filesystem module path with `pathToFileURL(...).href` before dynamic import (`build-manifest.mjs:18-39`).
- The real entrypoint is exercised with filesystem paths and temporary installer/output data in `build-manifest.test.ts:116-163`; the app suite passed.
- A Windows drive-letter execution remains part of the real workflow evidence, but the raw-path source defect is removed.

### P1-04 — FIXED

**Stable signature:** `P1|packages/ppt-bridge/src/process-client.ts|SIGKILL followed by fixed 10ms sleep`

- Generation failure creates a termination barrier, and `beginPoll` waits that barrier before any replacement generation (`process-client.ts:108-123,292-311`).
- Forced termination retains `exit`/`close` listeners until confirmed or a bounded `unconfirmed` diagnostic is emitted (`process-client.ts:313-356`).
- Close first waits for graceful termination, then awaits the same forced-termination primitive before listener removal (`process-client.ts:358-395`).
- Tests cover delayed confirmed exit, bounded unconfirmed restart, delayed confirmed forced close, and bounded unconfirmed close (`process-client.test.ts:166-291`). Fresh bridge tests passed.

### P1-05 — FIXED

**Stable signature:** `P1|companion/src/ppt-probe.ts|ensure resumes after stop and creates client`

- `createPptNativeLifecycle` increments a lifecycle epoch on every stop; `ensure` captures and rechecks it after awaiting the shared close and before client creation (`companion/src/ppt-probe.ts:38-84`).
- The deterministic race test blocks close, starts ensure, issues quit stop, releases close, and proves no replacement is created; it also proves later fresh re-enable still works (`companion/src/ppt-probe.test.ts:5-39`).
- Companion’s gated quit awaits the shared stop promise (`ppt-probe.test.ts:41-52`; `ppt-quit-gate.ts:41-62`). Fresh Companion tests passed.

### P1-06 — FIXED (source); workflow execution pending

**Stable signature:** `P1|.github/workflows/companion-build.yml|electron-builder invoked before dist/viewer build`

- The workflow now runs `npm run build:viewer` and `npm run build` before `npx --no-install electron-builder --publish never`, then asserts `dist/main.js` and `frontend/dist-viewer/index.html` exist (`companion-build.yml:56-76`).
- CI order is asserted at `apps/ppt-timer/src/main/ci-parity.test.ts:76-88`.
- The current Companion suite (including its TypeScript prebuild/CJS sequence) passed 165 tests.
- The separate Node-version regression in this workflow is reported as NEW-P1-02 below; it does not make the original missing-build-order defect remain.

### P1-07 — FIXED

**Stable signature:** `P1|apps/ppt-timer/src/main/session-host.ts|timingMode always initializes remaining`

- The composition root passes `currentSettings.timingMode` into `createSessionHost` before start (`main.ts:108-116`).
- Host initialization uses `options.timingMode ?? 'remaining'` before the first projection (`session-host.ts:34-39,115-120`).
- The restart test persists elapsed, reloads it, starts the host, and observes elapsed `timeMs` on the first live projection (`session-host.test.ts:119-151`). Fresh app tests passed.

### P1-08 — FIXED

**Stable signature:** `P1|apps/ppt-timer/package.json|electron 31.7.7 is end-of-life`

- The standalone pins Electron `43.2.0` and Electron Builder `26.11.1` exactly, with matching lockfile entries (`apps/ppt-timer/package.json:23-27`; `package-lock.json:522-545`).
- On 2026-07-28, Electron 43 is a supported stable major; the official schedule gives 43 an EOL of 2027-01-05, and Electron supports the latest three stable majors: [Electron schedule](https://releases.electronjs.org/schedule), [Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).
- Exact pins are asserted in `package-content.test.ts:81-94`; the app suite passed.
- The Node-runtime fallout in other monorepo workflows is a separate new P1 below.

## Original P2 findings

### P2-01 — PARTIAL

**Stable signature:** `P2|apps/ppt-timer/src/main/config.ts|split build identities`

**What is fixed**

- App/installer/manifest version is now `0.1.0-beta.1` from the app package; the release workflow rejects a mismatching `ppt-timer-v*` tag (`apps/ppt-timer/package.json:2-5`; `ppt-timer-build.yml:32-38`).
- Diagnostics uses `app.getVersion()` and the helper-emitted `productVersion` (`main.ts:150-159`; `session-host.ts:223-225`).
- The helper build reads the app package version and passes it as `Version` and `InformationalVersion`; the protocol carries `productVersion` (`build-windows.ps1:5-13,31`; `Program.cs:13-18,53-56`; `protocol.ts:34-36`).

**Why it remains partial**

- .NET 8+ appends `SourceRevisionId` to `AssemblyInformationalVersion` by default when Source Link discovers Git metadata. The net10 publish does not set `IncludeSourceRevisionInInformationalVersion=false`, while `Program.cs` reports `AssemblyInformationalVersionAttribute`. A CI-built helper can therefore report `0.1.0-beta.1+<revision>` while app/tag/manifest report `0.1.0-beta.1`. Microsoft documents both the default revision suffix and the opt-out: [.NET Source Link compatibility change](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/source-link).
- `build-manifest.mjs:65-72` declares `helperVersion` by rereading app `package.json`; it does not inspect/verify the packaged helper’s emitted or file version. The manifest can claim exact equality without proving it.
- Existing tests assert source strings and a synthetic exact product version (`native-build-scripts.test.ts:105-118`; `session-host.test.ts:362-374`); they do not cover the SDK-generated informational version.

### P2-02 — FIXED

**Stable signature:** `P2|packages/presentation-core/src/powerpoint-normalize.ts|filename used unbasenamed as title`

- The core keeps the legacy snapshot title for Companion compatibility but the standalone projection detects the filename fallback and basenames it (`powerpoint-view.ts:55-69,143-149`).
- Drive and UNC missing-Name cases assert safe display titles while proving the canonical snapshot remains unchanged (`powerpoint-view.test.ts:335-354`).
- Renderer output uses the already-sanitized projected title (`renderer/view.ts:55-61`). Fresh core/app tests passed.

### P2-03 — PARTIAL

**Stable signature:** `P2|apps/ppt-timer/src/main/controllers.ts|move display forces custom while resize does not`

**What is fixed**

- Display move now preserves the existing preset (`controllers.ts:80-84`; `controllers.test.ts:77-83`).
- User resize events are classified and `settingsForResizeEvent` writes `sizePreset:'custom'`; programmatic size changes suppress one resize (`main.ts:97-106,221-222`; `window-resize-policy.ts:17-41`). Pure policy and store/restart tests pass (`window-resize-policy.test.ts:9-30`; `settings-store.test.ts:132-143`).

**Why it remains partial**

- There are two unsynchronized settings owners. `main.ts` updates `currentSettings` directly on resize (`main.ts:97-101`), while `createAppControllers` copied the launch settings into its private `let settings` and uses that copy for every rendered preset and later action (`controllers.ts:41-58`).
- A manual resize can therefore persist `custom` in `currentSettings`, but the next host push still renders the controller’s old Compact/Large value. A later controller action builds from that stale copy and `saveFromController` writes it back, only replacing `windowBounds` (`main.ts:90-96`), so it can overwrite `custom` with the old preset.
- Tests cover the resize classifier, store, and controller independently; there is no composition/event test proving manual resize → rendered Custom → another control action → restart remains Custom.

### P2-04 — FIXED

**Stable signature:** `P2|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|processCount>1 warning depends on HWND`

- The helper now initializes `affinityMismatch = pptProcesses.Length > 1` before optional COM HWND/PID lookup, and later ORs any resolved PID mismatch into it (`Program.cs:85-97,119-130`).
- Validator coverage proves `processCount:2`/warning survives with no `comPid` (`validate-response.test.ts:193-205`).
- The host consumes only the canonical flag (`session-host.ts:59-66`). Fresh bridge/app tests passed.

### P2-05 — FIXED (source/CI definition); Windows workflow execution pending

**Stable signature:** `P2|apps/ppt-timer/src/main/ci-parity.test.ts|string-presence tests substitute for Windows execution`

- The artifact job now runs both shared-package typechecks/tests, ordered CJS builds, app typecheck/tests, helper publish, installer packaging, manifest generation, and real unpacked/ASAR inspection (`ppt-timer-build.yml:40-176`).
- ASAR inspection uses the exact local `@electron/asar` dependency, not `npx --yes`; the package pins `@electron/asar:3.4.1` (`ppt-timer-build.yml:121-136`; `apps/ppt-timer/package.json:23-27`).
- The workflow verifies exactly one helper, both runtime workspace packages, exclusion of build-only manifest code, and absence of forbidden product assets (`ppt-timer-build.yml:105-162`).
- Local app CI/config tests passed, as did shared typechecks/tests, ordered CJS smokes, static guardrails, and dependency boundaries.
- Running that Windows workflow remains Stage 7 evidence; the prior source/CI-definition gaps are removed.

## NEW findings

### NEW-P1-01 — Packaged execution trusts development environment overrides for both renderer and helper

**Stable signature:** `P1|apps/ppt-timer/src/main/main.ts|packaged app honors dev renderer and helper environment overrides|S-024/S-025/S-033`

**Evidence**

- The production composition root always passes `process.env.PPT_PROBE_PATH` ahead of the packaged resource candidate (`main.ts:109-113`; preference is implemented/tested at `helper-discovery.ts:29-43` and `helper-discovery.test.ts:27-40`). The bridge then spawns the first existing candidate.
- The same production code always loads `process.env.VITE_DEV_SERVER_URL` when present, rather than local packaged HTML (`main.ts:231-235`). There is no `app.isPackaged` gate and no exact localhost-development URL check.
- The preload exposes `getView`, subscription, and action dispatch to whichever document is loaded (`preload/preload.ts:9-21`). IPC sender equality does not protect this case: the environment-selected remote page is the expected main-window `WebContents` (`ipc.ts:14-31`).
- `will-navigate`/popup denial does not reject the initial programmatic `loadURL` selected by main.
- Security tests cover BrowserWindow flags, later navigation, popups, IPC sender identity, and the upsell allowlist, but not packaged-mode renderer/helper selection (`security.test.ts:1-33`; `ipc.test.ts:48-111`).

**Impact**

A packaged launch inheriting attacker/operator-controlled development variables can execute an arbitrary existing helper path and can load remote content with the trusted preload/IPC surface. This defeats the claimed packaged-helper integrity and local-renderer security boundary and is a release blocker.

**Required correction/evidence**

Ignore both overrides when `app.isPackaged` is true. In development, constrain the renderer URL to the fixed launcher-owned localhost origin and keep helper override behavior explicitly dev-only. Add composition tests for packaged and development selection.

### NEW-P1-02 — Root workflows use Node 20 with a workspace dependency that requires Node >=22.12

**Stable signature:** `P1|.github/workflows/rebuild-guardrails.yml|root npm ci uses Node 20 with Electron 43 requiring Node 22.12|CI/package`

**Evidence**

- The Electron 43 remediation pins `apps/ppt-timer/node_modules/electron@43.2.0`, whose lockfile engine contract is `node >= 22.12.0`; its `@electron/get` dependency has the same minimum (`package-lock.json:39-56,522-538`).
- The standalone artifact workflow correctly moved to Node 22 (`ppt-timer-build.yml:21-29`).
- Root `npm ci` still runs under Node 20 in rebuild guardrails (`rebuild-guardrails.yml:27-35`), Companion packaging (`companion-build.yml:25-33`), and both Controller build jobs (`controller-build.yml:34-43,68-77`). Because these commands install the root workspace lock, they include the standalone Electron 43 workspace dependency even when the later job builds another product.
- `ci-parity.test.ts` checks standalone commands but does not compare every root-install workflow’s Node runtime against lockfile engine minima.

**Impact**

Required PR guardrails and existing Companion/Controller installer lanes install an explicitly unsupported dependency graph. Depending on npm engine enforcement/install-script behavior, they can warn or fail before tests/builds; even if they happen to install, the CI definition is outside the pinned toolchain’s supported runtime. This is a package/CI regression introduced by the Electron support upgrade.

**Required correction/evidence**

Move all root-workspace `npm ci` jobs to Node `>=22.12` (prefer one exact/current Node 22 policy), or isolate installs so Node-20 jobs do not install the standalone workspace. Add a lockfile-engine/CI-runtime parity test and run all affected workflows from a clean checkout.

## No additional new P0/P2 findings

No new P0 was found after tracing validator → session → reducer → projection → renderer failure ordering, protocol-v1 primary association, revision ordering, and process-generation isolation. No additional new P2 was found beyond the two partial original P2s above. In particular:

- there is exactly one current `Program.cs`: `packages/ppt-bridge/native/windows-ppt-probe/Program.cs`;
- the standalone production dependencies remain only `@ontime/ppt-bridge` and `@ontime/presentation-core`;
- dependency-cruiser reported no violations across 256 modules / 611 dependencies;
- Companion’s unchanged presentation characterization/event suites passed, and its new ensure/stop/quit races passed;
- typed operational failures still clear the current standalone view before rendering, and renderer revision ordering prevents an older async `getView()` result from restoring time (`renderer/main.ts:147-163`; `renderer/main.test.ts:153-181`).

## Fresh validation performed

No downloads, .NET publish, Windows packaging, or installer build were run.

| Command | Result |
|---|---:|
| `npm run test --workspace @ontime/presentation-core` | PASS — 105 tests |
| `npm run test --workspace @ontime/ppt-bridge` | PASS — 55 tests |
| `npm run test --workspace apps/ppt-timer` | PASS — 164 tests |
| `npm run test --workspace ontime-companion` | PASS — 165 tests |
| `npm run test --workspace frontend -- src/hooks/useTimerEngine.test.tsx src/__tests__/snapshotStale.test.ts` | PASS — 9 tests |
| `npm run typecheck --workspace @ontime/presentation-core` | PASS — no diagnostics |
| `npm run typecheck --workspace @ontime/ppt-bridge` | PASS — no diagnostics |
| `npm run typecheck --workspace apps/ppt-timer` | PASS — no diagnostics |
| `npm run boundaries` | PASS — 256 modules / 611 dependencies |
| `npm run guardrails:static` | PASS |
| ordered core/bridge `build:cjs` + `smoke:cjs` | PASS |

The Companion run logged one sandbox `EPERM` attempt to the host Application Support cache during an unrelated cache test, but all 165 tests passed and the tested in-memory assertions completed. This is not a finding in the audited PPT timer change.

## Windows-only Stage 7 evidence — pending, not source-defect substitutions

The following still require Windows/Office execution and must not be confused with the source defects above:

1. Run the real net10 win-x64 publish; inspect the complete publish directory; verify the helper starts on clean Windows without a machine-wide .NET runtime; capture its actual `productVersion` (including whether revision metadata is appended).
2. Execute corrected `ppt-timer-build.yml`, `companion-build.yml`, Controller builds, and rebuild guardrails from clean checkouts using the corrected Node runtime policy.
3. Inspect the real installer/unpacked/ASAR resources: exactly one runnable helper, both runtime packages, no forbidden product assets, correct manifest/checksum, and no build-only files.
4. Run real Microsoft 365 COM journeys: not running, no slideshow, standard show/Presenter View, play/pause/resume/seek/end/replay, slide changes, typed partial-COM failure, helper crash/timeout/restart, and multiple-video explicit-primary association.
5. Test Office x64 and x86; if x86 fails, narrow beta support explicitly.
6. Run Companion and standalone simultaneous polling for at least 30 minutes and inspect OS processes through timeout, crash, mode change, close, and quit, including the `unconfirmed` forced-termination diagnostic path.
7. Exercise clean Windows 11 and supported Windows 10 ESU/LTSC install/launch, same-version repair, newer-version in-place upgrade with settings retained, normal uninstall preserving userData, and reinstall recovery.
8. Exercise rendered settings behavior on real mixed-DPI/multi-display Windows: move, manual resize, presets, display removal/metrics changes, always-on-top, timing mode, close/restart, and the P2-03 composition sequence.
9. Confirm final website URL/privacy/support wording; keeping the CTA hidden while OQ-1 is unresolved remains acceptable.

## Stage 8 signing — separate

The internal artifact is intentionally unsigned. Publisher identity, Authenticode/RFC 3161 signing, post-sign verification, antivirus/SmartScreen evidence, and proof that published bytes equal tested bytes remain Stage 8 public-release work, not reasons for this H1–H6 source verdict.

## Final disposition

- **Original P0 remediation:** PASS — 3/3 fixed with current code and fresh targeted tests.
- **Original P1 remediation:** PASS at source — 8/8 fixed; Windows execution remains separately pending.
- **Original P2 remediation:** FAIL — P2-01 and P2-03 remain partial.
- **Canonical ownership/dependency direction:** PASS, subject to the packaged dev-override P1 security fix.
- **Companion behavioral preservation:** PASS in current automated characterization; real simultaneous Windows polling remains pending.
- **Package/CI readiness:** FAIL — NEW-P1-02 leaves required root workflows on an unsupported Node runtime.
- **Security readiness:** FAIL — NEW-P1-01 allows packaged execution to honor development renderer/helper overrides.
- **Overall H1–H6 acceptance:** **FAIL / NO-GO** until both new P1s are fixed and the partial P2 remediations are completed and covered.
