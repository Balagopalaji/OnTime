# Rebuild Fast-Lane System

Two-speed carve process. Most god-file lines are inert (type moves, dead code,
pure wiring) and must not pay the full behavior-review cost. This splits work
into a **fast lane** (mechanical, provably inert) and a **slow lane**
(behavior-sensitive), so throughput comes from not over-reviewing zero-risk
changes — while every behavior change still gets the full baton.

Motivation: the rework this rebuild has eaten came from false-greens and
smuggled behavior changes, not from carving. This system makes false-greens
structurally hard (`ci-local`) and keeps mislabeled behavior changes out of the
fast lane (`fast-lane` guardrail).

## The anti-false-green gate: `npm run ci-local`

`scripts/ci-local.mjs` runs the **same checks as the `Guardrail checks` CI job**
(`.github/workflows/rebuild-guardrails.yml`), same order, fail-fast. "ci-local
green" ⟺ "GitHub guardrails green". It is CI-*equivalent*, not byte-identical:
when the workflow changes, update the `STEPS` array in the same PR (the script
prints a non-fatal drift warning to remind you).

**Every builder, every lane, runs `npm run ci-local` and pastes the final
summary into the PR before flipping the review baton.** No paste → not ready.
`#88` round-1 failed review purely because typecheck was never run locally; this
gate makes that impossible.

## Lane classification

A PR is **fast-lane eligible** only if it is provably type/comment/doc-only.
Enforced by `npm run fast-lane` (`scripts/check-fast-lane.mjs`) using an
**emitted-JS comparison**, not line regexes: for every changed TS/TSX file it
transpiles the base and head versions (type-stripped, comments removed) and
compares the emitted JavaScript. Type annotations, interfaces, type aliases,
`import type`, and comments all erase from emitted JS; runtime edits do not.

- **Fast lane** — emitted JS byte-identical before vs after (after normalizing
  away inert `export {};` module markers and blank lines). God-files **may** be
  touched in the fast lane for such changes — no blunt whole-file denylist.
- **Slow lane (forced)** — emitted JS differs (a new array element, object
  field, changed literal, reordered value import, any statement/expression);
  any plain `.js` change (no type layer to erase); any non-source/non-doc file
  (json, yml, config, manifests, workflows, lockfiles); or any file that can't
  be transpiled/compared. The gate is biased toward slow-lane: a false positive
  just means "review it fully" (cheap); it is designed not to pass a
  runtime-affecting change.

The checker **requires a clean tree and runs against `origin/main`** (merge-base
`...HEAD`), so it must be run **after the final commit** — uncommitted work would
otherwise make the committed diff a lie and the gate report a false green. Exit
codes: `0` eligible, `1` slow-lane, `2` cannot decide (dirty tree / tooling →
treat as slow-lane).

Human backstop: Codex spot-checks every fast-lane diff before merge.

## Definition of Done + review depth, per lane

| | Fast lane | Slow lane |
|---|---|---|
| Prerequisite | none | correct-behavior spec + read-only placement pass |
| Builder DoD | `npm run ci-local` green (paste) **and** `npm run fast-lane` green | `ci-local` green (paste) + behavior trace against the spec |
| Review | **No Claude baton.** Codex merges on: green GitHub guardrails + `ci-local` paste + `fast-lane` guardrail pass + Codex diff spot-check | Full Claude baton review (strict, via `git show`/`git diff` vs PR SHA) |
| Batching | bundle large — many homogeneous inert moves per PR | one decision/divergence boundary per PR |

Slow lane keeps the existing rule set: don't preserve *known-buggy* behavior —
where current behavior diverges from the correct-behavior spec, build to the
spec and treat the old code as a reference to diff against, not a contract.

## Metric

Each carve PR records **god-file net line-delta** (`companion/src/main.ts`,
`frontend/src/context/UnifiedDataContext.tsx`). A PR that doesn't shrink a
god-file is foundation, not carve — surfaced in `docs/rebuild-progress.md` so
throughput is visible against the D5 target (both god-files deleted or
≤500-line pure-wiring shims).

## CI wiring

`.github/workflows/rebuild-guardrails.yml` includes a `fast-lane` label gate:
a PR carrying the `fast-lane` label must pass `node scripts/check-fast-lane.mjs`.

```yaml
      - name: Fast-lane eligibility
        if: github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'fast-lane')
        run: FAST_LANE_BASE=origin/${{ github.base_ref }} node scripts/check-fast-lane.mjs
```

A PR labeled `fast-lane` whose diff isn't inert then fails CI — you cannot
mislabel a behavior change as fast-lane. Unlabeled PRs default to slow-lane and
are unaffected.
