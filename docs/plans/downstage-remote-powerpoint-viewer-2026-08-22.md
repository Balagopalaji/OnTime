---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-08-25
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

## 2026-08-25 handoff baseline and readiness

- Authoritative merged base:
  `d1ff0770ec5449fb3fce4a28665b5d84f41f4f50` (PR #145).
- Planning branch: `codex/issue-002-remote-viewer`.
- Planning worktree:
  `C:\Dev\OnTime-worktrees\issue-002-remote-viewer` on the Windows machine.
- The local Windows observation chain is a deterministically tested source
  boundary:
  `ppt-bridge` tests 72/72, `presentation-core` tests 134/134, standalone timer
  tests 430/430, and all three targeted typechecks passed on 2026-08-25.
- Live ISSUE-002 Remote host publication, Presenter View cleanliness, sleep/
  reconnect, and cross-machine viewer acceptance remain unverified because the
  remote path and host mode do not exist yet.
- This does not mean remote viewing is implemented. There is no remote snapshot
  type, publisher, cloud presentation-session data model, session-scoped cloud
  viewer credential, remote reducer, Remote host mode, or desktop viewer yet.
- The helper already reports the necessary local slide/video observations. Do
  not add network endpoints to it. The missing boundary is a sanitized outer
  publisher that adds session/epoch/sequence/time/freshness metadata and emits
  the host-resolved headline state.
- The Deep Plan must name the new outer publisher executable/process and its
  lifecycle. Do not put Firebase, HTTP/WSS, viewer-token, or retry code into the
  accepted `apps/ppt-timer` package unless a separate boundary decision is
  explicitly ratified first.
- Existing cloud room viewers are public-by-room-ID and are not acceptable as
  the PowerPoint session authorization model without a dedicated protected read
  path. Existing LAN pairing/token foundations are reusable only after their
  room/role ownership checks are mapped and tested.
- Firebase emulator configuration currently disagrees: `firebase.json` uses
  Firestore 8081 and Functions 5002, while the frontend connects to 8080 and
  5001. Resolve this before cloud endpoint tests are considered authoritative.

The next pass is planning only. Use
`docs/prompts/issue-002-repoprompt-ce-planning-2026-08-25.md` to produce the
Deep Plan, endpoint contract, conformance matrix, and implementation slices.
No source implementation starts until `spec-plan-readiness` passes.

## Reuse boundary

Reuse the existing:

- `@ontime/ppt-bridge` native/helper/session behavior on the Windows host;
- `@ontime/presentation-core` normalization, timing, selection, and projection;
- Companion LAN relay, HTTPS/WSS, private-subnet, pairing, viewer-token, and
  revocation foundations;
- Firebase/cloud room transport and existing viewer delivery;
- shared Downstage presentation panel and read-only viewer semantics.

Reuse of existing transport foundations does not authorize reuse of their
payloads. Existing room state, `LiveCue`, `LIVE_CUE_*`, `PRESENTATION_*`, and
room viewer routes must not carry the new remote presentation snapshot. Socket
bootstrap ordering and authenticated viewer connection are reuse candidates;
the snapshot and replay event require a new independently typed, filtered
contract.

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
- an exact endpoint/data/rules matrix for cloud and later LAN, including
  publisher authorization, single-publisher enforcement, viewer-link lifecycle,
  snapshot publication/subscription, resume, revocation, expiry, and cleanup;
- a field-by-field helper -> canonical state -> remote allowlist map proving that
  every required viewer field exists and every machine-sensitive field is
  excluded;
- a Deep Plan and RPV-001..RPV-010 conformance matrix suitable for the
  `spec-plan-readiness` gate.
