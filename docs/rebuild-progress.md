# OnTime Rebuild Progress

_Updated: 2026-06-10._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild
PR.

## Current Stage

Stage 1a: first pure package extraction.

## Landed

- PR #1: architecture/product audit set on `main`
- PR #2: Stage 0 timer stabilization on `main`
- PR #3: rebuild architecture and extraction rules on `main`
- PR #4: rebuild guardrail enforcement on `main`
- PR #5: frontend lint/typecheck CI correctness gate on `main`

## Active Work

- Stage 1a timer-core extraction PR: create `packages/timer-core` from allowlisted timer helpers, keep a frontend legacy shim, and add scoped package checks.

## Next Gates

1. Land `packages/timer-core` with tests and a legacy re-export shim.
2. Confirm guardrail, frontend lint/typecheck, timer-core typecheck, and scoped timer tests run in CI.
3. Continue Stage 1a with `shared-types` only after timer-core is reviewed and merged.

## Not Started

- `shared-types` extraction
- Stage 1b god-file carve-outs
- app folder moves
- fresh repo split

## Deferred

- full test-suite gating, blocked by known pre-existing `main` failures
- line-ending normalization hygiene PR
- `mergeCueVideos` regression during `presentation-core` extraction
- iPad viewer polish branch

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
