---
Type: Prompt
Status: current
Owner: KDB
Last updated: 2026-08-25
Scope: RepoPrompt CE kickoff for ISSUE-002 planning and endpoint readiness.
---

# RepoPrompt CE kickoff — ISSUE-002 remote PowerPoint viewer

You are the planning architect for ISSUE-002 in the Downstage repository. This
is a bounded planning and readiness pass, not permission to implement source.

## Repository and immutable base

- Windows repository: `C:\Dev\OnTime-worktrees\issue-002-remote-viewer`
- Branch: `codex/issue-002-remote-viewer`
- Base SHA: `d1ff0770ec5449fb3fce4a28665b5d84f41f4f50`
- Tracking item: `.agents/issues/ISSUE-002.md`

Confirm the branch, clean/dirty state, HEAD, and base SHA before analysis. Do not
create or switch worktrees, change issue status/labels, implement source, push,
open a PR, or merge.

Use RepoPrompt CE Community Edition, not the discontinued legacy integration:

1. `bind_context` to this worktree.
2. Run `context_builder` with `response_type: "plan"` and
   `export_response: true`.
3. Use `oracle_send` only for focused gaps after the initial plan.
4. Return the exported plan path and all evidence. Do not start `agent_run`
   implementation until a later orchestrator explicitly clears readiness.

## Read first

1. `AGENTS.md`
2. `docs/rebuild-progress.md`
3. `docs/rebuild-extraction-rules.md`
4. `.agents/issues/ISSUE-002.md`
5. `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
6. `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
7. `docs/progress/backlog-issue-002-remote-viewer-2026-08-25.md`
8. `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`
9. `docs/interface.md`, `docs/local-offline-lan-plan.md`,
   `docs/client-prd.md`, `docs/cloud-server-prd.md`,
   `docs/phase-3-pairing-ux.md`, and `docs/phase-3-cert-trust-ux.md`
10. Current host, core, transport, rules, functions, and viewer code identified
    below. Do not use archived documents as authority.

## Ratified scope

- Start with a standalone remote presentation session. It may optionally attach
  to a Downstage `roomId` later, so Downstage Control can embed the same viewer.
- Exactly one Windows show laptop publishes; multiple viewers read. LAN keeps
  the existing 20-device cap; recommend and justify a cloud service limit.
- First surfaces: cloud browser viewer, then one shared Downstage View product
  with Windows and macOS builds. LAN follows using the same contract.
- Viewer access is an opaque, unguessable, session-scoped read-only link.
  Publisher and viewer credentials are distinct.
- Active viewer access lasts 24 hours. Publisher startup may offer to resume and
  extend the prior session. Operator can end it or issue a new link. Delete
  inactive session data after seven days.
- Publish a full snapshot immediately on material PowerPoint transitions and a
  liveness heartbeat every 10 seconds. Viewer is stale after 25 seconds and
  disconnected after 60 seconds. Reconnect starts with a full current snapshot.
- Read-only only. No remote slide/media/timer control in this issue.
- Public website, privacy/support pages, Store identity/signing, and macOS
  notarization are later release gates, not planning/MVP blockers.

## Non-negotiable boundaries

- Windows remains authoritative for PowerPoint COM, helper behavior, Remote host
  mode, Presenter View acceptance, and Windows packaging.
- The native helper remains local and transport-agnostic. It accepts only
  `poll`/`exit` over stdin and emits JSON over stdout. Do not add Firebase,
  HTTP/WSS, accounts, rooms, viewer tokens, or retry policy to it.
- `ppt-bridge` and `presentation-core` remain pure of cloud, Firebase, rooms,
  controller, viewer, and Electron concerns.
- Cloud/viewer code must not import `local-sync-arbitration`,
  `UnifiedDataContext.tsx`, `FirebaseDataContext.tsx`, or
  `companion/src/main.ts`. These are reference/code-map sources only where the
  extraction rules permit.
- Do not expose `liveCues` directly to public viewers; its metadata may include
  sensitive paths/notes.
- Do not duplicate PowerPoint selection/countdown logic in browser or desktop
  viewers. Publish the host-resolved headline/focus semantics.
- Name a new outer publisher executable/process, lifecycle, and secure-storage
  boundary. Do not add Firebase, HTTP/WSS, viewer-token, or retry code to
  `apps/ppt-timer`, and do not change that package's content boundary, unless the
  Deep Plan presents a separate explicit decision for owner ratification.
- Existing room viewer documents/routes, `LIVE_CUE_*`, `PRESENTATION_*`, and
  raw `LiveCue` replay may not carry the new snapshot, even temporarily. Reuse
  socket bootstrap/connection mechanics only through a new independently typed,
  privacy-filtered snapshot and replay event.

## Windows source readiness already established

The local chain is tested and supplies the PowerPoint observations needed for a
remote projection:

- `packages/ppt-bridge/native/windows-ppt-probe/Program.cs` emits PowerPoint
  availability, slideshow state, slide number/count, helper primary video
  identity, and ordered video rows with id/name/status/playing/duration/elapsed/
  remaining.
- `packages/ppt-bridge/src/protocol.ts`, `validate-response.ts`,
  `process-client.ts`, and `powerpoint-session.ts` validate, restart, and reduce
  those observations.
- `packages/presentation-core/src/powerpoint-types.ts`,
  `powerpoint-normalize.ts`, `powerpoint-machine.ts`, `powerpoint-headline.ts`,
  and `powerpoint-view.ts` own canonical normalization and projection.
- `apps/ppt-timer/src/main/session-host.ts` adds status stabilization,
  host-resolved focus/headline selection, and a monotonic local revision.

Verified on 2026-08-25: `ppt-bridge` 72 tests, `presentation-core` 134 tests,
`ppt-timer` 430 tests, plus all three targeted typechecks passed.

The tests ran in `C:\Dev\OnTime`, whose target source was proven byte-equivalent
for these paths with
`git diff --quiet db38ed4 d1ff077 -- apps/ppt-timer packages/ppt-bridge packages/presentation-core`.
This is deterministic source readiness only. Live Remote host publication,
Presenter View, sleep/reconnect, packaged publisher, and cross-machine viewer
acceptance remain PENDING.

This is source readiness, not remote readiness. There is no remote snapshot
schema, publisher, authorization, session/epoch/sequence/freshness reducer,
cloud presentation data path, Remote host mode, or viewer surface yet.

## Required field audit

Produce a field-by-field matrix from helper -> validated observation ->
normalized source -> host-resolved view -> remote allowlist. Prove that every
viewer field has one canonical source and that no remote field forces cloud
knowledge into the helper/core.

The remote contract must decide exact names and validation for at least:

- schema/protocol major version;
- presentation session ID and optional room attachment;
- publisher/session epoch and monotonically increasing sequence;
- observation time, server receive/publish time, expected heartbeat, and
  freshness deadline;
- availability (`connecting`, `presentation`, PowerPoint absent, no slideshow,
  helper unavailable, stale, disconnected) without stale numeric timing;
- slide number/count and optional sanitized display title;
- every video row: opaque identity/ordinal, optional sanitized label, canonical
  status, duration, elapsed/position, remaining, running anchor, and focus;
- host-resolved headline identity/mode and the selected scalar meaning;
- backward/forward compatibility, duplicate/out-of-order rejection, clock skew,
  correction bounds, reconnect, sleep/resume, and session reset.

Ordinary remote payloads must exclude full `filename`, presentation/deck paths,
PowerPoint `instanceId`, process counts/PIDs, COM affinity data, helper paths,
validator warnings/extensions, diagnostics, window/display data, credentials,
and control actions. Sanitized labels are optional in v1; recommend their
default during UX planning.

## Endpoint and transport audit

Do not assume existing room viewer endpoints are sufficient. Map current code
and define the smallest exact endpoint/data/rules contract for:

- create presentation session;
- authorize, resume, or replace the one publisher;
- issue/resolve/rotate/revoke the viewer-only link;
- publish a complete current snapshot and heartbeat;
- subscribe/read/bootstrap the current snapshot;
- end a session and delete expired data;
- reject a second/foreign/stale publisher;
- later attach/detach a presentation session to a Downstage room without
  changing viewer semantics;
- later LAN pairing/WSS delivery using the same snapshot and reducer.

For each operation specify: proposed callable/HTTP/WSS/browser route,
authentication and authorization, request/response schema, Firestore document
and indexes/TTL if any, security-rule predicate, idempotency, rate limit, error
codes, logging/redaction, retry behavior, and deterministic/emulator tests.

Current evidence to reconcile:

- Cloud viewer route is `/room/:roomId/view` and current room/state reads are
  public by room ID.
- Cloud Functions currently export lock/operator callables only; there is no
  presentation-session publisher/viewer-token endpoint.
- Companion already has LAN pairing create/status/revoke/reset/claim, persisted
  viewer JWT/revocation, and private-LAN HTTPS/WSS delivery. Existing replay
  contains room state and raw `LiveCue`/presentation payloads and is not reusable
  for the remote snapshot. Audit role binding and room ownership; design a new
  typed filtered bootstrap/replay event.
- `firebase.json` uses Firestore 8081 and Functions 5002, while
  `frontend/src/lib/firebase.ts` connects to 8080 and 5001. Make environment
  parity an early bounded slice.

## Required planning deliverables

Draft exact content for these artifacts in the exported RepoPrompt plan, but do
not edit the repository or implement runtime source in this pass:

1. `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-25.md`
2. `docs/spec/downstage-remote-powerpoint-viewer.endpoints.md`
3. `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`
4. A scenario-to-code matrix for RPV-001 through RPV-010.
5. A dependency-ordered slice backlog with immutable IDs, precise file
   ownership, tests, commands, manual gates, and stop conditions.
6. A Mac/Windows handoff matrix: Mac owns transport-neutral contracts, cloud
   backend, browser/shared renderer and macOS packaging; Windows owns helper
   integration, publisher/Remote host mode, live PowerPoint/Presenter View, and
   Windows packaging. Shared files must have one owner per slice.
7. A readiness verdict: `READY`, `READY WITH NAMED PREREQUISITES`, or `BLOCKED`,
   with every unresolved decision and evidence gap listed.

Recommended delivery dependency:

1. Remote snapshot schema, pure validator/reducer, golden fixtures, endpoint
   contract, emulator parity.
2. Cloud session/auth/publish/read model and rules.
3. Browser viewer using fixtures, then a real Windows publisher.
4. Windows Remote host behavior and live PowerPoint acceptance.
5. Shared Downstage View shell and platform-specific Windows/macOS validation.
6. LAN adapter/pairing using the proven contract.
7. Controls only in a future separately authorized issue.

## Verification and return format

- Cite exact paths and line numbers for every reuse/gap claim.
- Record commands and PASS/PENDING results; do not report unrun tests as PASS.
- Call out any divergence between current docs and current code.
- Keep the Deep Plan bounded; no concurrent agents may edit the same packaging,
  rules, interface-contract, or viewer files.
- Return exported RepoPrompt plan path, proposed artifact paths, readiness
  verdict, endpoint summary, field coverage summary, slice order, platform
  ownership, and exact resume command/context for the outer orchestrator.
