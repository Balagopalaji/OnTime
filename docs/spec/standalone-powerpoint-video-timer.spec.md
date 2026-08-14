# Standalone PowerPoint Video Timer — Spec

Tracking: `ISSUE-001`. Branch `backlog/ISSUE-001-standalone-ppt-timer`. Base SHA `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`.
Deep Plan: `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`. Product draft: `docs/phase-3-standalone-ppt-timer.md`.

## Problem

Church and theater presenters running a PowerPoint slideshow with embedded video need to see slide position and video remaining/elapsed time without running the full OnTime app or a Companion room. Today the only proven, working way to read that information is Companion's native Windows STA COM helper (`ppt-probe.exe`) feeding the Controller's presentation panel — a path that requires rooms, sockets, and the rest of OnTime. There is no lightweight, free, Windows-only viewer of that same PowerPoint state, and no upsell funnel into OnTime for presenters who only need a timer.

## Goals

- **G1** — Reuse the single canonical PowerPoint capability (the existing native STA COM helper and its established polling/debounce/cache/clearing/primary-video-selection/status-inference behavior) that Companion already uses; do not build or ship a second implementation of PowerPoint logic, and do not regress Companion's existing presentation/live-cue behavior.
- **G2** — Show a compact, optionally always-on-top window with slide number, total slides, video remaining-or-elapsed time, and play/pause/ended state, matching the full set of states PowerPoint/the helper can report.
- **G3** — Persist window placement, display selection, size preset, always-on-top, and timing-mode settings across restarts, tolerating corrupted settings data.
- **G4** — Provide a one-click, redacted diagnostics report suitable for user support without leaking presentation content, file paths, or personal data.
- **G5** — Recover automatically from helper failures (crash, timeout, missing executable) without ever displaying stale numeric timing.
- **G6** — Ship as a Windows installer that supports fresh install, in-place upgrade, and uninstall while preserving user settings.
- **G7** — Provide a one-click upsell path to the OnTime website without requiring Companion, cloud, or local-server connectivity.

## Non-Goals

- Companion's room, Socket.IO, controller-sync, timer, or disk-cache features.
- Cloud or local-server connectivity of any kind.
- Viewer routing or show-control commands.
- macOS or Linux support (Windows-only for this product).
- PowerShell (or AppleScript) as a fallback transport for the standalone app — see Constraints.
- Auto-update.
- Tray or background-process mode (the app has exactly one window and no persistent background presence).
- Microsoft Store / MSIX distribution.
- Deterministic selection among multiple concurrently running PowerPoint instances (the app surfaces a warning only; see S-012).
- General-purpose or run-of-show timers, rundowns, or any other OnTime feature outside PowerPoint slide/video timing.
- Code signing and public-release distribution mechanics for this beta (private beta may ship unsigned with checksums; see Open Questions for the public-release gate).

## Constraints

- **Windows-only.** The private beta targets Windows only; there is no macOS/Linux build of this product.
- **Shared canonical PowerPoint capability.** The standalone app and Companion consume the same native STA COM helper, canonical normalization, and established behavior constants: 600 ms identity-change debounce (timing changes for an already-announced identity commit immediately), two-consecutive-no-video-poll clearing before reporting no video, strict `>200 ms` elapsed-delta playing inference when explicit status is absent, and a 250 ms end-inference threshold. The native helper performs a cold full descriptor scan, then uses an all-or-nothing ordered descriptor cache for warm complete-v1 state sweeps: every cached shape ID receives a fresh `Player.State` read, while `CurrentPosition` is read on transitions and by bounded rotating active/stopped refreshes. Any incomplete traversal, missing/invalid player state, identity uncertainty, or other cache uncertainty falls back to a cold scan. Same-slide descriptor edits during an already-warm scope remain an experimental limitation and are not a private-beta acceptance claim. The shared helper/session path remains the source of canonical normalized state for both consumers.
- **Standalone-only scheduling and display stabilization.** These policies do not mutate canonical normalized state and do not affect Companion: a bounded 200 ms confirmation burst; a 500 ms armed cadence when a nonterminal ready/paused video could start; a 1,000 ms cadence for no media, all-playing, all-terminal, and failure states; per-video cumulative movement episodes that trigger once after strict `>200 ms` movement; 1,000 ms of stationary evidence before movement re-arms; and a separate 350 ms initial connecting/ready → paused presentation gate. Status precedence is ended evidence first, then explicit `playing`/`paused`, then inferred evidence. A contradictory non-playing observation must remain stable for 350 ms before an accepted playing status changes; confirmed playing cancels the pending pause, while ended, scope/media changes, and large seeks remain immediate.
- **No duplicate canonical policy.** The standalone must not duplicate canonical identity, normalization, or clearing logic, but it may own scheduling and display-status stabilization around the shared normalized state.
- **No PowerShell fallback in the standalone.** Companion's PowerShell/AppleScript fallback transports exist for Companion only. If the canonical helper is missing, times out, or crashes, the standalone shows the operational-failure state (S-002); it never silently degrades to a different data source.
- **Bounded local playback projection.** The canonical helper remains authoritative for playback state and corrections. Once playing is confirmed, the standalone advances a deterministic monotonic clock through sparse or delayed readings until the known duration reaches zero, a non-playing transition is confirmed, or timing becomes actually unavailable. A single contradictory numeric outlier is ignored; a drift correction requires two advancing, mutually consistent samples beyond the strict 1,500 ms threshold. Stop/pause/end, identity or duration change, and actual timing loss remain authoritative boundaries. An operational failure removes numeric timing immediately.
- **No stale numeric time after failure.** Any operational failure (missing helper, timeout, crash, invalid output, COM unavailable) immediately removes visible numeric timing; only sanitized diagnostics may retain a stale raw value (S-002, S-013).
- **No tray/background process.** Closing the app's only window terminates the helper process and exits the app (S-024).
- **No auto-update.** Upgrading requires the user to run a newer installer with the same application identity (S-031).
- **Companion regression bar.** Companion's existing presentation/live-cue event sequence and Controller display must be unchanged and its existing automated test suite must remain green after this feature ships (S-028).

## Scenarios

### Presentation and video state display

- **S-001** — Given the app has just launched and no poll has completed yet, when the window renders, then it shows a "Connecting to PowerPoint…" state with no time displayed.
- **S-002** — Given the app is displaying any live state, when the canonical helper becomes unavailable (missing executable, timeout, crash, invalid output, or COM unavailable), then the app shows "PowerPoint timing unavailable" with a retry indicator and no numeric timing.
- **S-003** — Given the helper reports PowerPoint is not running, when the app receives that result, then it shows "PowerPoint is not running" and no timing.
- **S-004** — Given PowerPoint is running but not in a slideshow, when the app receives that result, then it shows "No slideshow running".
- **S-005** — Given a slideshow is running and the canonical clearing policy confirms no video on the current slide, when the app renders, then it shows the slide number and title/filename plus "No video on this slide".
- **S-006** — Given a slideshow slide has media but timing is absent or flagged unavailable, when the app renders, then it shows slide/title, the selected video (or multi-video count), and `--:--` in place of a time value.
- **S-007** — Given the canonical selected video status is "playing", when the standalone accepts the playing display status, then it shows a playing badge with the current remaining-or-elapsed time per the active timing-mode setting. Status precedence is ended evidence, then explicit `playing`/`paused`, then inferred evidence. A contradictory non-playing sample is held until 350 ms of stable evidence exists; confirmed playing cancels the pending pause, while ended, scope/media changes, and large seeks remain immediate.
- **S-008** — Given the canonical selected video status is "paused", when the standalone accepts the paused display status, then it shows a paused badge with the last validated remaining/elapsed value frozen (not advancing). Explicit paused status outranks inferred movement only after the 350 ms pause-confirmation interval; confirmed playing cancels a pending pause, while ended evidence remains highest precedence and scope/media changes and large seeks remain immediate.
- **S-009** — Given the canonical state reports remaining time of zero, an explicit ended status, or elapsed within the 250 ms end-inference threshold of duration, when the app renders, then it shows "Ended" with `00:00` remaining or the final elapsed value.
- **S-010** — Given a video exists on the slide with no play/pause/end evidence yet, when the app renders, then it shows "Ready" with the video's duration if known, otherwise `--:--`.
- **S-011** — Given one or more videos are present on the current slide, the persisted headline-selection mode defaults to `longest-remaining` and may be changed to `latest-started`. While any video is actively playing, both modes consider only videos whose resolved status is `playing`; paused, ended, and ready/not-yet-started videos are excluded. `longest-remaining` selects the playing video with the greatest usable observed remaining time, breaking ties by most-recent start rank and then shape order. If any playing video has no usable remaining time, the headline shows timing unavailable rather than a misleading aggregate. `latest-started` selects the most-recently-started video still playing. When no video is playing, both modes preserve the existing canonical/helper-primary fallback that identifies the next-to-play video and exposes its ready/paused/ended state and time. With multiple videos the app also shows an "N videos" indicator. The helper primary identity remains raw diagnostic/canonical metadata; standalone headline selection does not rewrite that helper identity.
- **S-012** — Given the helper reports a process/COM-affinity mismatch (more than one PowerPoint instance), when the app renders, then it shows a warning overlay stating "Multiple PowerPoint instances detected; verify the deck" in addition to the current state.
- **S-013** — Given the app is showing a live "playing" or "paused" state with a numeric time, when the helper subsequently fails (per S-002), then the numeric time is removed from the display in the same update, with no intermediate frame showing a stale number.
- **S-014** — Given the app is displaying remaining time, when the user toggles the remaining/elapsed setting, then the displayed number switches accordingly without altering the underlying canonical presentation state or triggering a new poll.
- **S-015** — Given the helper does not report a total slide count, when the app renders slide position, then it shows the known slide number and `--` in place of the missing total (e.g., "Slide 8 of --").
- **S-016** — Given a presentation file has a full file-system or network path, when the app displays the file name, then it shows only the basename, never the full path.
- **S-017** — Given the app has a trusted playing measurement, when time elapses before the next usable poll reading arrives, then the accepted clock continues deterministically to the known duration boundary rather than freezing because a fixed silence interval elapsed. Newer consistent playing views confirm without re-anchoring. One contradictory numeric outlier is ignored; a correction requires two advancing samples that are mutually consistent and whose drift is strictly greater than 1,500 ms. A confirmed non-playing transition anchors once, repeated non-playing samples retain that frozen anchor, omitted timing does not erase a usable baseline, and first usable timing is adopted only when no baseline exists. The clock stops at known-duration zero, on confirmed stop/pause/end, identity or duration change, or actual timing unavailability; operational failure removes numeric timing immediately.

### Window and settings persistence

- **S-018** — Given no prior settings exist, when the app launches for the first time, then the window opens at 360×220 CSS px, no smaller than 320×180, and is user-resizable with compact/large presets available.
- **S-019** — Given default settings, when the app launches, then always-on-top is enabled by default and an in-window toggle lets the user disable it without leaving the window.
- **S-020** — Given multiple displays are connected, when the user selects "Move to display" for a target display, then the window recenters within that display's work area.
- **S-021** — Given the user has moved the window, changed display, resized/selected a preset, toggled always-on-top, changed timing mode, or changed headline-selection mode, when the app is closed and relaunched, then all of those settings are restored exactly as last set.
- **S-022** — Given saved window bounds are no longer substantially inside any current display's work area (e.g., after a display is disconnected or resolution/DPI changes), when the app launches, then the window is clamped or recentered onto the saved display if still present, or the primary display otherwise.
- **S-023** — Given the settings file on disk is malformed or unreadable, when the app launches, then it renames the file with a `.corrupt-<timestamp>` suffix, starts with default settings, and does not crash.
- **S-024** — Given the app's single window is open, when the user closes it, then the app terminates the canonical helper process and exits; no window, tray icon, or background process remains.

### Diagnostics

- **S-025** — Given the user selects "Copy diagnostics", when the report is generated, then the clipboard content contains basenamed file paths only (no full user or presentation paths), no document contents, no environment variables, no tokens, no usernames, and no other OnTime product state.
- **S-026** — Given diagnostic-relevant events have occurred (helper start/exit/timeout/restart/close, sanitized and rate-limited `poll_slow` helper-poll diagnostics, validation warnings, availability transitions, process count/affinity, slide number, media count, selected media identity, display ID/scale factor, window bounds), when the user copies diagnostics, then the report includes those events from the most recent in-memory history (up to the last 100 events), each keyed by app/helper/protocol version and signing status.

### Process recovery

- **S-027** — Given the canonical helper process crashes or exits unexpectedly while the app is running, when the crash is detected, then the app automatically attempts to restart the helper with bounded backoff (never an immediate tight retry loop and never giving up indefinitely) and returns to a live display state once the helper responds again, without requiring user action.

### Companion compatibility and canonical shared behavior

- **S-028** — Given Companion's existing PowerPoint presentation/live-cue event sequence and Controller display behavior before this feature ships, when the standalone app is added to the repository and shipped, then Companion's presentation/live-cue event sequence, timing, and Controller display are unchanged, and Companion's existing automated presentation/live-cue test suite continues to pass without expectation changes.
- **S-029** — Given Companion and the standalone app are both running against the same PowerPoint instance at the same time, when either app polls and displays state, then each app independently reflects PowerPoint's current state using the same canonical debounce/cache/clearing behavior, and neither app's operation blocks, corrupts, or alters the other's displayed state.

### Installer, upgrade, and uninstall

- **S-030** — Given a clean Windows 11 (or ESU/LTSC-supported Windows 10) target machine with no prior installation, when the user runs the installer, then the app installs, launches, and can poll PowerPoint without requiring the user to separately install any additional runtime.
- **S-031** — Given an existing installation with saved settings, when the user runs an installer for a newer version with the same application identity, then the upgrade completes in place and all previously saved settings (bounds, display, preset, always-on-top, timing mode) are preserved after the upgrade.
- **S-032** — Given an existing installation with saved settings, when the user performs a normal uninstall, then the application program files are removed but the user's settings data remains on disk (not deleted), so a later reinstall of the same version line can recover it.

### Upsell link

- **S-033** — Given the app displays the "Need full show control? Try OnTime" link, when the user activates it, then the app opens exactly one allowlisted OnTime website URL in the user's default browser; the app denies navigation to any other URL and denies opening new in-app windows.

## Proposed Surface

- **UI states** (mutually exclusive per current poll result, precedence high-to-low): `connecting`, `unavailable`, `powerpoint-not-running`, `no-slideshow`, `no-video`, `timing-unavailable`, `playing`, `paused`, `ended`, `ready`; plus the orthogonal `multiple-videos` indicator and `multiple-instance-warning` overlay, both of which can accompany any of the above states.
- **Window**: default 360×220 CSS px, minimum 320×180, resizable, compact/large presets, "Move to display" action.
- **In-window controls**: always-on-top on/off toggle; remaining-vs-elapsed timing-mode toggle; longest-remaining-vs-latest-started headline-selection toggle.
- **Persisted settings fields**: window bounds, selected display ID, size preset, always-on-top (boolean), timing mode (remaining/elapsed), headline-selection mode (longest-remaining/latest-started), schema version.
- **Diagnostics report** ("Copy diagnostics"): app/helper/protocol versions and signing status; Windows/Office bitness/version when discoverable; helper start/exit/timeout/restart/close history; validation warnings and availability transitions; PowerPoint process count/affinity; current slide number, media count, selected media identity; display ID/scale factor and window bounds — all subject to the redaction rules in S-025.
- **Upsell link**: single build-time-constant OnTime website URL, opened only in the system default browser.
- **Installer**: Windows x64 installer with a stable application identity across versions, supporting fresh install, in-place upgrade, and settings-preserving uninstall.

## Open Questions

- **OQ-1 — Canonical OnTime website URL.** The exact production URL for the upsell link/allowlist (S-033) is not yet defined. *Recommendation:* confirm the exact production URL before private beta ships; if beta must ship before the URL is finalized, hide or disable the link rather than allowlisting a placeholder or wildcard destination.
- **OQ-2 — Office x86 (32-bit) support promise for private beta.** It is not yet known whether the canonical helper works correctly against 32-bit Office. *Recommendation:* test the native helper against x86 Office during beta QA; if it fails, explicitly scope private-beta support to x64-only in release notes rather than silently omitting the limitation.
- **OQ-3 — Windows 10 support wording.** Mainstream Windows 10 support has ended industry-wide. *Recommendation:* limit tested/claimed support to Windows 11 plus ESU-enrolled or LTSC Windows 10 test machines (per S-030), and word any public support statement to avoid implying general Windows 10 security support.
- **OQ-4 — Public-release code-signing identity.** The signing provider/publisher identity for a future public (non-beta) release is not chosen. *Recommendation:* this decision only blocks the public-signed-release gate, not private beta, which may ship unsigned with checksums and named-tester instructions; select the signing provider (e.g., Microsoft Artifact Signing or an approved CA) through procurement/security review before attempting a public release.
