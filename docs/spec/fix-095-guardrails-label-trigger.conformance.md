# Conformance Matrix — FIX-095 (guardrails label-trigger)

Spec source: inline brief for FIX-095 (Loop workflow). Implementation: branch
`backlog/fix-095-guardrails-label-trigger`, single file changed —
`.github/workflows/rebuild-guardrails.yml` (+6 lines under `pull_request:`).

Closeout coverage proof: `{ audited: [S1, S2, S3, "pull_request.types"], unreconciled: [] }`.

## Scenarios

| ID | Scenario (Given/When/Then) | Status | Evidence |
|----|----------------------------|--------|----------|
| S1 | Given a PR with a green guardrails run; when a maintainer adds the `fast-lane` label; then the guardrails workflow re-runs and the Fast-lane eligibility step executes. | **Conformed** | `.github/workflows/rebuild-guardrails.yml` `pull_request.types` now includes `labeled` (lines 9–11). Adding the label is now a triggering activity, so the workflow re-runs and the `if: …contains(…labels…,'fast-lane')` eligibility step executes. Verified: `python3 yaml.safe_load` → `types == […, 'labeled', …]`; git diff shows only the 6-line insertion. |
| S2 | Given a PR carrying the `fast-lane` label; when a maintainer removes it (`unlabeled`); then the guardrails re-runs and the eligibility step correctly sees the label is gone. | **Conformed** | `pull_request.types` now includes `unlabeled` (line 11). Label removal is now a triggering activity; the eligibility step re-evaluates and, with the label absent, the `contains(...)` condition is false so the fast-lane gate is not applied (slow-lane resumes). Same verification as S1. |
| S3 | Given normal `synchronize` (new commit), `opened`, `reopened` activity; then the full workflow runs unchanged (no regression). | **Conformed** | `pull_request.types` retains `opened`, `reopened`, `synchronize` (lines 9–10) — these are exactly the default activity set, so no prior event is lost. The `push:` trigger and all 20 job steps are byte-identical (git diff: only the 6 added `types` lines). |

## Proposed Surface

| Surface element | Required value | Status | Evidence |
|----------------|----------------|--------|----------|
| `on.pull_request.types` | `[opened, reopened, synchronize, labeled, unlabeled]` | **Conformed** | `python3 yaml.safe_load('.github/workflows/rebuild-guardrails.yml')['on' (True)]['pull_request']['types']` returns exactly `['opened', 'reopened', 'synchronize', 'labeled', 'unlabeled']`. Independent oracle value-conformance review: `conformed`, verdict `clean`, no findings. |

## Stated values / invariants

| Value | Status | Evidence |
|-------|--------|----------|
| Do not skip any non-label guardrail step on label-only events | **Conformed** | No `if:` guards were added or changed on any step; every step runs on every trigger activity as before. Diff shows zero step changes. |
| `push:` trigger byte-identical | **Conformed** | `push.branches == ['main']` unchanged; no lines touched outside the `pull_request:` block. |
| Every existing step byte-identical | **Conformed** | git diff (uncommitted vs base) shows exactly 6 added lines, all within the `on.pull_request.types` block; no removals/reorders. |
| Strengthens (does not weaken) a gate | **Conformed** | Change only adds triggering activities so the existing fast-lane eligibility gate re-executes on label changes; it removes no check and relaxes no condition. Oracle review: no weakening findings. |

## Unreconciled
None. `{ audited: [S1, S2, S3, "pull_request.types"], unreconciled: [] }`.

## Validation evidence
- YAML well-formedness: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rebuild-guardrails.yml'))"` → parses OK; types list verified.
- actionlint: not installed in environment → skipped cleanly per spec (not a failure).
- Structural re-read: `on:` block confirmed; `pull_request.types == [opened, reopened, synchronize, labeled, unlabeled]`; `push:` + every step byte-identical.
- Independent review (oracle, mode=review): verdict `clean`, findings `[]`, value_conformance `pull_request.types = conformed`, inspected `.github/workflows/rebuild-guardrails.yml`.

## Documentation audit (dry-run, doc_edits=false)
- No drift. `docs/rebuild-fast-lane.md` (lines 78–89) describes the fast-lane eligibility step and the invariant "you cannot mislabel a behavior change as fast-lane" but does not enumerate workflow trigger activities, so no documented claim is invalidated; this change strengthens that invariant. `docs/rebuild-progress.md` reference is historical ("landed in #95").
- Optional (not applied): a one-line note in `docs/rebuild-fast-lane.md` that the guardrail re-runs on `fast-lane` label add/remove. Declined for apply because `doc_edits=false`; reported to orchestrator.
