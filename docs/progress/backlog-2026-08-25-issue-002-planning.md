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

## Spec-plan-readiness result

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

Because the verdict is blocked, the readiness skill authorizes **no tests,
production code, implementation worktree, or Loop delegation**, even where the
planning draft describes slices that could later be independently authorized.
There is no `first_safe_task` while this gate is blocked.

## Outcome and track-work update

- Outcome: **blocked** at readiness gate; implementation skipped.
- File-backed tracking status changed from `draft` to `blocked` by the outer
  Backlog layer; `.agents/issues/README.md` was synchronized.
- Close policy was evidence-only, so the item was not closed.
- Tests/CI/user-testing: not run; no runtime implementation exists in this run.
- Conformance matrix: canonical file not yet created; all RPV scenarios remain
  Not-built.
- Review findings: none generated because no implementation diff was produced.

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

Resume the documentation-only Deep Plan correction from:

`docs/prompts/issue-002-deep-plan-revision-2026-08-26.md`

The pass must revise the canonical Deep Plan, materialize the endpoint contract
and RPV conformance matrix, reconcile the existing critique, split oversized
slices, and rerun readiness. The issue remains blocked until those artifacts
and the readiness result are independently reviewed. These owner decisions do
not authorize runtime source implementation by themselves. Only an
`implementable` verdict may identify and authorize the first bounded source
slice.
