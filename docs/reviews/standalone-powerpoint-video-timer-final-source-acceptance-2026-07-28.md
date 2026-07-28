# Standalone PowerPoint video timer — final source acceptance audit — 2026-07-28

## Verdict

**PASS / GO — final source acceptance.**

All 18 enumerated findings from the two prior reports remain **FIXED in the current source**: P0-01..03, P1-01..08, P2-01..05, NEW-P1-01, and NEW-P1-02. The two findings raised by this final audit, NEW-P1-03 and NEW-P2-01, are also **FIXED** by the closeout evidence below.

The H6 feature surface is source-accepted, including the intended **one canonical capability / two consumers** architecture. Real Windows artifact, Office, and installer validation remains required Stage 7 evidence, not a source defect; Stage 8 signing also remains separate.

## Closeout addendum — NEW-P1-03 and NEW-P2-01 — 2026-07-28

This closeout inspected only the two fixes and their focused regression coverage; it did not re-audit the application.

- **NEW-P1-03 — FIXED.** `apps/ppt-timer/package.json` remains `0.1.0-beta.1`. `windows-file-version.mjs` deterministically maps its SemVer core plus trailing numeric prerelease identifier to the bounded four-part PE value `0.1.0.1`; every part is rejected outside `0..65535`. `build-windows.ps1` passes `0.1.0-beta.1` to `Version` and `InformationalVersion`, and the derived `0.1.0.1` to `FileVersion`. Before manifest generation, `ppt-timer-build.yml` reads the actual published executable's `ProductVersion` and `FileVersion`, requiring exact equality with the SemVer and derived numeric value respectively.
- **NEW-P2-01 — FIXED.** `apps/ppt-timer/src/main/config.ts` ends cleanly after its export, and the exact baseline gate `git diff --check fceb200 -- .` exits 0 with no diagnostics.

Fresh focused evidence:

| Command | Result |
|---|---:|
| `node packages/ppt-bridge/scripts/windows-file-version.mjs "$(node -p "require('./apps/ppt-timer/package.json').version")"` | **PASS** — app `0.1.0-beta.1` → PE `0.1.0.1` |
| `npx vitest run packages/ppt-bridge/test/native-build-scripts.test.ts apps/ppt-timer/src/main/ci-parity.test.ts` | **PASS** — 2 files, 18 tests |
| `git diff --check fceb200 -- .` | **PASS** — exit 0, no output |

The tests execute the mapper for the current prerelease, build metadata, stable-version fallback, and out-of-range core/revision cases; they also assert distinct MSBuild properties and the actual-PE verification ordering/operands in the Windows workflow. No remaining P0/P1/P2 was found in this narrow closeout scope.

## Audit basis and method

- Baseline: `fceb200`.
- Source-acceptance checkpoint: `5193084`; later docs-only metadata commits do not change the audited source. The branch remains unpushed.
- Checkpoint commits: `0bd69c7` canonical probe/core; `24fa596` standalone runtime/settings; `65f65d7` installer/CI/versioning; `5193084` H6 source-acceptance docs.
- Current diff inspected: 114 changed files versus `fceb200` at audit start, including all H6/review files then present.
- The two prior reports were read only to enumerate the required finding IDs, summaries, and stable signatures. Every status below was re-established from current source and fresh local checks.
- Current contract sources: `docs/spec/standalone-powerpoint-video-timer.spec.md`, `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`, and the non-archived sources of truth named by `AGENTS.md`.
- `docs/archive/**` was excluded.
- No downloads, `.NET publish`, Electron packaging, installer build, Windows execution, or PowerPoint/Office execution were performed.

### Status rules

- **FIXED:** the original source defect is absent and fresh targeted local checks pass.
- **PARTIAL:** remediation exists but the original source defect remains reachable or required targeted checks fail.
- **NOT_FIXED:** the original defect remains substantially present.
- Windows-only evidence that cannot be produced on this host is recorded under Stage 7 rather than substituted for a source status.

## Canonical capability and H6 source disposition

### One canonical capability / two consumers — PASS

- There is exactly one current native helper source: `packages/ppt-bridge/native/windows-ppt-probe/Program.cs`.
- `@ontime/ppt-bridge` owns native framing, validation, process generation/isolation, failure mapping, polling/session lifecycle, and shutdown.
- `@ontime/presentation-core` owns normalization, debounce/cache/clearing, presentation state reduction, primary-video projection, and standalone view-state derivation.
- Companion consumes both shared packages through `companion/src/ppt-probe.ts`, `presentation-candidate.ts`, and `presentation-snapshot.ts`; its PowerShell/AppleScript transports remain Companion-only compatibility fallbacks, as the spec permits.
- The standalone declares only `@ontime/ppt-bridge` and `@ontime/presentation-core` as production dependencies (`apps/ppt-timer/package.json:17-20`) and has no Companion/frontend/Firebase/cloud/local-sync/Socket.IO runtime dependency.
- Dependency boundaries passed across 258 modules / 614 dependencies.

### H6 source implementation — IMPLEMENTED AND SOURCE-ACCEPTED

The intended H6 source surface exists: net10 Windows helper retarget, self-contained single-file flags, stable NSIS identity/settings-preserving uninstall policy, exact package pins, manifest/checksum tooling, standalone/Companion Windows workflows, clean-checkout build ordering, package-content gates, Node runtime alignment, and unsigned internal-artifact policy. NEW-P1-03 and NEW-P2-01 are closed by the focused addendum above, so H6 is accepted as the final source slice. Stage 7 execution evidence remains pending separately.

## Exact finding dispositions

### Original P0 findings

| ID | Status | Fresh current evidence |
|---|---|---|
| **P0-01** — critical partial COM read can preserve stale time | **FIXED** | The helper emits `slideshow_state_unavailable` when a positively detected slideshow cannot yield its window, presentation/view, show position, slides collection, or slide (`Program.cs:19,157-202`). Validation maps non-empty `pptError` to `com_unavailable` (`validate-response.ts:194-203,235-238`), and the session/reducer takes the operational-failure path to `{kind:'unavailable'}` (`powerpoint-session.ts:54-61`; `powerpoint-machine.ts:203-207`). Live numeric → partial-COM failure clearing is covered by `session-host.test.ts:170-193`. |
| **P0-02** — running response without valid `instanceId` is accepted | **FIXED** | Foreground/background outcomes now require a positive integer identity (`validate-response.ts:224-229`); invalid identity becomes `invalid_payload`, then operational failure, clearing numeric timing. Validator coverage is in `validate-response.test.ts:167-176`; live → missing identity → unavailable is in `session-host.test.ts:195-208`. |
| **P0-03** — helper primary selection is not end-to-end | **FIXED** | The helper emits protocol v1 plus primary index/id and scalar timing from the same selected entry (`Program.cs:11,53-56,244-270,303-333`). Protocol-v1 validation rejects absent/contradictory primary metadata (`validate-response.ts:52-82,230-234`). Session projection, normalization cache, and view selection retain that identity (`powerpoint-session.ts:31-40`; `powerpoint-normalize.ts:250-280`; `powerpoint-view.ts:71-99,117-139`). Native-shaped and divergent-primary regressions pass in bridge/core/app suites. |

### Original P1 findings

| ID | Status | Fresh current evidence |
|---|---|---|
| **P1-01** — helper is not a true self-contained one-file payload | **FIXED at source** | Publish includes `--self-contained true`, `PublishSingleFile=true`, `PublishTrimmed=false`, and `IncludeNativeLibrariesForSelfExtract=true` in one command (`build-windows.ps1:22-31`). Builder packages only `ppt-probe.exe` (`electron-builder.yml:32-39`), and the workflow rejects missing exe/loose DLL output (`ppt-timer-build.yml:75-96`). Clean-Windows launch remains Stage 7. |
| **P1-02** — Windows workflow invokes POSIX-only CJS scripts | **FIXED** | Both shared packages call `node ../../scripts/build-cjs.mjs`; the Node script uses `rmSync`, `mkdirSync`, `writeFileSync`, and `spawnSync` (`scripts/build-cjs.mjs:8-28`). The real ordered CJS builds and both smokes passed locally. |
| **P1-03** — manifest entrypoint imports a raw Windows drive path | **FIXED** | The entrypoint imports the resolved module through `pathToFileURL(...).href` (`build-manifest.mjs:18-43`), and the real entrypoint seam is exercised in `build-manifest.test.ts:116-173`. |
| **P1-04** — forced helper termination is not confirmed | **FIXED** | Replacement polling waits a termination barrier; forced shutdown retains exit/close listeners until confirmed or a bounded `unconfirmed` diagnostic (`process-client.ts:108-123,292-356,358-395`). Delayed confirmed and bounded-unconfirmed restart/close cases pass in `process-client.test.ts`. |
| **P1-05** — Companion can recreate a native client after stop/quit | **FIXED** | `createPptNativeLifecycle` increments and rechecks a lifecycle epoch across the shared close before client creation (`companion/src/ppt-probe.ts:38-84`). The deterministic ensure/stop race and quit-gate regressions pass. |
| **P1-06** — Companion installer workflow omits app/viewer builds | **FIXED at source** | The workflow builds viewer/shared packages/application before Electron Builder and asserts clean-checkout outputs (`companion-build.yml:56-76`). Companion's full 165-test suite passed. Workflow execution remains Stage 7. |
| **P1-07** — persisted elapsed mode is not applied at host startup | **FIXED** | Main passes `currentSettings.timingMode` before host start (`main.ts:108-116`), host initializes from it before first projection (`session-host.ts:115-120`), and restart/first-live-projection coverage passes (`session-host.test.ts:119-151`). |
| **P1-08** — standalone pins an unsupported Electron line | **FIXED** | The app exactly pins Electron `43.2.0` and Electron Builder `26.11.1` (`apps/ppt-timer/package.json:23-27`), with matching lockfile/runtime policy tests. On 2026-07-28, Electron 43 is supported and scheduled for EOL on 2027-01-05; Electron supports its latest three stable majors ([Electron schedule](https://releases.electronjs.org/schedule), [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)). |

### Original P2 findings

| ID | Status | Fresh current evidence |
|---|---|---|
| **P2-01** — app/helper/artifact/tag versions are disconnected | **FIXED for the original finding** | App/installer/manifest/tag use `0.1.0-beta.1`; diagnostics uses `app.getVersion()` plus helper-emitted `productVersion`; helper informational metadata disables the Source Link revision suffix (`ppt-probe.csproj:15-17`; `build-windows.ps1:31`); the workflow independently reads published PE metadata before exposing the verified helper version to manifest generation (`ppt-timer-build.yml:98-118`; `build-manifest.mjs:66-75`). The separate misuse of prerelease SemVer for numeric `FileVersion` was raised as NEW-P1-03 below and is now fixed by the closeout addendum. |
| **P2-02** — missing title can expose full drive/UNC path | **FIXED** | Canonical snapshot compatibility remains unchanged, while standalone projection basenames the filename fallback (`powerpoint-view.ts:55-69,143-149`). Drive/UNC regressions pass in `powerpoint-view.test.ts`; renderer uses the sanitized projection. |
| **P2-03** — display movement/manual resize corrupt preset semantics | **FIXED** | Display move preserves the preset; manual resize marks `custom`; programmatic resize suppression remains explicit. Controllers no longer keep a launch-time settings copy: every view/action reads `getSettings()` (`controllers.ts:23-29,41-60`). The manual resize → Custom view → later action → fresh controller sequence passes in `controllers.test.ts:87-111`. |
| **P2-04** — multiple-process warning depends on COM HWND/PID lookup | **FIXED** | The helper initializes mismatch from `processCount > 1` before optional HWND/PID lookup and ORs any resolved PID mismatch (`Program.cs:85-97,119-130`). Validator and host regressions pass. |
| **P2-05** — workflow tests substitute string checks for package seams | **FIXED at source/CI definition** | The Windows lane runs shared/app checks, ordered CJS builds, helper publish, installer, manifest, PE metadata verification, and real unpacked/ASAR inspection (`ppt-timer-build.yml:40-176`). It verifies exactly one helper, required runtime packages, excluded build-only code, and forbidden product assets. Actual workflow/package execution remains Stage 7. |

### Previously new P1 findings

| ID | Status | Fresh current evidence |
|---|---|---|
| **NEW-P1-01** — packaged app trusts dev renderer/helper overrides | **FIXED** | `selectLaunchTargets` returns only `{rendererUrl:null}` for packaged mode and permits only the exact launcher-owned `http://localhost:5173` renderer in development (`launch-policy.ts:6-28`). Main applies this policy before helper discovery and renderer load (`main.ts:108-121,231-235`). Packaged/dev/adversarial URL cases pass in `launch-policy.test.ts`. |
| **NEW-P1-02** — root workflows use Node 20 with Electron requiring Node >=22.12 | **FIXED** | Every root-install workflow now uses exact Node `22.12.0`: rebuild guardrails, Companion, both Controller jobs, and standalone (`rebuild-guardrails.yml:27-32`; `companion-build.yml:25-30`; `controller-build.yml:34-39,68-73`; `ppt-timer-build.yml:24-29`). CI-runtime/lockfile parity coverage passes in the app suite. |

## Findings raised by this final audit — closed by closeout addendum

### NEW-P1-03 — Prerelease SemVer is used as the numeric Windows PE `FileVersion` — **FIXED**

**Stable signature:** `P1|packages/ppt-bridge/scripts/build-windows.ps1|prerelease SemVer passed as PE FileVersion and exact-matched by workflow|H6-versioning`

The following evidence and impact record the original audit-time defect and are superseded by the closeout addendum.

**Original audit evidence**

- The standalone package version is `0.1.0-beta.1` (`apps/ppt-timer/package.json:4`).
- The helper build reads that string and passes the same value to `Version`, `FileVersion`, and `InformationalVersion` (`packages/ppt-bridge/scripts/build-windows.ps1:5-13,31`).
- The Windows workflow reads the published PE `ProductVersion` and `FileVersion` and requires both fields to equal `0.1.0-beta.1` exactly (`.github/workflows/ppt-timer-build.yml:98-118`).
- Microsoft specifies that Windows assembly file versions use `Major.Minor.Build.Revision`; Windows expects that four-part numeric format and raises a warning for nonconforming values ([Microsoft .NET versioning guidance](https://learn.microsoft.com/en-us/dotnet/standard/library-guidance/versioning#assembly-file-version)). A prerelease suffix belongs in informational/product version, not the numeric file version.
- The local tests assert only the source strings (`native-build-scripts.test.ts:105-118,136-155`). This host has no `dotnet`, and the required Windows publish/PE inspection was intentionally not run.

**Impact**

The source defines a nonconforming PE file-version contract and then makes the artifact workflow depend on exact prerelease-string equality. Depending on SDK/resource normalization, the publish can warn and the PE verification can reject an otherwise valid helper, or the artifact can carry ambiguous/nonstandard file-version metadata. This is a Windows packaging/release blocker, not merely missing Stage 7 evidence.

**Required correction/evidence — satisfied at source**

Derive a numeric file version (for example `0.1.0.1`) separately from the product/informational SemVer; retain `0.1.0-beta.1` for package, tag, manifest, helper `productVersion`, and PE product/informational version. Verify each PE field against its appropriate representation, add a source-level mapping test, then run the real Windows publish/PE check in Stage 7.

### NEW-P2-01 — The complete baseline diff fails the repository whitespace gate — **FIXED**

**Stable signature:** `P2|apps/ppt-timer/src/main/config.ts|extra blank line at EOF fails git diff --check|source-hygiene`

The following evidence and impact record the original audit-time defect and are superseded by the closeout addendum.

**Original audit evidence**

Fresh command:

```text
git diff --check fceb200 -- .
apps/ppt-timer/src/main/config.ts:6: new blank line at EOF.
```

`config.ts` contains an additional blank line after the final export. The repository's PR workflow executes a diff whitespace check, so the complete current source tree is not gate-clean.

**Impact**

No runtime behavior changes, but source acceptance and the PR whitespace lane are red.

**Required correction/evidence — satisfied at source**

Remove the extra blank line and rerun `git diff --check fceb200 -- .`.

## New P0/P1 regression scan

No additional new P0/P1 was found across:

- native COM probing, protocol validation, explicit-primary association, failure ordering, and stale-time clearing;
- process framing, one-in-flight polling, generation isolation, restart backoff, confirmed/bounded-unconfirmed termination, and close idempotence;
- presentation normalization/reducer/view precedence and Companion compatibility adapters;
- Companion ensure/stop/quit ordering and existing C1-C16/D1-D12 event behavior;
- standalone local-only renderer, sandbox/preload/closed-union IPC, packaged launch policy, navigation/popups, settings, placement, diagnostics redaction, and renderer revision ordering;
- package dependency boundaries, CJS portability/order, NSIS identity/uninstall policy, manifest/checksum source, helper packaging path, Node workflow engines, and Electron support status.

## Fresh lightweight local validation

No downloads or disk-heavy packaging were performed.

| Command | Result |
|---|---:|
| `npm run test --workspace @ontime/presentation-core` | **PASS** — 105 tests |
| `npm run test --workspace @ontime/ppt-bridge` | **PASS** — 56 tests |
| `npm run test --workspace apps/ppt-timer` | **PASS** — 174 tests |
| `npm run test --workspace ontime-companion` | **PASS** — 165 tests |
| `npm run test --workspace frontend -- src/hooks/useTimerEngine.test.tsx src/__tests__/snapshotStale.test.ts` | **PASS** — 9 tests |
| `npm run typecheck --workspace @ontime/presentation-core` | **PASS** — no diagnostics |
| `npm run typecheck --workspace @ontime/ppt-bridge` | **PASS** — no diagnostics |
| `npm run typecheck --workspace apps/ppt-timer` | **PASS** — no diagnostics |
| `npm run boundaries` | **PASS** — 258 modules / 614 dependencies |
| `npm run guardrails:static` | **PASS** |
| ordered core/bridge `build:cjs` + `smoke:cjs` | **PASS** |
| `npm run build --workspace apps/ppt-timer` | **PASS** — main/preload compile and renderer production build |
| `git diff --check fceb200 -- .` | **PASS** — exit 0, no diagnostics in closeout rerun |

The Companion run logged one sandbox `EPERM` attempt against the host Application Support cache during an unrelated cache test; all 165 tests passed and the tested assertions completed. This is not a PowerPoint timer finding.

## Remaining Stage 7 Windows/Office/installer gates — pending, not source defects

With the source findings above corrected, the following still require real Windows execution as Stage 7 evidence, not source-defect remediation:

1. Run the net10 win-x64 publish, inspect all outputs, verify the independently derived numeric PE file version plus exact product/informational SemVer, and launch the helper on a clean Windows machine without a machine-wide .NET runtime.
2. Execute `ppt-timer-build.yml`, `companion-build.yml`, Controller builds, and rebuild guardrails from clean checkouts.
3. Inspect the real installer/unpacked/ASAR payload: exactly one runnable helper, both runtime packages, no forbidden product assets or build-only code, and correct checksum/manifest.
4. Run Microsoft 365 COM journeys: not running, no slideshow, standard show/Presenter View, play/pause/resume/seek/end/replay, slide changes, typed partial-COM failures, crash/timeout/restart, and divergent multiple-video explicit-primary association.
5. Test Office x64 and x86; narrow the beta support statement to x64 if x86 is not proven.
6. Run Companion and standalone concurrently for at least 30 minutes; inspect OS processes through crash, timeout, mode change, close, quit, and `unconfirmed` termination paths.
7. Test clean Windows 11 and supported Windows 10 ESU/LTSC fresh install/launch, same-version repair, in-place upgrade with settings retained, normal uninstall preserving user data, and reinstall recovery.
8. Exercise real mixed-DPI/multi-display behavior: move, manual resize, presets, display removal/metric change, timing mode, always-on-top, close/restart, and the P2-03 composition journey.
9. Confirm final website URL, privacy wording, support statement, checksum delivery, and named-tester instructions. Keeping the CTA hidden while OQ-1 remains unresolved is source-conformant.

## Stage 8 signing — separate

The internal beta artifact is intentionally unsigned. Publisher identity, Authenticode/RFC 3161 signing, post-sign verification of helper/app/uninstaller/installer, antivirus and SmartScreen evidence, and proof that published bytes equal tested bytes remain Stage 8 public-release work. They do not change the present source finding statuses.

## Final disposition

- **Enumerated finding remediation:** **PASS** — 18/18 FIXED at source.
- **Canonical ownership / two consumers:** **PASS**.
- **Companion automated preservation:** **PASS** — full 165-test suite plus canonical shared-package tests green.
- **Standalone runtime/security/settings/diagnostics source:** **PASS**.
- **H6 source surface:** **IMPLEMENTED AND SOURCE-ACCEPTED**.
- **New P0 findings:** none.
- **New P1 findings:** none remaining; **NEW-P1-03 FIXED**.
- **New P2 findings:** none remaining; **NEW-P2-01 FIXED**.
- **Local regression evidence:** focused version/workflow tests and the required whitespace gate are green.
- **Stage 7 Windows gates:** pending evidence and separate from source acceptance.
- **Stage 8 signing:** pending and separate.
- **Final source acceptance:** **PASS / GO**.
