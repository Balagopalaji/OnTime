---
id: ISSUE-002
title: "Add Downstage remote PowerPoint viewer surfaces"
status: draft
type: feature
priority: p1
labels: [area:presentation,area:desktop,area:remote]
created: 2026-08-22
---

## What
Add Downstage remote PowerPoint viewer surfaces: a Windows Remote host mode,
cross-platform Mac/Windows read-only desktop viewers, and a cloud browser viewer
using the existing LAN/cloud transport foundations.

## Repro / context
<!-- bugs: steps, expected vs actual -->

## Acceptance criteria
- [ ] Contract-level remote-viewer scenarios cover Windows hosting, Mac/Windows
      desktop viewers, cloud URL viewing, LAN pairing, stale/reconnect behavior,
      and read-only permissions.
- [ ] A solo-agent implementation plan maps reuse versus new remote composition
      work and separates Mac-owned from Windows-owned validation.
- [ ] The Windows host remains authoritative and Presenter View/confidence
      monitor output stays clean in Remote host mode.
- [ ] Viewers do not require PowerPoint, COM, or the native Windows helper.

## Detail / links
- Spec: `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
- Plan: `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
- Existing roadmap: `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`
- Existing transport/pairing references: `docs/local-offline-lan-plan.md`,
  `docs/interface.md`, `docs/phase-3-pairing-ux.md`,
  `docs/phase-3-cert-trust-ux.md`
