# Standalone PowerPoint Video Timer — Spec–Implementation Conformance Matrix

- **Spec:** `docs/spec/standalone-powerpoint-video-timer.spec.md` (scenarios S-001…S-033, Proposed Surface, Constraints, Open Questions OQ-1…OQ-4).
- **Implementation:** `apps/ppt-timer/**` (standalone Electron app); `packages/ppt-bridge/**` (native boundary + supervised client/session); `packages/presentation-core/**` (pure normalization + view projection); Companion integration in `companion/src/{presentation-candidate,presentation-snapshot,ppt-probe,ppt-quit-gate}.ts` + `companion/src/main.ts`.
- **Commit audited:** base `cec0f353de4e08401f59f8b6237f8c4823891c0e` ("feat: Add standalone PowerPoint video timer") **+ uncommitted H5 fixes for D-1/D-2/D-3** (working tree: modified `apps/ppt-timer/src/main/{main,session-host,session-host.test,controllers.test}.ts` + `apps/ppt-timer/src/renderer/{main,main.test}.ts`; this conformance doc is untracked). Only D-1/D-2/D-3 and their dependent rows were re-audited against those uncommitted changes; all other rows are unchanged from the prior (cec0f353, clean) audit.
- **Audit mode:** independent spec-conformance only. No implementation code was edited, no tests were written, no commit/push/issue-state change was made. Tests were **run** (not inferred from progress-doc summaries).

Legend: ✅ Conformed (evidence matches the requirement) · ⚠️ Diverged (evidence conflicts — both sides stated) · ❌ Not-built (no evidence found).

Scope marker in the **H** column: **H5** = runnable standalone app (Deep-Plan Stage 5); **H6** = installer / private-beta / public-release (Deep-Plan Stages 6–8). Per `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md` and `docs/reviews/standalone-powerpoint-video-timer-readiness-2026-07-27.md`, H6 is explicitly out of the H5 work package.

## Runtime-evidence caveat (applies to every Windows/native scenario)

The host is macOS; there is no Windows/Office/.NET environment. Canonical-behavior code is fully present and unit-tested at the Node seam (fake helper / fixtures), but **real COM emission, packaged-helper resource path, live helper restart, and the before-quit STA-close/orphan check are recorded-pending**, not executed. Throughout the matrix, "✅ (code)" means the requirement is satisfied and verified at the testable seam; the residual live-Windows proof is an H6/private-beta gate, not an H5 code defect. This caveat is recorded once here and referenced by scenario.

---

## 1. Presentation and video-state display (S-001…S-017) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-001** connecting state, "Connecting to PowerPoint…", no time | H5 | ✅ | `apps/ppt-timer/src/renderer/view.ts:describeView` `connecting` → `messageText='Connecting to PowerPoint…'`, `timeText='--:--'`. Initial projection published on start: `session-host.ts:start` → `publish(currentView.state)`; `session-host.test.ts` "publishes the initial connecting view on start (S-001)"; `view.test.ts` "S-001 connecting". |
| **S-002** helper unavailable → "PowerPoint timing unavailable" + retry + no numeric timing | H5 | ✅ (code) | `view.ts` `unavailable` → `badge='retry'`, `messageText`, `timeText='--:--'`. All failure modes map to `unavailable`: `ppt-bridge/src/powerpoint-session.ts:outcomeToPoll` returns `'failure'` for `helper_missing/timeout/process_exit/invalid_json/invalid_payload/oversized_response/com_unavailable` → `dispatch({type:'operational_failure'})` → `sourceState={kind:'unavailable'}` (`powerpoint-machine.ts`). `session-host.test.ts` "clears timing on failure (S-002/S-013)"; `view.test.ts` "S-002 unavailable". Live COM-unavailable pending (caveat). |
| **S-003** PowerPoint not running → "PowerPoint is not running" | H5 | ✅ (code) | Native `Program.cs:Poll` emits `state:'none'` when `POWERPNT` processes = 0 → session maps to `powerpoint_not_running` → `view.ts` `messageText='PowerPoint is not running'`. `view.test.ts` "S-003". |
| **S-004** running, no slideshow → "No slideshow running" | H5 | ✅ (code) | Native sets `inSlideshow=false` when `SlideShowWindows.Count=0` → `validate-response.ts` returns `no_slideshow` → `view.ts` `messageText='No slideshow running'`. `view.test.ts` "S-004". |
| **S-005** canonical clearing confirms no video → slide/title + "No video on this slide" | H5 | ✅ | Two-consecutive clearing: `POWERPOINT_VIDEO_CLEAR_POLLS=2` in `presentation-core/src/powerpoint-normalize.ts` (`shouldClearVideo = !hasVideoPayload && noVideoCount >= 2`). `view.ts` `no_video` → `messageText`, slide/title shown, `videoText=null`. `view.test.ts` "S-005". |
| **S-006** media but timing absent/unavailable → slide/title/video + `--:--` | H5 | ✅ | `view.ts` `timing_unavailable` → `timeText='--:--'`, `videoText` shown; projection in `presentation-core/src/powerpoint-view.ts` (`snap.videoTimingUnavailable || (!hasTiming && !hasPlaybackSignal)`). `view.test.ts` "S-006". |
| **S-007** status playing → playing badge + remaining/elapsed per mode | H5 | ✅ | `view.ts` `playing` → `badge='playing'`, `timeText=formatTime(state.timeMs)`; `powerpoint-view.ts` picks `resolvedRemaining`/`elapsed` by `timingMode`. `view.test.ts` "S-007". |
| **S-008** status paused → paused badge + frozen value | H5 | ✅ | `view.ts` `paused` → `badge='paused'`, `timeText` from frozen `state.timeMs`; "not advancing" guaranteed by S-017 (no extrapolation). `view.test.ts` "S-008". |
| **S-009** remaining 0 / ended / within 250 ms → "Ended", `00:00` remaining or final elapsed | H5 | ✅ | `POWERPOINT_END_INFER_MS=250` in `powerpoint-view.ts`; ended → remaining mode `timeMs=0`, elapsed mode `timeMs=elapsed`. `view.test.ts` "S-009 ended shows Ended with 00:00 in remaining mode" + "…final elapsed value in elapsed mode". Native also uses the 250 ms threshold (`Program.cs`). |
| **S-010** video, no play/pause/end evidence → "Ready" + duration or `--:--` | H5 | ✅ | `powerpoint-view.ts` `ready` branch; `view.ts` `ready` → `messageText='Ready'`, `timeText = durationMs!=null ? formatTime : '--:--'`. `view.test.ts` "S-010 ready … duration when known" + "…--:-- when unknown". |
| **S-011** >1 video → "N videos" + helper primary selection | H5 | ✅ | `view.ts:videoLabel` → `${videoCount} videos` when `multipleVideos`; primary selection is the helper's (`selectPrimaryVideo` prefers explicit id/index then playing then first — never standalone-chosen). `view.test.ts` "S-011". |
| **S-012** affinity mismatch → overlay "Multiple PowerPoint instances detected; verify the deck" | H5 | ✅ (code) | Native `Program.cs` emits `processCount`+`selectedPid` always and `comPid`+`affinityMismatch` when HWND readable; fields validated in `ppt-bridge/src/validate-response.ts`; `session-host.ts:deriveMultipleInstanceWarning` reads `observation.affinityMismatch`; `view.ts` overlay text is byte-exact. `session-host.test.ts` "surfaces the canonical affinity signal (S-012)". Live emission vs multi-instance PowerPoint pending (caveat). |
| **S-013** failure during live numeric → number removed same update, no stale frame | H5 | ✅ | `AppView` is replaced wholesale (`ipc-contract.ts`); `view.ts` `unavailable` carries no `timeMs`. Renderer `mountApp` drops any view with `revision < lastRevision` so a late `getView()` cannot restore stale timing: `renderer/main.ts` + `main.test.ts` "drops a stale (lower-revision) view … (S-013)". |
| **S-014** toggle remaining/elapsed → switches without re-poll or state change | H5 | ✅ | `session-host.ts:setTimingMode` reprojects from `session.state.sourceState` (no `client.poll()`); `session-host.test.ts` "reprojects on a timing-mode toggle WITHOUT polling (S-014)". |
| **S-015** no total slide count → "Slide 8 of --" | H5 | ✅ | `view.ts:slideLabel` → `total = state.totalSlides ?? '--'`. `view.test.ts` "S-015 missing total slide count renders 'Slide 8 of --'". |
| **S-016** file path → basename only, never full path | H5 | ✅ | `presentation-core/src/powerpoint-view.ts:basename` (both `/` and `\`) → `filenameBasename`; `view.ts:titleLabel` uses `title || filenameBasename`. `view.test.ts` "S-016 hides the full path". |
| **S-017** no local extrapolation between polls | H5 | ✅ | Renderer renders only the immutable pushed `AppView`; session updates only on a poll transition; no `setInterval`/clock in the renderer or projection. `session-host.ts` "never extrapolates"; `session-host.test.ts` `projectHostView` asserts `unavailable` carries no `timeMs`. |

## 2. Window and settings persistence (S-018…S-024) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-018** default 360×220, min 320×180, resizable, compact/large presets | H5 | ✅ | `settings-schema.ts:PRESET_SIZES.compact={360,220}`, `MIN_WINDOW_SIZE={320,180}`; `main.ts` BrowserWindow sets `minWidth/minHeight` and omits `resizable` (default true); renderer renders Compact/Large presets. Default windowBounds `null` → `restoreBounds` uses compact preset. `settings-schema.test.ts`, `window-placement.test.ts`. |
| **S-019** always-on-top default on + in-window toggle | H5 | ✅ | `DEFAULT_SETTINGS.alwaysOnTop=true`; `main.ts` `alwaysOnTop: currentSettings.alwaysOnTop`; renderer always-on-top checkbox dispatches `setAlwaysOnTop`. `main.test.ts` "always-on-top checkbox reflects state and dispatches on change". |
| **S-020** "Move to display" recenters within target work area | H5 | ✅ | `window-placement.ts:moveToDisplay` → `centerBounds` on target `workArea`; `main.ts` `effects.moveToDisplay`. Implemented as a display `<select>` (functionally the "Move to display" action). `window-placement.test.ts`. |
| **S-021** all placement/control/timing settings restored on relaunch | H5 | ✅ | Persisted fields: `windowBounds, selectedDisplayId, sizePreset, alwaysOnTop, timingMode, schemaVersion` (`settings-schema.ts:Settings`); atomic serialized round-trip in `settings-store.ts`. `settings-store.test.ts` "save (S-021 atomic, ordered, serialized)". (Unit-level round-trip; full Electron restart not exercised on this host.) |
| **S-022** saved bounds off-screen / display removed / DPI changed → clamp or recenter | H5 | ✅ | `window-placement.ts:restoreBounds` (substantially-visible test `VISIBILITY_THRESHOLD=80×60`, clamp-into-work-area, saved-display-then-primary fallback); `main.ts:revalidatePlacement` on `display-added|removed|metrics-changed` (registered after `app.whenReady()`). `window-placement.test.ts`. |
| **S-023** malformed settings → rename `.corrupt-<ts>`, defaults, no crash | H5 | ✅ | `settings-store.ts:quarantine` → `${filePath}.corrupt-${now()}` on parse-fail / non-ENOENT read-fail, returns defaults; quarantine failure returns `recovered:true, quarantinedPath:null` without throwing. `settings-store.test.ts` "quarantines a malformed JSON file with .corrupt-<ts>" + "…when quarantine itself fails, without throwing". |
| **S-024** close only window → terminate helper + exit; no tray/background | H5 | ✅ (code) | `main.ts` `before-quit` → `preventDefault()` + idempotent `quitting` + `runShutdown()` (`Promise.race([host.shutdown(), 2_000ms])`) → `app.exit(0)`; `window-all-closed` → `app.quit()`; `setWindowOpenHandler` deny. No tray code exists. `session-host.ts:shutdown` is idempotent → `client.close()`. `session-host.test.ts` "shuts down idempotently, closing the helper exactly once (S-024/S-027)". Live STA-helper close/orphan check pending (caveat). |

## 3. Diagnostics (S-025…S-026) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-025** clipboard basenames only; no contents/env/tokens/usernames/other product state | H5 | ✅ | Structural redaction in `diagnostics.ts`: the event union never stores titles, raw video names, stderr text, env, tokens, usernames. The only path-bearing app field is a quarantined settings path, basenamed on insert (`redactPath`). `ValidationWarning.path` is a structural JSON pointer (e.g. `videos[0].duration`), not a filesystem path. `diagnostics.test.ts` "redaction guarantees (S-025)" asserts no `bob`/`AppData`/`SECRET`/`TOKEN`/`Intro.mp4`/`password` leak. |
| **S-026** events from last 100, each keyed by app/helper/protocol version + signing | H5 | ✅ | Ring cap + event coverage ✅: `DiagnosticsBuffer` caps at 100 FIFO; event kinds cover helper start/exit/timeout/restart/close, validation warnings, availability transitions, affinity/process count, slide number, media count, display ID/scale, window bounds; report header keys by `appVersion/helperVersion/protocolVersion/signingStatus`. `diagnostics.test.ts` "buildReport includes the S-026 diagnostic surface" + ring test. **Selected media identity + protocol version now wired (D-1/D-2 fixed, re-audit PASS):** `session-host.ts:deriveObservationMeta` carries `observation.primaryVideoId` and `observation.protocolVersion` straight through — `primaryVideoId` is the helper-owned canonical primary id (an integer-validated wire field in `ppt-bridge/src/validate-response.ts`, the same id that `presentation-core/powerpoint-view.ts:selectPrimaryVideo` defers to as its first preference), so the standalone never chooses a video itself. Both are threaded into `lastSelectedMediaId`/`lastProtocolVersion` every poll (before the session reduces) and clear to `null` on every terminal/no-signal outcome (`powerpoint_not_running`, `com_unavailable`, all failure kinds, `closed`, `null`) — a stale id/version from a defunct slideshow cannot reach the report. `slide_observed` now carries `selectedMediaId: lastSelectedMediaId`; `main.ts:diagMeta()` (read lazily at copy-diagnostics via `getDiagnosticsReport → buildReport(diagMeta())`) uses `host.getProtocolVersion()`. Tests: `session-host.test.ts` "threads the canonical selected-media id into slide_observed (S-026 D-1)" (report `selectedMediaId=501`, raw `intro.mp4` absent — S-025), "does not choose a video itself … no primaryVideoId means null", "does not leave a stale selected-media id when a later slide emits none" (slide 4 → `selectedMediaId=--`), "surfaces the validated observation protocol version" / "clears the protocol version on a terminal/no-signal transition" (2 → null). Accepted-with-reason minors remain: `APP_VERSION='0.0.0-beta'`, `HELPER_VERSION='ppt-probe/native'` placeholders (D-5); `officeBitness` undiscovered — spec says "when discoverable" (D-6). |

## 4. Process recovery (S-027) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-027** helper crash → bounded-backoff auto-restart, return to live, no user action | H5 | ✅ (code) | `ppt-bridge/src/process-client.ts`: `restartBackoffMs=[1_000,2_000,5_000]` default; `restartAttempt` increments on `exit`/`error`/missing/spawn-fail and **resets to 0** on any observation/no-slideshow/not-running success; `beginPoll` awaits the backoff before relaunch, caps at the last bucket but keeps retrying (never an immediate tight loop, never gives up). The standalone session keeps the 1 s cadence (`session-host.ts` → `PowerPointSession.start`), so each tick re-enters the client which performs the restart. `session-host.test.ts` "shuts down idempotently (S-024/S-027)". Live crash/restart pending (caveat). |

## 5. Companion compatibility and canonical shared behavior (S-028…S-029)

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-028** Companion presentation/live-cue event sequence + Controller display unchanged; existing automated suite green without expectation changes | H5 | ✅ | `companion/src/presentation-candidate.ts` is now a thin adapter over the shared `PowerPointSession` reducer (`@ontime/ppt-bridge`) + `presentation-core` comparators; Companion-specific LiveCue effects (`applyCommittedSnapshot`: create/update/replace/clear order, `startedAt`, ended payload) remain host-owned and unchanged. `presentation-snapshot.ts` re-exports core types/comparators and keeps `buildPowerPointCue` local (incl. the macOS `videoTimingUnavailable=true` rule). **Verified this audit: `npm run test --workspace ontime-companion` → 164 pass / 0 fail** (the characterization suites `main.presentation.test.ts` C1–C16, `main.ppt-status.test.ts` D1–D12, lifecycle, elapsed-drift, livecue-elapsed, fixtures). |
| **S-029** both apps poll the same PowerPoint independently; neither blocks/corrupts/alters the other | H5 | ✅ (design) | Standalone and Companion each spawn their own helper process and run independent `PowerPointSession` instances over independent stdin/stdout pipes; no shared mutable state, no room/socket coupling in the standalone (`ppt-timer-standalone` dependency rule enforced by `scripts/check-dependency-boundaries.mjs`). Same canonical debounce/cache/clearing reducer on both sides. **No dedicated live two-app coexistence test exists**; assurance is fixture parity + the independent-process model. Live two-app verification pending (caveat). |

## 6. Installer, upgrade, uninstall (S-030…S-032) — H6

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-030** clean Windows install + launch + poll, no extra runtime install | H6 | ❌ Not-built | No installer configuration exists: `apps/ppt-timer/package.json` has only `typecheck/test/build/dev` scripts and **no `electron-builder`, NSIS, `appId`, `dist`/`build` block, or `createWindowsInstaller`** (repo-wide search for `electron-builder\|nsis\|appId` in `apps/ppt-timer`+`packages/ppt-bridge` returns no installer config). The .NET self-contained `publish` exists for the helper only (`packages/ppt-bridge/scripts/build-windows.ps1`), not a packaged app installer. Explicitly Stage-6 scope per the plan/H5 loop. |
| **S-031** in-place upgrade with same app identity preserves settings | H6 | ❌ Not-built | Same as S-030: no installer, no stable `appId` (`com.ontime.ppttimer`) defined for the app. No upgrade path exists yet. |
| **S-032** uninstall removes program files but keeps user settings | H6 | ❌ Not-built | No installer, so no `deleteAppDataOnUninstall:false` anchor and no uninstall behavior. Settings persistence code (`settings-store.ts`) would survive on disk, but the uninstall-of-program-files step does not exist. |

## 7. Upsell link (S-033) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-033** link opens exactly one allowlisted URL in default browser; denies other URLs and new in-app windows | H5 | ✅ (mechanism + copy) | Mechanism ✅: `ipc-contract.ts:resolveUpsellUrl/isAllowedUpsellUrl` (exact match, no wildcard, credential-free HTTPS only); `openUpsell` carries **no** renderer URL; `main.ts` `setWindowOpenHandler→deny` + `will-navigate→preventDefault`; `security.ts:safeOpenUpsell` opens via `shell.openExternal`. `ipc-contract.test.ts` + `main.test.ts` "omits the CTA entirely when no URL is configured" / "renders the CTA and dispatches openUpsell (no URL)". **Copy now matches (D-3 fixed, re-audit PASS):** `renderer/main.ts` renders exactly `'Need full show control? Try OnTime'` (byte-exact vs S-033); `main.test.ts` "uses the exact spec CTA copy (S-033 D-3)". **Secure hidden-when-unset policy unchanged:** the CTA is wrapped in `if (view.ctaAvailable)`; `config.ts:UPSELL_URL_CONSTANT=''` → `ctaAvailable=false` → CTA omitted entirely (no placeholder, no dead control) — the spec-sanctioned OQ-1 fallback. The actual destination URL remains pending OQ-1 (D-4, accepted-with-reason). |

---

## 8. Proposed Surface

| Surface element | H | Status | Evidence |
|---|---|---|---|
| UI states mutually exclusive, precedence high→low: connecting, unavailable, powerpoint-not-running, no-slideshow, no-video, timing-unavailable, playing, paused, ended, ready | H5 | ✅ | `presentation-core/src/powerpoint-view.ts:PowerPointViewState` discriminated union with the exact kinds and the §3.4 precedence; `view.ts:describeView` maps each. `powerpoint-view.test.ts` (28 tests). |
| Orthogonal `multiple-videos` indicator + `multiple-instance-warning` overlay (can accompany any state) | H5 | ✅ | `PowerPointViewStateBase.{multipleVideos,videoCount,multipleInstanceWarning}` carried by every variant; `view.ts` renders `${videoCount} videos` and the warning overlay independent of state kind. `view.test.ts` "S-011" / "S-012". |
| Window default 360×220, min 320×180, resizable, compact/large presets, "Move to display" | H5 | ✅ | See S-018 / S-020. |
| In-window controls: always-on-top toggle; remaining-vs-elapsed toggle | H5 | ✅ | `renderer/main.ts:renderControls` (timing toggle buttons, always-on-top checkbox). `main.test.ts`. |
| Persisted fields: window bounds, selected display ID, size preset, always-on-top (bool), timing mode, schema version | H5 | ✅ | `settings-schema.ts:Settings` carries exactly these six fields; `SETTINGS_SCHEMA_VERSION=1`. `settings-schema.test.ts`. |
| Diagnostics report: versions + signing; Windows/Office bitness; helper history; validation warnings; availability transitions; process count/affinity; slide/media/selected identity; display/scale; bounds — redacted per S-025 | H5 | ✅ | Structure ✅ (see S-025/S-026); **selected media identity and protocol version now populated and cleared on no-signal** (S-026 D-1/D-2 fixed); Office bitness not discovered (D-6, "when discoverable"). |
| Upsell link: single build-time-constant URL, system default browser only | H5 | ✅ | Mechanism ✅; link copy now matches S-033 (D-3 fixed). Constant is empty (OQ-1/D-4 fallback — CTA hidden), accepted-with-reason pending the canonical URL. |
| Installer: Windows x64, stable app identity across versions, fresh install + in-place upgrade + settings-preserving uninstall | H6 | ❌ Not-built | See S-030…S-032. |

---

## 9. Constraints (cross-cutting)

| Constraint | Status | Evidence |
|---|---|---|
| One canonical capability — reuse the native STA helper; constants 1 s poll / 600 ms debounce / 2-poll clear / >200 ms playing inference / 250 ms end threshold; no second implementation | ✅ | `PowerPointSession.pollIntervalMs` default 1_000; `presentation-core/powerpoint-normalize.ts` `POWERPOINT_DEBOUNCE_MS=600`, `POWERPOINT_VIDEO_CLEAR_POLLS=2`, `POWERPOINT_PLAYING_DELTA_MS=200`; `powerpoint-view.ts` `POWERPOINT_END_INFER_MS=250`. The standalone consumes the same helper + reducer as Companion (`presentation-candidate.ts`). No duplicate policy in the app. |
| No PowerShell/AppleScript fallback in the standalone | ✅ | `apps/ppt-timer` imports only `@ontime/ppt-bridge` + `@ontime/presentation-core`; helper discovery (`helper-discovery.ts`) feeds only the canonical exe; failure → `unavailable` (S-002), never a fallback transport. Boundary rule `ppt-timer-standalone` enforced. |
| No local extrapolation | ✅ | See S-017. |
| No stale numeric time after failure | ✅ | See S-002 / S-013. |
| No tray / background process | ✅ | See S-024. |
| No auto-update | ✅ | No update code/config; upgrade = run newer installer (H6, not built). |
| Companion regression bar | ✅ | See S-028 (164/164 green). |

---

## 10. Divergences (unreconciled detail)

| # | Scenario | Spec side | Code side | Disposition |
|---|---|---|---|---|
| D-1 | S-026 | "selected media identity" included in diagnostics | **Fixed (re-audit PASS):** `deriveObservationMeta` threads the canonical `observation.primaryVideoId` (integer-validated; the id `selectPrimaryVideo` defers to) into `slide_observed` via `lastSelectedMediaId`; never chooses a video itself; clears to `null` on every terminal/no-signal outcome. Tests: "threads the canonical selected-media id", "does not choose a video itself", "does not leave a stale selected-media id when a later slide emits none". | **Fixed** (H5, uncommitted). |
| D-2 | S-026 | report keyed by protocol version | **Fixed (re-audit PASS):** `getProtocolVersion()` exposes the validated `observation.protocolVersion`; `main.ts:diagMeta()` reads it lazily at copy-diagnostics (`getDiagnosticsReport → buildReport(diagMeta())`); clears to `null` on terminal/no-signal. Tests: "surfaces the validated observation protocol version" (2), "clears … on a terminal/no-signal transition" (→ null). | **Fixed** (H5, uncommitted). |
| D-3 | S-033 | link text "Need full show control? Try OnTime" | **Fixed (re-audit PASS):** `renderer/main.ts` renders byte-exact `'Need full show control? Try OnTime'`; `if (view.ctaAvailable)` hidden-when-unset guard unchanged. Test: "uses the exact spec CTA copy (S-033 D-3)". | **Fixed** (H5, uncommitted). |
| D-4 | S-033 | one allowlisted OnTime URL | `UPSELL_URL_CONSTANT=''` (CTA hidden) | **Accepted-with-reason**: spec OQ-1 explicitly permits hiding the link until the canonical URL is chosen. Blocks private-beta *visibility* of the link only; not an H5 code defect. |
| D-5 | S-026 (minor) | helper/app versions | `APP_VERSION='0.0.0-beta'`, `HELPER_VERSION='ppt-probe/native'` placeholders | **Accepted-with-reason**: beta placeholders; real values are an H6/release wiring task. |
| D-6 | S-026 (minor) | "Windows/Office bitness/version when discoverable" | only `windowsBitness=process.arch`; no Office bitness | **Accepted-with-reason**: spec says "when discoverable"; Office bitness discovery is a Windows-host task. |

---

## 11. P0 / P1 blockers

- **P0 — none.** No correctness, stale-timing, security, or data-loss defect was found. The "no stale numeric time after failure" invariant (S-002/S-013) is enforced at every layer and directly tested.
- **P1 — none at the H5 code level.**
- **Feature-level closeout gap (not a defect, recorded for the closeout gate):** ISSUE-001 **cannot close** because (a) H6 installer scenarios **S-030, S-031, S-032 are Not-built**; (b) live Windows/native/user-facing smoke and native parity are recorded-pending (no Windows/Office host); (c) the S-033 destination URL remains unset pending OQ-1 (D-4 — CTA hidden; mechanism + copy now conform). With D-1/D-2/D-3 fixed (this re-audit), **no H5-scope code divergence remains**; the H5 runnable app is fully conformant with its in-scope code scenarios.

## 12. Validation results (commands run this audit)

| Command | Result |
|---|---|
| `git rev-parse HEAD` + `git status` | base `cec0f353…`; **working tree NOT clean** — 6 modified (`main`, `session-host`, `session-host.test`, `controllers.test` under `apps/ppt-timer/src/main/`; `main`, `main.test` under `apps/ppt-timer/src/renderer/`) + this conformance doc untracked |
| `npm run test --workspace @ontime/presentation-core` | ✅ 4 files / **100 pass** |
| `npm run test --workspace @ontime/ppt-bridge` | ✅ 4 files / **33 pass** (validate-response 17, process-client 9, session 5, native-build-scripts 2) |
| `npm run test --workspace @ontime/ppt-timer` | ✅ 12 files / **123 pass** (view 20, settings-schema 11, ipc-contract 8, settings-store 8, ipc 9, window-placement 14, controllers 9, **session-host 16** (+8 D-1/D-2), security 4, helper-discovery 5, diagnostics 6, **renderer main 13** (+1 D-3)) |
| `npm run typecheck --workspace @ontime/ppt-timer` | ✅ exit 0 — `tsc -p tsconfig.json --noEmit`; covers the new `getProtocolVersion()` on the `SessionHost` interface + the updated mock in `controllers.test.ts` |
| `npm run test --workspace ontime-companion` | ✅ **164 pass / 0 fail** (S-028 regression; C1–C16 / D1–D12 / lifecycle / elapsed-drift / livecue-elapsed / fixtures) |
| repo-wide search `electron-builder\|nsis\|appId\|createWindowsInstaller` under `apps/ppt-timer` + `packages/ppt-bridge` | no installer config (H6 Not-built) |

Test files were read (not just run) for the load-bearing scenarios — `view.test.ts`, `renderer/main.test.ts`, `session-host.test.ts`, `diagnostics.test.ts`, `settings-store.test.ts`, `ipc-contract.test.ts` — and assert real spec invariants (exact state copy, `timeMs`-absent on `unavailable`, stale-revision drop, `.corrupt-<ts>` quarantine, exact-match allowlist, no renderer-supplied URL).

---

## 13. Coverage proof

- **Audited** (every spec item checked): scenarios S-001, S-002, S-003, S-004, S-005, S-006, S-007, S-008, S-009, S-010, S-011, S-012, S-013, S-014, S-015, S-016, S-017, S-018, S-019, S-020, S-021, S-022, S-023, S-024, S-025, S-026, S-027, S-028, S-029, S-030, S-031, S-032, S-033; Proposed Surface (UI states + orthogonal indicators, Window, In-window controls, Persisted fields, Diagnostics report, Upsell link, Installer); Constraints; Open Questions OQ-1…OQ-4 reviewed for gating effect.
- **Unreconciled:**
  - **Fixed this re-audit (H5-scope, uncommitted, PASS — moved out of unreconciled):** D-1 (S-026 selectedMediaId), D-2 (S-026 protocolVersion), D-3 (S-033 copy).
  - **Accepted-with-reason:** D-4 (S-033 URL unset — OQ-1 fallback), D-5 (version placeholders — beta), D-6 (Office bitness — "when discoverable").
  - **Not-built (H6 scope, blocks feature closeout, not an H5 defect):** S-030, S-031, S-032 (no installer/appId). Plus recorded-pending live-Windows/native/user-facing verification per §"Runtime-evidence caveat".
- **Open Questions (release-gate status, not H5 blockers):** OQ-1 canonical URL — mechanism built, URL unset, CTA hidden (D-4); OQ-2 Office x86 — untested (no Windows host); OQ-3 Windows 10 wording — doc/release decision; OQ-4 public signing identity — H8 release mechanics. None changes an H5 conformance classification.

This matrix is the coverage proof required by the closeout gate. With D-1/D-2/D-3 fixed (this re-audit), **no H5-scope code divergence remains**; an H5-only closeout would still be blocked by the recorded-pending Windows/user-facing evidence. An ISSUE-001 feature closeout is additionally blocked by the Not-built H6 installer (S-030…S-032) and the pending OQ-1 upsell URL (D-4).
