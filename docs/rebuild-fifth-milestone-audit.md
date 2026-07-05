# Fifth Milestone Audit — OnTime Rebuild

_Independent fresh-context Fable audit of the cumulative diff `b4c4968 → #71` (U1 slices 1–3, U2, U3, U6, G1, G2), updated after the #72/#73 fixes landed. Audit performed 2026-07-05 over `origin/main` @ `0cdf8c7` (#71). This is the durable artifact for all participants (Claude / GLM / Codex); the ledger (`docs/rebuild-progress.md`) carries the one-paragraph pointer._

## Verdict: **GO** — one required next action (F1/F2), not a blocker

All moved code is byte-faithful, pure, and locally tested; all guardrails demonstrably bite; every gate is green on `main` through #73. The one substantive defect was a **CI coverage gap** (F1/F2): the three new packages' tests never ran in CI. **Resolved by #72** (see status below).

## Current status of findings (post-audit, as of #73 review)

| Finding | Severity | Status |
|---|---|---|
| **F1** — 3 new packages' tests/typechecks never run in CI | MEDIUM | **FIXED (#72)** — `rebuild-guardrails.yml` now has typecheck+test steps for interface-contracts, lock-view-model, presentation-core |
| **F2** — interface-contracts vitest run is typecheck-realized (vacuous alone) | LOW | **FIXED (#72)** — the package typecheck now runs as its own required CI step, so discriminant/key drift fails CI |
| **F3** — `HandshakeError` 3-way wire-shape split (loose frontend vs strict companion) | LOW (decaying) | **FIXED (#73, merged)** — strict 4-code union adopted into `interface-contracts`; all four sites consume it |
| **F4** — stale `token-server.ts:NNN` line refs in interface-contracts doc comments | trivial | **FIXED** — line refs removed from `packages/interface-contracts/src/index.ts` |
| **F5** — ledger lag (#70/#71 unrecorded) + double `parseAllowedOrigins()` per token request (perf-only) | OBS | ledger sync tracked by this artifact + the post-#73 ledger update; perf note is behavior-safe, deferred |

## Prior-finding dispositions (verified in place)

| Finding (origin) | Disposition | Evidence |
|---|---|---|
| H-A: PIN strict equality (3rd) | STILL FIXED | `main.ts:5968` `allowByPin = Boolean(storedPin && normalizedPin && normalizedPin === storedPin)` |
| Timeout-requester force predicate (3rd) | STILL FIXED | `main.ts:5965` requester-match AND `requestAgeMs >= CONTROL_REQUEST_TIMEOUT_MS`; 4 `FORCE_TAKEOVER` tests |
| M-A: disconnect `requester_disconnected` clearing (3rd) | STILL FIXED | `main.ts:3454`; characterization in the 91-test companion suite |
| M-B: property-access anti-dup regex (3rd) | STILL FIXED | `check-rebuild-guardrails.mjs:229` `propAccess = '(?:[\\w$]+\\.)*'` on all five patterns |
| L-A: missing-baseline hard-fail (3rd) | STILL FIXED | `checkGodFileRatchet` fails on missing ratchet file (script:347-349) |
| L-B: re-export shim (3rd) | STILL HONORED | `main.ts:55-65` re-exports `control-lock-utils` surface |
| L-C: ControllerPage raw `elapsedOffset` (3rd) | STILL OPEN (correctly unclaimed) | `ControllerPage.tsx:1082` feeds raw `elapsedOffset` into `computeRemaining` |
| LOW: predicate spec-mirror drift (4th) → **U8** | STILL OPEN, wrinkle noted | `shouldClearPendingControlByTimeout/ForRequester` still have zero production callers. The inline timeout-staleness site **moved** during the #57 carve to `pending-control-timeout-utils.ts:44-46` (`pending.requestedAt !== requestedAt`) — so U8's wiring target is that module, not `main.ts`. The moved inline check is now directly unit-tested. |
| OBS: `reauthenticated` validated-but-unread (4th) → M-C | STILL OPEN | `main.ts:5788` validates it; `handleForceTakeover` never reads it |

## Package seeds — byte-faithful, pure, tested

- **interface-contracts** (#69/#70/#71): slice-1's eight wire types match removed `main.ts` blocks 60/60 lines (modulo `export`); slice-3's three types line-identical; slice-2's three HTTP contracts shape-faithful to the literal `JSON.stringify` bodies. Zero imports; package.json deliberately has **no** `"type": "module"`.
- **lock-view-model** (#65): 240/240 lines identical with removed `control-lock-reducers.ts`; single divergence `DataContextValue['connectionStatus']` → shared-types `ConnectionStatus`, proven identical (`'online' | 'offline' | 'reconnecting'`). Shim honored. Only import: `@ontime/shared-types`.
- **presentation-core** (#67): `mergeCueVideos` body identical; only the signature widened from `LiveCueRecord` to generic `T extends { cue: { metadata?: { videos?: CueVideo[] } } }` (call site unchanged; a dedicated test pins the passthrough).

**Non-vacuity — a named mutation each test kills:** presentation-core — deleting the incoming-empty-keeps-existing branch, swapping the `...match, ...video` spread order, or removing the `entry.id !== undefined` gate each kill a test. lock-view-model — `>=`→`>` in `shouldExpirePendingControlRequest` kills the TTL-boundary test; dropping the `(requesterId, requestedAt)` tuple check kills "does not clear a newer pending request". token-server — returning `true` on unhandled paths kills the fall-through test; dropping `escapeAttr` kills the quote-escaping test. interface-contracts — discriminant/required-key drift fails the package **typecheck**.

## ESM/CJS resolution — sound

Companion (`module: node16`, CJS) imports the package via `import type` only; compiled `companion/dist/*.js` has **zero** references to `interface-contracts` (no runtime `require()` of a `.ts`-exporting package). Frontend consumes via Vite. No TS1541 because the package omits `"type": "module"`.

- **Latent (a) CONFIRMED:** `packages/shared-types/package.json` still has `"type": "module"`. First companion import of shared-types re-hits TS1541. shared-types exports no runtime values, so dropping `"type": "module"` (to match interface-contracts) is a zero-risk one-liner — do it proactively **before U7**, not mid-carve.
- **Latent (b) CONFIRMED:** the CJS mirror `resolveCompanionElapsedForState` (`main.ts:549`) with drift-guard test (`main.elapsed-driftguard.test.ts`) — #29 pending by explicit decision. Correctly pending, not a trap (drift-guard runs in CI'd companion suite).

## Guardrails — all bite (probed in a scratch clone; repo untouched)

- **G1**: planted unmarked `companion/src/*.ts` → "must declare its destination" ✓
- **G2**: removed a package test file → "population fell below baseline: 5 < 6" ✓ (baseline 6; #66→#67→#69 traced 4→5→6, never lowered)
- **God-file ratchet**: +1 line to `main.ts` → fail ✓; at #71 actual 7796 ≤ baseline 7797 ✓
- **Whitespace**: planted trailing spaces → `git diff --check` flags it ✓

## Gates (commands + results at audit time)

| Gate | Result |
|---|---|
| `npm run guardrails` (static + dependency-cruiser) | PASS — 6/10 populated (baseline 6); 146 modules / 324 deps, no violations |
| companion `npm run build` + `node --test dist/*.test.js` | PASS — tsc clean; 91/91 |
| frontend `tsc -b` + `npx vitest run` | PASS — clean; 218/218 (25 files) |
| Package typechecks ×6 | PASS all |
| Package tests | interface-contracts 14/14 (#71), timer-core 16/16, local-sync-arbitration 32/32, presentation-core 11/11, lock-view-model 46/46 |
| `git diff --check main...HEAD` / `git show --check HEAD` | clean / clean |
| GitHub Actions `rebuild-guardrails` @ #71 | success |
| Guardrail probes (G1/G2/ratchet/whitespace) | all fail on planted violations as intended |

## Deliberately NOT flagged (known / intentional)

- God-file size (`main.ts` ~7.8k, `UnifiedDataContext.tsx` 6,662) — shrinking by design under the ratchet.
- Deferred #29 timer-core CJS build + drift-guarded mirror — deferred by recorded decision, guard in place.
- PRD features not yet built — PRDs are intent per AGENTS.md doc authority.
- `companion/src/*-utils.ts` carves being app-internal — already re-aimed by `docs/rebuild-plan.md`; the U-series now targets packages.
- CRLF↔LF rewrites of otherwise-identical `main.ts` lines — mandated by extraction-rules §7; `git diff --check` clean.
- `/api/status-window` route skipped when deps omitted — deliberate injection seam; `buildTokenServerDeps` always passes both, so production behavior is unchanged (skip path is itself tested).
