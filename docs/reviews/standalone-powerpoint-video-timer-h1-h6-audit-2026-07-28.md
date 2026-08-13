# Standalone PowerPoint Video Timer H1–H6 audit — 2026-07-28

## Verdict

**FAIL / NO-GO.** H1–H6 establish the intended shared architecture, but the core objective is not yet achieved safely enough for Stage 7 acceptance. Three P0 correctness defects can retain stale numeric timing or associate one video's label/status with another video's time. H6 also contains clean-Windows build/package failures, and helper shutdown still has orphan/race windows.

H6 is the intended **last implementation slice before Stage 7 validation**, and its file surface substantially matches Deep Plan Stage 6. It is **not an accepted final slice** in its present uncommitted form. A bounded H6 remediation slice is required before Windows/Office validation. Stage 7 evidence and Stage 8 signing remain separate from the defects below.

## Audit basis and scope

- Baseline: `fceb200`
- Committed implementation audited: `fceb200..4fd0827`
- Additional scope: complete uncommitted H6 working-tree diff present on 2026-07-28 (12 modified and 9 untracked files before this report)
- Current contracts used:
  - `docs/spec/standalone-powerpoint-video-timer.spec.md`
  - `docs/spec/standalone-powerpoint-video-timer.conformance.md`
  - `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`
  - current source-of-truth PRDs/architecture docs where relevant
- `docs/archive/**` was excluded and was not used as evidence.
- Review method: inspected git diff and current implementation/tests, not H1–H6 progress summaries.
- Source areas inspected: all `packages/ppt-bridge/**`; all `packages/presentation-core/**`; Companion bridge adapters, candidate/snapshot/shutdown wiring and relevant `main.ts` lifecycle; all `apps/ppt-timer/**`; native project/build script; workspace/package/guardrail changes; Electron Builder/NSIS config; both Windows workflows; checksum/manifest code.

### Severity convention

- **P0:** defeats the live timer's core correctness/safety contract; must be fixed before any Stage 7 run.
- **P1:** release/build/security/lifecycle blocker; must be fixed before an internal artifact is accepted.
- **P2:** material correctness, privacy, diagnostics, or evidence weakness that should be fixed before beta closeout.

## What is structurally achieved

- There is one current `Program.cs`: `packages/ppt-bridge/native/windows-ppt-probe/Program.cs`. Companion's build script copies the canonical binary; there is no second native source.
- Both consumers depend on `@ontime/ppt-bridge` and `@ontime/presentation-core`; the standalone does not import Companion/frontend/Firebase/cloud/sync runtime.
- The process client owns framing, size limits, validation, one-in-flight polling, generation isolation, timeout and restart; the presentation reducer/view owns the shared presentation behavior.
- The standalone's Electron boundary is appropriately narrow: `contextIsolation`, sandboxing, no Node integration, sender-checked closed-union IPC, denied in-window navigation/popups, and an external action that carries no renderer-supplied URL (`apps/ppt-timer/src/main/security.ts:13-20`, `ipc.ts:14-31`, `shared/ipc-contract.ts:104-130`, `main.ts:199-210`). No IPC/navigation P0/P1 was found.
- Settings writes are serialized and use same-directory temp-file then rename (`settings-store.ts:70-82`); diagnostics use a bounded structural event union rather than retaining raw stderr/document data (`diagnostics.ts:27-60,83-128`).
- Stable installer identity and uninstall policy are correctly declared: `appId: com.ontime.ppttimer`, assisted per-user NSIS, and `deleteAppDataOnUninstall: false` (`electron-builder.yml:11-15,50-61`). Actual upgrade/uninstall behavior still requires Stage 7 evidence.

## P0 findings

### P0-01 — A critical partial COM read is emitted as a valid observation and the warm cache can preserve old time forever

**Stable signature:** `P0|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|critical slideshow COM failure remains nominal observation`

**Evidence**

- `Program.Poll` declares `inSlideshow=true` from the slideshow-window count, but if `SlideShowWindows.Item(1)`, its `View`, the current show position, or the slide cannot be acquired, it returns the ordinary payload without a typed failure (`Program.cs:134-163,165-191`). `TryGetProp`/`TryInvoke` deliberately swallow COM exceptions (`Program.cs:402-436`).
- `normalizePowerPointPoll` restores `videos` from its warm cache *before* computing `hasVideoPayload` (`powerpoint-normalize.ts:137-172`). That makes the cached observation look present, resets `noVideoCount`, and carries prior scalar duration/elapsed/remaining (`powerpoint-normalize.ts:205-258`).
- The test suite explicitly locks in the indefinite behavior: `powerpoint-normalize.test.ts:351-390` says the no-payload poll refills cache, carries timing, and “never reaches” the clear threshold.

**Impact**

A transient or persistent COM failure after a live measurement can leave an old numeric time and playback state on screen indefinitely. This directly violates the no-stale constraint and S-002/S-013, and is a Deep Plan Stage 5 stop condition.

**Smallest fix**

Have the native helper emit a typed operational/COM failure when a slideshow is positively reported but its current window/view/position/slide cannot be acquired. Map that outcome to `unavailable` before normalization. Preserve the legacy warm-cache rule only for genuinely valid observations. Add a regression journey: live numeric observation → critical partial-COM failure → same-frame `unavailable` with `timeMs:null`.

### P0-02 — A running response with no valid presentation identity is accepted, then ignored while prior live state remains

**Stable signature:** `P0|packages/ppt-bridge/src/validate-response.ts|missing instanceId accepted as observation`

**Evidence**

- `validatePowerPointResponse` requires only a valid `state`; `instanceId` is sanitized as an optional non-negative integer, and a foreground/background payload without it remains `kind:'observation'` (`validate-response.ts:132-141,157-180,187-192`).
- The validator test proves this behavior with a foreground payload containing no `instanceId` and expects `observation` (`validate-response.test.ts:82-95`).
- The reducer then handles the observation by returning the existing state unchanged: `if (!result.instanceId) return { state, action:null }` (`powerpoint-machine.ts:240-243`). If that state contains live numeric timing, it stays visible.

**Impact**

A semantically invalid helper output does not take the required invalid-output failure path and can retain stale time, again violating S-002/S-013.

**Smallest fix**

At the canonical bridge boundary, require a positive `instanceId` for running foreground/background outcomes (including no-slideshow observations), returning `invalid_payload` when absent/invalid. This need not change Companion's legacy PowerShell result shape because that fallback does not use the native JSON validator. Add a live → missing/invalid-ID session-host regression.

### P0-03 — Helper-owned primary-video selection is not implemented end to end; label/status can belong to a different video than the displayed time

**Stable signature:** `P0|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|primary identity not emitted or projected`

**Evidence**

- The helper selects a `primaryVideo` and emits only its scalar timing (`Program.cs:212-287,300-317`). It never emits `primaryVideoId`, `primaryVideoIndex`, or `protocolVersion`, although the protocol accepts those optional fields (`protocol.ts:25-32`).
- `PowerPointSession.projectObservation` also drops primary/protocol/affinity metadata from the reducer input (`powerpoint-session.ts:31-48`).
- `SessionHost` reads a synthetic `primaryVideoId` only for diagnostics, but `projectHostView` passes only `{timingMode,multipleInstanceWarning}` to the view (`session-host.ts:66-100,163-182`).
- `selectPrimaryVideo` therefore chooses a locally inferred playing video or the first video (`powerpoint-view.ts:71-88`), while the same view prefers the helper's scalar timing over that selected video's timing (`powerpoint-view.ts:117-139`). The displayed `selectedVideoName`/ID can consequently describe video B while `timeMs` is scalar time from helper-selected video A.
- Tests provide false confidence: core tests inject `primaryVideoId`/index directly (`powerpoint-view.test.ts:372-400`), and host tests synthesize fields the native helper never emits (`session-host.test.ts:75-90`). There is no native fixture → validator → host projection test for divergent scalar/inferred selection.

**Impact**

The defining multiple-video promise in S-011 and the plan's “native helper owns primary identity; core fallback only for protocol v0” contract are not met. The standalone can show the wrong live timer association.

**Smallest fix**

Emit `protocolVersion` plus `primaryVideoId` (or a stable index) from `Program.Poll`; retain/clear that metadata in the host; pass it to `projectPowerPointView`. Add an end-to-end fixture in which helper scalar primary differs from elapsed-delta inference and assert label, status, diagnostics identity, and time all use the explicit helper choice.

## P1 findings

### P1-01 — The packaged helper is not actually a one-file self-contained payload

**Stable signature:** `P1|packages/ppt-bridge/scripts/build-windows.ps1|native runtime files omitted from installer`

**Evidence**

- Publish uses `--self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false` but not `IncludeNativeLibrariesForSelfExtract=true` (`build-windows.ps1:13-22`; no equivalent property exists in `ppt-probe.csproj:1-20`).
- Electron Builder copies **only** `ppt-probe.exe` (`electron-builder.yml:32-39`).
- Microsoft documents that native runtime binaries remain separate by default and that `IncludeNativeLibrariesForSelfExtract=true` is required to get one output file: [Microsoft Learn — single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview).
- `native-build-scripts.test.ts:13-59` checks only source strings, not actual publish contents or clean-runtime launchability.

**Impact**

The installer can omit required .NET native runtime files, so `ppt-probe.exe` may fail on the exact clean machine S-030 targets.

**Smallest fix**

Add `-p:IncludeNativeLibrariesForSelfExtract=true` and assert it in the script test, then inspect the publish directory and run the packaged helper on a clean Windows VM without .NET. Alternatively package the complete publish directory, but that conflicts with the intended exactly-one-helper payload.

### P1-02 — The Windows standalone workflow invokes POSIX-only CJS build scripts

**Stable signature:** `P1|packages/presentation-core/package.json|Windows npm build:cjs uses rm/printf`

**Evidence**

- Both shared packages define `build:cjs` with `rm -rf` and `printf ... >` (`packages/presentation-core/package.json:17`; `packages/ppt-bridge/package.json:17`).
- `ppt-timer-build.yml:39-42` invokes those scripts on `windows-latest`; `npm run dist` invokes them again through `apps/ppt-timer/package.json:9-15`.
- No repository `script-shell` override was found, so Windows npm uses its normal command shell, where these POSIX commands are unavailable.
- `ci-parity.test.ts:24-49` merely asserts that the command strings exist; it cannot prove they execute on Windows.

**Impact**

The H6 installer job fails before helper publish/package on a clean Windows runner.

**Smallest fix**

Replace shell-specific cleanup/package-file creation with a checked-in Node script using `fs.rmSync`, `fs.mkdirSync`, and `fs.writeFileSync`, and use it from both package scripts. Run the real workflow.

### P1-03 — The checksum/manifest entrypoint imports a raw Windows drive path as an ES module

**Stable signature:** `P1|apps/ppt-timer/scripts/build-manifest.mjs|raw Windows path passed to import()`

**Evidence**

- `build-manifest.mjs:26-34` calls `await import(join(appDir, 'dist/main/build-manifest.js'))`. On Windows this produces a `C:\...` specifier, which Node's ESM loader treats as an unsupported URL scheme.
- The Windows workflow necessarily executes that entrypoint (`ppt-timer-build.yml:65-67`).
- Node recommends converting filesystem paths with `url.pathToFileURL` for imports: [Node.js ESM documentation](https://nodejs.org/api/esm.html#urls).
- `build-manifest.test.ts` tests only pure helper functions and never executes the `.mjs` entrypoint (`build-manifest.test.ts:1-109`).

**Impact**

Even if packaging succeeds, checksum/manifest generation fails and the workflow cannot upload the required complete artifact set.

**Smallest fix**

Import `pathToFileURL` and use `await import(pathToFileURL(join(...)).href)`. Add a Windows entrypoint integration test or an injectable temp-output smoke, not only pure-function tests.

### P1-04 — Shared helper termination is not confirmed before restart/close resolves

**Stable signature:** `P1|packages/ppt-bridge/src/process-client.ts|SIGKILL followed by fixed 10ms sleep`

**Evidence**

- `failGeneration` removes all listeners and sends `SIGKILL` without awaiting `exit`/`close` before permitting a later generation (`process-client.ts:278-291`).
- `shutdownChild` waits for graceful exit, but on timeout sends `SIGKILL`, sleeps for 10 ms, removes listeners, and resolves without checking the kill result or observing process exit (`process-client.ts:294-319`).
- The forced-close test checks only that a diagnostic was emitted (`process-client.test.ts:107-117`), not that the child has exited.

**Impact**

A hung COM helper can outlive a reported close, and recovery can start a new generation while the old process still exists. That violates S-024/S-027 and the plan's no-orphan gate.

**Smallest fix**

Centralize forced termination and retain exit listeners until `exit`/`close` is observed, with a bounded post-kill timeout and explicit failure diagnostic. Do not start a replacement generation until termination settles or is explicitly declared unconfirmed. Add a fake child whose exit is delayed beyond 10 ms.

### P1-05 — Companion can recreate the native client after a stop/quit has begun

**Stable signature:** `P1|companion/src/ppt-probe.ts|ensure resumes after stop and creates client`

**Evidence**

- `stopPptProbeHelper` closes only the client currently stored and returns the current `pptNativeClosing` when none is stored (`ppt-probe.ts:98-111`).
- `ensurePptProbeHelper` can be awaiting `pptNativeClosing`; after it resumes it has no stopped flag or lifecycle epoch and creates/stores a new client (`ppt-probe.ts:114-132`). A mode-change or quit stop that ran while no client was stored cannot cancel that in-flight ensure.
- The only regression test runs on a non-Windows/no-helper path and proves two stop calls return the same already-resolved sentinel; it does not exercise ensure-vs-stop creation (`ppt-probe.test.ts:1-15`).

**Impact**

Polling can recreate a helper after shutdown gating has completed, allowing a late child to survive Companion exit or run after PowerPoint capability was disabled.

**Smallest fix**

Add a lifecycle generation/disabled epoch captured before the await and rechecked before client creation, or serialize ensure/stop under one owned lifecycle promise. Add an injected deterministic race test: blocked close/ensure → stop/quit → release → assert no client/child is created.

### P1-06 — The Companion installer workflow skips the application and viewer builds on a clean checkout

**Stable signature:** `P1|.github/workflows/companion-build.yml|electron-builder invoked before dist/viewer build`

**Evidence**

- The workflow goes from dependency/helper/ffprobe setup directly to `npx electron-builder --publish never` (`companion-build.yml:27-65`). Its own header notes that the lane needs TypeScript and viewer-bundle steps (`companion-build.yml:3-6`).
- Companion's entrypoint is `dist/main.js`; its intended `dist` script runs `build:viewer`, `build` (including shared CJS prebuild lifecycle), then Electron Builder (`companion/package.json:7-15`).
- Builder also expects `../frontend/dist-viewer` (`companion/package.json:43-58`). Those ignored outputs are absent on a clean checkout.
- The later hash step verifies only `ppt-probe.exe`, not `dist/main.js`, viewer assets, or launchability (`companion-build.yml:67-87`).

**Impact**

The Companion release workflow can fail entry validation or package stale/missing application/viewer content. It does not establish that existing Companion/Controller behavior is preserved in the shipped artifact.

**Smallest fix**

Invoke the package's build pipeline (for example `npm run dist -- --publish never` from `companion`) after the canonical helper build, or explicitly run the same ordered viewer/shared/TypeScript steps before Electron Builder. Add clean-checkout entry/viewer/package launch checks.

### P1-07 — Persisted elapsed mode is displayed in controls but not applied to the host at startup

**Stable signature:** `P1|apps/ppt-timer/src/main/session-host.ts|timingMode always initializes remaining`

**Evidence**

- Settings are loaded before host creation (`main.ts:55-76`), but `createSessionHost` receives no initial timing mode (`main.ts:108-112`).
- The host unconditionally initializes `timingMode='remaining'` (`session-host.ts:103-112`).
- Controllers render `settings.timingMode` (`controllers.ts:45-55`), so saved `elapsed` can appear selected while the projected numeric time remains `remaining` until another user action.
- Tests cover loading `elapsed` and separately toggling the host, but not restart wiring (`settings-store.test.ts:48-55`; `session-host.test.ts:143-153`; `controllers.test.ts:56-61`).

**Impact**

S-021 persistence is visibly inconsistent and can show the operator the opposite timing basis from the selected control.

**Smallest fix**

Pass `currentSettings.timingMode` into `createSessionHost`, or call `host.setTimingMode` before first projection/poll. Add a startup/restart integration test with saved `elapsed`.

### P1-08 — The release shell is pinned to an unsupported Electron line

**Stable signature:** `P1|apps/ppt-timer/package.json|electron 31.7.7 is end-of-life`

**Evidence**

- `apps/ppt-timer/package.json:23-26` pins Electron `31.7.7`.
- The Deep Plan says the old 31.x baseline is not an approved release stack and requires a supported pinned pair (`docs/plans/standalone-powerpoint-video-timer-2026-07-23.md:19`, Stage 0/tooling and packaging policy).
- Electron's official schedule shows Electron 31 reached end of life on 2025-01-14, and the support policy covers only the latest three stable majors: [Electron release schedule](https://releases.electronjs.org/schedule), [Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).
- The package-content test verifies exact pinning, not support/security status (`package-content.test.ts:79-91`).

**Impact**

A newly distributed Windows desktop app would ship an unsupported Chromium/Electron security surface, contrary to the release plan.

**Smallest fix**

Pin a currently supported Electron major and compatible Electron Builder version, refresh the lockfile, and rerun security, renderer, packaging, clean-VM, and upgrade smoke tests.

## P2 findings

### P2-01 — Artifact, diagnostics, helper, and release tag versions are disconnected

**Stable signature:** `P2|apps/ppt-timer/src/main/config.ts|split build identities`

**Evidence**

- Package/installer/manifest version source is still `0.0.0` (`apps/ppt-timer/package.json:2-5`).
- Diagnostics hard-code app `0.0.0-beta` and helper `ppt-probe/native` (`config.ts:7-9`); the native payload emits no product/protocol version.
- The workflow accepts any `ppt-timer-v*` tag without checking it against `package.json` (`ppt-timer-build.yml:7-10`).
- Stage 6 requires the package version as source and helper diagnostics to embed the same product build/version (`docs/plans/standalone-powerpoint-video-timer-2026-07-23.md:579-586`).

**Impact**

A tagged installer can carry a different internal/diagnostic identity, undermining support, manifest traceability, and upgrade evidence.

**Smallest fix**

Set a real beta package version, derive diagnostics from `app.getVersion()`/build metadata, embed the same product version plus protocol version in the helper, and fail CI unless the tag exactly matches the package version.

### P2-02 — Missing PowerPoint title can expose the full local/UNC path in the UI

**Stable signature:** `P2|packages/presentation-core/src/powerpoint-normalize.ts|filename used unbasenamed as title`

**Evidence**

- Normalization uses `result.filename?.trim()` as the `title` fallback (`powerpoint-normalize.ts:137`). The helper's `filename` is `ActivePresentation.FullName` (`Program.cs:155-160`).
- The projection basenames only `filenameBasename` but passes `title` unchanged (`powerpoint-view.ts:143-149`).
- Renderer prefers `state.title` over the safe basename (`renderer/view.ts:56-61`).

**Impact**

If `Name` is missing/unreadable while `FullName` succeeds, a user or network path can be shown, violating S-016. Diagnostics remain structurally redacted; this is a display privacy defect.

**Smallest fix**

Use a basename when filename supplies the standalone-visible title, or add a standalone-safe display-title projection while preserving any required Companion legacy cue semantics. Add drive-letter and UNC missing-title cases.

### P2-03 — Display movement and manual resizing corrupt size-preset semantics

**Stable signature:** `P2|apps/ppt-timer/src/main/controllers.ts|move display forces custom while resize does not`

**Evidence**

- `moveToDisplay` preserves width/height but persists `sizePreset:'custom'` (`controllers.ts:80-83`; `main.ts:125-130`), and the test explicitly blesses that coupling (`controllers.test.ts:77-82`).
- A user-originated `resized` event persists bounds only and never marks the preset custom (`main.ts:212-215`).

**Impact**

Moving an unchanged compact/large window loses its preset, while manually resizing can leave Compact/Large selected. Restarted settings and UI are internally inconsistent under S-021.

**Smallest fix**

Preserve the current preset on display move. Mark custom on user resize, with a suppression flag around programmatic preset/placement changes. Add event-level move, preset, manual-resize, and restart tests.

### P2-04 — Multiple-process warning is omitted when COM HWND/PID lookup fails

**Stable signature:** `P2|packages/ppt-bridge/native/windows-ppt-probe/Program.cs|processCount>1 warning depends on HWND`

**Evidence**

- The helper always emits `processCount` (`Program.cs:73-81`) but emits `affinityMismatch` only inside successful HWND → COM PID resolution (`Program.cs:105-130`).
- If HWND is unavailable while two PowerPoint processes are known, no mismatch flag is emitted.
- Standalone warning logic checks only `affinityMismatch===true`, not the already-emitted process count (`session-host.ts:57-62`).

**Impact**

The app can silently omit the S-012 wrong-deck warning even though the helper already knows multiple PowerPoint processes exist.

**Smallest fix**

Initialize `affinityMismatch = processCount > 1` before HWND lookup, then OR in COM/selected-PID mismatch when available. Keep `comPid` optional. Add a fixture with `processCount:2` and no HWND/comPid.

### P2-05 — Release workflow tests do not prove the commands or package seams they assert

**Stable signature:** `P2|apps/ppt-timer/src/main/ci-parity.test.ts|string-presence tests substitute for Windows execution`

**Evidence**

- The tag/manual artifact workflow runs app tests but does not run presentation-core or bridge typecheck/tests, despite Stage 6 requiring packages and app tests (`ppt-timer-build.yml:39-48`; plan Stage 6 acceptance at `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md:588-596`). Guardrails do not trigger on tags (`rebuild-guardrails.yml:3-16`).
- `ci-parity.test.ts:24-67`, `native-build-scripts.test.ts:13-59`, and `package-content.test.ts:24-91` mainly assert source/config strings. They passed while P1-01, P1-02, and P1-03 remained.
- ASAR inspection uses `npx --yes asar` without a direct exact dependency/no-install guarantee (`ppt-timer-build.yml:82-88`).

**Impact**

Green unit tests overstate H6 readiness and a release tag can execute untested shared-package code with mutable tool resolution.

**Smallest fix**

Run bridge/core typecheck/tests in the Windows artifact job; add Windows entrypoint/build smoke tests; pin the ASAR CLI directly and invoke it without installation; retain real unpacked-content checks.

## Conformance-matrix comparison

`docs/spec/standalone-powerpoint-video-timer.conformance.md` is not current closeout evidence for H6:

- It audits `cec0f35` plus H5 fixes, not HEAD `4fd0827` plus H6 (`conformance.md:3-10`).
- It still marks S-030–S-032 and the installer surface “Not-built” (`conformance.md:72-78,99`).
- Its D-1/D-2 “fixed” claims rely on synthetically supplied `primaryVideoId`/`protocolVersion`; the native helper never emits those fields and the render projection never consumes them (`conformance.md:121-125` versus P0-03).
- Its “P0 none / no stale numeric time” conclusion predates and misses the partial-COM and missing-identity paths above (`conformance.md:132-145`).

This is an evidence-staleness warning, not a request to edit that file during this read-only audit. Refresh the matrix only after remediation and Stage 7 evidence.

## Validation performed

Lightweight targeted suites only; no downloads, .NET publish, Electron packaging, or disk-heavy installer build:

| Command | Result |
|---|---:|
| `npm run test --workspace @ontime/ppt-bridge` | 36 passed |
| `npm run test --workspace @ontime/presentation-core` | 100 passed |
| `npm run test --workspace @ontime/ppt-timer` | 152 passed |
| `npm run test --workspace ontime-companion` | 164 passed |

These results establish local regression stability at tested seams, not Windows/native/package acceptance. The load-bearing false-confidence gaps are called out per finding.

## Windows-only pending evidence — not source-code defects

After all P0/P1 fixes, Stage 7 still needs recorded evidence for:

1. A real Windows `dotnet publish` of the net10 win-x64 helper; publish-directory inspection; byte/field parity against frozen native payload journeys.
2. Clean Windows 11 and supported Windows 10 ESU/LTSC install and launch with no machine-wide .NET runtime.
3. Real Microsoft 365 COM journeys: not running, no slideshow, standard show/Presenter View, play/pause/resume/seek/end/replay, slide changes, multi-video explicit selection, and helper crash/timeout/restart.
4. Office x64 and x86. If x86 fails, explicitly narrow private-beta support rather than implying coverage.
5. Actual installer/ASAR/resource inspection: one runnable helper, both runtime workspace packages, no forbidden Companion/frontend/viewer/cloud assets.
6. Companion and standalone simultaneous polling for at least 30 minutes, plus helper/PowerPoint crash recovery and OS process inspection proving no orphan helpers.
7. Clean-checkout execution of `ppt-timer-build.yml` and corrected `companion-build.yml`; checksum and manifest verification against the uploaded installer.
8. Same-version repair, newer-version upgrade with settings retained, normal uninstall removing program files while preserving userData, and reinstall recovery.
9. Mixed-DPI/multi-display placement, display removal/metrics changes, always-on-top, manual resize/preset semantics, and restart persistence through the rendered UI.
10. Final exact website URL/allowlist and privacy/support wording; keeping the CTA hidden while OQ-1 is unresolved is acceptable.

## Stage 8 signing — explicitly separate

The current internal artifact is intentionally unsigned, which the spec and Stage 6 allow. The following are **Stage 8 public-release evidence**, not present H6 code defects:

- trusted publisher identity and secret handling;
- SHA-256 Authenticode plus RFC 3161 timestamp on helper, app executable, uninstaller, and installer;
- post-sign verification, antivirus results, SmartScreen rollout expectations, and proof that the published bytes are the tested bytes.

## Final disposition

- **Core architecture direction:** PASS structurally — one native source and shared bridge/core with two consumers.
- **Core behavioral objective:** FAIL — P0 stale/misattributed timing paths remain.
- **Companion preservation:** automated assertions pass, but release workflow and lifecycle race evidence fail.
- **H6 Stage 6 completion:** FAIL — clean-Windows build/manifest/helper-package blockers remain.
- **Stage 7:** pending by design, and must not begin as acceptance testing until P0/P1 remediation is green.
- **Stage 8:** pending by design; signing is not the reason for this FAIL verdict.
