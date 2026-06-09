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
- PR #6: Stage 1a `timer-core` extraction on `main`
- PR #7: Stage 1a `shared-types` extraction on `main`

## Active Work

- Stage 1a `local-sync-arbitration` extraction PR: create a Local-owned pure arbitration package from the reviewed frontend helper, keep Vite debug logging in the frontend shim, preserve `ARBITRATION_FLAGS`, and add scoped package checks.

## Next Gates

1. Land `packages/local-sync-arbitration` with existing arbitration characterization coverage and a frontend legacy shim.
2. Confirm Cloud does not import `local-sync-arbitration` and `ARBITRATION_FLAGS` remain frozen.
3. Decide whether any Stage 1a pure extraction remains; otherwise stop before Stage 1b god-file carve-outs.

## Not Started

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
