---
issue: ISSUE-001
branch: backlog/ISSUE-001-standalone-ppt-timer
worktree: /tmp/ontime-issue001-ppt-timer
base_branch: main
base_sha: fceb200b05c8f3bf7253ac0b3a91d613cc0bd305
phase: H3 presentation-core complete
current_task: closeout
review_cycles: 6
stable_findings: []
worktree_preflight: clean at a5386d8; H2 Windows validation still pending (not an H3 blocker)
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
| H2-1 | Stage 2 atomic native ownership | new package native source/project; old paths removed | orchestrator | post-move hashes, true-move evidence, source count | complete |
| H2-2 | Stage 2 canonical build + compatibility shim | two PowerShell scripts, ignore rule | orchestrator | exact publish flags; shim copy/hash structure; pwsh unavailable | complete (Windows execution pending) |
| H2-3 | Stage 2 Windows packaging integration | companion-build workflow; unchanged extraResources contract | orchestrator | Windows-only setup/build/packaged-resource hash structure | complete (Windows execution pending) |
| H2-4 | Stage 2 regression/closeout | required package, Companion, guardrail, CI lanes | orchestrator | all deterministic commands pass; Windows gates pending | complete (Windows gates pending) |
| H2-5 | Remediation loop: publish failure semantics | canonical PowerShell script, static regression, compatibility shim review | orchestrator | red static test, green 23/23 bridge suite, final review | complete (Windows execution pending) |

### H2 Review and escape ledger

- Final delegated remediation review: `findings: []`; no P0/P1 remains.
- Stable finding signatures: none outstanding.
- Review-cycle count: 5 (initial H2 review, P2 follow-ups, reopened P1 review, remediation confirmation).
- Resolved signature: `P1|packages/ppt-bridge/scripts/build-windows.ps1|native publish failure can leave stale executable|S-028/H2`; output is removed/recreated before publish, `$LASTEXITCODE` is captured immediately, nonzero throws before the executable check, and static tests pin the ordering.
- Static regression evidence: the new test was red before the script fix and green afterward; it also verifies the shim has no independent `dotnet publish`, no catch-based error swallowing, and performs copy/hash validation only after canonical success.
- Previous resolved signature remains: `P2|.github/workflows/companion-build.yml|verify path literals use doubled backslashes|S-028/H2`; forward-slash literals are confirmed.
- Non-blocking review note: `P3|companion/ppt-probe/|empty residual directory after true move|S-028/H2`; directory is untracked/cosmetic, both old files are absent, and no source/project remains.
- Any source-byte difference, duplicate native source/project, missing exact publish setting, changed runtime/fallback path, missing package resource, or orphan helper blocks H2 completion.
- Compatibility shim re-check: no direct native invocation, bare canonical invocation under `Stop`, no catch, then output/copy/hash checks.
- Windows-only gates remain pending and must not be marked fixed/green without Windows evidence.

### H2 Validation and resume log

- Last safe checkpoint: H2 remediation committed as `348dd23`; branch base remains `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`.
- True moves: `file_actions move` relocated both native files; old paths absent. HEAD/destination hashes and sizes: `Program.cs` 12,526 bytes / `7c198b806a7e53133aa6c238eef8d6fa6fefaf850fb2d0a35e6b25a857608695`; `ppt-probe.csproj` 451 bytes / `cee03bd0f97bdb27c77eccd7f81a92b507b515267e7e07f98354bb4c702c2b52`. Exactly two `Program.cs`/`ppt-probe.csproj` files remain; no tracked binaries or lockfile changes.
- Changed implementation surfaces: new `packages/ppt-bridge/native/windows-ppt-probe/{Program.cs,ppt-probe.csproj}`, remediated `packages/ppt-bridge/scripts/build-windows.ps1`, new `packages/ppt-bridge/test/native-build-scripts.test.ts`, rewritten `companion/scripts/build-ppt-probe.ps1`, `.gitignore`, and `.github/workflows/companion-build.yml`; `companion/package.json` and `companion/src/ppt-probe.ts` unchanged.
- Required commands: `npm run typecheck --workspace @ontime/ppt-bridge` PASS; `npm run test --workspace @ontime/ppt-bridge` PASS (23/23); `npm run build:cjs --workspace @ontime/ppt-bridge` PASS; `npm run smoke:cjs --workspace @ontime/ppt-bridge` PASS; `npm run build --workspace companion` PASS; `npm run test --workspace companion` PASS (155/155); `npm run guardrails` PASS; `npm run ci-local` PASS (all 23 checks).
- Structural checks: exact publish flags, shim delegation/copy/hash validation, Windows-only setup/build/verify ordering, three-way packaged-resource hash logic, runtime/resource contracts, whitespace, source count, and binary hygiene PASS.
- PowerShell parse: unavailable because `pwsh` is not installed. Native build/package/PowerPoint parity are pending because `dotnet`, Windows, and Office are unavailable. Do not claim canonical exe, installer resource, real COM field parity, or no-orphan runtime evidence until Windows execution.
- Git staging/commit: scoped native-ownership commit `852ecfc` and remediation commit `348dd23` succeeded after sandbox escalation; Git confirmed both native files as 100% renames. No remote action was taken. Final worktree is clean.
- Resume instruction: run the Windows validation handoff when available: pwsh parse, canonical publish, shim copy/hash, Companion packaged-resource hash, PowerPoint parity matrix, and orphan-process check. Keep H2 closed to Stage 3/4 work.

## H3 Presentation Core Loop

### Metadata

- H3 Oracle plan export: `prompt-exports/oracle-plan-2026-07-27-203307-h3-presentation-core-dbfc.md` (mode: plan, chat `h3-presentation-core-BE0C95`).
- Scope: Deep Plan Stage 3 only — pure PowerPoint types/normalization/candidate reducer/standalone view projection graduate into `@ontime/presentation-core`; CJS build/export/smoke gate; guardrail + CI/`ci-local` reordering; the only Companion production adoption is `presentation-snapshot.ts` as a compatibility wrapper (types/comparators re-exported, `buildPowerPointCue()` stays local).
- Hard boundaries (verbatim from task): no change to `presentation-candidate.ts` / `main.ts` production behavior, polling, transport, logging, room/live-cue emission, `activeLiveCueId`, timestamps, `startedAt`, event order, fallbacks, lifecycle; no weakening of existing Companion test expectations/fixtures; no Node/Electron/process/timers/transport/shared-wire-contract/Companion/frontend imports into presentation-core production files; no D6/D10 behavior fix; no H4 session adoption/app/UI/installer/UnifiedDataContext/unrelated cleanup; H2 Windows evidence stays recorded-pending, not a blocker, not completed; no push/PR/issue-close/outer-status change.
- Readiness: inline gate + independent readiness review (`docs/reviews/standalone-powerpoint-video-timer-readiness-2026-07-27.md`) already verdict `implementable` for the full spec/plan including Stage 3; H3 oracle plan (mode=plan) is the implementation-ready design for this stage. Not re-litigated; proceeding directly to Implement mode per the user's explicit task framing.
- Base SHA: `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`; branch HEAD at H3 start: `4806798` (worktree clean, verified).

### H3 Task ledger

| Task | Source | Files/surface | Owner | Tests/validation | Status |
|---|---|---|---|---|---|
| H3-1 | Stage 3 §3.1-3.2 | powerpoint-types.ts, powerpoint-normalize.ts + tests | orchestrator | C1-C3, D1-D12; normalization tests included in 92 core tests | complete |
| H3-2 | Stage 3 §3.3 | powerpoint-machine.ts + tests | orchestrator | C7-C16, D1-D12; no-slideshow pending-candidate guard added | complete |
| H3-3 | Stage 3 §3.4 | powerpoint-view.ts + tests | orchestrator | H1 fixtures; S-001..S-017; ID/name/index, explicit invalid fallback, active-first/first-video, exact 250 ms boundary | complete |
| H3-4 | Stage 3 §3.5 | index.ts barrel, CJS build/export/smoke | orchestrator | typecheck PASS; 4 files/92 tests PASS; build:cjs PASS; smoke:cjs PASS; mergeCueVideos preserved | complete |
| H3-5 | Stage 3 §3.6 | presentation-snapshot.ts wrapper, companion/package.json prebuild | orchestrator | clean dist-cjs deletion followed by Companion build/test; 155/155 PASS | complete |
| H3-6 | Stage 3 §3.7 | guardrails script, CI workflow, ci-local.mjs | orchestrator | guardrails PASS; core-before-Companion ordering mirrored; full ci-local PASS after restoring generated test dependencies | complete |
| H3-7 | closeout | progress ledger, review | orchestrator | direct final diff review: no P0/P1; Oracle review handoff rejected twice at 1 MiB provider limit | complete |

### H3 Review and escape ledger

- Findings: none; no P0/P1 signatures remain.
- No production changes to presentation-candidate.ts or main.ts; C1-C16/D1-D12 and S-001..S-017/S-028 contracts remain covered. Event fixtures and C1-C16/D1-D12 Companion expectations were not edited.
- S-028/build-order evidence: presentation-core typecheck → tests → CJS build → CJS smoke precedes Companion typecheck/tests in both workflow and ci-local; Companion prebuild repeats the clean-checkout guarantee.
- Environment note: the first ci-local attempt stopped at Frontend lint after host disk exhaustion removed generated dependencies. The outer coordinator freed generated cache space, restored frontend tooling and an environment-only Electron test stub under node_modules, then reran the complete ci-local gate successfully. This was not a code finding and produced no tracked changes.

### H3 Validation and resume log

- H3 clean checkpoint: a5386d8; base SHA remains fceb200b05c8f3bf7253ac0b3a91d613cc0bd305.
- Presentation-core: npm run typecheck --workspace @ontime/presentation-core PASS; npm run test --workspace @ontime/presentation-core PASS (4 files / 92 tests); npm run build:cjs --workspace @ontime/presentation-core PASS; npm run smoke:cjs --workspace @ontime/presentation-core PASS.
- Companion clean-checkout evidence: after deleting packages/presentation-core/dist-cjs, npm test --workspace companion rebuilt core through companion prebuild and passed 155/155. Companion typecheck also PASS.
- Guardrails: npm run guardrails PASS; independent outer-coordinator rerun of npm run ci-local PASS across all 25 checks, including presentation-core 92/92, Companion 155/155, frontend lint/typecheck and 240/240 tests, bridge 23/23, remaining package suites, and whitespace checks.
- Build output is ignored via .gitignore; only the intended Companion dependency/prebuild and corresponding package-lock entry were added. No generated dist output is tracked.
- Resume instruction: H3 is complete and committed; do not enter H4 in this loop. H2 Windows/native evidence remains pending.

## Context exception log

- Oracle export required native `cat` fallback because RepoPrompt remapped the external export path into the bound worktree where it was not loaded. No source implementation context was substituted.
- Oracle readiness ambiguity was resolved by a focused continuation supplying the explicit user contract; no code was written before the implementable verdict.
- Stage 0 delegate `87BC2263-E055-4DCF-A6FD-E894478C6767` stalled without edits and was cancelled; Stage 0 was completed directly. Stage 1 delegate `EBA905AF-1C4F-4B87-A837-339324DC78BD` likewise stalled without edits and was cancelled; Stage 1 was completed directly. No external input was required.
- Oracle review handoff failed twice with `sourceCaptureFailed` after the review selection became stale; a fresh read-only delegated final review `E9DE195F-258B-42A0-A64F-3D47ED0CC88E` completed with no defects. The review evidence and all exact validation commands were independently verified in this worktree.
- Reopened H2 P1 was independently reviewed by read-only session `C9959F67-B5EC-43AB-9971-630E47D0F815`; final findings were empty, the P1 was resolved by code plus green static tests, and Windows execution remains pending.
- H3 Oracle review was attempted twice after publishing a narrowed 14-file diff; both provider calls were rejected before analysis for exceeding the 1 MiB input limit. Direct diff inspection and all available targeted/integration validation were used for the final gate; no P0/P1 was found.

## H4 Persistent PowerPoint session and Companion bridge loop

### Scope and ledger

- H4 scope: additive presentation-core `candidate`/`synchronize_commit` events; transport-injected `PowerPointSession`; persistent `PptBridgeClientImpl` generations; sanitized `no_slideshow` context; Companion native-client adapter and session/core compatibility wrappers.
- Protected surfaces remain unchanged: native C# source/project, PowerShell/AppleScript fallback bodies and order, `companion/src/main.ts`, frontend/Controller, room payloads, D6/D10 behavior, and standalone UI.
- Dependency order is pinned: presentation-core CJS → ppt-bridge CJS → Companion compile/tests in the workflow, local CI, and Companion `prebuild`.
- Review: direct final diff review found no P0/P1 findings.

### Validation evidence

- Presentation-core: typecheck PASS; 100 tests PASS; CJS build/smoke PASS.
- PPT bridge: typecheck PASS; 30 tests PASS; CJS build/smoke PASS.
- Companion: typecheck/build PASS; characterization and fixture suite PASS (155/155).
- Guardrails and dependency boundaries PASS (7/10 package population baseline; 212 modules / 506 dependencies).
- Windows native execution remains pending: no Windows/Office environment was available to verify helper PID reuse, exit/restart recovery, native-to-PowerShell fallback cascade, packaged resource parity, and orphan-process shutdown. Do not claim this evidence as verified until the Windows gate is run.

### Scoped commits

- H4 core/bridge implementation and tests: local commit `c5b3c52` (`feat: Add persistent PowerPoint bridge session`).
- H4 Companion/CI/guardrail integration: local commit `caea6e7` (`feat: Adopt PowerPoint session in Companion`).
- H4 manifest whitespace fix: local commit `244bfa8` (`chore: Normalize Companion manifest line endings`).
- H4 ledger closeout: this entry records the validation evidence and the Windows-pending boundary.
