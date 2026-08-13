---
issue: ISSUE-001
branch: backlog/ISSUE-001-standalone-ppt-timer
worktree: /private/tmp/ontime-issue001-ppt-timer
base_branch: main
loop_base_sha: fceb200b05c8f3bf7253ac0b3a91d613cc0bd305   # merge-base(HEAD, main)
working_base_sha: 5193084be79f78c3a334e14e3b0566a2656a7cb0  # H1-H6 source-acceptance checkpoint; later docs-only metadata commits do not change source
phase: H6 Stage 6 — source implemented and source-accepted; Stage 7 Windows/Office/installer execution pending
current_task: Stage 7 execution evidence only; do not reopen source remediation without a new finding
current_task_batch_a: complete — installer/manifest/workflow source accepted
current_task_batch_b: complete — net10 self-contained helper source accepted
review_cycles: 3  # audit, remediation re-audit, final source acceptance
stable_findings: []
checkpoint_commits: 0bd69c7 canonical probe/core; 24fa596 standalone runtime/settings; 65f65d7 installer/CI/versioning; 5193084 H6 source-acceptance docs
worktree_preflight: clean committed worktree; H1-H6 source checkpoint = 5193084 and loop base vs main = fceb200b. Branch not pushed; no PR or issue-state change has occurred.
---

# ISSUE-001 H6 Loop — Stage 6 source acceptance; Stage 7 pending

## Metadata

- Spec: `docs/spec/standalone-powerpoint-video-timer.spec.md` (S-001…S-033).
- Deep Plan: `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md` Stages 6–8.
- Final source decision: `docs/reviews/standalone-powerpoint-video-timer-final-source-acceptance-2026-07-28.md` — **PASS / GO** for source; Stage 7 execution and Stage 8 signing remain separate.
- Host: macOS. No `.NET publish`, Electron/NSIS package, Windows workflow, Windows install/upgrade/uninstall, or Office/PowerPoint run was performed. Do not infer those results from source tests.

## Task ledger

| Task | Source / surface | Status |
|---|---|---|
| Batch A — installer and artifact path | `apps/ppt-timer/electron-builder.yml`; package `dist`/`manifest` scripts; helper discovery; deterministic manifest/checksum tooling; standalone Windows workflow; local/guardrail app gates | **Complete — source-accepted.** Stable `appId: com.ontime.ppttimer`, x64 assisted per-user NSIS, `deleteAppDataOnUninstall: false`, exactly-one-helper/resource and ASAR/runtime dependency checks are defined. |
| Batch B — canonical helper retarget | `ppt-probe.csproj`, `build-windows.ps1`, `windows-file-version.mjs`, native build tests, standalone/Companion Windows workflows | **Complete — source-accepted.** `net10.0-windows` win-x64 self-contained, single-file, untrimmed helper; numeric PE `FileVersion` is derived separately from SemVer. |
| Audit remediation | P0-01…03, P1-01…08, P2-01…05, NEW-P1-01…03, NEW-P2-01 | **Complete.** Final source acceptance records all 18 enumerated findings fixed at source; no remaining audit P0/P1/P2. |
| Stage 7 execution | Windows/Office/installer runtime evidence | **Pending.** Required before claiming install, upgrade, uninstall, packaged-helper, or live PowerPoint conformance. |
| Stage 8 signing | Publisher identity and signed public artifact | **Pending.** Separate public-release gate; internal artifact remains intentionally unsigned. |

## Validation (source / local evidence)

Final source acceptance records:

- `npm run test --workspace @ontime/presentation-core` — **PASS, 105 tests**.
- `npm run test --workspace @ontime/ppt-bridge` — **PASS, 56 tests**.
- `npm run test --workspace apps/ppt-timer` — **PASS, 174 tests**.
- `npm run test --workspace ontime-companion` — **PASS, 165 tests**.
- Presentation-core, ppt-bridge, and PPT timer typechecks — **PASS**; boundaries — **PASS, 258 modules / 614 dependencies**; `npm run guardrails:static` — **PASS**; ordered CJS build/smokes and PPT timer production build — **PASS**.
- Focused version/workflow tests — **PASS, 18 tests**; `git diff --check fceb200 -- .` — **PASS**, exit 0 with no output.
- `ci-local` and repository guardrails are recorded green in the final H6 source state; their Windows workflow/package steps are definitions, not locally executed Windows evidence.

## Remaining Stage 7 gates — pending, not source defects

1. Publish the helper on clean Windows; inspect single-file output and PE product/informational SemVer plus derived numeric `FileVersion`; launch without machine-wide .NET.
2. Execute `ppt-timer-build.yml`, `companion-build.yml`, Controller, and rebuild-guardrails workflows from clean checkouts; inspect installer, unpacked resources, ASAR, checksum, and manifest.
3. Run S-030 clean install/launch/poll, S-031 same-identity in-place upgrade with all settings retained, and S-032 normal uninstall/reinstall recovery.
4. Run Microsoft 365 COM journeys (including x64/x86 support decision), failure/restart/orphan checks, live multi-display/settings journeys, and a 30-minute Companion + standalone coexistence test.
5. Resolve OQ-1 URL and release wording/support decisions; retain the CTA hidden until then.

## Resume instruction

Do **not** add source remediation merely because Windows evidence is absent. Next owner runs and records the Stage 7 gates above, then reconciles runtime outcomes into the conformance matrix. Preserve the existing branch, clean worktree, base SHA, and committed checkpoints; do not push, open a PR, or change issue state without explicit authorization.
