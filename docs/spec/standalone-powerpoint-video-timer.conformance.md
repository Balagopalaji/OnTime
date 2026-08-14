# Standalone PowerPoint Video Timer — Spec–Implementation Conformance Matrix

- **Spec:** `docs/spec/standalone-powerpoint-video-timer.spec.md` (scenarios S-001…S-033, Proposed Surface, Constraints, Open Questions OQ-1…OQ-4).
- **Implementation:** `apps/ppt-timer/**` (standalone Electron app); `packages/ppt-bridge/**` (native boundary + supervised client/session); `packages/presentation-core/**` (pure normalization + view projection); Companion integration in `companion/src/{presentation-candidate,presentation-snapshot,ppt-probe,ppt-quit-gate}.ts` + `companion/src/main.ts`.
- **Audit basis:** base `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`; H1–H6 source-acceptance checkpoint `5193084be79f78c3a334e14e3b0566a2656a7cb0`. Later docs-only metadata commits do not change the audited source; the branch is not pushed. Reconciled against the current source and the 2026-07-28 audit, re-audit, and final source-acceptance records.
- **Checkpoint commits:** `0bd69c7` canonical probe/core; `24fa596` standalone runtime/settings; `65f65d7` installer/CI/versioning; `5193084` H6 source-acceptance docs.
- **Audit mode:** documentation reconciliation only. No implementation code, tests, workflows, package files, issue state, or PR was changed by this matrix; no PR or issue-state change has occurred.

Legend: ✅ Conformed · ✅ **Implemented at source; Windows runtime evidence pending** · ⚠️ Diverged / accepted-with-reason · ❌ Not-built.

Scope marker in the **H** column: **H5** = runnable standalone app (Deep-Plan Stage 5); **H6** = installer/private-beta/public-release (Deep-Plan Stages 6–8). H6 source is now implemented and source-accepted; Stage 7 execution and Stage 8 signing remain separate gates.

## Runtime-evidence caveat (Stage 7)

The original source-audit checkpoint ran on macOS; its command/evidence table is preserved in §12 as historical evidence. Current Windows execution evidence is recorded in the [Stage 7 handoff](../progress/issue-001-stage-7-windows-2026-07-29.md). As of 2026-08-07 the current source was rebuilt, installed, and hash-verified, and bounded Companion-closed live PowerPoint helper-poll evidence was recorded. Those diagnostics measure helper poll duration, not click-to-visible start/pause latency. The evidence does not complete the full media-transition matrix, Companion coexistence, displays/mixed-DPI, diagnostics/recovery, or upgrade/uninstall acceptance.

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
| **S-007** status playing → playing badge + remaining/elapsed per mode | H5 | ✅ | `view.ts` `playing` → `badge='playing'`, `timeText=formatTime(state.timeMs)`; `powerpoint-view.ts` picks `resolvedRemaining`/`elapsed` by `timingMode`. `video-status-stabilizer.ts` applies ended > explicit playing/paused > inferred evidence; confirmed playing cancels a pending false-pause hold. `video-status-stabilizer.test.ts` and `view.test.ts` "S-007". |
| **S-008** status paused → paused badge + frozen value | H5 | ✅ | `video-status-stabilizer.ts` lets explicit paused outrank inferred movement after 350 ms of stable non-playing evidence, while ended/scope/media/large-seek boundaries remain immediate. `view.ts` `paused` → `badge='paused'`, `timeText` from the accepted/frozen position; the renderer clock stops on the accepted pause. `video-status-stabilizer.test.ts`, `view.test.ts` "S-008", and `playback-clock.test.ts`. |
| **S-009** remaining 0 / ended / within 250 ms → "Ended", `00:00` remaining or final elapsed | H5 | ✅ | `POWERPOINT_END_INFER_MS=250` in `powerpoint-view.ts`; ended → remaining mode `timeMs=0`, elapsed mode `timeMs=elapsed`. `view.test.ts` "S-009 ended shows Ended with 00:00 in remaining mode" + "…final elapsed value in elapsed mode". Native also uses the 250 ms threshold (`Program.cs`). |
| **S-010** video, no play/pause/end evidence → "Ready" + duration or `--:--` | H5 | ✅ | `powerpoint-view.ts` `ready` branch; `view.ts` `ready` → `messageText='Ready'`, `timeText = durationMs!=null ? formatTime : '--:--'`. `view.test.ts` "S-010 ready … duration when known" + "…--:-- when unknown". |
| **S-011** >1 video → "N videos" + persisted playing-only headline selection | H5 | ✅ | `powerpoint-headline.ts` implements persisted `longest-remaining` (default) and `latest-started` modes over resolved playing rows only; paused, ended, and ready videos are excluded while playback is active. With nothing playing, `powerpoint-view.ts` bypasses retained ranks and preserves the helper-primary next-to-play fallback. Incomplete active timing suppresses the longest aggregate as `timing_unavailable`. `powerpoint-headline.test.ts`, `powerpoint-view.test.ts`, `session-host.test.ts`, `settings-schema.test.ts`, `controllers.test.ts`, `ipc-contract.test.ts`, and `renderer/main.test.ts` pin selection, migration, persistence, no-poll toggling, IPC, and UI. Live signed-AppX PowerPoint acceptance on 2026-08-14 confirmed Longest, Latest, inactive-candidate exclusion, next-to-play fallback, and the compact wrapped tray. |
| **S-012** affinity mismatch → overlay "Multiple PowerPoint instances detected; verify the deck" | H5 | ✅ (code) | Native `Program.cs` emits `processCount`+`selectedPid` always and `comPid`+`affinityMismatch` when HWND readable; fields validated in `ppt-bridge/src/validate-response.ts`; `session-host.ts:deriveMultipleInstanceWarning` reads `observation.affinityMismatch`; `view.ts` overlay text is byte-exact. `session-host.test.ts` "surfaces the canonical affinity signal (S-012)". Live emission vs multi-instance PowerPoint pending (caveat). |
| **S-013** failure during live numeric → number removed same update, no stale frame | H5 | ✅ | `AppView` is replaced wholesale (`ipc-contract.ts`); `view.ts` `unavailable` carries no `timeMs`. Renderer `mountApp` drops any view with `revision < lastRevision` so a late `getView()` cannot restore stale timing: `renderer/main.ts` + `main.test.ts` "drops a stale (lower-revision) view … (S-013)". |
| **S-014** toggle remaining/elapsed → switches without re-poll or state change | H5 | ✅ | `session-host.ts:setTimingMode` reprojects from the held `stableSource` (no `client.poll()`); `session-host.test.ts` "reprojects on a timing-mode toggle WITHOUT polling (S-014)". |
| **S-015** no total slide count → "Slide 8 of --" | H5 | ✅ | `view.ts:slideLabel` → `total = state.totalSlides ?? '--'`. `view.test.ts` "S-015 missing total slide count renders 'Slide 8 of --'". |
| **S-016** file path → basename only, never full path | H5 | ✅ | `presentation-core/src/powerpoint-view.ts:basename` (both `/` and `\`) → `filenameBasename`; `view.ts:titleLabel` uses `title || filenameBasename`. `view.test.ts` "S-016 hides the full path". |
| **S-017** bounded local playback projection | H5 | ✅ at source; bounded live Windows evidence | `renderer/playback-clock.ts` continues confirmed-playing clocks deterministically to known-duration zero, confirmed non-playing, or actual unavailable rather than freezing after fixed silence. One numeric outlier is ignored; correction requires two advancing consistent samples beyond strict 1,500 ms drift. Accepted non-playing anchors once, repeated samples remain frozen, omitted timing preserves a usable baseline, and first usable timing is adopted only when no baseline exists. `playback-clock.test.ts` covers correction confirmation, persistent anchors, focus changes, and timing loss. The 2026-08-07 Companion-closed run recorded improved normal warm helper-poll durations and a separate user report that behavior was much better; click-to-visible start/pause latency was not instrumented or certified, and the run does not constitute the full S-017 transition/stall acceptance matrix. |

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
| **S-026** events from last 100, each keyed by app/helper/protocol version + signing | H5 | ✅ | Ring cap + event coverage ✅: `DiagnosticsBuffer` caps at 100 FIFO; event kinds cover helper start/exit/timeout/restart/close, sanitized/rate-limited `poll_slow` events for helper polls above 250 ms, validation warnings, availability transitions, affinity/process count, slide number, media count, display ID/scale, and window bounds; report header keys by `appVersion/helperVersion/protocolVersion/signingStatus`. `diagnostics.test.ts` covers the report surface and ring cap; `packages/ppt-bridge/test/process-client.test.ts` covers slow-poll sanitization and rate limiting. **Selected media identity + protocol version are wired (D-1/D-2 fixed):** `session-host.ts:deriveObservationMeta` carries helper-owned `primaryVideoId`/protocol version through diagnostics and clears them on terminal/no-signal results; `main.ts:diagMeta()` reads `host.getProtocolVersion()`. Current release versioning supersedes the former placeholders: `apps/ppt-timer/package.json:version` is `0.1.0-beta.1`; `main.ts` uses Electron `app.getVersion()`; `build-windows.ps1` passes that SemVer to helper product/informational version and `windows-file-version.mjs` derives numeric PE `FileVersion` `0.1.0.1`. `ppt-timer-build.yml` verifies both values from the published PE before manifest generation. Office bitness remains D-6: not discoverable on this host and required only when discoverable. |

## 4. Process recovery (S-027) — H5

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-027** helper crash → bounded-backoff auto-restart, return to live, no user action | H5 | ✅ (code) | `ppt-bridge/src/process-client.ts`: `restartBackoffMs=[1_000,2_000,5_000]` default; `restartAttempt` increments on `exit`/`error`/missing/spawn-fail and **resets to 0** on any observation/no-slideshow/not-running success; `beginPoll` awaits the backoff before relaunch, caps at the last bucket but keeps retrying (never an immediate tight loop, never gives up). The standalone uses completion-based adaptive polling while Companion retains its established interval behavior; rejected/null polls reset the standalone policy to its settled 1,000 ms fallback. `session-host.test.ts` covers shutdown/restart ownership. Live crash/restart remains **not run**. |

## 5. Companion compatibility and canonical shared behavior (S-028…S-029)

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-028** Companion presentation/live-cue event sequence + Controller display unchanged; existing automated suite green without expectation changes | H5 | ✅ | `companion/src/presentation-candidate.ts` is now a thin adapter over the shared `PowerPointSession` reducer (`@ontime/ppt-bridge`) + `presentation-core` comparators; Companion-specific LiveCue effects (`applyCommittedSnapshot`: create/update/replace/clear order, `startedAt`, ended payload) remain host-owned and unchanged. `presentation-snapshot.ts` re-exports core types/comparators and keeps `buildPowerPointCue` local (incl. the macOS `videoTimingUnavailable=true` rule). **Final source acceptance records: `npm run test --workspace ontime-companion` → 165 pass / 0 fail** (the characterization suites `main.presentation.test.ts` C1–C16, `main.ppt-status.test.ts` D1–D12, lifecycle, elapsed-drift, livecue-elapsed, fixtures). |
| **S-029** both apps poll the same PowerPoint independently; neither blocks/corrupts/alters the other | H5 | ✅ (design) | Standalone and Companion each spawn their own helper process and run independent `PowerPointSession` instances over independent stdin/stdout pipes; no shared mutable state, no room/socket coupling in the standalone (`ppt-timer-standalone` dependency rule enforced by `scripts/check-dependency-boundaries.mjs`). Same canonical debounce/cache/clearing reducer on both sides. **No dedicated live two-app coexistence test exists**; fixture parity and the independent-process model are source evidence only. Live two-app verification remains pending Stage 7. |

## 6. Installer, upgrade, uninstall (S-030…S-032) — H6

| Scenario | H | Status | Evidence |
|---|---|---|---|
| **S-030** clean Windows install + launch + poll, no extra runtime install | H6 | ✅ partial Windows runtime evidence; clean-machine acceptance still pending | The Stage 7 handoff records the self-contained helper and packaged payload gates. The 2026-08-07 source was rebuilt and installed, and installer SHA-256 `52c0d4d004d4fd7934c19a0f2e76d88bd3e8da2a4b3cf81f73068722b2dfdeab` was verified before bounded live PowerPoint runs. This is not a new clean-machine or lifecycle acceptance claim. |
| **S-031** in-place upgrade with same app identity preserves settings | H6 | ✅ Implemented at source; Windows runtime evidence pending | `electron-builder.yml` has stable `appId: com.ontime.ppttimer`, package-version-derived installer naming, and no auto-update; the same identity is the declared in-place upgrade path. `settings-schema.ts`/`settings-store.ts` retain the persisted settings surface. A real newer-installer upgrade with saved settings has not run: **Stage 7 pending**. |
| **S-032** uninstall removes program files but keeps user settings | H6 | ✅ Implemented at source; Windows runtime evidence pending | `electron-builder.yml:nsis` sets `deleteAppDataOnUninstall: false` for the assisted per-user NSIS installer, explicitly preserving user data. Normal uninstall/reinstall behavior has not run on Windows: **Stage 7 pending**. |

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
| Installer: Windows x64, stable app identity across versions, fresh install + in-place upgrade + settings-preserving uninstall | H6 | ✅ Implemented at source; current build/install/hash evidence recorded; lifecycle acceptance pending | `apps/ppt-timer/electron-builder.yml` declares `appId: com.ontime.ppttimer`, x64 NSIS and `deleteAppDataOnUninstall: false`. The 2026-08-07 current source was rebuilt and installed and its installer hash verified; upgrade/uninstall acceptance remains **not run**. |

---

## 9. Constraints (cross-cutting)

| Constraint | Status | Evidence |
|---|---|---|
| One canonical capability — reuse the native STA helper and canonical reducer constants; standalone-only scheduling/display confirmation remains local | ✅ | Shared `presentation-core/powerpoint-normalize.ts` constants are `POWERPOINT_DEBOUNCE_MS=600`, `POWERPOINT_VIDEO_CLEAR_POLLS=2`, `POWERPOINT_PLAYING_DELTA_MS=200`; `powerpoint-view.ts` uses `POWERPOINT_END_INFER_MS=250`. Native `Program.cs` builds an all-or-nothing ordered descriptor cache from a cold full scan; warm complete-v1 sweeps read `Player.State` for every cached ID and use transition plus rotating active/stopped `CurrentPosition` refreshes, falling cold on uncertainty. Same-slide descriptor edits remain an experimental limitation. Standalone `playback-poll-policy.ts` owns its adaptive cadence, while `video-status-stabilizer.ts` owns ended > explicit status > inference and 350 ms pause confirmation; none mutates canonical normalized state. |
| No PowerShell/AppleScript fallback in the standalone | ✅ | `apps/ppt-timer` imports only `@ontime/ppt-bridge` + `@ontime/presentation-core`; helper discovery (`helper-discovery.ts`) feeds only the canonical exe; failure → `unavailable` (S-002), never a fallback transport. Boundary rule `ppt-timer-standalone` enforced. |
| Local playback projection | ✅ | See S-017; confirmed-playing clocks continue to known-duration zero, confirmed non-playing, or actual unavailable. One numeric outlier is ignored and correction requires two advancing consistent samples beyond strict 1,500 ms drift. |
| No stale numeric time after failure | ✅ | See S-002 / S-013. |
| No tray / background process | ✅ | See S-024. |
| No auto-update | ✅ | No update code/config or `publish` block; upgrade is intentionally user-initiated with a newer installer using the stable H6 `appId`. |
| Companion regression bar | ✅ | See S-028 (165/165 green in final source acceptance). |

---

## 10. Divergences (unreconciled detail)

| # | Scenario | Spec side | Code side | Disposition |
|---|---|---|---|---|
| D-1 | S-026 / S-011 | Helper primary identity and visible headline focus | **Fixed (re-audit PASS):** helper `observation.primaryVideoId` remains canonical diagnostic metadata and is threaded into `slide_observed`; the standalone `focus-tracker.ts` separately selects the visible headline by most-recently-started still-playing recency with deterministic fallback. The tracker never rewrites the helper identity and clears diagnostic metadata on terminal/no-signal outcomes. | **Fixed at source** (final source acceptance). |
| D-2 | S-026 | report keyed by protocol version | **Fixed (re-audit PASS):** `getProtocolVersion()` exposes the validated `observation.protocolVersion`; `main.ts:diagMeta()` reads it lazily at copy-diagnostics (`getDiagnosticsReport → buildReport(diagMeta())`); clears to `null` on terminal/no-signal. Tests: "surfaces the validated observation protocol version" (2), "clears … on a terminal/no-signal transition" (→ null). | **Fixed at source** (final source acceptance). |
| D-3 | S-033 | link text "Need full show control? Try OnTime" | **Fixed (re-audit PASS):** `renderer/main.ts` renders byte-exact `'Need full show control? Try OnTime'`; `if (view.ctaAvailable)` hidden-when-unset guard unchanged. Test: "uses the exact spec CTA copy (S-033 D-3)". | **Fixed at source** (final source acceptance). |
| D-4 | S-033 | one allowlisted OnTime URL | `UPSELL_URL_CONSTANT=''` (CTA hidden) | **Accepted-with-reason**: spec OQ-1 explicitly permits hiding the link until the canonical URL is chosen. Blocks private-beta *visibility* of the link only; not a source defect. |
| D-5 | S-026 (minor) | helper/app versions | Current source uses package version `0.1.0-beta.1`; Electron `app.getVersion()` supplies the app value, and the helper publish/workflow carries verified product/informational SemVer plus numeric PE `FileVersion` `0.1.0.1`. | **Fixed at source**: version wiring is an H6 source-accepted surface; actual PE/installer evidence remains Stage 7. |
| D-6 | S-026 (minor) | "Windows/Office bitness/version when discoverable" | only `windowsBitness=process.arch`; no Office bitness | **Accepted-with-reason**: spec says "when discoverable"; Office bitness discovery is a Windows-host task. |

---

## 11. P0 / P1 blockers

- **P0 — none.** No correctness, stale-timing, security, or data-loss defect was found. The "no stale numeric time after failure" invariant (S-002/S-013) is enforced at every layer and directly tested.
- **P1 — none.** The final source-acceptance audit records all prior P0/P1/P2 findings fixed at source.
- **Feature-level remaining gates (not source defects):** The current source has been rebuilt, installed, hash-verified, and exercised in bounded Companion-closed live helper-poll runs. Click-to-visible start/pause latency was not instrumented or certified. The full media-transition/stall matrix, displays/mixed DPI, Companion coexistence, diagnostics/recovery acceptance, and upgrade/uninstall remain open; the S-033 destination remains unset under OQ-1, so its CTA remains securely hidden. Stage 8 signing is also pending. H5 and H6 source are source-accepted.

## 12. Historical validation results (original macOS/source checkpoint; preserved)

| Command | Result |
|---|---|
| Final source-acceptance basis | base `fceb200…`; H1–H6 source checkpoint `5193084…`, committed but not pushed (later docs-only metadata commits excluded; no PR/issue-state change) |
| `npm run test --workspace @ontime/presentation-core` | ✅ **105 pass** |
| `npm run test --workspace @ontime/ppt-bridge` | ✅ **56 pass** |
| `npm run test --workspace apps/ppt-timer` | ✅ **174 pass** |
| `npm run test --workspace ontime-companion` | ✅ **165 pass / 0 fail** |
| `npm run typecheck --workspace @ontime/{presentation-core,ppt-bridge}` and `apps/ppt-timer` | ✅ no diagnostics |
| `npm run boundaries`; `npm run guardrails:static`; ordered core/bridge `build:cjs` + `smoke:cjs`; `npm run build --workspace apps/ppt-timer` | ✅ final source-acceptance PASS (258 modules / 614 dependencies for boundaries) |
| focused version/workflow tests; `git diff --check fceb200 -- .` | ✅ 18 focused tests; whitespace gate exit 0 with no output |

Test files were read (not just run) for the load-bearing scenarios — `view.test.ts`, `renderer/main.test.ts`, `session-host.test.ts`, `diagnostics.test.ts`, `settings-store.test.ts`, `ipc-contract.test.ts` — and assert real spec invariants (exact state copy, `timeMs`-absent on `unavailable`, stale-revision drop, `.corrupt-<ts>` quarantine, exact-match allowlist, no renderer-supplied URL).

---

## 13. Coverage proof

- **Audited** (every spec item checked): scenarios S-001, S-002, S-003, S-004, S-005, S-006, S-007, S-008, S-009, S-010, S-011, S-012, S-013, S-014, S-015, S-016, S-017, S-018, S-019, S-020, S-021, S-022, S-023, S-024, S-025, S-026, S-027, S-028, S-029, S-030, S-031, S-032, S-033; Proposed Surface (UI states + orthogonal indicators, Window, In-window controls, Persisted fields, Diagnostics report, Upsell link, Installer); Constraints; Open Questions OQ-1…OQ-4 reviewed for gating effect.
- **Unreconciled / pending execution:**
  - **Current source packaging:** rebuilt, installed, and SHA-256 verified on 2026-08-07; this does not by itself prove clean-machine, upgrade, or uninstall behavior.
  - **Partially run:** Companion-closed normal warm helper-poll duration and observed timeout/restart recovery. Click-to-visible start/pause latency was not instrumented or certified; full play/pause/end/seek/stall coverage is not claimed.
  - **Not run:** displays/mixed DPI, Companion coexistence, full recovery/diagnostics acceptance, and installer upgrade/uninstall acceptance.
  - **Accepted-with-reason:** D-4 (S-033 URL unset — OQ-1 fallback) and D-6 (Office bitness — "when discoverable"). D-5 version placeholders are fixed at source.
- **Open Questions (release-gate status):** OQ-1 canonical URL — mechanism built, URL unset, CTA hidden; OQ-2 Office x86 and OQ-3 Windows 10 support wording — Stage 7/release decision; OQ-4 public signing identity — Stage 8. None changes current source conformance.

### Current Windows closeout checkpoint — 2026-07-30

| Evidence | Result |
|---|---|
| Current Windows evidence | The [Stage 7 handoff](../progress/issue-001-stage-7-windows-2026-07-29.md) is the current source of truth; previous Windows packaging/install/launch evidence passed. |
| Current final source changes rebuilt into a new installer | **NOT YET REBUILT/PACKAGED**. |
| Live PowerPoint media | **NOT RUN**. |
| Displays / mixed DPI | **NOT RUN**. |
| Recovery / diagnostics | **NOT RUN**. |
| Companion coexistence | **NOT RUN**. |
| Installer upgrade / uninstall acceptance | **NOT RUN**. |

At this dated checkpoint, H5 and H6 were source-accepted and the then-current source changes still required a new installer. That historical result is preserved and is superseded for build/install and bounded live helper-poll evidence by the 2026-08-07 checkpoint below. Stage 7 full acceptance and Stage 8 signing remain open; no PR or issue-state action is claimed here.

### Current Windows live checkpoint — 2026-08-07

Companion was closed for these runs. Measured normal warm helper poll durations were:

| Slide media | Normal warm helper poll duration | Samples | Prior baseline |
|---|---:|---:|---:|
| 1 video | median 770 ms; range 439–783 ms | 6 | 1.1–2.0 s |
| 2 videos | median 923 ms; range 898–969 ms | 3 | 2.6–3.3 s |
| 5 videos | median 1,254 ms; range 1,221–1,607 ms | 6 | 5.2–5.6 s |

Separately, the user reported the behavior as much better. The diagnostic values are helper poll durations; click-to-visible start/pause latency was not instrumented or certified by this log, so no strict sub-one-second claim is made, including for the five-video case. Values of `10,802,470 ms` and `651,594,668 ms` were excluded as machine suspend/resume artifacts; they are not normal helper poll duration. Timeout/restart recovery was observed, but is recovery evidence rather than a normal-duration sample and does not complete S-027 acceptance.

The tested source was rebuilt and installed, and installer SHA-256 `52c0d4d004d4fd7934c19a0f2e76d88bd3e8da2a4b3cf81f73068722b2dfdeab` was verified. The dated 2026-07-30 checkpoint above remains historical; its statements that the then-current changes were unbuilt or live media was entirely unrun are superseded only by this bounded helper-poll evidence. Full Stage 7 acceptance and Stage 8 signing remain open.
