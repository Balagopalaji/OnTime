# OnTime Rebuild Progress

_Updated: 2026-06-13._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild PR.

## Current Stage

**Stage 1a COMPLETE (M1, tag `M1-stage-1a`); both Fable corrective backlogs cleared — Stage 1b UNBLOCKED.**
TWO milestone reviews ran (internal M1 audit + INDEPENDENT Fable), then a Fable SECOND pre-Stage-1b gate
review. **Fable caught real issues each time** — a DEAD characterization harness, a misclassified "fix"
(C1), a receiver-side anchor smear, a transitive-boundary blind spot, and thin handler test coverage.
All are fixed (#14–#29) and the test net is gated in required CI (full 211-test frontend suite + companion
handler wiring). Remaining before carve-outs: only the inert cleanups (H2/anti-dup/L-2) listed below.

## Landed (on `main`)

- PR #1 architecture/product audit set
- PR #2 Stage 0 timer stabilization
- PR #3 rebuild architecture + extraction rules
- PR #4 rebuild guardrail enforcement
- PR #5 frontend lint/typecheck CI correctness gate
- PR #6 Stage 1a `timer-core` extraction
- PR #7 Stage 1a `shared-types` extraction
- PR #8 Stage 1a `local-sync-arbitration` extraction
- PR #9 fix(companion): drop PAUSE elapsed clamp (M1 audit C1)
- PR #10 ci(companion): stop installer-build failures on every push (ffprobe/companion-build)
- PR #11 ci(guardrails): extend bug-pattern checks to `companion/src` + broaden clamp regex (M1)
- PR #12 chore(shared-types): add test script for parity (M1 audit L1)
- PR #13 docs(ledger): M1 completion + audit fixes + Stage 1b worklist
- PR #14 fix(test): resurrect + gate UnifiedDataContext characterization harness (Fable C-1)
- PR #15 docs(ledger): Fable review + corrective backlog + Codex baton handoff
- PR #16 ci(companion): add no-emit TypeScript check to required guardrails (Fable M-3)
- PR #17 fix(companion): ignore unsafe client timer-action timestamps (Fable H-1)
- PR #18 fix(dashboard): use canonical active timer elapsed (Fable M-1)
- PR #19 refactor(arbitration): inject last accepted source cache (Fable M2)
- PR #20 docs(ledger): mark M2 landed
- PR #21 fix(companion): anchor room state on companion clock (Fable H-1b)
- PR #22 docs(ledger): mark H-1b landed
- PR #23 ci(rebuild): npm workspaces + `@ontime/*` aliases + dependency-cruiser (Fable M-4)
- PR #24 fix(unified): keep timer anchor stable on metadata-only deltas (2nd-review H-1b receive side)
- PR #25 ci(boundaries): enforce Cloud/Viewer no-arbitration transitively (2nd-review)
- PR #26 chore: Fable residual cleanups — dedup elapsed + run all companion tests (2nd-review)
- PR #27 test(companion): socket-level wiring tests for sync/patch room-state handlers (2nd-review)
- PR #28 fix(tests): un-exclude the 3 failing frontend test files — 211 tests now gate (2nd-review)
- PR #29 docs(companion): mark elapsed helper as CJS mirror + drift-guard test (2nd-review)
- PR #31 refactor(unified): remove dead room arbitration fallback (H1 inert cleanup)

## Claude offline-session summary (for Codex — 2026-06-11, while you were out of tokens)

While Codex was offline I (Claude/consultant) did, with the user's authorization:
- Reviewed + flipped the baton on PRs #6–#8 (all APPROVE), which you merged.
- Merged PR #8 (`local-sync-arbitration`) on the user's go, tagged **`M1-stage-1a`**, closing M1.
- Ran an **independent M1 milestone audit** (fresh-context Opus). It confirmed Stage 1a is
  structurally clean but NOT duplication-clean — extraction happened, collapse did not. Findings:
  - **C1 (fixed, #9):** `companion/src/main.ts` PAUSE handler clamped elapsed delta with
    `Math.max(0, …)` — removed (matches timer-core/no-clamp principle).
  - **M1 systemic (fixed, #11):** the guardrail bug-pattern checks were **blind to `companion/`** —
    extended scope to `companion/src/` + broadened the clamp regex (catches startedAt/lastUpdate).
  - **L1 (fixed, #12):** shared-types had no `test` script.
  - **ffprobe (fixed, #10):** companion-build failed on every push (flaky ffprobe URLs + it never
    ran `tsc`, so no `dist/main.js`). Gated the workflow to `workflow_dispatch` + `v*` tags and made
    ffprobe best-effort. NOTE: full installer builds still need `npm run build:viewer && npm run build`
    before electron-builder — left as release-prep.
- Created the reusable `agent-review-baton` skill (`~/.claude/skills/agent-review-baton/`).
- I did the above PRs **solo** (you were offline) — they had no independent review beyond CI +
  the user. Worth a second look if anything seems off.

## Fable independent review (2026-06-11) — corrective backlog (do BEFORE Stage 1b carve-outs)

An independent reviewer (Fable) found issues the M1 audit + the consultant missed. Priority-ordered.
The CORE lesson: the grep guardrails are tripwires, not a safety net — **the test suite is the net**
(now gated, #14). Several M1-audit conclusions were wrong (C1 misclassified; "pre-existing test
failures" was a one-line import bug). Trust tests over pattern-matching.

**DONE:**
- **C-1 (Critical, fixed #14):** `UnifiedDataContext.test.ts` (the named Stage 1b characterization
  baseline) was DEAD — missing `afterEach` import → 0 tests ran; this ledger mislabeled it as a
  "pre-existing failure." Fixed; the full frontend suite (incl. the 51-test harness) is now gated in
  the required check, excluding 3 genuinely-failing files (useSortableList/CuesPanel/AppModeContext).
- **M-3 (Medium, fixed #16):** companion now runs `npm ci` + `npx tsc -p tsconfig.json --noEmit`
  inside the required `Guardrail checks` job. Companion source can no longer merge through the
  rebuild gate with a TypeScript compile error.
- **H-1 (High, fixed #17):** companion `TIMER_ACTION` now treats the companion process clock as
  authoritative for START/PAUSE/RESET state transitions and delta timestamps. Client-supplied
  timestamps remain accepted for protocol compatibility but are classified/ignored when missing,
  invalid, stale, or future-skewed; PAUSE computes elapsed only from companion `now - lastUpdate`
  and invalid stored anchors produce zero additional elapsed instead of corrupting room state.
  The companion lifecycle tests covering this behavior run in the required guardrail CI check.
- **M-1 (Medium, fixed #18):** `DashboardPage` now derives active timer elapsed/remaining through
  the shared timer helpers (`resolveTimerElapsed` + `computeRemaining`) instead of the stale
  `progress[activeTimerId] + (now - startedAt)` formula. A Dashboard regression pins the invariant
  where active progress diverges from `elapsedOffset`.
- **M2 (fixed #19):** `local-sync-arbitration` no longer owns a module-global
  `lastAcceptedSource` cache. The core accepts an injected cache through arbitration options, making
  bare `arbitrate()` calls deterministic/reproducible, while the frontend shim owns the one current
  cache instance to preserve app behavior. Tests cover both injected last-accepted behavior and the
  no-cache deterministic core path.
- **H-1b (fixed #21):** Companion extends the H-1 companion-clock authority pattern to
  `SYNC_ROOM_STATE` and timer-affecting `ROOM_STATE_PATCH` anchors: payload timestamps remain
  protocol-compatible, but local `{ currentTime, lastUpdate }` timer tuples are re-anchored on the
  Companion receipt clock. Non-timer metadata patches no longer mutate timer `lastUpdate`, START
  `currentTime` remains finite elapsed (including negative bonus time), and stale-source arbitration
  remains intentionally unchanged.
- **M-4 (fixed #23):** Root npm workspaces now own the install graph for `frontend`, `companion`,
  `controller`, `functions`, `firebase`, and `packages/*`. The three Stage 1a frontend shims import
  `@ontime/timer-core`, `@ontime/shared-types`, and `@ontime/local-sync-arbitration` by package name
  instead of `../../../packages/*/src`, and dependency-cruiser runs as a transitive boundary gate
  alongside the existing grep-style guardrails.

## Fable SECOND review (2026-06-13, pre-Stage-1b gate) — corrective backlog (DONE)

A fresh Fable agent (given its prior findings + the cumulative `M1-stage-1a...main` diff) ran the
pre-Stage-1b gate review and verified C-1/M-3/H-1/M-1 genuinely fixed (mutation-checked), then found
new issues. All were fixed by Claude (#24–#29) while Codex/Fable were unavailable; CI-gated, no baton.

**DONE:**
- **H-1b receive side (fixed #24):** H-1b had fixed only the companion send/store side. `handleRoomStateDelta`
  (`UnifiedDataContext.tsx`) still advanced the LOCAL timer anchor to delta-receipt time on metadata-only
  deltas (which companion now correctly sends without `lastUpdate`) → running-timer elapsed snapped
  backward on OTHER clients mid-show. Now the anchor only moves when the delta carries timer keys
  (`lastUpdate`/`currentTime`/`isRunning`/`activeTimerId`). Added the first socket-level `ROOM_STATE_DELTA`
  characterization test.
- **Transitive boundary blind spot (fixed #25):** dependency-cruiser's `forbidden` rules matched only
  DIRECT edges, so Cloud/Viewer→arbitration passed through any intermediary (empirically confirmed).
  Added `to.reachable: true` transitive rules; planted-violation verified.
- **Residual cleanups (fixed #26):** routed `firebase-timer-state-utils` elapsed through `computeElapsed`
  (guard preserved); `companion npm test` now runs ALL `dist/*.test.js` (a compiled-but-never-run test
  is now executed). NOTE: CI is Node 20 → `node --test` glob must be SHELL-expanded (unquoted), not
  quoted (Node 21+ only).
- **Companion handler wiring tests (fixed #27):** exported `handleSyncRoomState`/`handleRoomStatePatch`/
  `roomStateStore`/`ioServers`/`getRoomState`; `main.handlers.test.ts` drives them with a fake socket +
  captured emits (validator rejection, store write, delta shape, clock re-anchor) — the wiring coverage
  Fable flagged as missing before carving the god-files.
- **3 CI-excluded test files un-excluded (fixed #28):** root causes were harness bugs — missing `vi`
  import (useSortableList) and missing testing-library `cleanup` (CuesPanel/AppModeContext, no `globals`),
  NOT product bugs. Excludes removed; the safety-net step is now plain `npx vitest run` (full suite
  25 files / 211 tests gates).
- **Elapsed duplication de-risked (fixed #29):** decision = do NOT do the timer-core CJS-build unification
  (too much Electron-packaging risk for low value). `resolveCompanionElapsedForState` is documented as the
  CommonJS mirror of timer-core `computeCompanionElapsed`, with a drift-guard test pinning it to the
  canonical formula. **Remaining deferred-by-decision:** the true timer-core CJS build so companion can
  import the canonical helper — revisit when companion build/packaging is worked on.

Net: all of Fable's pre-Stage-1b caveats are addressed; the test net is thicker (companion handler wiring
+ full frontend suite gated). **Stage 1b (god-file carve-outs) is unblocked.**

**TODO — process/CI hardening FIRST (prerequisites for safe 1b):**
- **M-2 (USER DECISION — do not change branch protection without the user):** protection has no
  required reviews + `strict:false`, so the baton is convention-only (the consultant's C1 mistake
  merged solo). `strict:true` is safe (prevents stale merges, does NOT block self-merge). Required
  reviews WOULD block orchestrator self-merge → changes heartbeat autonomy. Tradeoff is the user's call.

**TODO — correctness fixes (each its own PR + a test; harness must stay green):**
- All other priority correctness fixes from the Fable review are landed.

**TODO — then structure + inert cleanups:**
- **H2 (pending PR):** route inline `*1000 - elapsed` through `computeRemaining` (Controller/Dashboard);
  Dashboard already used the helper, and Controller now preserves existing elapsed inputs while routing
  derived remaining display through the shared helper.
- **Anti-duplication CI check:** add only AFTER H2 + M-1 collapse (else false-positives).
- **L-2:** line-count ratchet on `UnifiedDataContext.tsx` + `companion/src/main.ts` (fail if they grow).

### Codex — baton handoff / next heartbeat
The baton is **yours**; no PR is awaiting consultant review. Both Fable corrective backlogs (M1 review
+ the pre-Stage-1b second review) are fully landed, M-1/M-4 are in, and the test net is gated, so
**Stage 1b carve-outs are now unblocked.** Remaining pre-1b inert cleanups (each its own scoped PR + a
test, under the baton — do NOT self-merge unreviewed): finish **H2** (route inline `*1000 - elapsed`
through `computeRemaining`) → **Anti-duplication CI check** (only after H2) → **L-2** (line-count
ratchet on the two god-files). Then
begin Stage 1b. **M-2** (branch-protection tightening) stays a USER decision. One deferred-by-decision
item: the timer-core CJS build (so companion imports the canonical elapsed helper) — revisit during
companion build/packaging work. The actionable Fable summaries are captured in this ledger; the local
`prompt-exports/` brief is not tracked because guardrails intentionally forbid tracked prompt-export
artifacts.

## Deferred (unchanged)

- ~~triage + fix the 3 genuinely-failing test files (useSortableList, CuesPanel, AppModeContext)~~ **DONE (#28)** — harness bugs (missing `vi` import / missing testing-library `cleanup`), now un-excluded; full frontend suite (211 tests) gates.
- line-ending normalization hygiene PR (mixed CRLF/LF across repo — every edit must de-churn)
- timer-core CJS build so `companion` can import the canonical elapsed helper (instead of its documented drift-guarded mirror) — deferred by decision (#29); do during companion build/packaging work.
- `mergeCueVideos` regression during `presentation-core` extraction
- iPad viewer polish branch (stashed)
- installer-build release readiness (viewer bundle + tsc steps + ffprobe sourcing)

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
