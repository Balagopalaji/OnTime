---
Type: Tasklist
Status: current
Owner: KDB
Last updated: 2026-07-18
Scope: Rebuild state ledger, updated at the end of each rebuild PR.
---

# OnTime Rebuild Progress

_Updated: 2026-07-18._

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
was completed in #91, and the current PRD/rebuild-doc source set was reconciled in #92/#93. The ledger
was synced in #94 and the fast-lane two-speed carve system landed in #95. The M4 per-mode takeover matrix
was documented in #96. The **7th milestone audit (narrow, GO)** ran over the code-touching PRs since the
6th (#84/#88/#91 + #82); its one finding — MINOR-1, snapshot arbitration false-rejecting live snapshots
carrying companion `lastUpdate: 0` — was fixed in #97 (`resolveSnapshotTimestamp` in
`packages/local-sync-arbitration`), and the audit + the owner's arbitration/control decisions were recorded
in #98 (`docs/rebuild-seventh-milestone-audit.md`, `docs/rebuild-arbitration-decisions.md` — the spec for
U4/U5). **N2 RESOLVED (#97):** snapshot arbitration now anchors on the envelope `timestamp` when
`state.lastUpdate` is the `0` sentinel (never-cached room), so the `0`-anchor gap is closed + tested. A spec-conformance check of the shipped arbitration
against `rebuild-arbitration-decisions.md` confirmed every current-behavior principle holds, with one GAP
(GAP-1) fixed in #101: the skew guard now falls back to room authority/mode instead of hardcoding cloud,
so a materially-newer companion no longer loses to stale cloud in local mode (skew policy recorded in the
decisions doc §1). The `updateRoomActiveLiveCueId` lastUpdate-bump landed in #100.

**Batch #102–#111 (2026-07-08→10; Bala-orchestrated, Claude-reviewed where behavior-touching).** Ledger was synced through #101 in #102. CI hardening: #103 re-runs `Guardrail checks` on `fast-lane` label add/remove (FIX-095) and #104 tightened the `main.ts` ratchet baseline to its true count (FIX-088R). Correctness fixes: #105 re-anchors elapsed on a live-cue `lastUpdate` bump (FIX-100), #106 treats the `0` sentinel as missing in the skew guard (FIX-097), #107 stops dropping rooms on partial/invalid seed state (FIX-088S), and #109 made the FIX-100 re-anchor line-neutral (held the `main.ts` ratchet, fixed a red main). Then the first behaviour-sensitive **carve batch** landed, all byte-faithful and independently reviewed: **U8a (#108)** dedups the companion `ControllerLock` to `@ontime/shared-types` (DoD #4, single wire-shape); **U4 (#110)** carves five reconciliation/arbitration helpers (`resolveRoomSource`, `isSnapshotStale`, `getConfidenceWindowMs`, `shouldBootstrapCachedSubscriptions`, `resolveReconciledTimerTargetId`) + helper/consts out of `UnifiedDataContext.tsx` into `local-sync-arbitration` behind an app-side DI shim that preserves the last-accepted-cache path (`6624→6521`); **U7 (#111)** extracts the disk room-cache persistence lifecycle (load/debounced-write/flush/backup/trim) out of `main.ts` into a fs-injected `room-cache.ts` adapter (`7588→7386`, byte-identical debounce/flush). **U5 five-carve batch (#113, Claude solo-orchestrated + reviewed, Bala-merged):** five byte-faithful Lane-A carves out of `UnifiedDataContext.tsx` into `local-sync-arbitration` — offline timer- and cue-queue coalescing (`mergeQueuedEvents`/`QueuedEvent`, `mergeCueQueueEvents`/`CueQueuedEvent`) → `queue-merge.ts`; controller-client presence/TTL merge (`mergeControllerClients` + `ROOM_CLIENT_MAX_AGE_MS`/`getRoomClientMaxAgeMs`) → `controller-client-merge.ts`; generic companion lock-replay resolvers (`resolveQueuedCompanionLockReplayState`/`…CallbackState`) → `lock-replay-arbitration.ts`; and the plan-§84 companion↔domain translation cluster (`buildRoomFromCompanion`, `translateCompanionStateToFirebase`, `toCompanionRoomState`, `buildDefaultCompanionState` + `DEFAULT_ROOM_CONFIG`/`FEATURES`/`ROOM_STATE`) → `companion-room-state.ts`. Ratchet `6521→6091`; package suite 32→68 tests (all characterization migrated verbatim, no coverage lost); every commit gated (frontend lint/typecheck + full suite, package typecheck/tests, guardrails, dependency-cruiser). **Flags for the next Fable audit:** `translateCompanionStateToFirebase` is exported (it has a live god-file caller in the `ROOM_STATE_SNAPSHOT` handler, not only `buildRoomFromCompanion`); and the `DEFAULT_*` room-domain consts now live in `local-sync-arbitration` (re-imported by ~5 staying callers) — home is arguable vs `shared-types`. **God-file status now: `UnifiedDataContext.tsx` 6,091 / `main.ts` 7,386 (from 6,922 / 8,064 at the #35 ratchet); packages 6/10 populated.**

**8th milestone audit — U5 carve batch (2026-07-15, GO).** Fresh-context adversarial mutation audit (`model:"fable"`) over `git diff 435fb87..72adb26`. Byte-faithfulness of all five carves CONFIRMED both directions (character-identical after normalizing the `useCallback` dedent / `export` keyword); all six gates PASS (guardrails, dep-cruiser, frontend lint/typecheck/suite 223, package suite); 26 mutations run — **19 killed, 1 provably-equivalent** (the redundant ROOM_STATE_PATCH early-return), **6 surviving = pre-existing coverage gaps, NOT lost coverage** (the affected functions had zero direct tests pre-carve; coverage strictly increased). The one earlier self-audit hole — `translateCompanionStateToFirebase`'s `elapsedOffset = companion.currentTime` mapping — was fixed in **#115** and independently confirmed as its sole killer. The other 6 gaps (`toCompanionRoomState`/`buildDefaultCompanionState` run-flag, timer-queue `>=` inclusivity, companion/default TTL + equal-heartbeat merge, `buildRoomFromCompanion` title/timezone) were closed + mutation-verified in **#116** (package suite 68→70→76). Boundaries clean; the new `local-sync-arbitration → interface-contracts` edge is `import type` only and legitimate. **Flag rulings:** (a) `translateCompanionStateToFirebase` export — **SOUND, keep** (live state-level caller in the `ROOM_STATE_SNAPSHOT` handler; §1b names it a `local-sync-arbitration` target). (b) `DEFAULT_ROOM_CONFIG`/`FEATURES`/`ROOM_STATE` — **RE-HOME to `shared-types`** recommended (fast-lane): they are product domain defaults, `FirebaseDataContext.tsx:36` already duplicates `DEFAULT_CONFIG` on the cloud path, and Stage-2 `cloud-adapter-firestore` is forbidden from importing `local-sync-arbitration`, so leaving them here forces triple-duplication or a Stage-2 move (update the shared-types charter wording "types" → "types + domain default constants" when doing it). **Open follow-ups (non-blocking):** the DEFAULT_* re-home; a fast-lane cleanup of now-dead god-file re-exports (`UnifiedDataContext.tsx` lock-replay + `QueuedEvent`/`CueQueuedEvent` type re-exports have no remaining importers).

**Lane B batch #120–#126 (2026-07-16→18; Claude-only orchestration per the handover below; new orchestrator session, isolated worktree).** #120 landed the prior ledger sync + handover. Then the Lane B LiveCue/presentation tranche opened against `companion/src/main.ts`, characterize-first, every slice mutation-verified by the coordinating reviewer before merge: **B-1 (#121)** type-only adoption — `LiveCue.metadata` gains `instanceId?: number` in `shared-types` (ratified B1); the three live-cue/presentation wire envelopes (`LiveCueEventPayload`/`PresentationEventPayload`/`PresentationClearPayload`, strict required `timestamp` — companion is the emitter) adopt into `interface-contracts/src/live-cue-envelopes.ts`; companion + frontend dups deleted (frontend's loose `timestamp?` tightened); ratchets `6080→6067` / `7387→7343`. **B-2 (#122)** 16 characterizations (C1–C16) pin the candidate/commit machine: snapshot equality helpers, `buildPowerPointCue` (darwin `videoTimingUnavailable` override platform-stubbed both ways), commit emit sequences (CREATED+LOADED fan-out, `startedAt` preservation, instance-switch ENDED-all-rooms-first vs null-commit interleaved-per-room asymmetry), strict-`<` 600 ms debounce boundary, anchor reset semantics; 12 reviewer mutations in compiled dist — all killed. **B-3 (#123)** byte-faithful carve of `VideoTiming`/`PowerPointPoll*`/`PresentationSnapshot` + the four pure helpers into `companion/src/presentation-snapshot.ts` — **STAGED app-internal, marked `// rebuild-target: packages/presentation-core`**: companion (CJS/Node16) cannot VALUE-import `@ontime/*` packages at runtime (exports resolve to raw `.ts`; package CJS builds deferred by decision #29), so the ratified "logic → presentation-core" home is deferred to a graduation slice when the CJS build lands (the `control-lock-reducers`→`lock-view-model` staging pattern); independent sorted line-set diff empty; shim-path mutation probes killed; ratchet `7343→7218`. **B-4 (#124)** 12 characterizations (D1–D12) pin `handlePowerPointStatus` (title fallback, slide persistence, video source priority, explicitNoVideo two-poll + slide-change clears, >200 ms playing enrichment with exact-200 boundary and id>name>index matching, prior-snapshot timing fallback, `videoDetected` gating); **discovery pinned as-is (D6): the warm-cache no-payload path never fires the two-poll video clear** (cache refill precedes `hasVideoPayload`, counter resets every poll); reviewer mutations 9/10 killed, the `videoDetected &&` gate survivor closed by D12 (kill re-verified), the slideChanged-immediate-clear mutant ruled **provably equivalent** (slideChanged seeds `pptNoVideoCount=2` when explicitNoVideo). Ledger was synced mid-tranche in **#125**. **B-5a (#126)** then carved the PPT probe/helper I/O + debug logging (~1,100 lines) into app-internal `ppt-debug-log.ts` (124 lines) + `ppt-probe.ts` (1,018 lines — >400 review-approved: the embedded AppleScript/PowerShell probe scripts are load-bearing strings moved character-identical). Mostly-verbatim with a fully-enumerated 26-line DI seam (injected `getCompanionMode`, read-only debug-flag getters, logging imports); no shim needed (no moved name was exported or test-imported); ratchet `7218→6134`. The builder sub-agent was cut off mid-report by a session limit; the orchestrator verified the completed edit against every gate before shipping. **B-5b (#128) then COMPLETED Lane B:** the candidate/commit machine + `handlePowerPointStatus` + detection poll loop + all candidate/cache/counter state moved verbatim into staged `companion/src/presentation-candidate.ts` (379 lines, `rebuild-target: packages/presentation-core`) behind a `configurePresentationCandidate` deps seam (six emitters + `getPresentationRoomIds` + capabilities + mode getter injected as same-named bindings — bodies character-identical; single in-body edit = the `getCompanionMode()` interpolation); the dead `liveCueEmitters` lint-keeper became the real configure call; L-B shim keeps all 28 characterization imports unchanged; reviewer line-set diff = 18 residuals all classified + shim-path mutation probes killed exactly C12–C15 / D3; ratchet `6134→5841`. **God-file status: `UnifiedDataContext.tsx` 6,067 / `main.ts` 5,841 — main.ts now WELL UNDER its Stage-1b ≤6,600 exit target (7,387 at tranche start); packages 6/10 (staged carves await the package-CJS-build work).** **Flags for the 9th audit:** the B-3/B-5a/B-5b staging deviation; `pptBackgroundSince` write-only + `PPT_BACKGROUND_CLEAR_MS` unused (dead logic, deliberately untouched — moved as-is into `presentation-candidate.ts`); the M10 provable-equivalence ruling; the D6 warm-cache discovery. **Next: the 9th milestone audit over `ba8793a..main`, then Lane A — see the Handover section below.**

**9th milestone audit — Lane B tranche (2026-07-18, GO).** Fresh-context adversarial mutation audit (`model:"fable"`) over `git diff ba8793a..843c84d` (#121–#129); artifact at `docs/rebuild-ninth-milestone-audit.md`. Byte-faithfulness CONFIRMED both directions: B-3 pure verbatim; B-5a verbatim + the enumerated DI seam (one `$debugEnabled` interpolation, one `getCompanionMode()` interpolation, export keywords — embedded probe scripts character-identical); B-5b verbatim + 18 classified residuals behind the `configurePresentationCandidate` seam. B-1 envelope adoption sound (strict emitter-side `timestamp`; frontend still guards with `?? Date.now()`). All gates green (guardrails + dep-cruiser; frontend lint/typecheck/suite 223; companion 154; interface-contracts 54; local-sync-arbitration 76). **33 mutations: 29 killed (8 sole-killer), 2 provably equivalent, 2 survivors = pre-existing gaps only** (probe I/O; poll-loop reentrancy — zero pre-carve coverage either way) — **zero coverage lost by the carves**. Prior-audit closures (#115/#116) still kill their mutants; ratchet honest (5,841 = split-count = baseline, lowered in-PR, never retroactively). **Rulings:** (a) B-3/B-5a/B-5b app-internal staging **SOUND** under the CJS constraint, correctly marked + ledgered (only `presentation-snapshot.ts`/`presentation-candidate.ts` await `presentation-core` graduation; probe/debug-log are ratified app-internal); (b) dead `pptBackgroundSince`/`PPT_BACKGROUND_CLEAR_MS` — **DELETE in a fast-lane slice** (behavior-invariant by construction); (c) D6 warm-cache pin **ACCURATE** (documents, doesn't mask) but it is a real latent defect — a degraded probe leaves stale cached videos indefinitely — fix-or-ratify at graduation; (d) `ppt-probe.ts` >400 lines **APPROVED** (~63% is load-bearing probe-script literals moved character-identical; condition: externalize scripts at ppt-bridge graduation); (e) M10 slideChanged-immediate-clear equivalence **CONFIRMED** by independent proof + empirical re-run (the redundancy is bidirectional — simplification candidate at graduation). Five LOW findings, no High/Medium (see the artifact), incl. the B-1 envelopes' missing package-level test (net = cross-workspace tsc, verified to bite) and non-reproducing dep-cruiser module counts in the #126/#128 commit messages (evidence-hygiene nit). Orchestrator independently re-verified before accepting: M13 mutation kill end-to-end, full guardrails + companion suite at `843c84d`, worktree clean.

**Lane A localStorage tranche #130–#133 (2026-07-18, post-9th-audit; Claude-only orchestration, isolated worktree).** #130 recorded the 9th audit (previous entry). **LS-1 (#131)** characterization-first slice for the `UnifiedDataContext.tsx` localStorage persistence cluster: 8 new tests pin `persistRoomCache` trim-to-20/rekey-by-roomId/write-failure swallow, `persistSubscriptions`/`persistLocalTombstones` round-trip + swallow, `readCachedSubscriptions` falsy-skip + malformed-JSON fallback, `readRoomCache` per-entry defaults (fresh `cachedAt`, key-derived `roomId`, `[]` timers, source normalization, timers passthrough), and `readLocalTombstones` strict `expiresAt > now` boundary; the four private functions were exported for direct characterization (line-neutral). Reviewer mutation pass: 6/6 mutants killed. (Process lesson, now in the handover: a first mutation run was silently invalidated because `git checkout --` reverts wiped the *uncommitted* exports along with the mutant — mutation loops over a dirty tree must restore from a copied snapshot, not `git checkout`.) **LS-2 (#132)** the carve: the six functions + six consts + three types moved verbatim into `local-sync-arbitration/src/local-persistence.ts` behind `createLocalPersistence({ getStorage, now, isOnline })` (extraction-rules §4 injected-storage pattern; the frontend value-imports the package, so this is real package population — the U5 wave's charter §1b "queue/cache/tombstone persistence" item). God-file keeps a singleton shim binding real `localStorage`/`Date.now`/`navigator.onLine` and re-exports the same six names — zero call-site or test-import churn. 11 characterization oracles ported verbatim (package suite 76→87); frontend suite untouched at 231 and now exercises the shim→package path end-to-end. Ratchet `6067→5947`. Reviewer verification: both-directions trimmed body diff = the enumerated DI substitutions + factory wrapper only; sort-direction and tombstone-boundary mutants applied to the *package* file were each killed on BOTH the frontend shim path and the package path. **#133** executed 9th-audit ruling (b) fast-lane: dead `pptBackgroundSince`/`PPT_BACKGROUND_CLEAR_MS` (+ the `const now` whose only consumer was the dead write) deleted from `presentation-candidate.ts`, −11 lines, companion 154/154. **God-file status: `UnifiedDataContext.tsx` 5,947 / `main.ts` 5,841 — UnifiedDataContext still ~750 above its ≤5,200 Stage-1b exit target; next Lane A slices: stateful arbitration blocks (`mergeProgressFromCache`, `ARBITRATION_FLAGS.room` paths), then hook-internal `loadQueue`/`saveQueue` persistence.**

**Lane A arbitration tranche #135–#136 (2026-07-18; Claude-only orchestration, isolated worktree, handover item 3).** **AR-1 (#135)** characterization-first slice for the stateful arbitration blocks: 9 provider-level tests (mock socket + mocked contexts, driving `ROOM_STATE_SNAPSHOT`/`ROOM_STATE_DELTA` and observing `ctx.getRoom`/`ctx.roomAuthority`) pin: stale snapshot/delta rejection that still flips `roomAuthority` to the arbitration winner (AR-S1/D1, with a positive control proving rejected delta changes never leak); fresh acceptance applying exact state + authority `decision.acceptSource ?? 'companion'` (AR-S2/D2); the controller tie-breaker `<=` window boundary — equal-timestamp delta accepted at write age exactly 2000ms, rejected at 2001ms (AR-T1/T2, arranged by settling authority to `'cloud'` via a losing delta then marking a companion controller write through `setActiveTimer`); and the `getRoom` `mergeProgressFromCache` M5 fresh-wins contract — fresh room progress wins per key, cache fills gaps, empty cache returns the firebase room **by identity**, cached-room fallback when firebase is empty and companion idle (AR-M1/2/3, cache seeded via `ontime:companionRoomCache.v2` pre-mount). Reviewer mutation pass (copy-based restore): 6/6 killed; builder's own pass 10/10. **AR-2 (#136)** the carve: `resolveControllerTieBreaker` (deduped from its three character-identical god-file copies; `Date.now()` → `now`), `decideRoomStateAcceptance` (the `ARBITRATION_FLAGS.room` decision pair deduped from the two handler blocks, legacy flag-off formula moved verbatim; app shim in `lib/arbitration.ts` binds the wrapped cache+logging `arbitrate` via `arbitrateFn` — U4 precedent; FIX-097 `firebaseTs || undefined` stays at the snapshot call site), and `mergeRoomProgressFromCache` (verbatim incl. `mergeProgress(cachedProgress, roomProgress)`; `@ontime/timer-core` added as a package dep — dependency-cruiser green) → `local-sync-arbitration/src/room-state-acceptance.ts`. 14 package tests port the AR-1 oracles incl. the legacy strict-`<` boundary (app-unreachable behind the statically-true flag — package-only coverage). Package suite 87→101; frontend 240/240 through the shim path. Ratchet `5947→5922`. Reviewer verification: mechanical both-directions body diff = enumerated DI substitutions only; 4/4 package-file mutants killed, the behavior-reachable three on BOTH the frontend shim path and the package path. **God-file status: `UnifiedDataContext.tsx` 5,922 / `main.ts` 5,841 — ~720 above the ≤5,200 Stage-1b target; next Lane A slice: hook-internal `loadQueue`/`saveQueue` per-room queue persistence, then fast-lane U8; 10th audit after the batch (diff base `843c84d`).**

## Handover — 2026-07-18 (Lane B tranche complete → next Claude orchestrator)

Written for a fresh-context Claude session picking this up cold. **Start by reading this ledger, `AGENTS.md`, `docs/rebuild-extraction-rules.md`, and `docs/rebuild-plan.md` — do NOT rely on chat history.** (This section supersedes the 2026-07-16 handover; its process rules were kept verbatim below because they keep working.)

**Roles: Claude-only. No Codex, no GLM (unavailable — do not wait on them).** One Claude session is coordinator **and** independent reviewer. It spawns **fresh-context builder sub-agents** for carves and a **fresh-context `model:"fable"` (or fresh Opus) sub-agent** for milestone audits. The U5 batch + 8th audit and the entire Lane B tranche (#121–#126) were done solo this way. Work in an isolated worktree (`EnterWorktree`) — it cleanly contained a builder that was cut off mid-task (see #126: the edit was complete; the orchestrator re-ran every gate and shipped it — **gates decide, not builder reports**).

**State on `main` (HEAD = #133; this section written at #128 and updated 2026-07-18 after the Lane A localStorage tranche #130–#133):**
- God-files: `frontend/src/context/UnifiedDataContext.tsx` **5,947** / `companion/src/main.ts` **5,841**. Stage-1b exit targets `≤5,200` / `≤6,600` — **main.ts is well under its target**; UnifiedDataContext still needs ~750 lines (Lane A). D5 finish line = both deleted down to ≤500-line pure-wiring shims.
- Packages 6/10 populated (unchanged this tranche — see the CJS constraint below; three staged companion modules await graduation).
- **Lane B COMPLETE, #121–#128 merged:** B-1 LiveCue/envelope type adoption; B-2/B-4 characterizations (28 tests C1–C16 + D1–D12, every one reviewer-mutation-verified); B-3 pure-helper carve (`presentation-snapshot.ts`); B-5a probe-I/O + debug-log carve (`ppt-probe.ts`, `ppt-debug-log.ts`); B-5b candidate machine + decision core + poll loop (`presentation-candidate.ts`). The entire PPT/presentation subsystem is out of `main.ts`. Ledger synced in #125/#127. `main` clean, **no open PRs, no baton waiting.** The 9th milestone audit ran 2026-07-18 — **GO**, five LOWs, rulings recorded (see Current Stage + `docs/rebuild-ninth-milestone-audit.md`).
- **HARD CONSTRAINT governing every "companion code → packages/*" home:** companion is CJS/Node16 and **cannot VALUE-import any `@ontime/*` package at runtime** (their `exports` maps resolve to raw `.ts`; Node cannot `require()` it; only `import type` works). Package CJS builds are deferred by standing decision (#29). Until that lands, companion carves are STAGED app-internal with a `// rebuild-target: packages/<name>` marker (B-3's `presentation-snapshot.ts` is the precedent; `control-lock-reducers`→`lock-view-model` was the pattern's origin). Do NOT plan a companion carve that value-imports a package.

**Process rules that worked (keep doing):**
- Every god-file carve is **Claude-baton**: byte-faithful *verbatim* move + re-export/delegating shim + lower the ratchet in the SAME change. **Characterize FIRST** (extraction-rules §8). The reviewer independently **mutation-tests** each new characterization (mutate the moved fn → confirm a test dies → revert) — this is what caught the pre-existing gaps in #115/#116. Watch indentation when scripting mutations (object-literal props are 2-space). **When the tree carries uncommitted changes, restore mutants from a copied snapshot of the file — `git checkout --` also wipes the uncommitted work and silently invalidates the whole mutation run (bit us in #131's review; caught because baseline counts were re-checked).**
- Builder sub-agents: node_modules is already installed — **do NOT run `npm ci`** (electron postinstall 403s). Builders report; the **orchestrator runs the authoritative gates + commits** (never let the builder commit).
- Gates: `npm run guardrails` (ratchet + dependency-cruiser); `npm run lint|typecheck|test --workspace frontend`; package `typecheck` + `node node_modules/vitest/vitest.mjs run --root packages/<pkg> src/index.test.ts`. Ratchet baseline = `split('\n')` = `wc -l` + 1.
- **Single designated branch** `claude/work-without-codex-glm-rj4zcg` for all carve/code work → one PR at a time. After it merges, restart it from `origin/main` (`git checkout -B claude/work-without-codex-glm-rj4zcg origin/main`); the remote branch then carries only already-merged history, so **`git push --force-with-lease`** is correct.
- **Ledger syncs are SEPARATE `docs/*`-branch PRs** — carve/slice PRs must NOT touch `rebuild-progress.md`.
- Milestone audit after each 3–6-PR batch: fresh-context, mutation-based, over `git diff <last-audit-base>..main`. Record it in this ledger (see the 8th audit entry under Current Stage).
- **Squash-merge** PRs (repo convention: every `main` commit ends `(#NN)`). Merge only on green GitHub `Guardrail checks` (don't merge on local gates alone).

**Flags already ruled (do not re-litigate):** `translateCompanionStateToFirebase` export = sound/keep; `DEFAULT_*` re-home = DONE (#118); dead re-exports = removed (#119); B-3/B-5a app-internal staging = correct under the CJS constraint (graduation slices come with the package-CJS-build work); the slideChanged-immediate-clear mutant = provably equivalent (see #124; independently re-confirmed by the 9th audit); 9th-audit rulings a–e (staging sound / dead-PPT-consts DELETE / D6 pin accurate / `ppt-probe.ts` >400 approved / M10 confirmed) — do not re-litigate.

**Next tranche (recommended order):**
1. **DONE (2026-07-18, GO — see Current Stage).** ~~9th milestone audit FIRST~~ — fresh-context `model:"fable"` over `git diff ba8793a..main` (base = #120, the 8th-audit endpoint state; the diff now covers the whole Lane B tranche #121–#128). Audit flags already recorded for it: the B-3/B-5a/B-5b staging deviation (package population did not advance despite the ratified `presentation-core` home — CJS constraint); `pptBackgroundSince` write-only + `PPT_BACKGROUND_CLEAR_MS` unused (dead logic, moved as-is into `presentation-candidate.ts` — ruling wanted: delete in a fast-lane slice or keep); the D6 warm-cache discovery (two-poll no-video clear unreachable on the warm path — as-is behavior, pinned); byte-faithfulness of B-3 (pure verbatim), B-5a (verbatim + 26 enumerated DI lines), and B-5b (verbatim + 18 classified residuals, `configurePresentationCandidate` seam); the B-5a >400-line `ppt-probe.ts` review-approval; the M10 provable-equivalence ruling (#124).
2. **DONE (#131 characterization + #132 carve — see Current Stage).** ~~Lane A — localStorage persistence cluster~~ landed in `local-sync-arbitration/src/local-persistence.ts` behind `createLocalPersistence({ getStorage, now, isOnline })`; hook-internal `loadQueue`/`saveQueue` per-room queue persistence was deliberately left for a follow-up slice.
3. **DONE (#135 characterization + #136 carve — see Current Stage).** ~~Lane A — stateful arbitration blocks~~ landed in `local-sync-arbitration/src/room-state-acceptance.ts` (`resolveControllerTieBreaker`, `decideRoomStateAcceptance`, `mergeRoomProgressFromCache`); hook-internal `loadQueue`/`saveQueue` per-room queue persistence remains the next Lane A slice.
4. **Fast-lane U8** — wire/mark the zero-caller predicates. (The dead `pptBackgroundSince`/`PPT_BACKGROUND_CLEAR_MS` removal is DONE, #133.)
5. **Later (with companion build/packaging work):** package CJS builds (#29) → graduate the three staged companion modules (`presentation-snapshot.ts`, `presentation-candidate.ts` → `presentation-core`; delete the timer CJS mirror) — this is what finally moves companion package population.

**Owner's coordinator/orchestrator experiment (worth trying):** delegate the *mechanical* loop (spawn builder → gate → commit → push → PR → poll CI → merge) for a batch of homogeneous, low-risk carves to an **orchestrator sub-agent**, while the coordinator keeps strategy + final review. Reviewing is irreducibly context-heavy (you must load the diff), so **don't delegate review** — delegate mechanics. Lane A localStorage adapters (item 2) are the natural first trial; Lane B LiveCue is too risky for it.

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
- PR #94 docs(rebuild): sync ledger through spec docs
- PR #95 feat(rebuild): add fast-lane two-speed carve system
- PR #96 docs(contracts): per-mode takeover authorization matrix (M4)
- PR #97 fix(unified): anchor snapshot freshness on envelope timestamp when lastUpdate is 0 (7th-audit MINOR-1)
- PR #98 docs(rebuild): add 7th milestone audit + arbitration/control decisions
- PR #99 docs(rebuild): sync ledger through #98 — 7th audit GO, MINOR-1 fixed, N2 resolved
- PR #100 fix(companion): bump room lastUpdate when activeLiveCueId changes
- PR #101 fix(arbitration): large-skew fallback to room authority/mode instead of hardcoded cloud (GAP-1)
- PR #102 docs(rebuild): sync ledger through #101 — conformance check + GAP-1
- PR #103 ci(guardrails): re-run on fast-lane label change (FIX-095)
- PR #104 ci(guardrails): tighten main.ts ratchet baseline to true count (FIX-088R)
- PR #105 fix(companion): re-anchor elapsed on live-cue lastUpdate bump (FIX-100)
- PR #106 fix(arbitration): treat 0 sentinel as missing in skew guard (FIX-097)
- PR #107 fix(seed): don't drop rooms on partial/invalid seed state (FIX-088S)
- PR #108 refactor(companion): dedup ControllerLock to @ontime/shared-types (U8a, DoD #4)
- PR #109 fix(companion): make FIX-100 re-anchor line-neutral (hold main.ts ratchet, fix red main)
- PR #110 rebuild(U4): carve reconciliation helpers into local-sync-arbitration (UnifiedDataContext 6624→6521)
- PR #111 refactor(companion): extract disk room-cache persistence adapter (U7; main.ts 7588→7386)
- PR #112 docs(rebuild): sync ledger through #111 (U4/U7/U8a + fix batch)
- PR #113 rebuild(U5): five sync-merge + companion-translation carves into local-sync-arbitration (UnifiedDataContext 6521→6091)
- PR #114 docs(rebuild): sync ledger through #113 — U5 five-carve Lane A batch
- PR #115 test(local-sync-arbitration): pin translateCompanionStateToFirebase elapsed mapping (U5 audit LOW)
- PR #116 test(local-sync-arbitration): close U5 milestone-audit mutation gaps (package suite 70→76)
- PR #117 docs(rebuild): record 8th milestone audit (U5 carve batch, GO)
- PR #118 refactor(shared-types): re-home DEFAULT_* room-domain constants (single source; killed FirebaseDataContext dup)
- PR #119 refactor(unified): drop dead god-file re-exports of carved U5 symbols (UnifiedDataContext 6091→6080)
- PR #120 docs(rebuild): sync ledger through #119 + handover to next Claude orchestrator
- PR #121 refactor(interface-contracts): adopt LiveCue domain type + live-cue/presentation wire envelopes (Lane B slice B-1)
- PR #122 test(companion): characterize presentation snapshot/debounce machinery (Lane B slice B-2)
- PR #123 refactor(companion): extract presentation-snapshot pure helpers (Lane B slice B-3; staged for presentation-core)
- PR #124 test(companion): characterize handlePowerPointStatus decision core (Lane B slice B-4)
- PR #125 docs(rebuild): sync ledger through #124 — Lane B slices B-1..B-4
- PR #126 refactor(companion): extract PPT probe I/O + debug logging (Lane B slice B-5a; main.ts 7218→6134)
- PR #127 docs(rebuild): sync ledger through #126 + handover — Lane B tranche complete
- PR #128 refactor(companion): extract presentation candidate machine + detection loop (Lane B slice B-5b; main.ts 6134→5841 — LANE B COMPLETE)
- PR #129 docs(rebuild): sync ledger through #128 — LANE B COMPLETE
- PR #130 docs(rebuild): record 9th milestone audit (GO) + rulings
- PR #131 test(frontend): characterize localStorage persistence cluster (Lane A slice LS-1)
- PR #132 refactor(frontend): carve localStorage persistence cluster into local-sync-arbitration (Lane A slice LS-2)
- PR #133 chore(companion): delete dead pptBackgroundSince/PPT_BACKGROUND_CLEAR_MS (9th-audit ruling b)
- PR #134 docs(rebuild): sync ledger through #133 — Lane A localStorage tranche complete
- PR #135 test(frontend): characterize room-state arbitration decision paths (Lane A slice AR-1)
- PR #136 refactor(frontend): carve room-state acceptance cluster into local-sync-arbitration (Lane A slice AR-2)

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

- **Lane A — `UnifiedDataContext.tsx` (priority; biggest god-file value):** ~~**U4** first arbitration/reconciliation carve~~ **DONE (#110)**; ~~**U5** timer/sync/lock merge + companion-translation carves~~ **DONE (#113, five carves; 6521→6091)** — offline-queue coalescing, presence merge, lock-replay resolvers, and the companion↔domain translation cluster are now in `local-sync-arbitration`. **NEXT:** the clean byte-faithful pure-helper pool is largely exhausted; the remaining Lane-A work crosses a risk/decision boundary — localStorage persistence (`readRoomCache`/`persistRoomCache`, tombstones, subscriptions) needs an injected-adapter pattern (not a verbatim move); the companion normalizers (`normalizeControllerLock`/`Client`/`WithSource`) are type-entangled with staying code; and the stateful arbitration blocks (`mergeProgressFromCache`, the `ARBITRATION_FLAGS.room` decision paths) need careful characterization first. The M5 fresh-wins `mergeProgress` contract remains the extraction source of truth for those arbitration blocks. Resolve the `DEFAULT_*` const-home question (`local-sync-arbitration` vs `shared-types`) as part of the next tranche.
- **Lane B — `companion/src/main.ts`:** ~~**U7** disk room-cache adapter~~ **DONE (#111)** — `room-cache.ts` fs-injected adapter, byte-identical lifecycle. **NEXT (now the priority Lane-B unit): the LiveCue/presentation cluster carve** (B1 type dedup + envelopes→interface-contracts + logic→presentation-core + probe I/O→companion adapter; required for D5; decision-gated on `instanceId`). Lane A's timer-side work is far enough along that this is unblocked.
- **Fast-lane (low-risk, anytime, no god-file mutex contention):** **U8** wire/mark the zero-caller predicates. ~~companion-side `ControllerLock` dedup (U8a)~~ **DONE (#108)** — local copy dropped, imports from `@ontime/shared-types` (DoD #4, single wire-shape).
- **Deferred seed follow-ups:** `SEED_COMPANION_CACHE` auth gate stays deferred until LAN-mode scope. ~~N2 milestone-gate watch (snapshot arbitration tolerating a `0` anchor)~~ **RESOLVED (#97)** — `resolveSnapshotTimestamp` anchors a live snapshot on the envelope `timestamp` when `lastUpdate` is the `0` sentinel; the gap is fixed + tested.

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
