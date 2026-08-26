---
Type: Prompt
Status: current
Owner: KDB
Last updated: 2026-08-26
Scope: Documentation-only revision of the ISSUE-002 Deep Plan and readiness artifacts.
---

# ISSUE-002 Deep Plan revision — sidecar publisher and planning readiness

You are the Deep Plan revision agent for ISSUE-002 in the Downstage repository.
This is a documentation-only architecture and readiness pass. The owner has
settled the two product decisions that previously blocked the plan. Reconcile
the canonical artifacts, close every planning gap that can be closed from the
repository and current primary documentation, and rerun the readiness analysis.

Do not implement runtime source, install dependencies, create or switch
worktrees, change issue status or labels, push, open a PR, or merge. Do not
declare implementation ready merely because the owner decisions are now
settled.

## Repository and starting evidence

- Windows worktree: `C:\Dev\OnTime-worktrees\issue-002-remote-viewer`
- Branch: `codex/issue-002-remote-viewer`
- Required ancestor: `ceb7ba4`
- Tracking item: `.agents/issues/ISSUE-002.md`
- Current Deep Plan:
  `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md`
- Current critique:
  `docs/reviews/downstage-remote-powerpoint-viewer-deep-plan-critique-2026-08-26.md`

On macOS, fetch the same branch into an isolated worktree and bind to its real
path. Never copy the Windows path literally. Before editing, report the
worktree, branch, HEAD, dirty state, required-ancestor check, and changed files.
Preserve unrelated work.

When using RepoPrompt CE Community Edition:

1. `bind_context` to the existing ISSUE-002 worktree.
2. Run `context_builder` with `response_type: "plan"` and
   `export_response: true` for this bounded revision.
3. Use `oracle_send` only for focused unresolved technical questions.
4. If an editing agent is used, constrain it to the documentation paths named
   below. Do not start runtime implementation or a general Loop run.
5. Return the exported plan path together with the repository diff and
   verification evidence.

## Read completely before revising

1. `AGENTS.md`
2. `.agents/issues/ISSUE-002.md`
3. `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
4. `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
5. `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md`
6. `docs/reviews/downstage-remote-powerpoint-viewer-deep-plan-critique-2026-08-26.md`
7. `docs/progress/backlog-2026-08-25-issue-002-planning.md`
8. `docs/progress/backlog-issue-002-remote-viewer-2026-08-25.md`
9. `docs/prompts/issue-002-repoprompt-ce-planning-2026-08-25.md`
10. `docs/plans/powerpoint-capability-and-display-roadmap-2026-08-07.md`
11. `docs/rebuild-extraction-rules.md`, `docs/rebuild-progress.md`,
    `docs/timer-logic.md`, `docs/interface.md`, and
    `docs/local-offline-lan-plan.md`
12. The current `ppt-timer`, host, renderer, packaging, Firebase, Functions,
    rules, Companion, interface-contract, and viewer files cited by the Deep
    Plan. Do not use archived documents as authority.

Use current primary Electron, Firebase, Firestore, and platform documentation
where process, authentication, rules, packaging, or lifecycle behavior is
version-sensitive. Cite the exact authoritative source for each such decision.

## Ratified owner decisions

These are settled requirements, not questions to return to the owner.

### D1 — One visible PPT Timer with an isolated publisher sidecar

- **Downstage PPT Video Timer remains the only user-facing PowerPoint host
  application.** The operator does not install, launch, or choose a second
  timer-like “Downstage Publisher” application.
- `apps/ppt-timer` remains the single owner of `ppt-probe`, PowerPoint COM, the
  canonical `SessionHost`/`HostView`, the compact local timer window, and the
  visible “share remotely” workflow.
- A separately bounded publisher sidecar/utility process owns Firebase/cloud
  authentication, publisher credentials, session/link callables, heartbeats,
  network retry, cloud publication, and later loopback Companion publication.
  It has no visible window, Start-menu identity, PowerPoint access, helper
  process, presentation-selection logic, or remote-control path.
- The timer sends the sidecar only strict, reconstructed, privacy-filtered full
  snapshot candidates through a private inherited process channel. The
  sidecar must never receive full paths, COM/process identity, helper
  diagnostics, renderer actions, or raw `HostView` objects that contain
  forbidden fields.
- Prefer the smallest supported Electron child/utility-process mechanism and a
  typed MessagePort or inherited stdio channel. Audit the pinned Electron and
  packaging versions before choosing. Do not introduce a listening localhost
  HTTP/WSS port merely for this boundary.
- Parent-to-sidecar messages may cover sanitized snapshots and explicit
  operator lifecycle actions. Sidecar-to-parent messages may cover connection
  status, safe errors, approval URL, viewer URL/QR material, and session state.
  There is no viewer-to-PowerPoint command channel in ISSUE-002.
- Cloud/Firebase/room/retry implementation must remain outside `ppt-bridge`,
  `presentation-core`, the native helper, and the timer renderer. The timer
  composition root may start/stop the sidecar, broker narrowly validated UI
  actions, and use a pure allowlist adapter; it must not absorb the sidecar's
  Firebase or retry implementation.
- When remote sharing is active, hiding or minimizing the timer may leave the
  host and sidecar running. Explicit “stop sharing,” session end, application
  quit, crash, update, and shutdown behavior must be specified. A sidecar or
  network failure must not stop the local countdown; it makes remote viewers
  stale/disconnected.
- Existing S-033 sender validation, context isolation, navigation blocking,
  single-instance behavior, helper cleanup, and Store/package-content
  boundaries remain load-bearing. Any required expansion must be explicit,
  narrow, tested, and included in Windows acceptance.
- Define exact secure persistence. The sidecar owns credential meaning. If an
  Electron-main `safeStorage` broker is required, the timer may only seal and
  unseal opaque versioned bytes through a narrow service; secrets must never
  enter ordinary settings JSON, renderer IPC, logs, snapshots, or URLs.
- Remove the proposed second independent PowerPoint host, duplicated helper,
  shared cross-process COM-observer lock, and mutually exclusive user-facing
  timer/publisher workflow unless a verified platform constraint makes the
  ratified sidecar impossible. A constraint is evidence for a new owner review,
  not permission to silently restore the old design.

### D2 — Advisory cloud support target of 50 viewers for v1

- The v1 cloud service target is **50 concurrent viewers per presentation
  session**, validated by a staged 50-viewer load test. LAN retains its existing
  enforced 20-device limit.
- Cloud 50 is an advisory/support/load-test target in v1, not hard lease
  admission. Do not reject a nominal 51st viewer by implementing renewable
  viewer leases.
- Remove v1 `presentationViewerLeases`, `activeViewerCount`, 90-second lease
  renewal/release, lease claims, lease rule lookups, and stale-lease
  reconciliation. Preserve a future extension point if measured cost or abuse
  later justifies hard admission.
- Keep the opaque unguessable link, separate viewer custom identity,
  `viewerGeneration` rotation/revocation, 24-hour live access window,
  seven-day cleanup, per-owner active-session limit, resolve/publish abuse
  protection, monitoring, and explicit staging cost/latency measurements.
- Specify how every stated rate limit is actually enforced. Do not present an
  in-memory per-instance counter as a distributed guarantee. Production-only
  rate-limit validation may remain a named release gate, but the implementation
  mechanism and fallback behavior must be concrete.

## Required technical corrections

Resolve these in the canonical Deep Plan and companion specifications. They are
technical planning work, not new owner-decision blockers.

1. **Wire availability:** `connecting`, `stale`, `disconnected`, `ended`, and
   access-ended are reducer/display states, not publisher snapshot
   availability. Define the smallest wire-level active/source-unavailable
   discriminant and fail safely on invalid combinations.
2. **Discriminated PowerPoint payload:** presentation payloads carry slide,
   headline, and video timing. PowerPoint-not-running, no-slideshow, and helper
   failure variants carry their reason and no stale numeric timing. Avoid a
   nullable catch-all object whose invariants exist only in prose.
3. **Timing-anchor truth:** current values are measured before a callable
   commits `publishedAtMs`. Do not label them as measured at server commit time
   without accounting for observation age and transport/function latency.
   Specify the exact anchor/interpolation formula, clamps, material-transition
   comparator, normal-poll handling, heartbeat behavior, clock-skew handling,
   and transition-to-render budget. Every heartbeat must use the latest host
   observation, not merely restamp the last cloud-sent numbers.
4. **Sidecar lifecycle and protocol:** version the private message contract;
   validate both directions; define start/ready/auth/share/stop/crash/restart/
   app-update/shutdown behavior, backpressure, latest-state-only delivery, and
   secret/log redaction. Prove the sidecar cannot spawn or control the helper.
5. **Credential lifecycle:** specify system-browser approval, callback
   validation, dedicated publisher-device identity, refresh, encrypted local
   persistence, sign-out, device revocation, lost-device recovery, and behavior
   when secure storage is unavailable.
6. **Endpoint/rules exactness:** preserve server-side allowlist reconstruction,
   durable idempotency, transactional epoch/sequence checks, live-generation
   revocation, top-level TTL documents, scheduled cleanup, client-side expiry,
   and production-only Auth/TTL/rate-limit gates. Remove all hard-viewer-lease
   branches from the v1 endpoint and rules design.
7. **Slice size:** split every XL or multi-owner slice into bounded,
   dependency-ordered checkpoints. At minimum split cloud auth/session,
   viewer-link/read authorization, publish/snapshot, cleanup/load validation;
   sidecar protocol/lifecycle, auth/session, publication/retry, packaging/live
   Windows acceptance; and shared desktop wrapper, macOS packaging, Windows
   packaging. Each slice must name exclusive file ownership, tests, manual
   gates, rollback, and stop conditions.
8. **Dependency repair:** update slice dependencies for the ratified sidecar.
   The user-facing timer owns the local face and host; the sidecar must not
   require a second timer-face host or `packages/powerpoint-host` extraction
   unless another consumer demonstrably needs it.
9. **Critique reconciliation:** for C-001 through C-018 in the existing
   critique, record `resolved`, `accepted`, `superseded`, or `still open`, with
   an exact canonical location and rationale. Do not copy obsolete critique
   findings back into the revised plan.

## Canonical artifacts to create or revise

Use `apply_patch` for repository edits.

1. Revise
   `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md`.
2. Revise `docs/spec/downstage-remote-powerpoint-viewer.spec.md` and the
   shorter planning brief where the old independent publisher/hard-cap design
   is implied.
3. Create
   `docs/spec/downstage-remote-powerpoint-viewer.endpoints.md` with the exact
   cloud, private sidecar IPC, browser, and later LAN operation matrices.
4. Create
   `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`, initially
   marking RPV-001 through RPV-010 `Not-built` with closing slices and exact
   automated/manual evidence requirements.
5. Update progress evidence and ISSUE-002 links/decision text, but **do not
   change its status or labels**. The outer orchestrator owns status changes.
6. If helpful, append a resolution table to the existing critique rather than
   rewriting its historical findings.

Do not edit runtime source, package manifests, lockfiles, workflows, rules, or
Firebase configuration during this pass.

## Readiness and return contract

After the documents are coherent:

- run the available spec/plan readiness gate;
- run documentation/static guardrails and `git diff --check`;
- inspect every edited file and the complete diff;
- report unrun runtime tests as `NOT RUN (documentation-only)`;
- do not force an `implementable` verdict if a concrete technical planning gap
  remains;
- distinguish later staging/release gates from blockers to beginning the first
  bounded implementation slice.

Return:

1. exported RepoPrompt plan path;
2. edited artifact paths;
3. D1/D2 decision mapping;
4. final sidecar process/IPC/secure-storage design;
5. revised wire timing and payload contracts;
6. endpoint/rules summary without hard viewer leases;
7. bounded slice index and platform/file ownership;
8. C-001 through C-018 resolution table;
9. readiness verdict and any remaining blocker with evidence;
10. exact commands and PASS/PENDING/NOT-RUN results;
11. exact next safe slice if and only if the readiness gate is implementable.

