# ISSUE-001 Stage 7 Windows execution record — 2026-07-29

Branch: `backlog/ISSUE-001-standalone-ppt-timer`
HEAD: `d1f4d1971664f85b92884902ba7575f4219f344d`
Host: Windows 11 (`10.0.26200`)

This is an in-progress execution record. No installer or live PowerPoint acceptance result is claimed until the automated gates complete.

## Preflight

| Command | Result |
| --- | --- |
| `git fetch origin` | PASS |
| `git switch backlog/ISSUE-001-standalone-ppt-timer` | PASS |
| `git pull --ff-only` | PASS — already up to date |
| `git merge-base --is-ancestor d1f4d19 HEAD` | PASS |
| `git status --short --branch` before tool setup | PASS — clean |
| host `node --version` | FAIL for workflow requirement — `v24.12.0` |
| host `dotnet --list-sdks` | FAIL for workflow requirement — only `6.0.428` |

Local, checksum-verified toolchains were provisioned under ignored workspace directories so the host installations were not replaced:

| Command | Result |
| --- | --- |
| Node `v22.12.0` x64 archive SHA-256 verification | PASS — `2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8` |
| `.tools\\node-v22.12.0-win-x64\\node.exe --version` | PASS — `v22.12.0` |
| `.tools\\node-v22.12.0-win-x64\\npm.cmd --version` | PASS — `10.9.0` |
| .NET 10.0.302 x64 SDK archive SHA-512 calculation | PASS — `7D170ED75FA9AF34C00646621D92011DBD71943952E2787CD15DF9BE78E6452B55DADEF34D7EFF77B802E6AF4959E071A55855AC649AFEAC70901C3A2A258716` |
| `.tools\\dotnet-10.0.302\\dotnet.exe --list-sdks` | PASS — `10.0.302` |

## Dependency installation

The initial `npm ci` attempt failed because the months-old checkout contained a locked `frontend/node_modules/.vite-temp` (`EPERM rmdir`) and npm could not write the default user cache. No Node/Electron process was running. The stale ignored dependency folders `frontend/node_modules`, `companion/node_modules`, and `controller/node_modules` were removed, then the command was retried using checkout-local `.npm-cache`.

| Command | Result |
| --- | --- |
| `npm ci` with Node 22.12 and local cache, sandboxed | FAIL — registry fetches denied (`EACCES`); npm reported secondary `Exit handler never called!` |
| `npm ci` with Node 22.12 and local cache, registry access authorized | PASS — 1,572 packages added; 81 dependency audit findings reported by npm |

The `EBADENGINE` notices for repository dependency `watskeburt@5.0.3` (`^20.12 || ^22.13 || >=24.0`) are warnings only; the workflow-pinned Node 22.12 installation completed successfully.

## Reproducible Windows defect found before source edit

Command executed with the required local Node 22.12/.NET 10 PATH:

```powershell
npm run ci-local
```

Result: **FAIL** at `npm run boundaries`; all subsequent `ci-local` gates were skipped. Exact final error:

```text
spawnSync C:\\Dev\\OnTime\\node_modules\\.bin\\depcruise.cmd EINVAL
```

Evidence:

```powershell
node node_modules/dependency-cruiser/bin/dependency-cruise.mjs --version
# PASS: 17.4.3
node_modules/.bin/depcruise.cmd --version
# PASS: 17.4.3
```

`scripts/check-dependency-boundaries.mjs` selects `node_modules/.bin/depcruise.cmd` on Windows and calls `spawnSync` without `shell: true`. Node cannot execute a `.cmd` shim directly in that configuration, although the shim itself is valid.

Proposed minimal fix, applied only after this record: add `shell: process.platform === 'win32'` to that one `spawnSync` options object. This preserves the existing direct executable behavior on non-Windows hosts and enables the already-selected Windows shim; no dependency, guardrail, or product behavior changes.

## Follow-up Windows test-discovery defect

After the launcher fix, `ci-local` advanced through the boundary, presentation-core, and PPT bridge typecheck gates but failed in the PPT bridge test package command:

```text
vitest run test/*.test.ts
No test files found, exiting with code 1
filter: test/*.test.ts
```

The four matching files exist under `packages/ppt-bridge/test/`. On this Windows host with the lockfile-installed Vitest `4.0.10`, `vitest run test/*.test.ts` discovers none, while `vitest run test` discovers all four suites. The minimal script correction is therefore `vitest run test`, preserving the intended test directory and avoiding the Windows glob-filter failure. This correction is applied before re-running the package suite.

That direct directory run discovered 56 tests and reported one separate timing-sensitive failure in `process-client.test.ts` (`expected process_exit`, received `timeout`). It is not changed at this point; it will be repeated after test discovery is repaired to establish reproducibility.

The repaired package test command was repeated and the same case failed again. The test creates a fresh Node fake helper that immediately exits, but configures `pollTimeoutMs: 100`; on this Windows host, helper process creation plus the poll handshake exceeded that test-only window. The bridge runtime default remains `8,000 ms`; this is not an observed product timeout. Proposed minimal fix: raise only this test fixture's `pollTimeoutMs` to `1,000`, preserving its `process_exit` and bounded-restart assertions while allowing normal Windows child-process startup.

## Follow-up Windows CI-parity assertion defect

With the preceding two fixes, `ci-local` passed through all presentation-core and PPT bridge gates and discovered 173 of 174 PPT timer tests. The remaining test read `.github/workflows/companion-build.yml` and searched for the LF-only literal `npm run build\\n`. Git materializes this workflow with CRLF line endings on this Windows checkout, so the lookup returned `-1` even though the workflow contains the required ordered lines `npm run build:viewer`, `npm run build`, then `npx --no-install electron-builder --publish never`.

Proposed minimal fix: replace that LF-specific `indexOf` with a CRLF-tolerant `search(/npm run build\\r?\\n/)`. This changes only the parity test's text matching and does not alter the Companion workflow or its build pipeline.

## Follow-up Windows CJS-builder test timeout

The next full `ci-local` run reached the Companion regression gate after all standalone gates passed, but the PPT bridge CJS temporary-package test exceeded Vitest's default `5,000 ms` limit (the underlying CJS builder took `7,704 ms` under the concurrent Windows run). The test invokes TypeScript in a newly created temporary package and validates the emitted files; it does not assert an execution-performance contract.

Proposed minimal fix: retain the existing test body and give this one known host/toolchain-sensitive test a `15,000 ms` Vitest timeout. Product code, build scripts, and global test timeouts remain unchanged.

## Follow-up Windows Companion cache-fixture defect

The subsequent `ci-local` run passed every standalone check and 164 of 165 Companion tests. `load: corrupted cache is backed up and old backups trimmed to 3` found five backups instead of three. The production cache code uses `path.join` for generated backup paths; on Windows it produces backslashes. The test's in-memory filesystem seeded POSIX-slash keys but compared and enumerated raw paths, so its `readdir` prefix did not recognize the seeded backups and the trim operation had nothing to delete.

Proposed minimal fix: normalize slash direction only within the test fake filesystem at its read/write/copy/unlink/readdir boundary. This makes the fake represent a case-preserving Windows/POSIX path store consistently; no production cache behavior changes.

An initial narrower attempt used native `path.join` only for the seeded backup files. It was insufficient because `CACHE_FILE` remained `/cache/rooms.json`: on Windows, `path.dirname` keeps `/cache` while `path.join` produces `\\cache\\...`, leaving the fake's `/cache\\` enumeration prefix inconsistent. The final minimal fixture correction is to define `CACHE_FILE` from the native process-root path, making every fake cache path (including the directory prefix) consistent on both platforms.

## Reproducible Stage 7 packaged-helper defect

The canonical helper publish passed its one-file and PE-version gates. Packaging then produced the requested NSIS installer and manifest, but the workflow's real packaged-content verification failed:

```text
Expected exactly one packaged ppt-probe.exe, found 3
```

The intended helper exists at `resources/bin/ppt-probe.exe`. Electron-builder also unpacked two generated copies from the workspace runtime dependency: `node_modules/@ontime/ppt-bridge/bin/win-x64/ppt-probe.exe` and `node_modules/@ontime/ppt-bridge/native/windows-ppt-probe/bin/Release/net10.0-windows/win-x64/ppt-probe.exe`.

Proposed minimal fix: retain the runtime package's `dist-cjs` files but exclude only `node_modules/@ontime/ppt-bridge/bin/**` and `node_modules/@ontime/ppt-bridge/native/**` in `electron-builder.yml`. The canonical extra-resource remains the single packaged executable. Add a static config assertion for those two exclusions, rebuild the installer, and repeat the actual resource/ASAR gate.

After that rebuild, the single-helper count passed. The ASAR gate then falsely reported the required CJS entrypoints absent. Direct listing proved they are present, but the pinned `asar` CLI prints Windows backslashes while the workflow compares forward-slash path literals. Proposed minimal fix: normalize the `asar list` entries with `-replace '\\', '/'` immediately after listing, before the existing required/forbidden path checks. This changes verification representation only; no package contents change.

## Completed Stage 7 automated and installer evidence

| Command / verification | Result |
| --- | --- |
| `npm run ci-local` (final post-fix run) | PASS — all listed guardrail, typecheck, CJS smoke, Companion, frontend, and whitespace checks |
| `packages/ppt-bridge/scripts/build-windows.ps1` with local .NET 10 | PASS — published `packages/ppt-bridge/bin/win-x64/ppt-probe.exe` |
| Helper output inspection | PASS — only `ppt-probe.exe` plus PDB, no loose DLL; executable is 73,529,055 bytes |
| Helper PE verification | PASS — ProductVersion `0.1.0-beta.1`, FileVersion `0.1.0.1` |
| `npm run dist` (initial) | PASS — installer produced; first sandbox attempt was expectedly blocked from electron-builder download, authorized retry passed |
| `npm run manifest` with workflow-carried verified version | PASS — checksum and `build.manifest.json` produced |
| Initial actual packaged-content check | FAIL — three helpers; remediated above |
| Rebuilt `npm run dist`, `npm run manifest`, and actual packaged-content check | PASS — exactly one helper; both required CJS entrypoints present; no build-manifest or forbidden assets |
| Installer checksum / manifest cross-check | PASS — `8498a8f3dc5634bea422e7662150c195fb89ebdd236b5a99c45b397493d95bcd` |
| NSIS silent install | PASS — application installed at `%LOCALAPPDATA%\\Programs\\OnTime PowerPoint Video Timer` |
| Installed executable launch | PASS — `OnTime PowerPoint Video Timer.exe` remained running after five seconds |
| S-024 close cleanup | PASS — after the window was closed, neither the timer process nor `ppt-probe` remained |

Final artifact:

`apps/ppt-timer/dist_out/OnTime-PowerPoint-Video-Timer-0.1.0-beta.1-win-x64-setup.exe` (126,431,441 bytes).

## Runtime acceptance status

The installer and process-launch portion of S-030 has passed. At launch no `POWERPNT` process was present, but this command-session cannot inspect the rendered Electron state, so S-003 is not asserted. This machine has not supplied a Microsoft 365 PowerPoint deck with embedded media or a multi-display/mixed-DPI setup. Therefore S-001--S-017 visual/state/video cases, S-020--S-023 display/settings cases, S-025--S-027 diagnostics/recovery, S-029 Companion coexistence, and S-031--S-032 upgrade/uninstall preservation remain **not run**, not failed. The installed app is left available for interactive continuation; no destructive upgrade/uninstall test was performed.

## Pending

- Re-run `npm run ci-local` after the minimal Windows launcher fix.
- Run each explicit `ppt-timer-build.yml` gate, build/publish/inspect the helper, package the app, generate checksum and manifest, and inspect helper/ASAR contents.
- Install the produced NSIS artifact and run the manual PowerPoint, multiple-display/DPI, recovery/diagnostics, installer lifecycle, and Companion coexistence cases. Those cases need Microsoft 365 PowerPoint, suitable video decks, and at least two displays; no outcome has yet been recorded.

## Continuation handoff — 2026-07-30

This section supersedes only the stale “Pending” statements above where it says so. The earlier entries remain the evidence record for the initial Windows execution loop.

### Current checkpoint

- Branch: `backlog/ISSUE-001-standalone-ppt-timer`.
- Current committed HEAD: `8f85fa7 fix(ppt-timer): Elevate presenter overlay level`.
- The branch contains follow-on Windows/runtime fixes after the initial Stage 7 checkpoint. Do not reset or recreate the checkout from the old `d1f4d19` entry.
- Expected ignored local build/runtime folders: `.dotnet-cli/`, `.npm-cache/`, `.tools/`, and `packages/ppt-bridge/native/windows-ppt-probe/bin/` and `obj/`. Preserve them. They contain the local Node 22.12, .NET 10, Electron runtime workaround, caches, and native build output.

### Work completed after the initial record

| Area | Commits | Result |
| --- | --- | --- |
| Multi-video state and focus selection | `c74b83d`, `502a800`, `1293b7e` | Standalone projection now exposes every video. The main timer follows the most recently started still-playing video, with deterministic fallback. |
| Renderer rows and smooth countdown | `7e50910`, `60a0261`, `05d796a` | Large timer and video rows share the same focus tile; local interpolation is anchored to accepted measurements and snaps on corrections. |
| Timer-only UI | `678a6bd`, `19d672a` | Default view is timer plus video rows and an accessible gear. Settings holds only Remaining/Elapsed, Always on top, and Copy diagnostics. The old Electron menu is removed. |
| Windows overlay diagnostics | `4fffb78`, `5fc5328`, `43b31a6`, `629b610` | Debug-only diagnostics cover window lifecycle, bounds/display/DPI, Electron AOT state, and selected Windows window messages. `PPT_TIMER_DEBUG=1` is the only opt-in. The final closed-only cleanup prevents the earlier diagnostic-only destroyed-window crash. |
| Presenter View AOT repair | `8f85fa7` | AOT now uses Electron's Windows `pop-up-menu` level when enabled and `normal` when disabled. It is applied while the window is hidden at startup and by the existing settings toggle. |

### Confirmed Presenter View defect and final repair

User reproduction on this Windows 11 / Microsoft PowerPoint host:

1. With Always on top checked, the timer behaved normally above standard PowerPoint editing windows.
2. In PowerPoint Presenter View, clicking the timer made it disappear behind Presenter View. It could not be restored by directly Alt-Tabbing to it.
3. Alt-Tabbing first to another application and then to the timer restored it.

The diagnostic capture was conclusive. At direct Presenter View → timer activation, Windows delivered `WM_WINDOWPOSCHANGING`, activation, and `WM_WINDOWPOSCHANGED`; the focus snapshot then reported `alwaysOnTop=false`. There was **no** renderer/main AOT request, `WM_STYLECHANGED`, or Electron `always-on-top-changed` event. A later ordinary application → timer activation restored `alwaysOnTop=true`.

This rules out PowerPoint media polling and a user settings toggle as the immediate cause. The app had been using Electron's default `floating` AOT level. Electron's Windows implementation can reorder that level beneath `Shell_TrayWnd` on activation; `pop-up-menu` is the lowest Electron level that avoids that behavior. Do not add focus-loop reassertion, `moveTop`, `moveAbove`, PowerPoint window lookup, or COM changes unless a new reproduction disproves this targeted repair.

The user manually retested the final installed build on 2026-07-30 and confirmed: **“ok that works now. Excellent!”** The timer remains interactive/draggable. Intentional trade-off: when AOT is enabled it can draw above the Windows taskbar, particularly if manually positioned there. This is acceptable unless product requirements later say otherwise.

### Diagnostic-hook false starts (do not repeat)

- `f2653eb` and `2e212f2` were intermediate attempts to dispose/re-arm debug message hooks around close/cancelled-close.
- A real field crash exposed the problem: `TypeError: Object has been destroyed` from `overlay-debug.js` while calling `unhookWindowMessage` after the BrowserWindow had been destroyed.
- `629b610` supersedes those attempts: cleanup occurs on `closed`; native unhook safely no-ops after destruction and JS listeners/timers are released. A debug launch-and-close smoke check passed afterward.

### Latest artifact and verification

- Latest installer: `apps/ppt-timer/dist_out/OnTime-PowerPoint-Video-Timer-0.1.0-beta.1-win-x64-setup.exe`.
- Latest installer SHA-256: `56a0f8114e23322b6418cc9e73b6463cc386813e370573881dcb822a8381fa2b`.
- It was silently installed successfully to `%LOCALAPPDATA%\\Programs\\OnTime PowerPoint Video Timer` and launched with `PPT_TIMER_DEBUG=1` for the passing Presenter View retest.
- `8f85fa7` focused verification: `overlay-debug.test.ts` 20/20, focused overlay/controller/settings tests 50/50, PPT timer typecheck PASS. The preceding `19d672a` run had `npm run ci-local` PASS all 27 stages. Do not claim a new full `ci-local` pass specifically for `8f85fa7` without running it.
- The current package build used the existing verified local Electron distribution (`.tools/electron-v43.2.0-win32-x64-unpacked`) through `electron-builder --config.electronDist=...`. This is a local Windows workaround for electron-builder's reproducible `EPERM` rename of `win-unpacked.tmp`; it is not a committed product configuration change.

### Next owner instructions

1. Read this record plus the current (non-archive) product/spec documents before changing source. Check `git status --short --branch` and preserve the expected ignored folders.
2. Treat the Presenter View AOT defect as **fixed and user-accepted**. If it regresses, first launch with `PPT_TIMER_DEBUG=1`, reproduce once, and use Copy diagnostics. Do not revert to `floating` or introduce automatic focus/z-order loops.
3. Continue the still-pending Stage 7 manual acceptance matrix: state transitions/video timing/multiple videos; settings; displays and mixed DPI; recovery/diagnostics; cleanup; installer upgrade/uninstall preservation; and Companion coexistence. Record every command and PASS/FAIL here.
4. If packaging again, use the local Node 22.12/.NET 10 toolchains and the existing `electronDist` workaround. Close only timer processes before silent install; do not terminate PowerPoint or Companion without an explicit need.
5. Keep source changes narrow. Before editing for a new issue, capture a reproducible Windows symptom and state the proposed minimal fix.

### Countdown/play-start issue — 2026-07-30

The next source issue is the standalone countdown becoming visibly erratic and
taking several seconds to begin after PowerPoint video playback starts. Sol
investigation traced both symptoms through the canonical path
`PowerPoint COM → Program.cs → bridge/session → normalization/projection → renderer`:

- The renderer's former measurement signature included elapsed/remaining on
  every row, so ordinary one-second COM movement re-anchored the local
  interpolation on every poll. Quantization and COM jitter therefore appeared
  as repeated snaps.
- The native helper rejected `CurrentPosition == 0` and only classified a
  player after a positive elapsed value existed. It also used the wrong
  `PpPlayerState` mapping (`2` as playing instead of `0`), delaying or
  misclassifying playback. PowerPoint's values are now named in the helper:
  `0=playing`, `1=paused`, `2=stopped`, `3=not ready`.

The narrow source repair is now applied:

- `Program.cs` accepts zero elapsed, resolves `Player.State` independently of
  elapsed availability, emits an immediate zero/full-duration playing anchor,
  and emits `playing=false` for recognized non-playing states.
- `apps/ppt-timer/src/renderer/playback-clock.ts` keeps independent per-video
  monotonic anchors. Newer playing views confirm the clock without resetting it;
  pause/stop/end, identity or duration changes, timing loss, or drift greater
  than 1,500 ms re-anchor. The existing 250 ms repaint cadence and 2,000 ms
  silent-helper safety freeze remain.
- Presenter View AOT code was not changed; the accepted `pop-up-menu` repair
  remains fixed.

Focused source verification after the repair:

| Command | Result |
| --- | --- |
| PPT bridge focused tests | PASS — 45 tests, including native enum/zero-anchor guards |
| Presentation-core focused tests | PASS — 111 tests |
| Standalone renderer + playback-clock tests | PASS — 87 tests |
| Standalone TypeScript typecheck | PASS |
| Native helper `.NET 10` Release build | PASS — 0 errors; existing NU1510 warning only |

Live Windows/PowerPoint acceptance is still required and has not been claimed.
The next manual cases are immediate play from zero, pause/resume, stopped-at-zero,
seek in both directions, replay, end, coarse/stuck COM readings, multiple
simultaneous videos, helper stall/recovery, and Companion coexistence. The
existing local CI lane is currently blocked before product tests by its
pre-existing static line-limit findings in `apps/ppt-timer/src/main/main.ts`
(405 lines) and `overlay-debug.ts` (413 lines); those are unrelated to this
timing repair.

### Dist rebuild and handoff ledger closeout — 2026-07-30

The updated countdown/play-start repair has been rebuilt into a Windows
installer. The ignored local tool folders and native `bin/obj` folders were
preserved, and Presenter View AOT remains the accepted `pop-up-menu` repair.

| Command / verification | Result |
| --- | --- |
| `packages/ppt-bridge/scripts/build-windows.ps1` with local .NET 10 | PASS — self-contained `ppt-probe.exe` rebuilt; existing NU1510 warning only |
| `npm run dist -- --config.electronDist=.tools/electron-v43.2.0-win32-x64-unpacked` | PASS — NSIS installer rebuilt with updated renderer and helper |
| Helper PE identity | PASS — ProductVersion `0.1.0-beta.1`, FileVersion `0.1.0.1` |
| `npm run manifest` with independently verified helper version | PASS |
| Packaged helper gate | PASS — exactly one helper at `resources/bin/ppt-probe.exe` |
| Packaged runtime gate | PASS — bridge/core `dist-cjs/index.js` entries present; forbidden assets absent |
| Installer SHA-256 | `24fa167e6253b51f6bd71d09e4a94a0a8f90a0228aad3975d9eac709a94e46ee` |

Final artifact:

`apps/ppt-timer/dist_out/OnTime-PowerPoint-Video-Timer-0.1.0-beta.1-win-x64-setup.exe`
(126,520,642 bytes). The package build used the existing local Electron
distribution workaround. Electron Builder's NSIS cache was redirected to the
permitted session temp directory because the global/workspace cache paths were
blocked in this environment; this is not a committed product configuration
change.

Automated handoff work is complete. Manual acceptance remains **not run**, not
failed: immediate play/countdown, pause/resume, stop/end, seek/replay, multiple
videos, helper stall/recovery, settings/displays, installer lifecycle, and
Companion coexistence still require the installed artifact and a live
PowerPoint/Windows environment.

### Countdown startup follow-up — 2026-07-30

The remaining startup symptom was traced to the standalone session's fixed
1,000 ms cadence. Polls do not overlap; while a synchronous COM read is in
flight, interval ticks are discarded. The renderer's 1,500 ms strict drift
threshold already suppresses visible deterministic-clock corrections for all
drift under one second (and an additional 500 ms beyond that), so it remains
unchanged.

The bounded follow-up repair is applied:

- `PowerPointSession` keeps the established `setInterval` behavior when no
  adaptive policy is supplied, preserving Companion behavior. Standalone can
  supply a completion-based adaptive policy without overlapping reads.
- The standalone host uses a 200 ms burst for up to 2 seconds after first media
  discovery, a playing transition, or elapsed movement over the canonical 200
  ms start-inference threshold. It then returns to 1,000 ms. There is no
  dependable cross-process PowerPoint play-button click signal in this path, so
  no global mouse hook or COM event sink was added.
- The initial immediate poll now owns the first adaptive follow-up, so the
  first 200 ms burst is not delayed by a pre-armed 1,000 ms timer. A
  standalone-only 350 ms provisional gate suppresses one ambiguous initial
  `ready → paused` flash; a confirmed `playing` or a stable pause is then
  published normally.
- Bridge diagnostics now record only helper polls slower than 250 ms as
  `poll_slow` (rate-limited to one event per helper generation/5 seconds),
  allowing the next live test to distinguish slow COM/helper work from
  scheduler latency without filling the report during normal polling.

Focused verification:

| Command | Result |
| --- | --- |
| PPT bridge and standalone typechecks after CJS dependency rebuild | PASS |
| Focused bridge/session, diagnostics, session-host, poll-policy, and playback-clock tests | PASS — 84 tests |
| `git diff --check` | PASS |

A read-only probe against the existing PowerPoint process found steady helper
polls of approximately 2–4 ms after attachment. One first COM-unavailable poll
took approximately 3,116 ms; three later cold helper starts were approximately
164 ms each. No slideshow/video was active, so this is diagnostic evidence only,
not live countdown acceptance. The next installed-build test should copy
diagnostics after immediate play from zero and after pause/resume; manual
acceptance remains not run.

### Latest dist build and launch — 2026-07-30

The adaptive polling/startup-gate changes were packaged from the current working
tree and the installed app was launched.

| Command / verification | Result |
| --- | --- |
| `npm run dist -- --config.electronDist=..\\..\\.tools\\electron-v43.2.0-win32-x64-unpacked` from `apps/ppt-timer` | PASS — production build, native helper packaging, and NSIS installer completed |
| Installer | `apps/ppt-timer/dist_out/OnTime-PowerPoint-Video-Timer-0.1.0-beta.1-win-x64-setup.exe` |
| Installer size | 126,522,599 bytes |
| Installer SHA-256 | `9c03045e789eb32f038cfadf6cc8bd2e712b8b695543de308680f0dff51247e4` |
| Installed app launch | PASS — installed executable started and remained running; `ppt-probe` child also present |

The build used the existing local Electron distribution workaround and a local
`.electron-builder-cache` because the default Electron Builder cache was blocked
by permissions. The cache is local build state, not a product configuration
change. Direct launch of `dist_out/win-unpacked` was blocked by Windows
Application Control; the installed executable was used for the launch check.
The silent installer command did not return before its 30-second shell timeout,
so do not treat installer replacement/upgrade as independently accepted from
this run; verify the installed file before live testing if that distinction
matters.

Automated verification remains PASS from the preceding checkpoint: bridge tests
61/61, standalone timer tests 291/291, typechecks, lint, production build, and
focused adaptive-polling/startup tests 84/84. Live PowerPoint acceptance remains
not run. The next owner should test immediate play from zero, pause/resume,
stop/end, seek/replay, multiple videos, helper stall/recovery, and Companion
coexistence while copying diagnostics for the first play and pause/resume cases.

### Final source closeout checkpoint — 2026-07-30

The current source was reviewed against the completed timing fixes. The prior
Windows package/install/launch evidence above remains historical and passed; the
current final source changes have not yet been rebuilt or packaged into a new
installer.

Current implementation summary:

- Renderer playback clocks keep persistent per-video paused/non-playing anchors.
  Repeated non-playing samples retain the frozen anchor, while an omitted timing
  sample cannot erase a usable baseline; the first usable timing is adopted only
  when no baseline exists.
- Missing timing preserves continuity when a baseline exists. Accepted playing
  clocks confirm without re-anchoring, and drift strictly greater than 1,500 ms
  corrects.
- Standalone polling is per-video adaptive: 200 ms bounded confirmation bursts,
  500 ms armed cadence for a nonterminal ready/paused video, and 1,000 ms for
  settled no-media/all-playing/all-terminal/failure states, with no overlapping
  reads.
- Movement episodes accumulate per video and trigger once after strict `>200 ms`
  movement; 1,000 ms of stationary evidence is required before movement can
  re-arm.
- Per-video contradictory non-playing status requires 350 ms before the
  standalone display changes; ended, scope/media changes, and large seeks remain
  immediate. The separate initial connecting/ready → paused presentation gate is
  also 350 ms.
- The standalone focus tracker keeps the visible headline stable through false
  pauses and selects the most-recently-started still-playing video with
  deterministic fallback. The helper primary identity remains canonical
  diagnostic metadata.
- A rejected/null poll resets the standalone adaptive policy state and returns
  to the 1,000 ms settled fallback; Companion retains its established polling
  behavior.

| Command / verification | Result |
| --- | --- |
| Complete PPT timer suite | PASS — 335 tests |
| Complete PPT bridge suite | PASS — 62 tests |
| PPT timer typecheck | PASS |
| PPT bridge typecheck | PASS |
| `git diff --check` | PASS — existing line-ending warnings only |
| Independent integrated review | No remaining actionable source findings |
| Live PowerPoint acceptance | NOT RUN |
| Current changes rebuilt/packaged into a new installer | NOT YET REBUILT/PACKAGED |

Live PowerPoint media, displays/mixed DPI, recovery, Companion coexistence,
and installer upgrade/uninstall acceptance remain not run. The earlier focused
counts and package evidence are preserved above as historical records.

### Native warm-cache and live helper-poll checkpoint — 2026-08-07

This checkpoint supersedes the current-state conclusions in the 2026-07-30
closeout while preserving those dated entries as historical evidence. The
current source was rebuilt, installed, and hash-verified before live testing.

Final timing and status semantics:

- A confirmed-playing renderer clock continues deterministically through sparse
  or delayed readings until known-duration zero, a confirmed non-playing
  transition, or actual timing unavailability. The removed 2,000 ms
  silent-helper freeze is not current behavior.
- One contradictory numeric outlier is ignored. A correction requires two
  advancing, mutually consistent samples beyond the strict 1,500 ms drift
  threshold.
- Status precedence is ended evidence, then explicit `playing`/`paused`, then
  inferred evidence. A contradictory pause/non-playing observation requires
  350 ms of stable evidence; confirmed playing cancels the pending pause, while
  ended, scope/media changes, and large seeks remain immediate.
- The native helper builds its ordered descriptor cache only after a complete
  cold v1 media scan. Warm complete-v1 sweeps read `Player.State` for every
  cached shape ID and read `CurrentPosition` on state transitions plus bounded
  rotating active and stopped/not-ready refreshes. Missing/invalid state,
  incomplete traversal, identity uncertainty, or other cache uncertainty falls
  back to a cold scan. Editing same-slide media descriptors after scope warming
  remains an experimental limitation, not accepted behavior.

Companion was closed during the measured live helper-poll runs:

| Slide media | Normal warm helper poll duration | Samples | Prior baseline |
| --- | --- | ---: | --- |
| 1 video | median 770 ms; range 439–783 ms | 6 | 1.1–2.0 s |
| 2 videos | median 923 ms; range 898–969 ms | 3 | 2.6–3.3 s |
| 5 videos | median 1,254 ms; range 1,221–1,607 ms | 6 | 5.2–5.6 s |

Separately, the user reported that behavior was much better. The diagnostic
values above are helper poll durations, not click-to-visible countdown latency;
click-to-visible start/pause latency was not instrumented or certified by this
log. No strict sub-one-second claim is made, including for the five-video case.
Two recorded values, `10,802,470 ms` and `651,594,668 ms`, were excluded because
they followed machine suspend/resume; they are artifacts, not normal helper poll
duration. Timeout/restart recovery was observed, but those observations are
recovery evidence rather than normal-duration samples and do not by themselves
complete S-027 or the broader recovery matrix.

| Artifact verification | Result |
| --- | --- |
| Current source rebuild | PASS |
| Installer installation used for live runs | PASS |
| Installer SHA-256 | `52c0d4d004d4fd7934c19a0f2e76d88bd3e8da2a4b3cf81f73068722b2dfdeab` |

This is bounded evidence for normal warm helper polling, not full Stage 7
acceptance or certified click-to-visible startup behavior. Companion coexistence
was not tested because Companion was closed.
The complete play/pause/end/seek/stall matrix, displays/mixed DPI, full
diagnostics/recovery acceptance, and installer upgrade/uninstall preservation
remain open. Historical installer hashes and checkpoints above remain valid for
the builds they identify.

### Follow-up stress test and new release blockers — 2026-08-07

The installed app was exercised again after a break in development. This run
found two release-blocking defects that supersede the earlier recommendation to
move directly to visual polish:

1. The app took long enough to become visible that repeated launch clicks opened
   multiple application instances. Startup also appeared CPU-heavy (the laptop
   fan increased). The current main process does not acquire an Electron
   single-instance lock. Before release, a second launch must focus/show the
   existing window rather than starting another app/helper, and cold/warm
   launch-to-visible time plus process/CPU/memory counts must be measured.
2. A single 33-second video on slide 8 repeatedly displayed approximately 24
   seconds at startup, counted from that value, and then jumped backward to
   approximately 30 seconds before continuing. This is not acceptable clock
   smoothing. Capture raw per-video observations and renderer
   anchor/pending-correction decisions for the sequence and add a deterministic
   regression before changing clock policy.

Other observations were positive:

- The five-video slide played smoothly.
- Moving away from and back to media slides showed `--:--` during transition and
  then restored the video durations.
- Closing PowerPoint produced "PowerPoint is not running".
- PowerPoint open without a slideshow produced "No slideshow running".
- Starting the existing controller alongside the standalone appeared fine in a
  short check; sustained two-consumer coexistence remains unaccepted.

The first app was closed before diagnostics were copied, so its launch and
duplicate-instance evidence is observational rather than present in the pasted
ring buffer. After reopening, generation 1 started normally and the copied
diagnostics included normal observations plus `poll_slow` samples of 330 ms,
737 ms, and 395 ms. Those values are helper poll durations, not user-action or
launch-to-visible timings, and do not explain the 24-to-30-second correction on
their own. The next diagnostic build should log sanitized raw per-video timing
and renderer correction decisions behind an explicit bounded debug mode.

The active sequencing and cross-product follow-up now live in
`docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`. Stabilize
these findings first; implement the frameless charcoal redesign only after the
M0 exit gate passes.

### M0/M1 corrective checkpoint — 2026-08-07

The next installed build resolved the main stress findings and supplied the
missing startup evidence. Diagnostics reported `app_ready elapsedMs=85` and
`window_ready elapsedMs=455`. Repeated launches emitted `second_instance`; a
packaged process check found one visible Electron window and one `ppt-probe`
after the second launcher exited. Closing the window removed both app and helper
processes.

Live media results:

- The 33-second single-video countdown no longer began near 24 seconds or jumped
  backward. It recognized play quickly and counted smoothly.
- One first visit to the two-video slide briefly showed `00:00` for each newly
  played video before correcting; later visits and the five-video slide were
  normal. Source review identified a precise native sequence: a cached terminal
  video could change from stopped/not-ready to `Player.State=Playing` while its
  first fresh `CurrentPosition` still contained the previous terminal value.
  End inference therefore emitted one false ended sample. The probe now replaces
  only that exact transition with a zero play anchor; stable terminal and
  uncached observations keep immediate end behavior. This correction is
  automated but still requires live replay on slide 6.

The standalone shell is now frameless and single-instance. The first visual
pass was still too large and exposed name/deck/slide metadata in the collapsed
surface. The refined M1 contract is `190 × 80` with only status and focused
time plus a bottom-right caret. Expansion is a two-stage, content-sized
tray with a 260-pixel minimum width: the complete video list first, then a
compact 28-pixel single-row action strip behind the gear disclosure. A widened
collapsed timer keeps that width while expanded; a narrower timer widens to the
readable minimum and collapse restores its exact custom geometry. The default is non-invasive:
multi-video slides remain collapsed. A persisted `Auto open` toggle defaults
off; when enabled, it opens a multi-video list without focusing the timer.
Every video is present, including the focused video, and the tray grows to all
rows without an internal scrollbar or visible row cap. Video-stage height is
`110 + 28 * videoCount` pixels; options add 30 pixels. An automatically opened
tray closes when the view returns to one or no videos. Manual expansion
transfers ownership to the operator and is not auto-collapsed; same-slide manual
dismissal is also respected. The gear and whole-tray caret remain separate at
the bottom-right in every expanded state. The action labels are
`Remaining`/`Elapsed`, `On top`, `Auto open`, and `Diagnostics`; they retain
intrinsic compact widths instead of stretching with the window. Minimize and
close live in independent top-right window chrome in every state and remain
invisible until hover or keyboard focus. Operational toggles use tooltips and
subtle borders; the window controls are borderless at rest. Focused metadata
headings, cards, and the nonfunctional remote placeholder remain absent.

| Verification | Result |
| --- | --- |
| PPT timer suite | PASS — 401 tests |
| PPT bridge suite | PASS — 72 tests |
| Both typechecks | PASS |
| Production application build | PASS |
| Static guardrails and dependency boundaries | PASS |
| `git diff --check` | PASS — line-ending warnings only |
| Current M1 source rebuild and silent installer replacement | PASS |
| Packaged staged-tray renderer review | PASS — multi-video view stayed collapsed by default; gear/caret remained bottom-right and the options strip stayed separate from hover-only top-right window controls |
| Current installer SHA-256 | `b056bc24bd35373a120a8e4f3393ee90365a38e2c9868a959cf82462994ffe7e` |
| Native transient-terminal correction live replay | PENDING |
| Mixed-DPI and near-work-area-edge expansion review | PENDING |

The current M1 geometry and terminal-position correction are rebuilt and
installed. Automatic collapse, manual-ownership persistence, and options-stage
appearance remain user acceptance items even though their state and DOM paths
are covered deterministically. Final Stage 7 acceptance still requires the
slide 6 first-play replay and the remaining mixed-DPI/work-area-edge checks.
