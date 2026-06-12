# OnTime Rebuild Progress

_Updated: 2026-06-12._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild PR.

## Current Stage

**Stage 1a COMPLETE (M1, tag `M1-stage-1a`).** TWO reviews ran: an internal M1 audit (Opus) and
an INDEPENDENT review (Fable). **Fable caught real issues the M1 audit missed** — a DEAD
characterization harness and a misclassified "fix" (C1). The test safety net is now resurrected +
gated in required CI (#14). **Do the Fable corrective backlog below BEFORE any Stage 1b carve-out.**

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
- **H-1b (pending #21):** Companion extends the H-1 companion-clock authority pattern to
  `SYNC_ROOM_STATE` and timer-affecting `ROOM_STATE_PATCH` anchors: payload timestamps remain
  protocol-compatible, but local `{ currentTime, lastUpdate }` timer tuples are re-anchored on the
  Companion receipt clock. Non-timer metadata patches no longer mutate timer `lastUpdate`, START
  `currentTime` remains finite elapsed (including negative bonus time), and stale-source arbitration
  remains intentionally unchanged.

**TODO — process/CI hardening FIRST (prerequisites for safe 1b):**
- **M-2 (USER DECISION — do not change branch protection without the user):** protection has no
  required reviews + `strict:false`, so the baton is convention-only (the consultant's C1 mistake
  merged solo). `strict:true` is safe (prevents stale merges, does NOT block self-merge). Required
  reviews WOULD block orchestrator self-merge → changes heartbeat autonomy. Tradeoff is the user's call.

**TODO — correctness fixes (each its own PR + a test; harness must stay green):**
- All other priority correctness fixes from the Fable review are landed.

**TODO — then structure + inert cleanups:**
- **M-4 (before Stage 2):** adopt npm workspaces + `@ontime/*` aliases (replace `../../../packages/*/src`).
  Aliasing is NOT the Stage-4 folder rename — do it now while cheap (3 packages/shims). Add
  dependency-cruiser for real (transitive) boundary enforcement; grep can't catch indirection.
- **H1 (inert dead code):** delete the unreachable arbitration fallback chain in `resolveRoomSource`.
- **H2 (low value):** route inline `*1000 - elapsed` through `computeRemaining` (Controller/Dashboard).
- **Anti-duplication CI check:** add only AFTER H2 + M-1 collapse (else false-positives).
- **L-2:** line-count ratchet on `UnifiedDataContext.tsx` + `companion/src/main.ts` (fail if they grow).

### Codex — baton handoff / next heartbeat
The baton is **yours**; no PR is awaiting consultant review. On your next heartbeat, work this
corrective backlog **in order**, one scoped PR each, under the baton (add `needs-claude-review`, wait
for `claude-reviewed` before merging — do NOT self-merge unreviewed like the solo C1 mistake). Next:
**M-4 (workspace aliases + real boundary enforcement)** after M2 lands and only if no PR is waiting
on Claude/human.
The harness is gated now, so behavior regressions go red. **Do NOT begin Stage 1b carve-outs until
M-1 lands.** The actionable Fable review summary is captured in this ledger; the local
`prompt-exports/` brief is not tracked because guardrails intentionally forbid tracked prompt-export
artifacts.

## Deferred (unchanged)

- triage + fix the 3 genuinely-failing test files (useSortableList, CuesPanel, AppModeContext) and remove them from the CI exclude list once green (note: the "UnifiedDataContext.test" entry was a FALSE premise — it was a one-line missing import, fixed in #14)
- line-ending normalization hygiene PR (mixed CRLF/LF across repo — every edit must de-churn)
- `mergeCueVideos` regression during `presentation-core` extraction
- iPad viewer polish branch (stashed)
- installer-build release readiness (viewer bundle + tsc steps + ffprobe sourcing)

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
