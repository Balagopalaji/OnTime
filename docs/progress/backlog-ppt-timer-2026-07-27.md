---
issue: ISSUE-001
branch: backlog/ISSUE-001-standalone-ppt-timer
worktree: /tmp/ontime-issue001-ppt-timer
base_branch: main
base_sha: fceb200b05c8f3bf7253ac0b3a91d613cc0bd305
phase: H2 in progress
current_task: H2-0 identity preflight / H2-1 atomic native ownership move
review_cycles: 0
stable_findings: []
worktree_preflight: clean at 8ca58ff; H2 documentation checkpoint pending
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
| H1-S0 | Plan Stage 0 | sanitized native/event fixtures, baseline manifest | orchestrator (recovered after child stall) | Companion suite 155/155; fixture replay | complete |
| H1-S1 | Plan Stage 1 | `packages/ppt-bridge/**` | orchestrator (recovered after child stall) | validator/client 21/21; typecheck; CJS build/smoke | complete |
| H1-S2 | Plan Stage 1 | lockfile, dependency/CI/guardrails | orchestrator | guardrails; ci-local | complete |

## Review and escape ledger

- P0/P1 findings: none; final delegated review verdict: no defects.
- Stable signatures: none remaining.
- Low-risk review note `maintainability|packages/ppt-bridge/src/process-client.ts|magic-byte-thresholds-not-bound-to-MAX_RESPONSE_BYTES|S-002` was fixed and targeted tests/typecheck passed.
- Non-blocking note: duplicated sanitized fixtures are intentionally owned by Companion and bridge suites; Stage 0 provenance manifest records the relationship.
- No false-positive, skip, core-issue, or futility decisions.

## Validation and resume log

- Read Oracle export: `/Users/radhabalagopala/Dev/onTime2/OnTime/prompt-exports/oracle-plan-2026-07-27-184010-h1-bridge-seed-d28be-085f.md` (RepoPrompt path remapping rejected it; native read fallback used after recording the tool gap).
- Required inputs read: spec, plan, readiness review, backlog progress, ISSUE-001.
- Independent Oracle: initial blocked ambiguity resolved by supplied H1 contract; final verdict implementable.
- Base SHA recorded: `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`.
- Last safe checkpoint: H1 implementation and validation complete; scoped commits `4da61ee` and `73567a0` are present.
- Required validation: `npm run test --workspace companion` PASS (155/155); `npm run typecheck --workspace @ontime/ppt-bridge` PASS; `npm run test --workspace @ontime/ppt-bridge` PASS (21/21); `npm run build:cjs --workspace @ontime/ppt-bridge` PASS; `npm run smoke:cjs --workspace @ontime/ppt-bridge` PASS; `npm run guardrails` PASS (7/10, baseline 7; 183 modules, 439 dependencies); `npm run ci-local` PASS (all 23 checks).
- Stage 0 evidence: sanitized native-helper fixtures cover not-running, no-slideshow, playing, paused, ended, multiple-video, synthetic malformed/timeout; complete ordered event replay passes. Windows 11 + Microsoft 365 x64 raw capture remains pending because no Windows/Office environment is available; no evidence was fabricated.
- Protected-file check: no changes to `companion/ppt-probe/Program.cs`, Companion production TypeScript, presentation-core, frontend/controller, or standalone UI/installer.
- Resume instruction: H1 is complete; next work, if authorized, starts at H2 and must not retrofit H1 into protected production paths.

## H2 Native Ownership Loop

### Metadata

- H2 Oracle export: `/Users/radhabalagopala/Dev/onTime2/OnTime/prompt-exports/oracle-plan-2026-07-27-195533-h2-native-ownership-3468.md`
- Independent H2 readiness verdict: `implementable`; blocking gaps: none; governing scenario: S-028.
- H2 scope: Stage 2 only. No C#/.csproj content changes, protocol/COM/media/timing/selection changes, runtime retarget, Stage 3/4 adoption, UI/installer redesign, dependency or lockfile changes.
- Base SHA: `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`; branch HEAD at start: `8ca58ff`.
- H2-0 preflight: old `Program.cs` = 12,526 bytes, SHA-256 `7c198b806a7e53133aa6c238eef8d6fa6fefaf850fb2d0a35e6b25a857608695`; old `ppt-probe.csproj` = 451 bytes, SHA-256 `cee03bd0f97bdb27c77eccd7f81a92b507b515267e7e07f98354bb4c702c2b52`.
- Tool availability: `pwsh` unavailable; `dotnet` unavailable. Windows/native build, packaged-resource, and real Office parity evidence remain pending.

### H2 Task ledger

| Task | Source | Files/surface | Owner | Tests/validation | Status |
|---|---|---|---|---|---|
| H2-0 | Stage 2 identity preflight | old native source/project | orchestrator | SHA-256, byte size, tracked source count | complete |
| H2-1 | Stage 2 atomic native ownership | new package native source/project; old paths removed | orchestrator/engineer | post-move hashes, rename identity, source count | in progress |
| H2-2 | Stage 2 canonical build + compatibility shim | two PowerShell scripts, ignore rule | orchestrator/engineer | script parse if pwsh available; structural assertions | pending |
| H2-3 | Stage 2 Windows packaging integration | companion-build workflow; unchanged extraResources contract | orchestrator/engineer | workflow parse/structural assertions; Windows package pending | pending |
| H2-4 | Stage 2 regression/closeout | required package, Companion, guardrail, CI lanes | orchestrator | required deterministic command set; Windows gates pending | pending |

### H2 Review and escape ledger

- P0/P1 findings: none at H2 start.
- Stable finding signatures: none.
- Review-cycle count: 0.
- Any source-byte difference, duplicate native source/project, missing exact publish setting, changed runtime/fallback path, missing package resource, or orphan helper blocks H2 completion.
- Windows-only gates are pending and must not be marked fixed/green without Windows evidence.

### H2 Validation and resume log

- Last safe checkpoint: H1 complete at `8ca58ff`; H2-0 identity preflight complete.
- Next action: move native files byte-faithfully, add canonical build script and compatibility shim, then update only necessary Windows workflow/ignore rules.
- Required final commands: bridge typecheck/test/build:cjs/smoke:cjs; Companion build/test; guardrails; ci-local.
- Resume instruction: continue H2-1 from the clean documentation checkpoint; do not alter native file contents or protected Companion runtime behavior.

## Context exception log

- Oracle export required native `cat` fallback because RepoPrompt remapped the external export path into the bound worktree where it was not loaded. No source implementation context was substituted.
- Oracle readiness ambiguity was resolved by a focused continuation supplying the explicit user contract; no code was written before the implementable verdict.
- Stage 0 delegate `87BC2263-E055-4DCF-A6FD-E894478C6767` stalled without edits and was cancelled; Stage 0 was completed directly. Stage 1 delegate `EBA905AF-1C4F-4B87-A837-339324DC78BD` likewise stalled without edits and was cancelled; Stage 1 was completed directly. No external input was required.
- Oracle review handoff failed twice with `sourceCaptureFailed` after the review selection became stale; a fresh read-only delegated final review `E9DE195F-258B-42A0-A64F-3D47ED0CC88E` completed with no defects. The review evidence and all exact validation commands were independently verified in this worktree.
