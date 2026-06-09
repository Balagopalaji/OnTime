# OnTime Rebuild Progress

_Updated: 2026-06-09._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild
PR.

## Current Stage

Stage 0.5: guardrail enforcement before extraction.

## Landed

- PR #1: architecture/product audit set on `main`
- PR #2: Stage 0 timer stabilization on `main`

## In Review

- PR #3: rebuild architecture and extraction rules

## Active Work

- Guardrail enforcement PR, stacked after PR #3 until PR #3 lands

## Next Gates

1. Land PR #3.
2. Land guardrail enforcement.
3. Confirm guardrail checks run in CI.
4. Only then start Stage 1a.

## Not Started

- Stage 1a package extraction
- Stage 1b god-file carve-outs
- app folder moves
- fresh repo split

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
