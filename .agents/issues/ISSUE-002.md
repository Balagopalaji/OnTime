---
id: ISSUE-002
title: "Add Downstage remote PowerPoint viewer surfaces"
status: in-progress
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
- Deep Plan:
  `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md`
- Endpoint/process contract:
  `docs/spec/downstage-remote-powerpoint-viewer.endpoints.md`
- Conformance matrix:
  `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`
- Deep Plan critique and resolution ledger:
  `docs/reviews/downstage-remote-powerpoint-viewer-deep-plan-critique-2026-08-26.md`
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

## Readiness decision

The 2026-08-26 documentation revision records the settled architecture:

- one visible Downstage PPT Video Timer remains the sole helper/COM/host owner;
  a hidden app-internal utility-process sidecar owns publisher authentication,
  credentials, cloud/LAN publication, heartbeat, links, and retry;
- cloud v1 supports and load-tests 50 concurrent viewers per session as an
  advisory target, without viewer leases or active-viewer admission counts;
  LAN remains capped at 20 devices.

The canonical Deep Plan, endpoint contract, and initial Not-built conformance
matrix are linked above. The rerun readiness verdict is `implementable`; S0
(Firebase emulator parity) is the first safe bounded implementation slice.
Production Auth, rate-limit, TTL, 50-viewer load/cost/latency, packaging, and
real Windows Presenter View checks remain staging/release gates rather than
implementation-start blockers.

The outer backlog orchestrator moved the item to `in-progress` after the
2026-08-26 readiness rerun returned `implementable`. Implementation begins with
S0 in a dedicated `backlog/ISSUE-002-*` worktree; status/closure remains owned
by that outer layer.
