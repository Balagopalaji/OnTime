# OnTime Rebuild Progress

_Updated: 2026-07-04._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild PR.

## Current Stage

**Stage 1a COMPLETE (M1, tag `M1-stage-1a`); both Fable corrective backlogs cleared; Stage 1b is underway.**
TWO milestone reviews ran (internal M1 audit + INDEPENDENT Fable), then a Fable SECOND pre-Stage-1b gate
review. **Fable caught real issues each time** — a DEAD characterization harness, a misclassified "fix"
(C1), a receiver-side anchor smear, a transitive-boundary blind spot, and thin handler test coverage.
All are fixed (#14–#29) and the test net is gated in required CI (full 211-test frontend suite + companion
handler wiring). The inert pre-carve-out cleanups also landed (#31–#35), the first Stage 1b carve-out
landed in #36, controller installer CI noise was gated to release triggers in #37, companion
control-arbitration handlers were characterized in #38/#40, takeover-policy handoff docs were corrected
in #43/#44, the disconnect-cleanup carve prerequisite landed in #45, and the pure companion
control-lock utility carve landed in #47. The controller lock payload builder carve landed in #49, further
shrinking `companion/src/main.ts` while preserving the emitted lock shape. Runtime control/lock handlers and
mutable stores remain in `companion/src/main.ts`. Next unit: choose the next coherent Companion control/lock
behavior, characterize it before moving it, follow the #36 template, and preserve the current Companion PIN
and 30s pending request behavior.

## Baton Policy — updated 2026-06-13 (faster cadence for inert work)

Rationale: routine baton review has been **low-yield** (across ~12 Claude reviews, one substantive
catch — the ungated companion test in #17); the real defects came from **fresh-context milestone
audits** + the gated CI/test net (dead harness, misclassified clamp, receiver-side smear, transitive
boundary hole). So: reduce per-change review friction for SAFE work, concentrate scrutiny where
defects actually surface. This supersedes the "each unit its own scoped PR under the baton, do NOT
self-merge" rule **for fast-lane-eligible work only**; risky work still follows the handoff rules.

**FAST-LANE — Codex self-merges on green CI; do NOT add `needs-claude-review`.**
Eligible types: docs/ledger, dead-code removal, helper/utility routing, guardrail-or-CI-only changes,
line-count ratchets, test-only additions. ALL conditions required:
- no behavior change (behavior-preserving must be *mechanically obvious*, not a claim);
- ≤ 3 related files, one reviewable theme ("one invariant" / "one guardrail capability");
- fully test-backed and `Guardrail checks` green;
- RepoPrompt/sub-agent scope + diff review ran.
If any condition fails → it is NOT fast-lane; route to Claude.

**CLAUDE BATON — add `needs-claude-review`, wait for `claude-reviewed`.**
Required for: every Stage 1b carve-out; provider/runtime behavior; timer/elapsed semantics;
sync/arbitration behavior; package boundary changes; ANY edit to `UnifiedDataContext.tsx` or
`companion/src/main.ts` beyond a tiny inert edit; anything where "behavior-preserving" is a claim
rather than mechanically obvious.

**MILESTONE AUDIT — the highest-yield safety mechanism; spend tokens here.**
After each batch of 3–6 merged PRs, AND before starting any carve-out phase, run a fresh-context
adversarial audit (Fable-style; a fresh `model:"fable"` or fresh-context Opus sub-agent) over the
cumulative diff `git diff <last-audit-tag>...main`: rule prior findings FIXED/NOT, hunt regressions.

**PR sizing:** bigger than "one tiny expression." A unit = one invariant or one guardrail capability,
not necessarily one file. Pure guardrail-infra items may be batched (e.g. anti-dup CI check + L-2
ratchet together) provided they stay within the fast-lane conditions above.

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
- PR #32 refactor(controller): route remaining display through timer helper (H2 inert cleanup)
- PR #33 docs(ledger): adopt fast-lane baton policy for inert work
- PR #34 ci(guardrails): block duplicate timer formulas (anti-dup CI check)
- PR #35 ci(guardrails): ratchet god-file line counts (L-2)
- PR #36 refactor(unified): extract control-lock reducers to a dedicated module (Stage 1b carve #1)
- PR #37 ci(controller): gate installer build to release triggers
- PR #38 test(companion): characterize control arbitration handlers
- PR #39 docs(rebuild): sync ledger through control-handler characterization
- PR #40 test(companion): pin FORCE_TAKEOVER wrong-PIN + pending-timeout boundaries (audit H-A)
- PR #41 ci(guardrails): catch property-access timer operands + fail on missing ratchet baseline (audit M-B/L-A)
- PR #42 docs(rebuild): record 3rd audit handoff, carve prerequisite, and operational notes
- PR #43 docs(rebuild): correct M-C handoff status
- PR #44 docs(rebuild): clarify takeover policy for handoff
- PR #45 test(companion): characterize disconnect cleanup (audit M-A prerequisite)
- PR #46 docs(rebuild): sync ledger after disconnect cleanup
- PR #47 refactor(companion): extract control lock utilities
- PR #48 docs(rebuild): sync ledger after control lock utility carve
- PR #49 refactor(companion): extract controller lock builder

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

**DONE — structure + inert cleanups:**
- **Anti-duplication CI check (fixed #34):** a tripwire, not full coverage — required guardrails fail
  when runtime source (`frontend/src`, `packages/`, `apps/`) reintroduces the canonical or
  property-access spellings of inline timer remaining/elapsed formulas outside the canonical helpers
  (`timer-utils` / `timer-core`, allowlisted), but it does not catch reordered/aliased operands; the
  timer test-net is the real guarantee. Comments are stripped before matching; `companion/` is out of
  scope (its CJS mirror is intentional + drift-guarded).
- **L-2 (fixed #35):** line-count ratchet on `UnifiedDataContext.tsx` + `companion/src/main.ts` — required guardrails fail if either grows past its baseline; carve-outs must lower the baseline as they shrink the file.

## Fable THIRD milestone audit (2026-06-30, over #31–#39) — CONDITIONAL GO → conditions now met

Independent fresh-context Fable audit of the Stage-1b batch. Verdict: batch SOLID — #36 is a
byte-faithful extraction (all 241 deleted lines reappear verbatim; only `type`→`export type` +
two type-only imports), ratchet/anti-dup guardrails landed correctly, all nets green (guardrails +
dependency-cruiser over 132 modules, companion + frontend suites), process was followed.

**FIXED (post-audit):**
- **H-A (High, fixed #40):** #38 did NOT pin the FORCE_TAKEOVER PIN-equality check (`companion/src/main.ts:6086`)
  — a mutation dropping `=== storedPin` survived all companion tests. Added wrong-PIN / fresh-pending /
  different-requester characterization; mutation-verified (the new test fails under the mutation).
- **M-B (Medium, fixed #41):** the anti-dup guardrail missed property-access operands
  (`room.state.elapsedOffset + (now - room.state.startedAt)` — the historical DashboardPage M-1 bug shape).
  Added a `(?:[\w$]+\.)*` operand prefix. NOTE: still a **tripwire**, not a semantic guarantee (reordered/
  aliased forms still evade) — the timer test-net is the real net.
- **L-A (Low, fixed #41):** the god-file ratchet silently skipped a missing baseline file (rename hole) —
  now fails loudly.

**UNRESOLVED PRODUCT/SPEC DECISION — M-C is NOT a carve implementation task:** Fable flagged
code-vs-`docs/local-mode.md`/`docs/interface.md` divergence on 90s-stale takeover-without-PIN. Those docs
are currently listed as source-of-truth docs in `AGENTS.md`, so the divergence must not be dismissed as
an archive false positive. Product direction from the user: **PIN = immediate takeover; server-verified
OAuth/reauth = immediate takeover on the Cloud path; unanswered takeover request = forceable after the
existing 30s timeout.** Local Companion should not require OAuth for assistants/operators who have room
access but not the owner's OAuth details; it preserves the current PIN + 30s pending-request timeout
behavior. Cloud already has the server-verified reauth/stale helpers in `functions/src/lock.ts`; Companion
currently implements PIN + 30s pending-request timeout only. `lastHeartbeat` is written as presence metadata
and is not used as a stale-takeover authorization leg. Because Stage 1b is a rewrite/extraction path, not
feature expansion, do **not** add heartbeat-stale takeover inside a carve-out. Preserve current behavior
while carving, then reconcile the current docs in a dedicated product/docs PR: retire 90s heartbeat-stale
takeover, or re-spec it later as abandoned-lock recovery with explicit approval and tests. The existing
PIN + 30s-timeout behavior is now characterized (#38/#40).
**PROCESS LESSON:** future audits must use `AGENTS.md` to distinguish current docs from historical/archive
docs; do not include archived docs, but also do not misclassify listed current docs such as
`docs/local-mode.md` as archived.

**DONE — prerequisite for the next companion control-lock carve (audit M-A):**
Characterized the disconnect cleanup: lock deletion + pending-request clearing had lived inside the
unexported `socket.on('disconnect')` closure (`companion/src/main.ts`). The closure body is now extracted
in place as a testable function, with the socket closure still calling it. Socket-level tests pin lock
deletion, pending-request clearing, `requester_disconnected`, non-controller disconnect behavior, stale
socket cleanup, and pending-requester transfer behavior. Also still-thin and worth characterizing as the
carve reaches them: `handleRequestControl`
no-lock grant (5991) / same-client no-op (6002) / pending-replacement (6005); `schedulePendingControlRequestTimeout`
expiry; `appendControlAudit` writes; heartbeat lock refresh (5955). Rule: characterize what the carve will move.

**DONE — first companion control-lock carve (#47):**
Extracted pure control-lock utilities from `companion/src/main.ts` into `companion/src/control-lock-utils.ts`
with compatibility re-exports from `main.ts`; added focused utility tests; lowered the `companion/src/main.ts`
ratchet baseline from 8064 to 8033. This moved only pure helpers (`CONTROL_REQUEST_TIMEOUT_MS`,
pending-request replacement/timeout/requester clearing checks, PIN normalization, and related types). Runtime
handlers, stores, socket emissions, audit writes, lock refresh, and pending-request timeout scheduling remain
in `main.ts` until they are characterized and carved in their own scoped units.

**DONE — controller lock payload builder carve (#49):**
Moved the pure `ControllerLock` payload type and `buildControllerLock` serializer from
`companion/src/main.ts` into the existing `companion/src/control-lock-utils.ts` module. The move preserved
the existing emitted lock shape (`connectedAt` remains serialized as `lockedAt`, with `roomId` injected by
the caller), added focused deep-equality tests for full and optional-field payloads, and lowered the
`companion/src/main.ts` ratchet baseline from 8033 to 8006. No takeover, heartbeat-stale, pending-request,
socket emission, store mutation, or product behavior changed.

**CARVE NOTES:**
- **L-B:** #38 exported 7 mutable stores from `main.ts` for testability (tests import `./main.js`) — the carve
  MUST keep those names importable via a re-export shim (the #36 pattern).
- **L-C (pre-existing, NOT a #32 regression):** `frontend/src/routes/ControllerPage.tsx:1082` active-timer
  fallback passes raw `elapsedOffset` when `engine` is absent, so a running timer ignores `now - startedAt`
  there. Backlog item, not a carve blocker.
- **Template to repeat (from #36):** verbatim move + re-export shim + lower the god-file ratchet baseline in
  the SAME PR + mutation-verified characterization tests; Claude baton review for every god-file carve.

### Codex — baton handoff / next heartbeat
`main` is clean at the latest commit; no open PRs; no baton waiting. Stage 1a + both Fable corrective
backlogs are done; Stage 1b is underway (#36 carve #1, #47/#49 companion control-lock utility/payload
carves, #38/#40 companion control-arbitration characterized).
A third Fable audit over #31–#39 returned CONDITIONAL GO; its High/Medium/Low fixes landed (#40/#41) and
M-C remains an unresolved product/spec decision, not a carve-out implementation task (see audit section).

**Next Stage-1b unit:** continue the companion control/lock carve from `companion/src/main.ts` one coherent
behavior at a time. The disconnect-cleanup prerequisite, pure utility carve, and controller lock payload
builder carve are done; next candidates should be characterized before moving, especially
`handleRequestControl` no-lock grant / same-client no-op / pending-replacement,
`schedulePendingControlRequestTimeout` expiry, `appendControlAudit` writes, and heartbeat lock refresh. Every
future god-file carve is a **Claude-baton** item. Do not implement heartbeat-stale takeover as part of this
carve. Preserve current Companion behavior: PIN grants immediate takeover; an unanswered control request
becomes forceable after 30s. Cloud immediate takeover may use PIN or server-verified OAuth/reauth. Any
stale/abandoned-lock recovery belongs in a separate product-approved behavior PR or docs reconciliation, not
Stage 1b extraction.

**M-2** (branch-protection tightening) stays a USER decision. Deferred-by-decision: timer-core CJS build
for companion; controller installer packaging under npm workspaces (electron hoisted to root).

**Operational notes for a fresh orchestrator/reviewer (start from the repo, NOT chat history):**
- Read `AGENTS.md`, this ledger, and `docs/rebuild-extraction-rules.md` first. Do NOT rely on any chat.
- Run review/build sub-agents in **separate git worktrees or with strict branch ownership** — shared-working-
  tree operation caused uncommitted-file bleed across branches during this session.
- Editing the CRLF god-files: added lines must be LF or the CI whitespace gate fails — see
  `rebuild-extraction-rules.md §7`; verify with `git diff --check main...HEAD`.
- Fresh milestone audits: source only CURRENT repo docs + touched code; **exclude archived docs** per
  AGENTS Archive Policy, but treat docs listed under AGENTS current sources (including `docs/local-mode.md`)
  as authoritative unless the user explicitly updates/deprecates them.

## Deferred (unchanged)

- ~~triage + fix the 3 genuinely-failing test files (useSortableList, CuesPanel, AppModeContext)~~ **DONE (#28)** — harness bugs (missing `vi` import / missing testing-library `cleanup`), now un-excluded; full frontend suite (211 tests) gates.
- line-ending normalization hygiene PR (mixed CRLF/LF across repo — every edit must de-churn)
- timer-core CJS build so `companion` can import the canonical elapsed helper (instead of its documented drift-guarded mirror) — deferred by decision (#29); do during companion build/packaging work.
- `mergeCueVideos` regression during `presentation-core` extraction
- iPad viewer polish branch (stashed)
- controller installer-build release readiness: under npm workspaces, `electron` is hoisted to the root and `electron-builder` cannot compute the Electron version from `controller/`; fix during release-prep by pinning `electronVersion` or installing controller deps unhoisted.
- companion installer-build release readiness (viewer bundle + tsc steps + ffprobe sourcing)

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
