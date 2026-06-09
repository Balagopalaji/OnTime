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

## Active Work

- Stage 1a `shared-types` extraction PR: create `packages/shared-types` from the reviewed type-only frontend contract surface, keep a frontend legacy shim, and add scoped package typecheck.

## Next Gates

1. Land `packages/shared-types` with compile-time fixtures and a legacy type-only re-export shim.
2. Confirm guardrail, frontend lint/typecheck, timer-core checks, and shared-types typecheck run in CI.
3. Choose the next Stage 1a pure extraction candidate only after `shared-types` is reviewed and merged.

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
