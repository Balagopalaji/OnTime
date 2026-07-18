---
Type: Audit
Status: current
Owner: Fable (fresh-context 9th milestone auditor)
Last updated: 2026-07-18
Scope: Independent adversarial audit of the Lane B LiveCue/presentation tranche, `git diff ba8793a..843c84d` (PRs #121–#129).
---

# OnTime Rebuild — Ninth Milestone Audit (Lane B tranche, 2026-07-18)

## Verdict: **GO**

The entire Lane B tranche (#121–#128) is verified byte-faithful in both directions, all
gates are green, the characterization net kills every non-equivalent mutation aimed at the
moved logic, both prior-audit coverage closures (#115/#116) still bite, and the ratchet was
lowered honestly in-PR each time. The four mutation survivors are two **provably equivalent**
mutants (both sides of one structural redundancy) and two **pre-existing gaps** in code that
had zero coverage before the carve (probe I/O, poll loop) — no coverage was lost by the
carve. No High or Medium findings. Rulings a–e below; five Low findings.

Audit environment: worktree at `843c84d` (= origin/main HEAD = #129), node_modules
preinstalled, no commits/pushes/branches made, every mutation reverted (final
`git status` clean except this file).

---

## 1. Byte-faithfulness (required check 1) — CONFIRMED, both directions

Method: for each carve, `git diff <parent>..<commit> -- companion/src/main.ts`,
split into removed/added line sets, compared against the new module(s) by **sorted
multiset** (`sort` + `comm`, multiplicity-preserving) **and** by **ordered sequence
diff** of each moved region (catches in-string reordering that multiset checks miss).

### B-3 (#123, `bc5cd94`, parent `77c2ad4`) — pure verbatim: CONFIRMED
- 129 lines removed from `main.ts`; every one reappears in
  `companion/src/presentation-snapshot.ts` verbatim except 4 type declarations that
  gained `export` (`VideoTiming`, `PowerPointPollState`, `PowerPointPollResult`,
  `PresentationSnapshot`).
- The 4 moved functions were **already `export function`** pre-carve
  (`git show 77c2ad4:companion/src/main.ts` lines 3741/3753/3766/3787) — heads identical.
- Ordered-sequence diff of the full moved body vs the module body (header/import
  stripped, `export type` normalized): **only blank-line placement differs**.
- Module-side additions fully classified: header comment block, `// rebuild-target:
  packages/presentation-core` marker, one `import type { LiveCue } from
  '@ontime/shared-types'` (type-only — legal under the CJS constraint).
- `main.ts` keeps a re-export shim (`export { … } from './presentation-snapshot'`).

### B-5a (#126, `227cb3f`, parent `f6402eb`) — verbatim + enumerated DI seam: CONFIRMED
- 1,097 lines removed. Ordered-sequence diffs:
  - The 984-line probe hunk vs `ppt-probe.ts` body (lines 27–1017): **identical** except
    3 `export` keywords (`stopPptProbeHelper`/`stopPowerPointHelper`/`fetchPowerPointStatus`),
    the ONE enumerated `$debugEnabled = ${isPptDebugVerboseEnabled() …}` interpolation
    (probe line 344), and one debug-flag read swapped to `isPptDebugEnabled()` (line 955).
  - The 100-line debug hunk vs `ppt-debug-log.ts` body: **identical** except 5 `export`
    keywords, the enumerated `initializePptDebugLogging(deps: { getCompanionMode … })`
    signature + `deps.getCompanionMode()` in the startup line, and the two NEW read-only
    getters `isPptDebugEnabled()`/`isPptDebugVerboseEnabled()`.
  - The 7 `pptHelper*`/`pptNative*` state `let`s (hunk @832) moved verbatim to the top of
    `ppt-probe.ts`.
- **Embedded scripts verified character-identical by ordered diff** (AppleScript block
  probe:254–307, PowerShell block probe:369–957) except the single enumerated
  interpolation — the exact seam the PR enumerated.
- Staying `main.ts` edits are exactly the enumerated ones: import churn, the
  `initializePptDebugLogging({ getCompanionMode: () => currentCompanionMode })` call,
  and 3 flag reads in staying `startPowerPointDetection` swapped to the getter
  (hunk @4931). Stop-sequence call order unchanged.

### B-5b (#128, `db98b31`, parent `3bae8a6`) — verbatim + classified residuals: CONFIRMED
- 315 lines removed. Ordered-sequence diff of the 283-line machine hunk
  (`commitPresentationSnapshot` + `updatePresentationCandidate` +
  `handlePowerPointStatus` + `startPowerPointDetection`) vs
  `presentation-candidate.ts:84–369`: **bodies character-identical**; the ONLY in-body
  edit is the enumerated `mode=${getCompanionMode()}` interpolation
  (candidate line 354). `startPowerPointDetection` gained `export` (the other three were
  already exported for the B-2/B-4 tests).
- Constants (`PPT_*`) + candidate/cache/counter state moved verbatim (module lines 67–82).
- Every residual classified: the `PresentationCandidateDeps` type + 9 same-named `let`
  bindings + `configurePresentationCandidate` (the seam); new
  `isPowerPointDetectionActive()`/`stopPowerPointDetectionTimer()` timer accessors;
  header comments/markers; import churn.
- Mode-change wiring (`main.ts` @2487): `clearInterval + null` → `stopPowerPointDetectionTimer()`
  with the subsequent `logPptInfo`/`stopPowerPointHelper`/`stopPptProbeHelper` order
  **preserved**; the accessor's early-return is unreachable at that call site (guarded by
  `isPowerPointDetectionActive()`), so behavior is equivalent.
- The dead `liveCueEmitters` lint-keeper became the real `configurePresentationCandidate({ … })`
  call with the six emitter lines position-identical (they appear as diff context, not churn).
- L-B re-export shim keeps all 28 C/D test imports on `./main.js` unchanged.

### B-1 (#121, `4d829e4`) — envelope adoption: SOUND
- Companion's local `LiveCue`/`LiveCueConfig`/`LiveCueMetadata` dups deleted; shared-types
  `LiveCue.metadata` gains `instanceId?: number` (ratified B1). Shared `LiveCue` is a
  strict superset of the deleted companion dup (extra optional `videos[].status`) —
  type-only widening, no runtime effect.
- The three envelopes in `packages/interface-contracts/src/live-cue-envelopes.ts` match
  the deleted companion definitions field-for-field with **required** `timestamp`
  (companion is the emitter — correct direction of strictness). The frontend's deleted
  dups were the loose ones (`timestamp?`); its receive sites still guard
  (`payload.timestamp ?? Date.now()`, `UnifiedDataContext.tsx:3911/3932` etc.), so
  runtime robustness against old/malformed emitters is unchanged.
- Frontend `../types` re-exports shared-types (`frontend/src/types/index.ts:1`), so
  `payload.cue` and stored cues are the same nominal type — no structural-compat masking.

## 2. Adversarial mutation testing (required check 2)

Harness: mutate source → verify non-empty `git diff` → `npx tsc -p companion/tsconfig.json`
→ `node --test companion/dist/main.presentation.test.js main.ppt-status.test.js
main.livecue-elapsed.test.js` → record kills → revert → re-verify green. Baseline: all
green before and after the battery; package mutants run under vitest.
Every mutation confirmed applied (diff) before running; every revert confirmed.

| # | Target (file:line) | Mutation | Result |
|---|---|---|---|
| M1 | presentation-snapshot.ts:69 | identityEqual: drop `a.title === b.title` | **KILLED** C1 |
| M2 | presentation-snapshot.ts:85 | timingEqual: `videoListsEqual(…)` → `true` | **KILLED** C2, D7 |
| M3 | presentation-snapshot.ts:92 | videoListsEqual: drop length check | **KILLED** C3 |
| M4 | presentation-snapshot.ts:113 | derivedRemaining `-` → `+` | **KILLED** C5 + D1/D4/D5/D6/D11 |
| M5 | presentation-snapshot.ts:130–132 | drop darwin `videoTimingUnavailable=true` override | **KILLED** C6 |
| M6 | presentation-snapshot.ts:124 | `videoRemaining ?? derived` → `derived ?? videoRemaining` | **KILLED** C4, C5, D10 |
| M7 | presentation-candidate.ts:68 | `PPT_DEBOUNCE_MS` 600 → 700 | **KILLED** C12 + D1–D6 |
| M8 | presentation-candidate.ts:144 | debounce `<` → `<=` | **KILLED** C12 + D1–D6 (matches the #128 claim; kill set is wider once the D-suite runs too) |
| M9 | presentation-candidate.ts:138 | identity change: drop `pptCandidateSince = now` | **KILLED** C12–C14, D1, D2, D8 |
| M10 | presentation-candidate.ts:141 | timing update: ALSO reset anchor | **KILLED** C13 (sole killer) |
| M11 | presentation-candidate.ts:104 | `startedAt` never preserved (always `Date.now()`) | **KILLED** C8, C15 |
| M12 | presentation-candidate.ts:108–111 | instance switch: drop ENDED-for-old emit | **KILLED** C9 (sole killer) |
| M13 | presentation-candidate.ts:181 | title final fallback `'PowerPoint'` → `''` | **KILLED** D3 (sole killer) |
| M14 | presentation-candidate.ts:184 | drop `?? lastSlideNumber` persistence | **KILLED** D4 (sole killer) |
| M15 | presentation-candidate.ts:196–199 | `editSlideVideos` beats `videos` (priority swap) | **KILLED** D5 (sole killer) |
| M16 | presentation-candidate.ts:253/255 | slideChanged seeding `explicitNoVideo ? 2 : 0` → `0` | **SURVIVED — provably equivalent** (see ruling e: seeding and immediate-clear disjunct are mutually redundant) |
| E1 | presentation-candidate.ts:258 | drop `(slideChanged && explicitNoVideo) \|\|` disjunct (the exact #124 mutant) | **SURVIVED — provably equivalent** (ruling e, proof below) |
| M17 | presentation-candidate.ts:69 | `PPT_VIDEO_CLEAR_POLLS` 2 → 3 | **KILLED** D7 |
| M18 | presentation-candidate.ts:292 | enrichment `delta > 200` → `>= 200` | **KILLED** D9 |
| M19 | presentation-candidate.ts:285–287 | drop name-match fallback in prior lookup | **KILLED** D9 |
| M20 | presentation-candidate.ts:321 | drop `?? lastVideoPlaying` fallback | **KILLED** D6, D10 |
| M21 | presentation-candidate.ts:326 | drop `videoDetected &&` gate on videoTimingUnavailable | **KILLED** D12 (sole killer — the #124 gap-closure holds) |
| M22 | presentation-candidate.ts:129–133 | drop announced fast-path commit | **KILLED** D4–D10 (6+) |
| M23 | main.ts `emitLiveCueCreated` | payload `timestamp: now` → `0` | **KILLED** C7, C9 |
| M25 | presentation-candidate.ts:91–94 | commit(null): drop `PRESENTATION_CLEAR` emit | **KILLED** C10, D1, D2 |
| M26 | presentation-candidate.ts:56 | configure destructure: drop `emitLiveCueUpdated` | **KILLED by tsc** |
| M26b | main.ts configure call | miswire `emitLiveCueUpdated: emitLiveCueCreated` | **KILLED** D4–D9 (6+) |
| M24 | ppt-probe.ts:360–362 | non-win32 fetch fallback `{state:'none'}` → `{state:'background'}` | **SURVIVED (full 154-test companion suite)** — pre-existing gap, see below |
| M27 | presentation-candidate.ts:357 | drop `if (pptPollInFlight) return;` reentrancy guard | **SURVIVED** — pre-existing gap, see below |
| T1 | live-cue-envelopes.ts | drop `cueId?: string` from PresentationClearPayload | **KILLED** by companion tsc (`main.ts(589,5) TS2353`) |
| T2 | live-cue-envelopes.ts | `timestamp: number` → `string` (LiveCueEventPayload) | **KILLED** by companion tsc (3 emit sites: 523/539/557) |
| S1 | local-sync-arbitration companion-room-state.ts:19 | `elapsedOffset: companion.currentTime` → `0` | **KILLED** (2 tests — the #115 closure still bites) |
| S2 | local-sync-arbitration companion-room-state.ts:51 | drop `companionState.title ??` fallback | **KILLED** (1 test — a #116 closure still bites) |

**Survivor classification (the load-bearing distinction):**
- **Lost-coverage-by-the-carve: NONE.** Every decision-relevant line that had (or gained)
  characterization coverage kills its mutant through the `main.js` shim path — i.e., the
  carve preserved the entire B-2/B-4 net.
- **Provably equivalent: M16 + E1** — two halves of one structural redundancy (ruling e).
- **Pre-existing gaps (non-blocking):**
  - **M24 (ppt-probe.ts):** the probe I/O layer has zero test coverage. Pre-carve, none of
    its functions were exported or test-imported (`fetchPowerPointStatus` was a private
    function of `main.ts`); the B-2/B-4 suites deliberately stub at the
    `handlePowerPointStatus` boundary. Coverage was zero before and is zero after — nothing
    lost. Characterizing probe I/O is ppt-bridge graduation work.
  - **M27 (poll loop):** `startPowerPointDetection`'s interval/reentrancy behavior is never
    exercised (no test starts detection). Same pre-carve state (the function was unexported
    until B-5b). Nothing lost.

## 3. Gates (required check 3) — ALL GREEN

| Gate | Command | Result |
|---|---|---|
| Guardrails (static + ratchets + markers + population) | `npm run guardrails` | PASS (`Rebuild guardrail checks passed`, population 6/10 = baseline) |
| Dependency boundaries | (in guardrails) `check-dependency-boundaries.mjs` | PASS — no violations, 163 modules / 393 deps |
| Frontend lint | `npm run lint --workspace frontend` | PASS |
| Frontend typecheck | `npm run typecheck --workspace frontend` | PASS |
| Frontend suite | `npm run test --workspace frontend` | PASS — 25 files / **223 tests** |
| Companion suite | `npm run test --workspace companion` (tsc build + `node --test dist/*.test.js`) | PASS — **154/154** (incl. the 28 C/D characterizations) |
| interface-contracts | `typecheck` + `vitest run --root packages/interface-contracts src/index.test.ts` | PASS — 54 tests |
| shared-types | `npm run typecheck --workspace packages/shared-types` | PASS |
| local-sync-arbitration | `vitest run --root packages/local-sync-arbitration src/index.test.ts` | PASS — 76 tests |

`git diff --check ba8793a..HEAD` clean (no whitespace/line-ending churn).

## 4. Boundary / purity (required check 4) — CLEAN

- dependency-cruiser green (see above).
- **No value-import of `@ontime/*` from companion runtime code**: a full-statement regex
  sweep over `companion/src/**/*.ts` (multi-line aware) finds every `@ontime/*` import is
  `import type` (`main.ts:55/92`, `token-server.ts:22`). B-1's adoption respects the CJS
  constraint; B-3/B-5b's `LiveCue` imports are `import type` only.
- The CJS constraint itself re-verified: companion `tsconfig` is `module: Node16`, and
  `packages/shared-types`/`interface-contracts` `exports` resolve to raw `./src/index.ts`
  — Node cannot `require()` these; value-import would fail at runtime. Staging deviation
  is forced, not elective (ruling a).
- New-module markers present and correct: `presentation-snapshot.ts` /
  `presentation-candidate.ts` → `// rebuild-target: packages/presentation-core`;
  `ppt-probe.ts` / `ppt-debug-log.ts` → `// rebuild-target: app-internal (local-companion)`
  (matches the ratified decision: probe I/O is a companion adapter now, `ppt-bridge` deferred).

## 5. Prior-audit findings stay fixed (required check 5) — CONFIRMED

- **#115** (`translateCompanionStateToFirebase` elapsed mapping): mutating
  `elapsedOffset: companion.currentTime` → `0` fails 2 package tests (S1). Still fixed.
- **#116** (`buildRoomFromCompanion` title fallback): mutating away
  `companionState.title ??` fails 1 package test (S2). Still fixed.
- Package suite intact at 76 tests (the #116 end-state count).

## 6. Ratchet honesty (required check 6) — CONFIRMED

- Current `main.ts` split-count = **5,841** = `GOD_FILE_LINE_BASELINES` entry
  (`scripts/check-rebuild-guardrails.mjs:342`) = ledger claim. `UnifiedDataContext.tsx`
  = 6,067 = baseline = ledger claim.
- Baseline history in-range: 7387→7343 (#121), 7343→7218 (#123), 7218→6134 (#126),
  6134→5841 (#128) — **each lowered in the same PR as its carve**, never retroactively,
  never raised. UDC 6080→6067 in #121.

## 7. Rulings on the pre-recorded flags

**(a) Staging deviation (B-3/B-5a/B-5b app-internal instead of `packages/presentation-core`) — SOUND, correctly marked, honestly ledgered.**
The blocker is real and re-verified (companion CJS/Node16 + raw-`.ts` package `exports`;
decision #29 defers package CJS builds). All three staged modules carry accurate
`rebuild-target` markers (G1-checked in CI); the two that graduate to `presentation-core`
are marked exactly so, and `ppt-probe`/`ppt-debug-log` are correctly marked app-internal
per the ratified probe-I/O decision — the deviation is narrower than "three modules await
graduation": only `presentation-snapshot.ts` + `presentation-candidate.ts` do. The ledger
flags the deviation prominently in both the #128 entry and the handover. The "packages
6/10, unchanged" claim is honest. Precedent (`control-lock-reducers` → `lock-view-model`)
is apt. Condition attached: **graduation must remain a tracked unit** (it is — handover
"Later" item 5); if package CJS builds slip indefinitely, the D5 finish line for
`presentation-core` slips with it, so the population ratchet should not be the only
forcing function.

**(b) Dead logic (`pptBackgroundSince` write-only, `PPT_BACKGROUND_CLEAR_MS` unused) — DELETE in a fast-lane slice.**
Verified: `PPT_BACKGROUND_CLEAR_MS` (presentation-candidate.ts:70) has zero references;
`pptBackgroundSince` (line 81) is written at 166/169/332 and its only "read" (168) guards
its own write — no behavioral consumer. Moving it as-is into the carve was the right call
(byte-faithfulness first); keeping it now fails the minimalism hard rule and would pollute
`presentation-core` at graduation with never-wired machinery (it looks like an
unimplemented "clear after 10 s in background" feature). Deletion is behavior-invariant by
construction (no observable read) and trivially fast-lane-eligible (dead-code removal,
one file, mechanically obvious). If the owner wants the background-clear behavior, that is
a product decision to spec — not a reason to carry dead state.

**(c) D6 warm-cache pin — ACCURATE: it documents, it does not mask.**
Code-verified: the cache refill (presentation-candidate.ts:200–205) runs **before**
`hasVideoPayload` is computed (220–228), so with a warm cache and a non-explicit no-payload
poll, `hasVideoPayload` is true and the counter resets every poll (237–238) —
`pptNoVideoCount >= PPT_VIDEO_CLEAR_POLLS` (259) is unreachable on that path. The D6 test
(main.ppt-status.test.ts:387) pins precisely this (silent polls, cache retained, cache
proof), and the file header (lines 35–41) names it a DIVERGENCE and points at the paths
that DO clear (D7 explicit counter, D8 slide-change+explicit). That is documentation done
right. It IS a real latent defect surface: if a probe stops reporting video fields without
the full explicitNoVideo signature (`videoDetected === false` + all timing fields and both
lists absent), stale cached videos persist indefinitely on that slide. Users would hit it
only via a degraded/partial probe. Recommendation: track it as a product-behavior decision
for the presentation-core graduation (fix or ratify), never as a silent carve-time change.

**(d) `ppt-probe.ts` at 1,017 lines (> the 400 cap) — APPROVED.**
Composition measured: the two embedded probe scripts span lines 254–307 (AppleScript) and
369–957 (PowerShell) — ~640 lines (63%) are load-bearing string constants that must move
character-identical (verified in §1); the remainder is cohesive process-I/O plumbing for
three probe strategies. The CI cap intentionally scopes to `packages/` and `apps/`
(extraction-rules §6 note; `companion/src` is review-gated), and splitting the scripts into
more `.ts` files to duck the number would add seams with no reviewability gain. Approval
condition: at ppt-bridge graduation, externalize the scripts as packaged resources rather
than inheriting a 1,000-line module into a package (where the 400 cap DOES bind).

**(e) M10 provable-equivalence ruling (#124, slideChanged-immediate-clear) — CONFIRMED, and strengthened.**
Independent proof: when `slideChanged && explicitNoVideo`, (i) `explicitNoVideo` forces
`hasVideoPayload = false` (line 221: `!explicitNoVideo &&` heads the conjunction), and
(ii) the slideChanged seeding (251–255) sets `pptNoVideoCount = PPT_VIDEO_CLEAR_POLLS`
**before** `shouldClearVideo` is computed (257–259), so the second disjunct
`(!hasVideoPayload && pptNoVideoCount >= PPT_VIDEO_CLEAR_POLLS)` is true whenever the
first disjunct is — the first disjunct is subsumed. (`shouldClearExplicit` also fires on
the same poll via the explicit-counter seed.) Empirically re-run as E1: the exact mutant
survives the full targeted suite, as an equivalent mutant must. Strengthening
observation: the redundancy is **bidirectional** — M16 (seed → 0, keeping the disjunct)
also survives and traces to the same subsumption. One of the two (disjunct or seeding) is
removable at graduation as a tested simplification; as a byte-faithful carve, keeping both
was correct.

## 8. Findings (ranked)

No High findings. No Medium findings.

- **LOW-1 (dead code, ruling b):** `PPT_BACKGROUND_CLEAR_MS` + write-only
  `pptBackgroundSince` — `companion/src/presentation-candidate.ts:70,81,166–170,332`.
  Delete in a fast-lane slice (behavior-invariant; see ruling b).
- **LOW-2 (latent product defect, pinned):** D6 warm-cache staleness — a degraded probe
  that omits video fields without the explicit no-video signature leaves stale cached
  videos on a slide indefinitely (`presentation-candidate.ts:200–205` vs `220–228`).
  Pinned as-is by `main.ppt-status.test.ts:387` (correctly); needs a tracked fix-or-ratify
  decision at presentation-core graduation (see ruling c).
- **LOW-3 (structural redundancy, simplification candidate):** the
  `(slideChanged && explicitNoVideo)` disjunct (`presentation-candidate.ts:258`) and the
  slideChanged counter-seeding (`:251–255`) are mutually redundant (proof in ruling e).
  Candidate for a tested simplification at graduation; harmless as-is.
- **LOW-4 (evidence hygiene):** dependency-cruiser module counts quoted in the #126/#128
  commit messages (168/169 modules) do not reproduce at HEAD (163 modules, 393 deps).
  The gate is green either way; but evidence numbers cited in merge messages should
  reproduce from the merged tree, or say what tree they came from.
- **LOW-5 (test-shape note):** the three B-1 envelopes have no package-level test in
  `interface-contracts/src/index.test.ts`; the effective net is cross-workspace tsc
  (T1/T2 show it bites at the companion emit sites, which is the strict side). Consistent
  with earlier type-only envelope slices; worth a compile-shape test only if the package
  ever ships independently of the apps.

## 9. Pre-existing gaps inventory (non-blocking, for the record)

- `ppt-probe.ts` — entire probe I/O layer uncharacterized (M24 survives the full
  154-test suite). Zero coverage pre-carve too (nothing exported); ppt-bridge scope.
- Poll-loop mechanics (`startPowerPointDetection` interval + `pptPollInFlight`
  reentrancy, `presentation-candidate.ts:356–364`) — untested (M27 survives). Zero
  coverage pre-carve too.

## 10. What the orchestrator should independently re-verify

- Rerun any single killed mutation from §2 end-to-end (apply → tsc → `node --test
  companion/dist/main.presentation.test.js …` → revert) to spot-check the battery.
- `npm run guardrails && npm run test --workspace companion` on a clean checkout of
  `843c84d` for the headline gates.
- The B-5b ordered-diff claim: `git diff 3bae8a6..db98b31 -- companion/src/main.ts`
  big hunk vs `presentation-candidate.ts:84–369` (one in-body interpolation, three
  pre-existing `export` heads, one new `export`).
