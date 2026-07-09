# FIX-100 — spec conformance matrix

Spec: [`fix-100-livecue-elapsed.spec.md`](./fix-100-livecue-elapsed.spec.md)
Impl: PR #105 — branch `backlog/fix-100-livecue-elapsed-drift` (commit `212aaac`)
Method: `spec-conformance` methodology applied inline (RepoPrompt MCP transport
unreliable during run — see Context Exception in progress doc). All evidence is
file:line + test-name, cross-checked against the implementation and the red→green run.

Legend: ✅ Conformed (with evidence) · ⚠️ Diverged · ⛔ Not-built

## Scenarios

| ID | Scenario | Status | Evidence |
|----|----------|--------|----------|
| S1 | running timer re-anchors currentTime (folds 3s delta); no backward jump; delta carries currentTime+lastUpdate | ✅ Conformed | Impl `companion/src/main.ts:693,701`; test `S1 running: activeLiveCueId change re-anchors currentTime + lastUpdate (no backward jump)` (`companion/src/main.livecue-elapsed.test.ts`). Red on main (`5000 !== 8000`) → green after fix. |
| S2 | paused timer: currentTime unchanged, lastUpdate bumped | ✅ Conformed | Resolver returns base for `!isRunning` (`companion/src/main.ts:496`); test `S2 paused: activeLiveCueId change leaves currentTime unchanged, bumps lastUpdate`. |
| S3 | same activeLiveCueId → early-return, no mutation, no delta | ✅ Conformed | Guard `companion/src/main.ts:691` (`if (state.activeLiveCueId === activeLiveCueId) return`); test `S3 no-op: unchanged activeLiveCueId triggers no state mutation and no delta` (asserts `emitted.length === 0`, lastUpdate NOT bumped). |
| S4 | non-finite/≤0 lastUpdate or currentTime → stored currentTime finite | ✅ Conformed | Resolver sanitization (`companion/src/main.ts:495-504`: bad currentTime→0, bad/≤0/future lastUpdate→treated as now); test `S4 hardening: bad lastUpdate/currentTime on a running timer stays finite after re-anchor` (lastUpdate-0, currentTime-NaN, both-NaN). Red on main (NaN persisted) → green after fix. |

## Proposed Surface

| Surface element | Status | Evidence |
|-----------------|--------|----------|
| Re-anchor `currentTime` for RUNNING timers via `resolveCompanionElapsedForState(state, now)` before the `lastUpdate` bump | ✅ Conformed | `companion/src/main.ts:693-694`. Uses canonical resolver (no formula reimplementation; `main.elapsed-driftguard.test.ts` pins it to `packages/timer-core`). |
| `ROOM_STATE_DELTA.changes` carries `currentTime` + `lastUpdate` (wire == store) | ✅ Conformed | `companion/src/main.ts:701`. Frontend merge safe (`frontend/src/context/UnifiedDataContext.tsx:~4236` spreads `...payload.changes`; preserves isRunning/activeTimerId/progress). |
| Keep `lastUpdate: now` bump (arbitration freshness) | ✅ Conformed | `companion/src/main.ts:694`. |
| Never persist non-finite `currentTime` | ✅ Conformed | Resolver returns finite (`:495-504`); S4 test asserts `Number.isFinite`. |

## Constraints

| Constraint | Status | Evidence |
|-----------|--------|----------|
| Timer-state tuple internally consistent | ✅ Conformed | Only currentTime+lastUpdate overridden; `...state` preserves isRunning/activeTimerId/progress (`:694`); companion `RoomState` has no `startedAt`. |
| In sync with `computeCompanionElapsed` (`packages/timer-core`) | ✅ Conformed | Call-site change only; formula untouched; drift-guard test green. |
| `main.ts` ≤ 7589 split-line baseline | ✅ Conformed | `guardrails:static` PASS; split-count 7589 = baseline. |
| LF endings / whitespace | ✅ Conformed | `git diff --check` clean. |
| Do not weaken any gate | ✅ Conformed | No gate edited/skipped; `boundaries` env-blocked (node 23.5.0), identical failure on base. |

## Coverage proof (Spec–Implementation Reconciliation closeout gate)

```json
{
  "audited": [
    "S1", "S2", "S3", "S4",
    "surface:reanchor-currentTime",
    "surface:delta-carries-currentTime+lastUpdate",
    "surface:keep-lastUpdate-bump",
    "surface:no-nonfinite-persist",
    "constraint:tuple-consistency",
    "constraint:sync-timer-core",
    "constraint:line-budget",
    "constraint:lf-endings",
    "constraint:no-gate-weakened"
  ],
  "unreconciled": []
}
```

Every scenario, Proposed Surface element, and constraint was checked (audited).
No Diverged or Not-built items. The feature is reconciled against the spec.
