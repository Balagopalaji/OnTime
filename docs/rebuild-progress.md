---
Type: Tasklist
Status: current
Owner: KDB
Last updated: 2026-07-08
Scope: Rebuild state ledger, updated at the end of each rebuild PR.
---

# OnTime Rebuild Progress

_Updated: 2026-07-08._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild PR.

## Contents

- [Current Stage](#current-stage)
- [Baton Policy — updated 2026-06-13 (faster cadence for inert work)](#baton-policy--updated-2026-06-13-faster-cadence-for-inert-work)
- [Landed (on `main`)](#landed-on-main)
- [Session sync — 2026-07-06 (Claude solo-orchestrated; Codex/GLM token-blocked)](#session-sync--2026-07-06-claude-solo-orchestrated-codexglm-token-blocked)
- [Claude offline-session summary (for Codex — 2026-06-11, while you were out of tokens)](#claude-offline-session-summary-for-codex--2026-06-11-while-you-were-out-of-tokens)
- [Fable independent review (2026-06-11) — corrective backlog (do BEFORE Stage 1b carve-outs)](#fable-independent-review-2026-06-11--corrective-backlog-do-before-stage-1b-carve-outs)
- [Fable SECOND review (2026-06-13, pre-Stage-1b gate) — corrective backlog (DONE)](#fable-second-review-2026-06-13-pre-stage-1b-gate--corrective-backlog-done)
- [Fable THIRD milestone audit (2026-06-30, over #31–#39) — CONDITIONAL GO → conditions now met](#fable-third-milestone-audit-2026-06-30-over-3139--conditional-go--conditions-now-met)
- [Fable FOURTH milestone audit (2026-07-04, over #40–#52) — GO](#fable-fourth-milestone-audit-2026-07-04-over-4052--go)
  - [Codex — baton handoff / next heartbeat](#codex--baton-handoff--next-heartbeat)
- [Deferred (unchanged)](#deferred-unchanged)
- [Standing Stop Conditions](#standing-stop-conditions)

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
mutable stores remain in `companion/src/main.ts`; `handleRequestControl` branch behavior is characterized in
#51, control-audit writes + the 30s pending-request timeout expiry are characterized in #53/#54, and their
corresponding carves landed in #56/#57. The **4th Fable milestone audit over #40–#52 returned GO** (no
High/Medium; one pre-existing LOW predicate-drift item). To shift from line-sized helper shaving to
subsystem-sized work, `docs/rebuild-companion-coupling.md` now records a partial Companion coupling map:
loopback `/api/token` is the clearest leaf-candidate; disk room cache is a persistence-adapter candidate
with a broad store footprint; pairing/viewer-token routes, file operations, control-lock/takeover, and sync
remain test-first or byte-faithful until their boundaries are proven. Heartbeat lock refresh still needs
characterization before its carve. The fifth Fable milestone audit artifact is now tracked at
`docs/archive/rebuild-fifth-milestone-audit.md`; its required CI package-coverage fixes landed in #72, and the
strict `HandshakeError` U1 slice landed in #73. The sixth milestone audit returned GO; its lockfile
LOW was fixed in #81, the U1 Timer/Cue wire-envelope slice landed in #82, the RoomState/envelope slice
landed in #84, D7 CRLF hygiene landed in #86 to normalize TS/TSX/JS source files to LF, and the
seed-state corrective follow-up landed in #88. The public README was refreshed in #90, LF normalization
was completed in #91, and the current PRD/rebuild-doc source set was reconciled in #92/#93.

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

**Do NOT slice too small (2026-07-06 rule).** Size a slice by RISK and REVIEWABILITY, not line count.
BUNDLE homogeneous, zero-divergence, same-region changes into ONE slice; only SPLIT at a genuine
decision/divergence/behavioral boundary. Small-for-its-own-sake costs more than it saves: each
god-file-touching slice competes for the same mutex + edits the same import block (→ serialized
rebases/collisions), and every slice carries fixed builder+review+CI+merge+ledger overhead. The
risk-isolation benefit that justifies a small slice does NOT apply when the changes are homogeneous
and near-zero-risk — you're isolating nothing. Examples: #78 correctly bundled 5 enums + `Timer` +
`Cue` (all "delete local type, import from shared-types") into one slice; the earlier plan to split
enums (6a) from Timer/Cue (7A) was over-fragmentation and the two even OVERLAPPED on the enums.
Legitimate splits: `LiveCue` (decision-gated on `instanceId`), `RoomState` (divergent projection).
Rule of thumb for the U1 tail: adopt ALL the homogeneous Timer/Cue wire ENVELOPES in one slice, not
one-per-payload.

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
- PR #50 docs(rebuild): sync ledger after controller lock builder carve
- PR #51 test(companion): characterize request control handler paths
- PR #52 docs(rebuild): sync ledger after request control characterization
- PR #53 test(companion): characterize control-audit writes
- PR #54 test(companion): characterize pending-request 30s timeout expiry
- PR #55 docs(rebuild): record 4th Fable audit (GO) + #53/#54 characterizations
- PR #56 refactor(companion): extract control audit utilities
- PR #57 refactor(companion): extract pending control timeout scheduler
- PR #58 docs(rebuild): add partial companion coupling map + sync ledger through #57
- PR #59 docs(rebuild): add authoritative rebuild plan + ratify owner decisions
- PR #60 docs(rebuild): append cache + token coupling spot-checks to the map
- PR #61 ci(guardrails): add rebuild-target marker check (G1) + backfill carve modules
- PR #62 refactor(companion): extract loopback token server to token-server.ts (U3)
- PR #63 docs(rebuild): sync ledger — U3 landed (#62), G1 landed (#61)
- PR #64 ci(guardrails): add package population ratchet (G2)
- PR #65 refactor(packages): graduate control-lock-reducers to lock-view-model (U2)
- PR #66 ci(guardrails): ratchet package population to four
- PR #67 refactor(presentation-core): seed package with mergeCueVideos regression (U6)
- PR #68 docs(rebuild): sync ledger after U6 package seed
- PR #69 refactor(interface-contracts): seed package with eight control-request wire types (U1 first slice)
- PR #70 refactor(interface-contracts): adopt /api/token + /api/status-window response contracts (U1 slice 2)
- PR #71 refactor(interface-contracts): adopt join/heartbeat/client-state wire types (U1 slice 3)
- PR #72 ci(guardrails): gate typecheck/test for all populated packages (F1/F2)
- PR #73 refactor(interface-contracts): adopt strict `HandshakeError` wire type (U1 slice 4)
- PR #74 docs(rebuild): sync fifth audit after HandshakeError slice
- PR #75 refactor(interface-contracts): adopt strict `HandshakeAck` wire type (U1 slice 5)
- PR #76 refactor(interface-contracts): adopt control/timer/cue wire types (U1 slice 6) + path A (drop shared-types `"type":"module"`, import `ControllerLock`)
- PR #77 docs(rebuild): sync ledger after U1 slices 5 and 6
- PR #78 refactor(companion): adopt `@ontime/shared-types` domain types (Timer/Cue + 5 enums) (U1)
- PR #79 docs(rebuild): sync ledger — U1 #77/#78 + session decisions + roles handoff
- PR #80 docs(rebuild): sixth milestone audit (GO) + re-land PR-sizing rule
- PR #81 chore(lockfile): sync workspace dependencies
- PR #82 refactor(interface-contracts): adopt timer and cue wire envelopes (U1 slice 7)
- PR #83 docs(rebuild): sync ledger after timer cue envelopes
- PR #84 refactor(interface-contracts): adopt companion room-state envelopes (U1 slice 8)
- PR #85 docs(rebuild): seed/sync room-state investigation (Fable)
- PR #86 chore(repo): normalize source line endings (D7)
- PR #87 docs(rebuild): sync ledger after roomstate and crlf hygiene
- PR #88 fix(companion): validate and normalize seed room state
- PR #89 docs(rebuild): sync ledger after seed-state fix
- PR #90 docs(readme): refresh rebuild status
- PR #91 chore(repo): finish LF normalization (#86 follow-up)
- PR #92 docs: sync specs to post-rebuild codebase (contracts, references, index, archive)
- PR #93 docs: oracle-review fixes (spec + rebuild plan/progress solidity)

## Session sync — 2026-07-06 (Claude solo-orchestrated; Codex/GLM token-blocked)

Recorded by Claude while Codex/GLM were out of tokens. Codex is back; this block is the handoff.

**Batch landed (#73–#78), all Claude-baton reviewed:**
- #73 `HandshakeError`, #75 `HandshakeAck` (inlines `companionMode`/`NodeJS.Platform` — drift-guarded at `createHandshakeAck`), #76 control/timer/cue wire types.
- **#76 path A (Claude-applied after a CHANGES):** dropped `"type":"module"` from `packages/shared-types/package.json` (zero runtime exports → behavior-neutral) and swapped the inlined `ControllerLock` in `ControllerLockStatePayload` for `import type { ControllerLock } from '@ontime/shared-types'`. **Latent item (a) CLOSED** — companion (CJS/Node16) now imports shared-types with no TS1541; the domain-referencing tail no longer needs inlining. `interface-contracts → shared-types` edge is allowed (dependency-cruiser) and now in use.
- **#78 (sub-agent-authored, Claude-reviewed, CI-proven):** companion drops its local `Timer`/`Cue`/`TimerType`/`MessageColor`/`OperatorRole`/`CueTriggerType`/`CueAckState` and imports them from shared-types. Verified: Timer = pure superset, Cue = single `editedByRole` widening (`OperatorRole | null`), enums byte-identical — behavior-neutral by construction. Ratchet `main.ts` 7734→7697. `LiveCue` intentionally excluded.
- Process fixes proven this session: #75 was DIRTY on the ledger (Claude merge-resolved); #76/#78 were clean. **Rule: slice PRs must NOT edit `docs/rebuild-progress.md` — Codex owns ledger syncs** (two collisions came from this).

**Decisions ratified this session:**
1. **LiveCue `instanceId` = B1** — when LiveCue is adopted, extend shared-types `LiveCue.metadata` with `instanceId?: number` (companion writes it, no reader; keeps the wire type honest + preserves show-caller optionality). Do NOT drop it (B2).
2. **Show-caller / show-control PRODUCT stays deferred (D3/D4)** — but this is distinct from carving the *existing* LiveCue/presentation code out of `main.ts`, which is **REQUIRED for D5** (god-file → ≤500-line pure-wiring shim). Defer *building the product*; still *relocate existing code*. Homes: domain types → `shared-types` (already has `LiveCue`); wire envelopes → `interface-contracts`; presentation merge/snapshot logic → `presentation-core`; PPT-probe I/O → companion app-internal adapter now (full `ppt-bridge` product deferred). Owner rationale on record: operator/custom viewers (not main viewer); PPT laptop can't run PowerPoint + controller both foremost → network-separated control; controller-reads-PPT-status is ppt-bridge, not crucial.
3. **Slice sizing:** bundle homogeneous, zero-divergence, same-region adoptions into ONE slice (see #78 = enums+Timer+Cue); split only at genuine decision/divergence boundaries (LiveCue). Avoid over-fragmentation — the earlier 6a(enums)/7A(Timer+Cue) split overlapped on the enums and was superseded by #78.
4. **RoomState (decision pass, ratified):** keep companion's lean `RoomState` as an explicit projection (`Pick<shared RoomState, …> & { title?; timezone? }`, rename `CompanionRoomState`); replace the unsafe `room.state as RoomState` cast at `frontend/src/context/UnifiedDataContext.tsx:~3091` with a tested adapter. Do NOT structurally unify (cloud-persisted entity vs clock-domain projection).

**Roles going forward (Codex back):** Codex orchestrates (authors GLM prompts) + merges; GLM (±Codex) builds; Claude reviews independently + supplies decision/placement analysis. **Next GLM prompt authored by Codex, not Claude** (reviewer independence — Claude should not both spec and review). Parallel Codex+GLM building only on DISJOINT files (god-file mutex).
For frontend-touching builder prompts, include `npm run lint --workspace frontend`; #84 showed `tsc` + Vitest can miss ESLint-only failures.

**SIXTH milestone audit DONE — GO** (2026-07-06, over #72–#79). Fresh-context Fable, all gates green, #78 behavior-neutral + #76 path-A ESM/CJS sound, guardrails/mutation probes all bite. The one LOW (#78 lockfile drift) is fixed by #81. Artifacts: `docs/rebuild-sixth-milestone-audit.md` (this batch), `docs/archive/rebuild-fifth-milestone-audit.md`.

**Next units (canonical — single source of truth; `rebuild-companion-coupling.md` and the handoff block below defer here):** Organized by god-file lane so PRs stay serial on each god-file mutex while lanes may interleave.

- **Lane A — `UnifiedDataContext.tsx` (priority; biggest god-file value):** **U4/U5** — expand `local-sync-arbitration` (carve the timer/sync/lock merge + arbitration out of the frontend god-file). The M5 fresh-wins `mergeProgress` contract is the extraction source of truth.
- **Lane B — `companion/src/main.ts`:** **U7** disk room-cache adapter (include cache round-trip tests — sixth-audit Obs-3) → **then** the **LiveCue/presentation cluster carve** (B1 type dedup + envelopes→interface-contracts + logic→presentation-core + probe I/O→companion adapter; required for D5; decision-gated on `instanceId` and sequenced AFTER Lane A's timer-side work).
- **Fast-lane (low-risk, anytime, no god-file mutex contention):** **U8** wire/mark the zero-caller predicates; companion-side `ControllerLock` dedup (sixth-audit Obs-2 / DoD #4).
  - **Companion `ControllerLock` dedup:** `companion/src/control-lock-utils.ts` still defines a field-identical local `ControllerLock` next to the canonical one in `@ontime/shared-types` (#76). Drop the local copy and import from shared-types — required for DoD #4 (single wire-shape).
- **Deferred seed follow-ups:** `SEED_COMPANION_CACHE` auth gate stays deferred until LAN-mode scope; N2 remains a milestone-gate watch to confirm snapshot arbitration tolerates a `0` anchor before the next milestone cut.

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

**DONE — request-control handler characterization (#51):**
Added socket-level tests for `handleRequestControl` paths that were still thin before carving: no active
controller grants the lock immediately without queuing a pending request; the current controller re-request is
a no-op that preserves an existing pending request; and a different requester supersedes the prior pending
request with `superseded` clear emissions before queuing the new requester. No production files changed.

**DONE — control-audit writes + pending-timeout expiry characterization (#53/#54):**
Socket-level tests that pin the last thin spots before their carves. #53 pins all five `appendControlAudit`
write paths (request / force-denied / force-accepted / handover / deny) with exact action/status/actorId/
targetId oracles (status ABSENT for request/handover, PRESENT for force/deny) plus the 50-entry cap trim.
#54 pins `schedulePendingControlRequestTimeout` 30s expiry firing via node:test fake timers: no clear at
29,999ms, and at exactly 30,000ms the pending request clears, the timeout handle is removed, and a
`cleared`/`timeout` `CONTROL_REQUEST_STATUS` is emitted to BOTH requester and controller. Test-only; no
production files changed; ratchet baseline unchanged. Authored by Claude (Codex credit-blocked); test-only
fast-lane, no baton. `appendControlAudit` and the pending-timeout scheduler are now carve-ready.

**CARVE NOTES:**
- **L-B:** #38 exported 7 mutable stores from `main.ts` for testability (tests import `./main.js`) — the carve
  MUST keep those names importable via a re-export shim (the #36 pattern).
- **L-C (pre-existing, NOT a #32 regression):** `frontend/src/routes/ControllerPage.tsx:1082` active-timer
  fallback passes raw `elapsedOffset` when `engine` is absent, so a running timer ignores `now - startedAt`
  there. Backlog item, not a carve blocker.
- **Template to repeat (from #36):** verbatim move + re-export shim + lower the god-file ratchet baseline in
  the SAME PR + mutation-verified characterization tests; Claude baton review for every god-file carve.

## Fable FOURTH milestone audit (2026-07-04, over #40–#52) — GO
Fresh-context independent Fable audit of the cumulative diff `git diff c2ba6e0...main` (base = the 3rd-audit
endpoint; 6 files, +793/−170; production surface = `companion/src/control-lock-utils.ts`, the `main.ts`
carves, and the ratchet script). **Verdict: GO. No High or Medium findings.**

- **Prior 3rd-audit findings — all FIXED, mutation-verified.** The auditor mutated the compiled `dist` output
  and confirmed exactly one intended test died each time: H-A PIN equality (`=== storedPin`), the
  timeout-requester force predicate, M-B property-access anti-dup regex, L-A missing-baseline hard-fail, and
  the M-A disconnect `requester_disconnected` clearing. L-B re-export shim honored; L-C (ControllerPage raw
  `elapsedOffset`) untouched — still an open backlog item, correctly not claimed fixed.
- **Carves #47/#49 byte-faithful.** CR-stripped / `export`-normalized line-set match with the removed code;
  ratchet traced 8064→8033→8006 (lowered per carve, never raised); #49 "no shim needed" confirmed by grep;
  `control-lock-utils.ts` is pure (zero imports), 78 lines (<400).
- **Characterizations (#40/#45/#51) non-vacuous** — exact store/emit oracles, three empirically killed.
- **Gates green on `main`:** guardrails pass, companion `tsc` clean, `node --test dist/*.test.js` all pass,
  `git diff --check` clean. Independently re-run by the orchestrator (build clean, full suite green, LOW
  finding confirmed by grep).

**LOW / PLAUSIBLE (pre-existing, NOT a carve regression) — predicate spec-mirror drift:**
`shouldClearPendingControlByTimeout` / `shouldClearPendingControlForRequester` (`control-lock-utils.ts:31-40`)
have ZERO production callers — only the `main.ts` re-export shim and tests reference them. The live timeout
path uses its own `pending.requestedAt !== requestedAt` staleness check (`main.ts:~1353`) and the disconnect
path an inline `pending?.requesterId === clientId` (`main.ts:~3512`). Risk: a future edit changes an inline
site while the canonical-looking util stays put, so the util's tests keep passing while it no longer describes
reality. Fix in a future unit — wire the inline sites through the predicates, or label them as test-mirrors.
**OBSERVATION (pre-existing):** `reauthenticated` is validated but unread in `handleForceTakeover` — belongs in
the eventual M-C docs/product reconciliation, not a carve.

### Codex — baton handoff / next heartbeat
`main` is clean at the latest commit; no open PRs; no baton waiting. Stage 1a + both Fable corrective backlogs
are done; Stage 1b is underway (#36 carve #1; #47/#49/#56/#57 companion control-lock utility/payload/audit/
timeout carves; #38/#40/#51/#53/#54 characterizations; #58 partial coupling map). The **4th Fable milestone
audit over #40–#52 returned GO**. M-C remains an unresolved product/spec decision, not a carve-out task.

**READ `docs/rebuild-plan.md` FIRST — it is now the authoritative next-phase plan.** A fresh-context Fable
architect reconciled current state against the target architecture; the load-bearing claims were independently
verified and the product decisions were ratified by the owner. Key rulings that change what "next unit" means:

- **The carve program was drifting** — #47/#49/#56/#57 all landed as `companion/src/*-utils.ts` (app-internal)
  and **zero of the 10 target `packages/*` have been populated by any Stage-1b carve.** Stop defaulting to
  companion line-shaving; carve toward the §3/§4 destinations.
- **Decisions (ratified 2026-07-04):** D1 = one codebase, two build targets. **D5 = the god-files are
  DELETED (logic rewritten into its own packages/modules); a ≤500-line pure-wiring shim only where a file
  must physically exist.** D2 = `interface-contracts` is plain TS types, no runtime schema lib. D3/D4 =
  Cue/NDI/native waived from the Definition of Done. D7 = land the CRLF hygiene PR before U4.
- **Re-aimed sequence (see plan §4):** **U3 `/api/token` carve DONE** (#62 → `companion/src/token-server.ts`,
  app-internal; ratchet 7978→7890; authored by a GLM 5.2 agent, Claude-reviewed APPROVE — byte-faithful, shared
  auth helpers correctly left in main.ts, fall-through control-flow preserved + tested). **U2 DONE** (#65 →
  `packages/lock-view-model`; GLM-authored, Claude-reviewed APPROVE; populated packages 3→4). **U6 DONE** (#67 →
  `packages/presentation-core`; GLM-authored, Claude reviewed the substantive carve and RepoPrompt independently
  approved the post-CHANGES line-ending-only amend; `mergeCueVideos` + the empty-overwrite regression are now
  pinned in package tests; populated packages 4→5). **U1 first slice DONE** (#69 →
  `packages/interface-contracts`; GLM 5.2-authored, type-only adoption of eight pure control-request wire
  types from `companion/src/main.ts` — `RequestControlPayload`/`ControlRequestReceived`/
  `ForceTakeoverPayload`/`HandOverPayload`/`DenyControlPayload`/`ControlRequestDenied`/`RoomPinState`/
  `SetRoomPinPayload`; companion imports them via `import type { … } from '@ontime/interface-contracts'`;
  populated packages 5→6, baseline raised 5→6; companion god-file ratchet lowered 7890→7832; no TS1541 —
  package has no `"type": "module"` so Node16/CJS companion resolves it cleanly; `ControllerLockState`,
  `ControlRequestStatus`, `HandshakeAck`, room/client/timer/domain types, and all runtime logic untouched).
  **U1 slice 4 DONE** (#73 → `packages/interface-contracts`; GLM 5.2-authored, type-only adoption of
  the strict `HandshakeError` server→client payload — `{ type: 'HANDSHAKE_ERROR', code: 'INVALID_TOKEN' |
  'INVALID_PAYLOAD' | 'CONTROLLER_TAKEN' | 'HANDSHAKE_PENDING', message: string }`). Companion's
  `main.ts` strict definition is the source of truth; three loose frontend dups deleted
  (`UnifiedDataContext.tsx`, `CompanionConnectionContext.tsx` named types + `ViewerPage.tsx` inline
  `{ code?: string }`), all three now `import type { HandshakeError }`. `HANDSHAKE_PENDING` is a
  Companion-only fourth code over `docs/interface.md` §3.3's three — recorded in the package per D6
  (M-C docs reconciliation is the follow-up, not this slice). God-file ratchets lowered:
  `main.ts` 7797→7793, `UnifiedDataContext.tsx` 6662→6658. No behavior change (the test trigger payload
  at `UnifiedDataContext.test.ts:781` already matched the strict shape). G5 one-definition tripwire
  deferred until the rest of the wire block (`HandshakeAck`/`JoinRoomPayload`/…) migrates in subsequent
  U1 slices.
  **Fifth milestone audit artifact tracked** (`docs/archive/rebuild-fifth-milestone-audit.md`): F1/F2 package CI
  coverage fixed in #72, F3 `HandshakeError` split fixed in #73; residual observation is the perf-only
  double `parseAllowedOrigins()` note. **U1 slice 5 DONE** (#75 → `packages/interface-contracts`;
  strict `HandshakeAck` server→client payload adopted type-only by companion/frontend; loose frontend ack
  shapes tightened; `main.ts` ratchet 7793→7775). **U1 slice 6 DONE** (#76 →
  `packages/interface-contracts`; `TimerActionKind`/`TimerActionPayload`, `TimerError`, `CueError`,
  `ControlRequestClearReason`, `ControlRequestStatus`, and renamed `ControllerLockStatePayload` adopted
  type-only; `control-lock-utils` re-exports `ControlRequestClearReason` for compatibility; `main.ts`
  ratchet 7775→7734; `shared-types` no longer declares `"type": "module"`, removing the known TS1541 trap
  for future type-only package imports). **Sixth-audit LOW-1 DONE** (#81 → root `package-lock.json`
  regenerated so companion and interface-contracts both record `@ontime/shared-types`). **U1 slice 7 DONE**
  (#82 → `packages/interface-contracts/src/timer-cue-envelopes.ts`; all 16 Timer/Cue wire envelopes adopted
  in one sized slice; companion and frontend duplicates removed via type-only imports/aliases; `main.ts`
  ratchet 7697→7581 and `UnifiedDataContext.tsx` 6658→6612; RoomState and LiveCue/presentation stayed out).
  **U1 slice 8 DONE** (#84 → `packages/interface-contracts/src/room-state-envelopes.ts`; `CompanionRoomState`
  + `RoomStateSnapshot`/`RoomStateDelta`/`RoomStatePatchPayload`/`SyncRoomStatePayload` adopted; `emitSyncRoomState`
  uses a behavior-neutral adapter; `seedCompanion` remains verbatim after Claude caught the double-counting hazard).
  **Seed-state investigation tracked** (#85 → `docs/archive/rebuild-seed-state-investigation.md`; follow-up owner decisions:
  seed auth, `progress` contract, and `getRoomState` default `lastUpdate`). **D7 CRLF hygiene DONE** (#86 →
  `.gitattributes`; tracked TS/TSX/JS sources normalized to LF, eliminating the recurring mixed-line-ending churn).
  **Seed-state corrective follow-up DONE** (#88 → validates and normalizes `SEED_COMPANION_CACHE` payloads,
  stores the lean seed projection, removes the stale seeded `progress[nextId]` fallback, sets unseen-room
  `getRoomState` default `lastUpdate` to `0`, adds real-handler seed coverage, and records the `emitSyncRoomState`
  contract comment). `SEED_COMPANION_CACHE` auth is intentionally deferred to LAN-mode scope; N2 remains a
  milestone-gate watch on snapshot arbitration with a `0` anchor.
  **U1 remainder still open**: LiveCue/presentation is deferred to its decision-gated U1 follow-up slice per the
  placement pass (keep code PRs serial on the god-file mutex). **Next-units priority is defined once, in the
  "Next units (canonical)" block in Current Stage above** (Lane A: U4/U5 → Lane B: U7 → LiveCue → fast-lane U8);
  do not re-state a different ordering here.
- **Anti-drift guardrails (plan §5):** **G1 LANDED (#61)** — every new `companion/src` / `frontend/src/context`
  module without a `// rebuild-target: <package | app-internal>` header now fails CI; the 5 landed carve modules
  are backfilled. **G2 LANDED (#64, ratcheted by #66/#67/#69)** — guardrails count populated §3 target packages
  (package manifest + `src/index.ts` export surface + at least one test) against the current baseline of 6;
  populated packages stay green in CI after #72's package typecheck/test coverage fix. Every carve PR must name
  its §3/§4 destination (the U3 module's marker + this ledger entry are the pattern).
- **Definition of Done (plan §3):** measurable per-stage ratchet ceilings + package population + boundary
  checks; the finish line is both god-files deleted (D5).

Every future god-file carve remains a **Claude-baton** item. Do not implement heartbeat-stale takeover in any
carve. Preserve current Companion behavior: PIN grants immediate takeover; an unanswered control request
becomes forceable after 30s.

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
- ~~line-ending normalization hygiene PR (mixed CRLF/LF across repo — every edit must de-churn)~~ **DONE (#86 + #91)** — TS/TSX/JS source files normalized to LF (D7); behavior PRs must still not mix in line-ending churn.
- timer-core CJS build so `companion` can import the canonical elapsed helper (instead of its documented drift-guarded mirror) — deferred by decision (#29); do during companion build/packaging work.
- ~~`mergeCueVideos` regression during `presentation-core` extraction~~ **DONE (#67)** — seeded
  `packages/presentation-core` and pinned the empty-overwrite regression.
- iPad viewer polish branch (stashed)
- controller installer-build release readiness: under npm workspaces, `electron` is hoisted to the root and `electron-builder` cannot compute the Electron version from `controller/`; fix during release-prep by pinning `electronVersion` or installing controller deps unhoisted.
- companion installer-build release readiness (viewer bundle + tsc steps + ffprobe sourcing)

## Standing Stop Conditions

- Cloud imports `local-sync-arbitration`
- a builder copies `UnifiedDataContext` or `companion/src/main.ts`
- app folders are moved before packages/adapters are proven
- timer behavior changes outside a specific Stage 0-style fix
- extraction work mixes with viewer polish or unrelated refactors
