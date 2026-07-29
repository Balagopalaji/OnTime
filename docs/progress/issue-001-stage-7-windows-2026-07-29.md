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
