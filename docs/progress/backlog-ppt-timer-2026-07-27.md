---
issue: ISSUE-001
branch: backlog/ISSUE-001-standalone-ppt-timer
worktree: /tmp/ontime-issue001-ppt-timer
base_branch: main
base_sha: fceb200b05c8f3bf7253ac0b3a91d613cc0bd305
phase: H1
current_task: Stage 0 contract characterization
review_cycles: 0
stable_findings: []
worktree_preflight: clean-after-documentation-checkpoint
---

# ISSUE-001 H1 Loop — Standalone PowerPoint Video Timer

## Metadata

- Spec: `docs/spec/standalone-powerpoint-video-timer.spec.md`
- Deep Plan: `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`
- Readiness: inline gate implementable; independent Oracle implementable after the explicit H1 contract addendum.
- Scope: Stage 0 characterization plus Stage 1 Node-only `@ontime/ppt-bridge`; stop before H2.
- Boundary: preserve `companion/ppt-probe/Program.cs`, native build/package files, Companion production TypeScript, presentation-core, frontend/Controller, and standalone UI/installer.
- Initial state: six untracked task-authority documents were present; no tracked or modified files. They are preserved and committed as the documentation checkpoint before Implement mode.

## Task ledger

| Task | Source | Files/surface | Owner | Tests/validation | Status |
|---|---|---|---|---|---|
| H1-S0 | Plan Stage 0 | sanitized native/event fixtures, baseline manifest | orchestrator + test delegate | Companion suite; fixture replay | in progress |
| H1-S1 | Plan Stage 1 | `packages/ppt-bridge/**` | engineer delegate | validator/client/CJS tests | pending |
| H1-S2 | Plan Stage 1 | lockfile, dependency/CI/guardrails | engineer delegate | guardrails; ci-local | pending |

## Review and escape ledger

- P0/P1 findings: none.
- Stable signatures: none.
- Repeat counters: none.
- No false-positive, skip, core-issue, or futility decisions.

## Validation and resume log

- Read Oracle export: `/Users/radhabalagopala/Dev/onTime2/OnTime/prompt-exports/oracle-plan-2026-07-27-184010-h1-bridge-seed-d28be-085f.md` (RepoPrompt path remapping rejected it; native read fallback used after recording the tool gap).
- Required inputs read: spec, plan, readiness review, backlog progress, ISSUE-001.
- Independent Oracle: initial blocked ambiguity resolved by supplied H1 contract; final verdict implementable.
- Base SHA recorded: `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`.
- Last safe checkpoint: documentation checkpoint pending local commit.
- Resume instruction: after the checkpoint commit, run Stage 0 baseline characterization; do not begin Stage 1 until fixtures and baseline gate pass.

## Context exception log

- Oracle export required native `cat` fallback because RepoPrompt remapped the external export path into the bound worktree where it was not loaded. No source implementation context was substituted.
- Oracle readiness ambiguity was resolved by a focused continuation supplying the explicit user contract; no code was written before the implementable verdict.
