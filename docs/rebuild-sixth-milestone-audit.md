---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-07-06
Scope: Independent fresh-context audit of rebuild batch #72–#79 (head 1cb421c).
---

# Sixth Milestone Audit — OnTime Rebuild

_Independent fresh-context Fable audit of the cumulative diff `0cdf8c7` (#71, fifth-audit endpoint) → `origin/main`. Performed 2026-07-06 in an isolated worktree (repo untouched; all probes reverted). Batch audited: #72, #73, #75, #76, #77, #78, #79 (head `1cb421c`). This is the durable artifact for Claude / GLM / Codex; the ledger carries the pointer._

## Verdict: **GO**

All moved types are shape-faithful with documented, drift-guarded divergences; every gate is green; every guardrail and the new #78 test demonstrably bite; the **sub-agent-authored #78 is behavior-neutral by construction** and the **#76 path-A ESM/CJS change is sound**. Only one new defect — a LOW lockfile-drift nit.

## Prior-finding dispositions (fifth audit)

| Finding | Disposition | Evidence |
|---|---|---|
| F1 — package tests never ran in CI | **STILL FIXED (#72)** | `rebuild-guardrails.yml:67-83` typecheck+test for the 3 new packages; proven non-vacuous — narrowing `ControlRequestStatus.status` → package `npm run test` fails (TS2322) |
| F2 — interface-contracts test vacuous alone | **STILL FIXED (#72)** | test = `npm run typecheck && vitest`; typecheck also its own CI step |
| F3 — HandshakeError 3-way split | **STILL FIXED (#73)** | strict 4-code union; all 6 companion emit sites annotate `const error: HandshakeError`; frontend consumes it |
| F4 — stale line refs | **STILL FIXED** | doc comments cite files without line numbers |
| L-C — ControllerPage raw `elapsedOffset` | **STILL OPEN (correctly unclaimed)** | `ControllerPage.tsx:1082` |
| U8 — predicate spec-mirror drift | **STILL OPEN (correctly unclaimed)** | `control-lock-utils.ts:31,37` zero prod callers; `main.ts:79-80` re-export shim only |
| M-C — `reauthenticated` validated-but-unread | **STILL OPEN (correctly unclaimed)** | `main.ts:5653` |

## New findings

- **LOW-1 — #78 shipped without regenerating the root lockfile.** `companion/package.json` gained `"@ontime/shared-types": "0.0.0"` but `package-lock.json`'s companion entry still lists only `interface-contracts`. No CI break (`npm ci` passes against the committed lockfile — the workspace symlink already exists from #76). Cost is churn: a future `npm install` regenerates the entry and injects unrelated lockfile noise into someone's PR. **Fix:** `npm install` at root + commit the lockfile in a chore PR.
- **Obs-1 — fifth-audit artifact package-test counts are doubled.** `docs/archive/rebuild-fifth-milestone-audit.md` lists timer-core 16 / local-sync 32 / lock-view-model 46; actual source (untouched since) is **8 / 16 / 23**. Artifact inaccuracy only; correct if that artifact is next edited.
- **Obs-2 — structural-twin `ControllerLock`.** `ControllerLockStatePayload.lock` references shared-types `ControllerLock` while companion's `buildControllerLock` returns a field-identical local copy (`control-lock-utils.ts:51-59`). Compatible today; a shared-types required-field addition breaks companion (tsc-guarded), but a companion-side change is not. Known duplication class → fold into the U-series.
- **Obs-3 — cache round-trip not pinned in #78.** Acceptable: #78 changes zero runtime statements (type decls + two `export` keywords), so the cache serialize path is byte-identical and the 92 characterizations pass. Pin cache-shape when U7 (cache adapter) carves that code.

## Reads on the two scrutinized changes

- **#76 path A (ESM/CJS): sound.** shared-types has zero runtime exports, so dropping `"type":"module"` is behavior-neutral (nothing loads it at runtime). Companion (node16/CJS) imports `import type`-only; compiled `companion/dist/*.js` has zero references to either package. Frontend resolves it under Vite dev-transform, tsc, and production rollup — all green. dependency-cruiser permits `interface-contracts → shared-types` (forbids only package→app/god-file/framework).
- **#78 (sub-agent-authored): clean under adversarial review.** Field-by-field: companion `Timer` ⊂ shared-types `Timer` (extras all optional); `Cue` identical except `editedByRole?: OperatorRole → OperatorRole | null` (pure widening — companion only writes `normalizeCueRole(...) | undefined`, never reads into a non-null context, so no latent bug); 5 unions literal-identical. Allowlists / `normalizeCueRole` / cache logic untouched. New `UPDATE_TIMER {sectionId}` allowlist test is a real tripwire (mutation-proven: widening the allowlist fails it).

## Gates (all run by the auditor)

| Gate | Result |
|---|---|
| `npm ci` (root, committed lockfile) | PASS (1442 pkgs) |
| `npm run guardrails` | PASS — 6/10 populated (baseline 6); 146 modules / 329 deps, 0 violations |
| companion `npm run build` (node16/CJS) | PASS — clean, **no TS1541** |
| companion `node --test dist/*.test.js` | PASS — **92/92** |
| frontend `tsc -b` / `vitest run` / Vite prod build | PASS / **218/218** / PASS |
| Package typechecks ×6 + tests | PASS — interface-contracts 31, timer-core 8, local-sync 16, presentation-core 11, lock-view-model 23 |
| `git diff --check 0cdf8c7...origin/main` | clean |
| Guardrail probes (G1/G2/ratchet/whitespace) + mutation of #78 test + `CompanionMode` widening | all bite as intended |

**Ratchet trace:** `main.ts` 7797→7793→7775→7734→7697 (#73/#75/#76/#78), always baseline−1, never raised; UDC 6662→6658 (#73). Inlined-union drift guard confirmed: widening companion `CompanionMode` → tsc fails at `createHandshakeAck` (same mechanism guards `NodeJS.Platform` and HandshakeError codes).

## Deliberately NOT flagged

God-file sizes (shrinking under ratchet); deferred #29 timer-core CJS mirror (drift-guarded); F5 double `parseAllowedOrigins` (perf-only); `HANDSHAKE_PENDING` vs `docs/interface.md` §3.3 (recorded per D6 → M-C); frontend's old loose `HandshakeAck` narrowing (wire-faithful, tsc-verified); G1's untracked-file blindness (inherent to `git ls-files`; CI always sees tracked files); PRD features not yet built.
