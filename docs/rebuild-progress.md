# OnTime Rebuild Progress

_Updated: 2026-06-09._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild
PR.

## Current Stage

Stage 0.5: CI correctness gate before Stage 1a extraction.

## Landed

- PR #1: architecture/product audit set on `main`
- PR #2: Stage 0 timer stabilization on `main`
- PR #3: rebuild architecture and extraction rules on `main`
- PR #4: rebuild guardrail enforcement on `main`

## Active Work

- CI correctness gate PR: run frontend lint and typecheck in the rebuild guardrail workflow

## Next Gates

1. Land CI correctness gate.
2. Confirm guardrail, lint, and typecheck checks run in CI.
3. Only then start Stage 1a.

## Not Started

- Stage 1a package extraction
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
