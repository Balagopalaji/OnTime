---
id: ISSUE-001
title: "Build standalone PowerPoint video timer"
status: in-progress
type: feature
priority: p1
labels: [area:presentation, area:desktop]
created: 2026-07-27
---

## What
Build the Windows-only OnTime PowerPoint Video Timer as a small standalone utility while preserving one canonical working PowerPoint capability shared with Companion.

## Acceptance criteria
- [ ] The working native C# STA helper and protocol have one canonical source and remain compatible with Companion.
- [ ] Companion-to-Controller presentation/live-cue behavior and existing tests remain green.
- [ ] The standalone app provides the private-beta UI, settings, display, diagnostics, recovery, and installer behavior in the linked spec and plan.
- [ ] Standalone dependency guardrails exclude rooms, Firebase, Socket.IO, sync, and Companion runtime imports.
- [ ] Automated tests, Windows package verification, user-facing smoke evidence, and spec-conformance evidence are recorded.

## Detail / links
- Spec: `docs/spec/standalone-powerpoint-video-timer.spec.md`
- Deep Plan: `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`
- Loop: `docs/progress/backlog-ppt-timer-2026-07-27.md`
- Source product draft: `docs/phase-3-standalone-ppt-timer.md`

## Source
Requested by user on 2026-07-27; GitHub authentication unavailable, so tracked in the file backlog.
