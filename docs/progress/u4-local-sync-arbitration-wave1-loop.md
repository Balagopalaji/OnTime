# U4 — local-sync-arbitration wave 1 (Loop)

```yaml
branch: backlog/u4-local-sync-arbitration-wave1
worktree: rp-agent-03ca4bde-backlog-u4-local-sync-arbitratio-be0d15bc
base_branch: main
base_sha: 54f9a255164f96198615c56ee7d1f07044c2a26a
phase: closed
spec: docs/rebuild-arbitration-decisions.md
plan: docs/rebuild-plan.md §4 (U4 row), §1b UnifiedDataContext table; docs/rebuild-extraction-rules.md
issue: U4 (backlog)
pr: "110 (https://github.com/Balagopalaji/OnTime/pull/110)"
commit: 29ecb1b
oracle: HARD-CONSTRAINT — do not call ask_oracle (prior stall). Inline deterministic gate only; escalate on block.
git_scope: branch+pr ONLY (implement, commit, push, open PR, STOP — do NOT merge)
```

## Scope

Carve 5 functions out of `frontend/src/context/UnifiedDataContext.tsx` into `packages/local-sync-arbitration`, with an app-side re-export shim (`frontend/src/lib/arbitration.ts`) so callers keep working. Behavior-preserving, byte-faithful (extraction-rules §1/§8).

Functions: `resolveRoomSource`, `isSnapshotStale`, `getConfidenceWindowMs`, `shouldBootstrapCachedSubscriptions`, `resolveReconciledTimerTargetId`. Also moves helper `normalizeRoomAuthoritySource` + consts `BASE_CONFIDENCE_WINDOW_MS`/`CHURN_CONFIDENCE_WINDOW_MS` (used only by `getConfidenceWindowMs`).

## Key design decision (byte-faithfulness)

`resolveRoomSource` currently delegates to the **app-wrapped** `arbitrate` (`lib/arbitration.ts` — core + module-level `lastAcceptedSourceCache` + decision logging). Moving it into the pure package would make it call the **core** `arbitrate` (no cache) — a behavior change on the both-offline / both-no-data paths. Fix: **dependency injection** — package `resolveRoomSource` takes optional `arbitrateFn` (defaults to core `arbitrate`); the app shim binds the wrapped `arbitrate`. A characterization test pins the cache-persistence path so a divergent carve fails red.

## Task ledger

| ID | Task | Status | Evidence |
|----|------|--------|----------|
| 1 | Extend char tests (cache pin + branch gaps) | done | UnifiedDataContext.test.ts: +5 char tests; 73 green pre-carve
| 2 | Carve 5 fns + helper + consts into package; package unit tests | done | packages/local-sync-arbitration/src/index.ts (+115); index.test.ts 32 green
| 3 | Wire shim re-exports + remove inline defs from god-file | done | lib/arbitration.ts shim + UnifiedDataContext.tsx (6624→6521); typecheck+lint clean
| 4 | Lower ratchet baseline; guardrails + full vitest; conformance matrix; commit/push/PR | done | ratchet 6624→6521; guardrails/lint/diff-check clean; 233 tests green; matrix written |

## Validation commands (resolved, reuse every run)

- `node scripts/check-rebuild-guardrails.mjs` (static; full `npm run guardrails` fails locally only on dep-cruiser vs Node 23.5 — CI is Node 20)
- `cd frontend && npx vitest run` (full suite; char harness = UnifiedDataContext.test.ts + snapshotStale.test.ts)
- `cd packages/local-sync-arbitration && npx vitest run src/index.test.ts` (package unit tests)
- Line count: `node -e "console.log(require('fs').readFileSync('frontend/src/context/UnifiedDataContext.tsx','utf8').split('\n').length)"`

## Ratchet

- OLD `frontend/src/context/UnifiedDataContext.tsx`: **6624** lines (matches baseline).
- NEW (post-carve): **6521** — baseline set to 6521 in scripts/check-rebuild-guardrails.mjs.

## Resume note

Char-first: tests added & green vs current code BEFORE any carve. If the cache-pinning test goes red after carve, the DI wiring is wrong.
