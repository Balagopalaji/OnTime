---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-08-22
Scope: Follow-on planning brief for read-only Downstage PowerPoint remote observation.
---

# Downstage Remote PowerPoint Viewer — Planning Brief

## Relationship to existing work

This is a follow-on to ISSUE-001 and must start from the merged Downstage host
base. ISSUE-001 remains responsible for the Windows helper, local host behavior,
packaging, and real Windows/PowerPoint acceptance. This brief covers remote
observation and viewer surfaces; it must not reopen the accepted source work or
accumulate on the standalone host branch.

The previous Windows-builder handoff already established the key direction in
`docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md` and commit
`10ec8b3`:

- one PowerPoint capability with multiple shells;
- Windows show computer authoritative;
- native helper unaware of accounts, rooms, Firebase, browser clients, and
  cloud retry policy;
- cloud-first remote observation;
- browser viewer first, then cross-platform Downstage View;
- state snapshots rather than screen pixels;
- LAN as a later transport using the same contracts and security policy.

The feature contract is in
`docs/spec/downstage-remote-powerpoint-viewer.spec.md`.

## Reuse boundary

Reuse the existing:

- `@ontime/ppt-bridge` native/helper/session behavior on the Windows host;
- `@ontime/presentation-core` normalization, timing, selection, and projection;
- Companion LAN relay, HTTPS/WSS, private-subnet, pairing, viewer-token, and
  revocation foundations;
- Firebase/cloud room transport and existing viewer delivery;
- shared Downstage presentation panel and read-only viewer semantics.

Add only the missing remote composition layer:

- a host-side publisher/adapter that converts canonical presentation state to a
  transport-neutral remote snapshot;
- cloud and LAN transport adapters for that snapshot;
- a browser viewer surface and cross-platform desktop viewer surface;
- remote-host window behavior that does not force the local surface above
  Presenter View;
- end-to-end freshness, reconnect, stale-state, and viewer-permission gates.

The helper must remain local and transport-agnostic. Viewers must not install or
run PowerPoint, COM, or the Windows helper.

## Suggested solo-agent planning lanes

These are planning lanes, not permission to implement them in this pass:

### Lane A — Contract and source map

- Read the remote-viewer spec, the existing capability roadmap, `docs/interface.md`,
  `docs/local-offline-lan-plan.md`, `docs/client-prd.md`, pairing/trust UX docs,
  and the current viewer route.
- Map the existing presentation snapshot/live-cue path and identify what is
  already sufficient for PowerPoint video timing versus what is timer-only.
- Propose the smallest versioned remote snapshot and freshness policy without
  adding internal helper fields to viewer payloads.

### Lane B — Cloud-first browser path

- Define the authenticated/session-scoped read-only cloud delivery path.
- Reuse the existing viewer route and room/session authorization where safe.
- Prove full-snapshot reconnect, sequence rejection, stale-state display, and
  host-disconnect behavior with deterministic fixtures.

### Lane C — Cross-platform Downstage View

- Reuse the accepted PowerPoint panel and view model in a viewer-only desktop
  shell for macOS and Windows.
- Keep viewer builds free of the native Windows helper and PowerPoint runtime.
- Support both cloud and later LAN sources through the same viewer contract.

### Lane D — Windows remote-host mode

- On the Windows-owned branch, add a Remote host mode that keeps observation
  active while the local window is hidden, minimized, or below the show output.
- Validate that Presenter View and the confidence monitor remain unaffected.
- Keep this work separate from viewer packaging and from the ISSUE-001 release
  acceptance evidence.

### Lane E — LAN adapter and pairing

- Reuse Companion-served viewer delivery, HTTPS/WSS trust UX, private-subnet
  allowlist, pairing-code TTL, viewer-token TTL, max-device, and revocation
  policies.
- Reuse the cloud/browser snapshot semantics; do not create a LAN-only timing
  model.
- Keep LAN read-only permissions enforced at the transport boundary.

### Lane F — Integration and release evidence

- Test one Windows host with a Mac desktop viewer, a Windows desktop viewer, and
  a browser viewer.
- Cover playing, pause, resume, seek, end, replay, multiple videos, helper
  failure, host sleep/reconnect, duplicate/out-of-order snapshots, and stale
  state.
- Measure LAN and cloud update latency against the existing viewer targets.
- Record Windows/PowerPoint evidence separately from Mac/browser automated tests.

## Proposed delivery order

1. Ratify the remote snapshot and permission contract.
2. Prove the cloud browser viewer with fixtures and a real host-to-viewer path.
3. Add the cross-platform Downstage View shell.
4. Add Windows Remote host behavior and validate Presenter View cleanliness.
5. Add or finish LAN delivery using the same snapshot contract.
6. Add remote viewer acceptance evidence and only then consider control commands.

## Stop conditions

- Do not duplicate PowerPoint polling or countdown math in any viewer.
- Do not make the native helper know about cloud accounts, rooms, Firebase,
  pairing, or browser clients.
- Do not treat a frozen last snapshot as a live countdown after freshness expiry.
- Do not grant control permissions to a viewer token.
- Do not merge remote work into ISSUE-001 before the Windows host release gate is
  explicitly complete or a baton handoff is recorded.

## Planning output expected from the next solo agent

The next planning pass should return:

- a contract-to-scenario matrix for `RPV-001` through `RPV-010`;
- an existing-code map for host, presentation-core, Companion, cloud, browser,
  and desktop-viewer surfaces;
- a smallest-slice file/task sequence with verification checkpoints;
- explicit Mac-owned versus Windows-owned work;
- unresolved choices from the spec's Open Questions with a recommendation;
- no source implementation until the plan passes its readiness gate.
