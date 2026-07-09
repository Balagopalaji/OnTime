# FIX-095 — guardrails label-trigger (Loop)

```json
{
  "branch": "backlog/fix-095-guardrails-label-trigger",
  "worktree": "rp-agent-51f788d0-backlog-fix-095-guardrails-label-81c44caf",
  "base_branch": "main",
  "base_sha": "29cd211fec1e2de05c6ed8335c960ad5e68f4cb8",
  "issue": "#95 (addresses unaddressed review feedback)",
  "spec": "inline brief (FIX-095)",
  "plan": "inline brief — single work item",
  "phase": "closeout",
  "current_task": "WI-1 (done)",
  "oracle_chat": "new-chat-57C8C3",
  "review_cycles": 1,
  "findings": [],
  "conformance_matrix": "docs/spec/fix-095-guardrails-label-trigger.conformance.md"
}
```

## Metadata
- Branch: `backlog/fix-095-guardrails-label-trigger`
- Base SHA (merge-base w/ main): `29cd211fec1e2de05c6ed8335c960ad5e68f4cb8`
- Authorization (orchestrated): `git_scope = branch+pr` (commit, push branch, open PR — STOP before merge); `doc_edits = false`.
- Oracle readiness verdict: `implementable`, no blocking gaps, spec `ready`. YAML-parse + structural re-read is the sufficient test layer (no in-repo runtime surface); actionlint optional.

## Root cause
`.github/workflows/rebuild-guardrails.yml` declares `on: pull_request: branches: [main]` with no `types:`. GitHub Actions uses the default PR activity set (opened/reopened/synchronize) and does NOT run on `labeled`/`unlabeled`. The "Fast-lane eligibility" step gates on `contains(github.event.pull_request.labels.*.name, 'fast-lane')`. Adding `fast-lane` after the last CI run triggers no re-run, so the stale green check + the eligibility gate that never re-executes let a mislabeled behavior change bypass the fast-lane gate until another commit lands.

## Approach (oracle-confirmed)
Add `types: [opened, reopened, synchronize, labeled, unlabeled]` to the `pull_request` trigger. Do NOT skip any non-label steps on label-only events. Keep the `push` trigger and every existing step byte-identical. This STRENGTHENS a gate.

## Scenarios
- S1: PR green; add `fast-lane` label → workflow re-runs, eligibility executes. (Was FAILING.)
- S2: PR with `fast-lane`; remove it (`unlabeled`) → workflow re-runs, eligibility sees label gone. (Was FAILING.)
- S3 (no regression): `synchronize`/`opened`/`reopened` full workflow unchanged.

## Toolchain / verification (recorded absolute commands)
1. YAML well-formedness: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rebuild-guardrails.yml'))"`
2. actionlint if available: `actionlint .github/workflows/rebuild-guardrails.yml` (skip cleanly if absent).
3. Structural re-read of final `on:` block; confirm `pull_request.types == [opened, reopened, synchronize, labeled, unlabeled]`, `push:` + every step byte-identical to original.

## Task ledger
| Task | Source | Files | Owner | Tests | Status | Evidence |
|------|--------|-------|-------|-------|--------|----------|
| WI-1 | brief approach | `.github/workflows/rebuild-guardrails.yml` | orchestrator | YAML parse + structural re-read | done | +6 lines `pull_request.types`; YAML OK; types == [opened,reopened,synchronize,labeled,unlabeled]; oracle review clean |

## Review and escape ledger
- Independent review (oracle, mode=review): verdict `clean`, findings `[]`, value_conformance `pull_request.types=conformed`, inspected `.github/workflows/rebuild-guardrails.yml`. No P0/P1. No repeat-finding classification needed.

## Validation and resume log
- YAML well-formedness: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rebuild-guardrails.yml'))"` → OK; `pull_request.types == ['opened','reopened','synchronize','labeled','unlabeled']`, `push.branches == ['main']`, `jobs == ['guardrails']`.
- actionlint: not installed → skipped cleanly per spec (not a failure).
- Structural diff (uncommitted vs base 29cd211): exactly +6 lines under `on.pull_request`; `push:` and all 20 job steps byte-identical; no removals/reorders.
- Conformance matrix: `docs/spec/fix-095-guardrails-label-trigger.conformance.md` — all scenarios + Proposed Surface Conformed, `unreconciled: []`.
- Documentation audit (dry-run, doc_edits=false): no drift; optional note to `docs/rebuild-fast-lane.md` proposed not applied.
- Last safe checkpoint: commit (below) on `backlog/fix-095-guardrails-label-trigger`; resume = push branch + open PR, STOP before merge.

## Context exception log
- (none — change is a single self-evident block; no delegate evidence needed)

## Constraints honored
- Touch only `.github/workflows/rebuild-guardrails.yml` (not `companion-build.yml` / `controller-build.yml`).
- LF line endings; do not remove or reorder existing steps.
- Do NOT merge; do NOT change `rebuild-progress.md` ledger status (orchestrator owns both).

## Authorization status
- git_scope = branch+pr: commit ✅, push ✅, open PR ✅ (STOP before merge — not authorized; orchestrator owns merge + ledger).
- doc_edits = false: documentation edits NOT applied (dry-run only; conformance matrix + this progress doc are Loop closeout artifacts, not doc-sync).
- PR: opened post-commit (URL reported to orchestrator).
