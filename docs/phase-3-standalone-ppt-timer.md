---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-01-12
Scope: Phase 3 draft for a standalone PowerPoint video timer app.
---

# Phase 3 Draft: Standalone PowerPoint Video Timer

Purpose
- Ship a lightweight, free Windows app that shows PowerPoint slide + video timing.
- Use it as a funnel to introduce OnTime (upsell path).

Goals
- Windows-only MVP (native helper already exists).
- Minimal UI: current slide number, total slides, video remaining/elapsed, play/pause state.
- Stable polling using the existing `ppt-probe.exe` helper.
- Low footprint and fast startup.

Non-goals
- Full Companion features (rooms, sockets, controller sync, timers, cache).
- Cloud/local server connectivity.
- Viewer routing or show control commands.

Proposed UI
- Title: "PowerPoint Video Timer"
- Status line: "No slideshow" / "Slide 8 of 14" / "Video 00:32 remaining"
- Secondary: file name, play/pause badge.
- Always-on-top by default with a user toggle to disable.
- Default placement: keep the timer on the presenter/main display (not the slideshow output).
- Allow manual move or a simple "Move to display" menu for multi-monitor setups.
- Small window footprint that lives in a corner of the presenter screen.
- Inline toggles in the window (no extra menus required):
  - Always-on-top on/off.
  - Remaining vs elapsed display.
- Include slide number in the compact layout (helps show callers without adding much space).
- Multiple videos on one slide:
  - Prefer the actively playing media if detectable.
  - Otherwise fall back to the first playable media on the slide.
  - Surface a small indicator if multiple videos exist.
- Upsell link: "Need full show control? Try OnTime" (opens website).

Technical approach
- Build a new Electron target (separate app config) or a small .NET tray app.
- Reuse:
  - `companion/ppt-probe` native helper (STA COM access).
  - Polling cadence + shape selection logic.
- Remove:
  - Rooms, socket server, token auth, controller state, cache, file ops.

Packaging
- Windows installer only (MSIX or NSIS, match current Electron build stack).
- Ship `ppt-probe.exe` in resources/bin.

Upsell path (draft)
- About screen or footer link to OnTime website.
- Optional CTA on launch: "Need run-of-show timers and companion control?"

Risks / open questions
- UI/UX polish and brand positioning.
- How to handle multiple videos on a slide.
- Whether to keep open-source or closed-source distribution.

Notes for future agents
- This app should remain intentionally scoped; avoid duplicating Companion features.
- Use `COMPANION_DEBUG_PPT_VERBOSE` equivalent only for dev builds.
