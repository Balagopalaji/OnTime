---
Type: Tasklist
Status: current
Owner: KDB
Last updated: 2026-08-07
Scope: Active tasks and notes.
---

# Tasks

## Active Productization Track

- PowerPoint capability, reusable timer displays, lightweight/full-controller composition, LAN/cloud viewers, clean outputs, controls, and future NDI: see `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`.
- The current standalone release contract remains `docs/spec/standalone-powerpoint-video-timer.spec.md`; live Windows evidence belongs in `docs/progress/issue-001-stage-7-windows-2026-07-29.md`.
- This productizes extracted modules alongside the god-file rebuild; it does not replace `docs/rebuild-plan.md` or relax extraction guardrails.

## Bugs / Follow-ups

- [ ] Standalone PPT Timer: enforce one app instance, focus/show the existing window after repeated launch, and measure cold/warm launch-to-visible time. Stress testing opened multiple app/helper instances and produced high apparent CPU/fan load.
- [ ] Standalone PPT Timer: reproduce the 33-second single-video sequence that initially displayed about 24 seconds and later jumped back to about 30 seconds. Capture raw video observations plus renderer anchor/correction decisions and add a deterministic regression before changing clock policy.
- [ ] Multi-tab controller reloads when another tab opens `/` (same browser/origin). Controller tab reloads and lands on dashboard (or restores last path). Console shows Firestore listen errors (`INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9/b815)` and `ERR_BLOCKED_BY_CLIENT`). Tried: ProtectedRoute grace windows, auth debounce, sessionStorage lastPath, Firestore long-polling init—none resolved; reverted changes. Likely root cause is Firestore transport/listen crash causing reload. Investigate Firestore transport fallback (long polling / fetch streams) and/or add app-level handling for listen failures without reload.

# Active Tasks (Phase 2 prep)

- Planning: Define Phase 2 scope and milestones using current PRDs and `phase-2-overview.md`.
- Companion reliability: monitor auto-reconnect/auto-join behavior; keep the skipped `reorderRoom.mock.test.tsx` noted for later refactor.
- UI polish (later pass): viewer minimal mode is live; broader polish to be scheduled.
- Phase 3 backlog: Local network viewer option (Companion-served viewer bundle + QR + token flow).
- Enterprise: Controller settings to choose a fixed local port (Enterprise-only, in-app).
- QA checklist: multi-tab/mode switch, Companion restart, dashboard previews stay fresh.
- Companion RAM budgets: reassess Minimal/Show Control/Production targets using packaged builds (dev/headless exceeded Minimal target). Deferred until pre-release (feature set still shifting).
- Migration: Drop v1→v2 migration from the active backlog (no users on v1); treat v2 as baseline. Keep migration notes archived only.
- Phase 3 backlog: Add an Electron controller option to send the viewer to a second display (fullscreen) for internal screen workflows.
- Phase 3 backlog: Prefer VLC when opening external videos (fallback to default player if VLC not installed).
- Active productization: Standalone PowerPoint video timer app (lead-in funnel) — current contract `docs/spec/standalone-powerpoint-video-timer.spec.md`; continuation roadmap `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`.
- PowerPoint video timing (Windows): See `docs/ppt-video-debug.md` for current findings and the STA helper plan.
- PowerPoint: Consider pre-scanning all slides for embedded media so we can flag video slides before playback.
- Pre-release cleanup: decide whether to remove or keep `COMPANION_DEBUG_PPT_VERBOSE` diagnostics.
- PowerPoint: Add multi-video slide handling (prefer currently playing media; fallback to first playable) and test with multiple embedded videos.
- Dev builds: use `npm run dist:dev` in `companion/` and `controller/` to auto-increment `-dev.N` suffix for clean reinstalls.

## Phase 2 Actionables (Need Implementation)
- [ ] Viewer-only Electron build target (distinct app/build config).
- [ ] Crash recovery banner on force-quit relaunch ("Recovered session").
- [ ] Auto-update pipeline for Electron controller (canary + stable). Deferred until pre-release.
- [ ] RAM target reduction work for Minimal mode (currently over 50MB). Deferred until pre-release (re-baseline after features stabilize).
- [ ] Add optional version bump step for macOS builds (mirror Windows script); not urgent since mac install doesn’t require uninstall/reinstall per build.
