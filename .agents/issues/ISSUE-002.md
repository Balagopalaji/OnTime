---
id: ISSUE-002
title: "Add Downstage remote PowerPoint viewer surfaces"
status: blocked
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
ISSUE-002 starts from merged base
`d1ff0770ec5449fb3fce4a28665b5d84f41f4f50` (PR #145). The first delivery is
a standalone Windows show-laptop publisher plus read-only browser viewing. A
presentation session may later attach to a Downstage room, but the initial
contract must not require a room or the main controller.

The standalone PowerPoint countdown app in `apps/ppt-timer` already provides
the local timer panel, video disclosure list, and presentation status
semantics. ISSUE-002 builds around that shipped baseline; it does not replace
the local app or recreate its timer UI. The Windows helper is already
authoritative for local PowerPoint observation.
It exposes only the local `poll`/`exit` stdin protocol and must not gain cloud,
LAN, account, room, or viewer responsibilities. Remote publication begins at a
new host-side sanitized snapshot adapter outside `ppt-bridge` and
`presentation-core`.

## Acceptance criteria
- [ ] Contract-level remote-viewer scenarios cover Windows hosting, Mac/Windows
      desktop viewers, cloud URL viewing, LAN pairing, stale/reconnect behavior,
      and read-only permissions.
- [ ] A solo-agent implementation plan maps reuse versus new remote composition
      work and separates Mac-owned from Windows-owned validation.
- [ ] The Windows host remains authoritative and Presenter View/confidence
      monitor output stays clean in Remote host mode.
- [ ] Viewers do not require PowerPoint, COM, or the native Windows helper.
- [ ] The Deep Plan defines one source-neutral compact timer face/viewer shell
      and an adapter boundary: PowerPoint is the only v1 source, while a later
      rundown or standalone timer publisher can reuse the same surface without
      PowerPoint types, duplicated timer math, or viewer control authority.
- [ ] Exactly one Windows publisher owns a presentation session; multiple
      read-only viewers may consume it without receiving write/control access.
      LAN remains subject to the existing 20-device limit; the Deep Plan must
      define an explicit cloud service limit.
- [ ] A complete endpoint/data/rules matrix defines publisher authorization,
      viewer-link issuance, snapshot publication/subscription, resume,
      revocation, expiry, and deletion for cloud and later LAN delivery.
- [ ] The remote snapshot allowlist is versioned and tested; full paths,
      PowerPoint/COM process identity, helper diagnostics, and control fields
      never enter ordinary viewer payloads.
- [ ] Transition snapshots publish immediately; a 10-second liveness heartbeat,
      25-second stale threshold, and 60-second disconnected threshold stop
      viewers from advancing an untrusted countdown.
- [ ] The first read-only viewer link is session-scoped, resumable for 24 hours
      with publisher confirmation, revocable, and removed after seven days of
      inactivity.

## Detail / links
- Spec: `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
- Plan: `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
- RepoPrompt CE kickoff:
  `docs/prompts/issue-002-repoprompt-ce-planning-2026-08-25.md`
- Deep Plan revision prompt:
  `docs/prompts/issue-002-deep-plan-revision-2026-08-26.md`
- Worktree/progress handoff:
  `docs/progress/backlog-issue-002-remote-viewer-2026-08-25.md`
- Existing roadmap: `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`
- Existing transport/pairing references: `docs/local-offline-lan-plan.md`,
  `docs/interface.md`, `docs/phase-3-pairing-ux.md`,
  `docs/phase-3-cert-trust-ux.md`
- Backlog readiness evidence:
  `docs/progress/backlog-2026-08-25-issue-002-planning.md`

## Blocked

The 2026-08-25 spec/Deep-Plan readiness gate does not yet authorize
implementation. On 2026-08-26 the owner ratified one visible Downstage PPT
Video Timer with a separately bounded background publisher sidecar, plus an
advisory cloud support target of 50 concurrent viewers per session without hard
viewer leases in v1. LAN remains capped at 20. The canonical Deep Plan,
endpoint contract, conformance matrix, and readiness result must now be revised
and independently reviewed using the linked revision prompt. Issue status
remains blocked until that documentation gate passes.
