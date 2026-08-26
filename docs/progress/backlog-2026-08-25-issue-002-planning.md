---
Type: Progress
Status: current
Owner: Backlog orchestrator
Last updated: 2026-08-26
Scope: ISSUE-002 backlog triage, planning export, and readiness gate.
---

# Backlog run — ISSUE-002 planning readiness

## Run authorization

The upfront wizard timed out; the user then accepted the orchestrator's
recommendation:

- Queue: `ISSUE-002` only, using track-work's file-backend override because the
  authenticated GitHub backend had no open issues.
- Completion path: `local-only`.
- Close policy: evidence only.
- Loop role: `pair` if implementation becomes authorized.
- Run cap: one issue.

No push, PR, merge, direct-default-branch update, issue closure, or branch
removal is authorized.

## Triage and clarity

- Item: `ISSUE-002` — Add Downstage remote PowerPoint viewer surfaces.
- Classification: feature, priority p1, draft at discovery, large/unlabelled
  effort.
- Exempt/duplicate/decision dependency: none identified.
- Deterministic clarity pre-check: **PASS** — bounded ratified scope, observable
  acceptance criteria, no linked unresolved `type:decision`, no duplicate.
- Oracle clarity confirmation: **clear**. The largest planning ambiguity is the
  exact process/package home and secure-storage boundary of the new Windows
  publisher; the Deep Plan can describe options but cannot ratify one.

## Immutable checkout evidence

- Branch: `codex/issue-002-remote-viewer`.
- HEAD: `5e036444cea17d58ecccdfb68f72ae33a0a132b4`.
- Recorded base: `d1ff0770ec5449fb3fce4a28665b5d84f41f4f50`.
- Base is an ancestor of HEAD: **PASS**.
- `origin/codex/issue-002-remote-viewer` matched HEAD at verification time.
- Kickoff prompt exists on that remote ref: **PASS**.
- Checkout was clean before the outer status/progress updates.

## Planning evidence

RepoPrompt CE Context Builder ran in planning mode with archive content excluded.
It made no runtime-source changes and produced:

- Initial plan export:
  `prompt-exports/oracle-plan-2026-08-25-201510-issue-002-remote-vie-e4d7.md`
- Focused readiness-gap addendum:
  `prompt-exports/oracle-plan-2026-08-25-201857-issue-002-remote-vie-7d97.md`
- Prior handoff:
  `docs/progress/backlog-issue-002-remote-viewer-2026-08-25.md`

The exports draft the Deep Plan, endpoint/data/rules contract, RPV-001 through
RPV-010 mapping, immutable slices S0 through S10, platform ownership, remote
field allowlist, renderer extraction boundary, validation commands, and risks.
They are planning drafts, not ratified canonical artifacts.

## 2026-08-26 blocker update

The media-label decision is **resolved** in the current Spec, Plan, and tracking
item. The existing `apps/ppt-timer` surface is authoritative: the collapsed
charcoal face shows the small canonical status label above the time; sanitized
video titles appear only in the hover disclosure/list. The remote work builds
around this baseline and must not recreate or redesign the timer or disturb the
local Windows/PowerPoint behavior.

Spot-check evidence:

- `apps/ppt-timer/src/renderer/powerpoint-panel.ts` defines the canonical
  `Playing`, `Paused`, `Ready`, and `Ended` labels and renders video-row names
  only in the list.
- `apps/ppt-timer/src/renderer/styles.css` describes the compact surface and
  quiet disclosure control.
- `apps/ppt-timer/src/renderer/view.ts` keeps the focus timer and video-row
  projection deterministic.

Any media-label ambiguity in the earlier Oracle exports is superseded by the
current repository documents. The two remaining product decisions are the
publisher boundary and cloud viewer cap. The canonical Deep Plan, endpoint
contract, and conformance matrix also remain draft-only readiness inputs.

## Historical 2026-08-25 spec-plan-readiness result

```text
verdict: blocked
blocking_gaps:
  - source: both
    reason: The publisher process/package and secure-storage boundary is an open owner decision; it affects cloud, host, and LAN implementation surfaces.
    required_resolution: Ratify one publisher boundary and record it in the canonical Spec/Deep Plan. The planning recommendation is a separate `apps/downstage-publisher` process that leaves `apps/ppt-timer` unchanged.
  - source: both
    reason: The cloud viewer concurrency limit is required by the issue but remains a recommendation rather than a ratified contract value.
    required_resolution: Ratify the per-session cloud limit; the planning recommendation is 50 concurrent subscribers while LAN remains capped at 20.
  - source: plan
    reason: The Deep Plan, endpoint spec, and conformance matrix exist only as exported drafts, not canonical linked and independently reviewed repository artifacts.
    required_resolution: In a separately authorized documentation pass, write and review the canonical artifacts, then link them from ISSUE-002.
scenario_to_test_map: []
task_to_scenario_map:
  - task: S0 emulator parity
    scenarios: []
    notes: Infrastructure prerequisite; intentionally does not claim behavior coverage.
  - task: S1 remote-viewer contracts and reducer
    scenarios: [RPV-002, RPV-003, RPV-004, RPV-005, RPV-006, RPV-007, RPV-008, RPV-009, RPV-010]
    notes: Closes RPV-007 and RPV-008 only after its deterministic tests pass.
  - task: S2 owner ratification
    scenarios: []
    notes: Decision gate; intentionally does not claim behavior coverage.
  - task: S3 cloud session/auth/rules/functions
    scenarios: [RPV-001, RPV-002, RPV-003, RPV-005, RPV-007, RPV-008, RPV-009, RPV-010]
  - task: S4 source-neutral viewer face and PowerPoint adapter
    scenarios: [RPV-002, RPV-003, RPV-004, RPV-005, RPV-006, RPV-007, RPV-008, RPV-009, RPV-010]
  - task: S5 browser viewer
    scenarios: [RPV-002, RPV-003, RPV-005, RPV-006, RPV-007, RPV-008, RPV-009, RPV-010]
  - task: S6 Windows publisher
    scenarios: [RPV-001, RPV-002, RPV-003, RPV-006, RPV-007, RPV-008, RPV-009, RPV-010]
  - task: S7 Windows Remote host acceptance
    scenarios: [RPV-001, RPV-002, RPV-008, RPV-010]
  - task: S8 desktop viewer wrapper
    scenarios: [RPV-002, RPV-005, RPV-009]
  - task: S9 LAN remote-snapshot adapter
    scenarios: [RPV-002, RPV-004, RPV-005, RPV-006, RPV-007, RPV-008, RPV-009, RPV-010]
  - task: S10 future stage-timer publication and controls
    scenarios: []
    notes: Frozen placeholder; explicitly out of ISSUE-002 scope.
```

At that historical checkpoint the verdict was blocked, so the readiness skill authorized **no tests,
production code, implementation worktree, or Loop delegation**, even where the
planning draft describes slices that could later be independently authorized.
There is no `first_safe_task` while this gate is blocked.

## 2026-08-26 Deep Plan revision and readiness rerun

The documentation-only revision consumed the owner decisions and closed the
remaining technical planning gaps. Canonical artifacts now are:

- Deep Plan:
  `docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md`
- Endpoint/private-process contract:
  `docs/spec/downstage-remote-powerpoint-viewer.endpoints.md`
- Initial conformance matrix:
  `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`
- Critique resolution ledger:
  `docs/reviews/downstage-remote-powerpoint-viewer-deep-plan-critique-2026-08-26.md`
- RepoPrompt planning export:
  `prompt-exports/oracle-plan-2026-08-26-145749-issue-002-d1-d2-revi-ecf2.md`

Decision and correction outcome:

- D1: `apps/ppt-timer` remains the only visible app and sole helper/COM/host
  owner. A hidden `utilityProcess` receives reconstructed allowlisted snapshots
  over a validated inherited message port and owns Firebase/auth/session/link/
  heartbeat/retry/later-LAN publication. The old visible publisher,
  `packages/powerpoint-host`, duplicated helper, and COM lock are superseded.
- D2: 50 cloud viewers/session is advisory/load-tested. All viewer lease,
  renewal/release, active-count, lease-claim/rule, and reconciliation branches
  are removed. LAN remains hard-capped at 20.
- Timing values are anchored to the host observation. `observationAgeMs` is a
  same-host-clock duration; `publishedAtMs` is server freshness time only.
  Material transitions publish immediately and heartbeats use the latest host
  observation.
- Cloud endpoints use server allowlist reconstruction, durable request results,
  transactional ownership/epoch/sequence/generation, top-level cleanup docs,
  and Firestore-backed distributed rate-limit buckets.
- Every old XL/multi-owner slice is split into bounded S0/S1a...S9b checkpoints
  with exclusive paths, dependencies, tests, manual gates, rollback, and stop
  conditions.

```text
verdict: implementable
blocking_gaps: []
scenario_to_test_map: docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md#readiness-traceability
task_to_scenario_map: docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md#readiness-traceability
first_safe_task: S0 — align frontend emulator configuration with firebase.json
staging_release_gates:
  - production publisher-device Auth refresh/revocation and browser callback
  - production distributed rate-limit fallback, Firestore indexes/TTL and cost
  - staged 50-viewer/30-minute load and p95 transition-to-render evidence
  - packaged Windows sidecar lifecycle and Presenter View/confidence acceptance
  - macOS/Windows viewer packaging and user testing
```

The staging/release gates do not block S0. All runtime, emulator, staging, and
user tests remain **NOT RUN (documentation-only)**. The issue's status/labels
remain untouched because the outer backlog orchestrator owns that transition.

## Outcome and track-work update

- Historical outcome: **blocked** at the 2026-08-25 readiness gate;
  implementation was skipped.
- Current documentation outcome: **implementable**, with S0 as the first safe
  slice; no runtime implementation was started in this revision.
- File-backed tracking status changed from `draft` to `blocked` by the outer
  Backlog layer; `.agents/issues/README.md` was synchronized.
- Close policy was evidence-only, so the item was not closed.
- Tests/CI/user-testing: not run; no runtime implementation exists in this run.
- Conformance matrix: canonical and audited at
  `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`; all ten RPV
  scenarios remain Not-built pending runtime evidence.
- Implementation review findings: none, because no implementation diff was
  produced. The planning critique C-001 through C-018 is fully reconciled in
  the linked critique ledger.

## Worktree ledger

| Issue | Worktree | Branch | Base SHA | Status |
|---|---|---|---|---|
| ISSUE-002 | None created | Existing `codex/issue-002-remote-viewer` checkout only | `d1ff0770ec5449fb3fce4a28665b5d84f41f4f50` | No Loop allocation; nothing to remove |

No `backlog/*` branch or dedicated implementation worktree was created. No
session cleanup or worktree removal is required, and no branch was deleted.

## Exact resume instruction

On 2026-08-26 the owner ratified the remaining product decisions:

- keep Downstage PPT Video Timer as the only visible PowerPoint host and launch
  a separately bounded publisher sidecar for authentication, cloud/LAN
  transport, credentials, links, heartbeat, and retry;
- support 50 concurrent cloud viewers per session as an advisory/load-tested v1
  target, without renewable hard-admission leases; retain the LAN cap of 20.

The documentation correction is complete. Resume implementation from this
progress document and the linked worktree ledger, re-check the required
ancestor and clean/dirty state, run `spec-plan-readiness` against the current
Spec and Deep Plan, and execute **S0 only** if it still returns
`implementable`. Do not skip directly to cloud, sidecar, or UI slices. Track
runtime evidence in the conformance matrix and keep issue status changes in the
outer backlog layer.
