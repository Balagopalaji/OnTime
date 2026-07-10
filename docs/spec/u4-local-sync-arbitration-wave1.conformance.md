# U4 — local-sync-arbitration wave 1: Conformance Matrix

Spec: `docs/rebuild-arbitration-decisions.md` (owner decisions governing arbitration/sync behavior).
Plan: `docs/rebuild-plan.md` §4 (U4 row), §1b UnifiedDataContext table; `docs/rebuild-extraction-rules.md`.
Change type: **behavior-preserving carve** (Stage 1b) — 5 functions (+ helper + 2 consts) moved from `frontend/src/context/UnifiedDataContext.tsx` into `packages/local-sync-arbitration`, app-side re-export shim, god-file ratchet lowered. No intended behavior change.

Coverage proof:

```json
{
  "audited": [
    "resolveRoomSource (§1)",
    "getConfidenceWindowMs (§1)",
    "isSnapshotStale (§1 pre-mortem, §7)",
    "shouldBootstrapCachedSubscriptions (package charter: reconnect reconciliation)",
    "resolveReconciledTimerTargetId (package charter: reconnect reconciliation)",
    "normalizeRoomAuthoritySource (helper, §1)",
    "resolveSnapshotTimestamp 0-sentinel + arbitrate 0-sentinel guard (§7, FIX-097/#106) — preserved, not regressed",
    "byte-faithfulness (extraction-rules §1/§8)",
    "package purity (extraction-rules §4)",
    "god-file ratchet (rebuild-plan §3)",
    "rebuild-target marker (G1)",
    "LF line-ending hygiene (extraction-rules §7)"
  ],
  "unreconciled": []
}
```

## §1 Data arbitration — read precedence

| Decision / pre-mortem | Status | Evidence |
|---|---|---|
| Freshest trustworthy `lastUpdate` wins; confidence window = ambiguity/holds only; mode = tie-breaker/fallback | Conformed | `resolveRoomSource` delegates to the shared `arbitrate` engine (domain `'room'`) unchanged. Now `packages/local-sync-arbitration/src/index.ts` `resolveRoomSource`; app-bound via `frontend/src/lib/arbitration.ts`. Pinned by char tests in `UnifiedDataContext.test.ts` (`resolveRoomSource` block, incl. the last-accepted cache canary) + package DI mapping test (`index.test.ts`). |
| Large skew (>10 min) → fall back to authority/mode, not a hardcoded source | Conformed | Behavior lives in `arbitrate` (untouched by U4; FIX-097/#106 0-sentinel guard preserved). `resolveRoomSource` routes room decisions through it. Pinned by existing `arbitrate` skew tests. |
| Confidence window must not become a stale-data window | Conformed | `getConfidenceWindowMs` (2000ms base / 4000ms churn) moved verbatim to package. Pinned by `getConfidenceWindowMs` char test (false→2000, true→4000) in both `UnifiedDataContext.test.ts` and `packages/local-sync-arbitration/src/index.test.ts`. |
| Apply snapshot-staleness checks before arbitration where relevant | Conformed | `isSnapshotStale` (duration-aware 3× cap, adjustment-log aware, never clamps elapsed) moved verbatim to package; called before accept in the snapshot handler (`UnifiedDataContext.tsx`, unchanged call site). Pinned by `__tests__/snapshotStale.test.ts` (5 cases) + package tests. |
| Cross-source decisions go through the shared arbitration module — no one-off paths | Conformed | `resolveRoomSource` still routes through `arbitrate`; no new arbitration path introduced. The carve *strengthens* this (room-domain wrapper now co-located with the engine in the package). |
| Do not reuse room authority for other domains; per-item `updatedAt` for timers/cues | Out of scope (Not-built, accepted) | Long-term item explicitly deferred in §1. U4 is an extraction only; it does not alter domain inputs or add per-item timestamps. Tracked by rebuild roadmap, not this unit. |

## §7 Snapshot freshness (live broadcasts)

| Decision | Status | Evidence |
|---|---|---|
| Freshness anchor = envelope `timestamp` when `state.lastUpdate` is sentinel `0`; real `lastUpdate` (>0) always wins | Conformed (preserved) | `resolveSnapshotTimestamp` (already in package, FIX-097/#97) and the `arbitrate` 0-sentinel guard (FIX-097/#106) are **untouched** by U4 — explicitly preserved per the U4 brief. Pinned by `resolveSnapshotTimestamp` tests + FIX-097 sentinel tests in `index.test.ts`. |
| `isSnapshotStale` plausibility check complements the freshness anchor | Conformed | Moved verbatim; see §1 row. |

## §9 Process — carve in this repo; byte-faithful for proven behavior

| Decision / constraint | Status | Evidence |
|---|---|---|
| Carve in this repo via package boundaries (no fresh repo/microservices) | Conformed | Moved into the existing `packages/local-sync-arbitration` workspace package. |
| Preserve byte-faithfully for proven behavior | Conformed | All 5 functions moved with behavior intact; char harness green before AND after the carve (`UnifiedDataContext.test.ts` 73 tests, `snapshotStale.test.ts` 5 tests). Cache-persistence canary specifically pins that `resolveRoomSource` still delegates to the app-wrapped `arbitrate` (last-accepted cache), not a cache-less core `arbitrate`. |
| Extraction-rules §1/§8: destination stated; tests before/after; legacy shim | Conformed | Destination: `packages/local-sync-arbitration`. Char tests extended first, then carve. App re-export shim: `frontend/src/lib/arbitration.ts` (re-exports + bound `resolveRoomSource`) + `UnifiedDataContext.tsx` re-export for existing importers. |
| Extraction-rules §4: package purity (no app/React/Firebase/Socket.IO/Electron imports) | Conformed | Package imports only `@ontime/shared-types` (pure). `checkPackageBoundaries` + dep-cruiser green (`check-rebuild-guardrails.mjs` passed). |
| rebuild-plan §3 / G1: god-file ratchet shrinks; destination marker | Conformed | `UnifiedDataContext.tsx` 6624 → 6521; baseline lowered in `scripts/check-rebuild-guardrails.mjs`. `// rebuild-target: packages/local-sync-arbitration` marker added to package `index.ts`. |
| Extraction-rules §7: LF line-ending hygiene | Conformed | `git diff --check` clean (no CRLF / trailing whitespace). |

## Notes / accepted deviations

- **`resolveRoomSource` body form rewritten (behavior identical).** The verbatim 14-field destructure + call was rewritten as a rest-spread that produces an identical `arbitrate` input object, to keep the package `index.ts` under the 400-line ceiling. This is sanctioned by extraction-rules §8 ("rewrite from tests") and pinned by: (a) the package DI mapping test asserting the exact mapped fields (domain `'room'`, `cloudTs = firebaseTs`, pending→`undefined`), and (b) the app char tests asserting observable decisions incl. the last-accepted cache path. No behavior divergence.
- **Dependency injection for `arbitrate`.** The package `resolveRoomSource` takes an optional `arbitrateFn` (defaults to core `arbitrate`); the app shim injects its wrapped `arbitrate` (core + last-accepted cache + decision logging) so the carved function stays byte-faithful to the pre-extraction behavior. This is a wiring detail, not a behavior change.
- **`shouldBootstrapCachedSubscriptions` param type widened.** `Record<string, CompanionSubscription>` → `Record<string, unknown>` (the function only counts keys; `CompanionSubscription` stays a local app type). Type-only change, no behavior change; call sites remain type-safe (widening).

## Validation evidence

- `node scripts/check-rebuild-guardrails.mjs` → passed (ratchet 6521≤6521, population 6/10, boundaries, G1, size ceilings, bug patterns, timer-formula).
- `cd frontend && npx tsc -p tsconfig.app.json --noEmit` → 0 errors.
- `cd frontend && npm run lint` → clean.
- `cd frontend && npx vitest run` → 25 files / 233 tests passed (incl. char harness).
- `cd packages/local-sync-arbitration && npx vitest run src/index.test.ts` → 32 tests passed.
- `git diff --check` → clean.
