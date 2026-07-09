# FIX-100 — live-cue elapsed re-anchor (Loop)

```yaml
branch: backlog/fix-100-livecue-elapsed-drift
worktree: rp-agent-ffae3510-backlog-fix-100-livecue-elapsed-dd100b65
base_branch: main
base_sha: 29cd211fec1e2de05c6ed8335c960ad5e68f4cb8
issue: "#100 (unaddressed review feedback)"
spec: inline (orchestrated brief) — root cause verified on main, approach oracle-confirmed
phase: implement
current_task: DONE (loop complete; PR open, NOT merged)
review_cycles: 0
authorization: git_scope=branch+pr (commit/push/open PR, NO merge); doc_edits=true (own notes only)
oracle: up; degraded_ok=false
user_testing: none (companion runtime logic; no rendered UI)
toolchain:
  companion_test: "cd companion && npm test   # = npm run build && node --test dist/*.test.js"
  guardrails: "npm run guardrails"
  line_budget: "companion/src/main.ts <= 7589 lines (base 7587)"
```

## Root cause (verified on main, `companion/src/main.ts`)

`updateRoomActiveLiveCueId(roomId, activeLiveCueId)` (~L689) does:
`{ ...state, activeLiveCueId, lastUpdate: now }` — bumps `lastUpdate` to `now`
but preserves `currentTime`. Canonical running elapsed
`resolveCompanionElapsedForState` (~L491) = `currentTime + (now - lastUpdate)`
(running) / `currentTime` (paused). After the bump a RUNNING timer's stored
elapsed becomes `currentTime_old + (now - now) = currentTime_old`, discarding the
`(now - lastUpdate_old)` delta accrued since the last anchor → the active timer
**jumps backward / stalls** whenever a live cue is created, changed, or ended.

`lastUpdate` is overloaded (timer anchor AND room-mutation/arbitration-freshness
ts), so the `lastUpdate: now` bump must stay — only `currentTime` is wrong.

Frontend note (`UnifiedDataContext.tsx` ~L4150): current delta carries only
`activeLiveCueId`, so `carriesTimerAnchor=false` and existing clients keep their
own (valid) anchor — existing clients don't jump. The bug lives in the **companion
stored state** (snapshots to new joiners + arbitration source), which permanently
loses the delta until the next real timer action re-anchors.

## Fix (smallest plan-aligned)

Re-anchor `currentTime` via `resolveCompanionElapsedForState(state, now)` BEFORE
bumping `lastUpdate`. Resolver returns base `currentTime` when `!isRunning` and
sanitizes non-finite values, so it is safe unconditionally (running folds the
delta; paused is a no-op). Carry `currentTime`+`lastUpdate` in the delta `changes`
so wire == store (spec constraint: "emitted delta + stored state must not
disagree"). Algebraically jump-free for existing clients:
`reanchored + (feNow - now)` == `old + (feNow - lastUpdate_old)`.

## Task ledger

| ID | WI | Files | Tests | Status | Evidence |
|----|----|-------|-------|--------|----------|
| T1 | red test | companion/src/main.livecue-elapsed.test.ts (new) | S1,S2,S3,S4 | done | 2fail/2pass red, right reason |
| T2 | fix | companion/src/main.ts (~L692-701) | — | done | 112 pass/0 fail; review CLEAN |
| T3 | validate+review | — | npm test 112/0, guardrails:static PASS, boundaries env-blocked, inline review CLEAN | done | see validation log |
| T4 | git | branch push + PR #105 (commits 212aaac, 74c22c1) | — | done | https://github.com/Balagopalaji/OnTime/pull/105 — NOT merged (orchestrator owns merge) |
| T5 | closeout | docs/spec/fix-100-livecue-elapsed.{spec,conformance}.md + this doc | — | done | matrix: audited=[S1-S4 + 4 surface + 5 constraints], unreconciled=[] |

## Scenarios

- S1 running: currentTime=5000, lastUpdate=now-3000, activeLiveCueId changes → stored currentTime≈8000, lastUpdate=now; subsequent resolve continuous (no backward jump). FAILS on main.
- S2 paused (isRunning=false): currentTime=5000 unchanged; lastUpdate bumped.
- S3 same activeLiveCueId: early-return, no mutation, no delta.
- S4 non-finite/≤0 lastUpdate or currentTime (running): resolver sanitizes → stored currentTime finite (no NaN/Infinity persisted).

## Review & escape ledger

### T2 review (FIX-100 diff, 4 effective lines in updateRoomActiveLiveCueId)
- Method: code-review skill methodology executed INLINE (RepoPrompt MCP transport
  hung on ask_oracle/apply_edits with 1800s no-response; native `agent_explore`
  also MCP-bound; `Workflow` not opted-in → orchestrator ran the finder angles
  against the diff + 3 callers + resolver + frontend consumer). Context exception
  logged below.
- Angles A(line)/B(removed-behavior)/C(callers: emitLiveCueCreated|Updated|Ended,
  void return, no break)/D(pitfalls: === guard, idempotent re-anchor, int-ms)/
  E(n/a)/reuse(uses canonical resolver, no dup)/simplification(minimal)/
  efficiency(negligible)/altitude(root-cause depth)/conventions(CLAUDE.md OK)/
  sweep(none).
- Verdict: CLEAN — no P0/P1/P2/nit. Empirical red->green (S1/S4 fail on main,
  pass after fix; S2/S3 guards; drift-guard formula pin green). Algebraic
  jump-freedom proven. Oracle GO + Option-B endorsement on record (chat new-chat-F5D4E4).
- Stable signatures: none raised.

## Validation & resume log

### Run 1 — red (pre-fix)
- `cd companion && npm run build` -> OK (after symlinking node_modules + companion/node_modules
  from /Users/bala/Sites/OnTime; main HEAD == base 29cd211 so deps identical).
- `node --test dist/main.livecue-elapsed.test.js` -> 2 pass / 2 fail.
  S1 fail `5000 !== 8000` (currentTime not re-anchored = the bug).
  S4 fail `currentTime must be finite, got NaN` (hardening). S2/S3 pass (guards). Confirmed red for the right reason.

### Run 2 — green (post-fix)
- `cd companion && npm test` (= build + node --test dist/*.test.js) -> **112 pass / 0 fail**
  (4 new S1-S4 green; drift-guard green; all handler/lifecycle/seed/token green).
- `npm run guardrails`:
  - `guardrails:static` (check-rebuild-guardrails.mjs) -> **PASSED** ("Rebuild guardrail checks passed").
  - `boundaries` (dependency-cruiser) -> **ENV-BLOCKED**: node 23.5.0 unsupported by
    dependency-cruiser (^20.12||^22||>=24). Verified IDENTICAL failure on main checkout
    (base commit, no changes). My change adds zero imports/deps (function-body-only edit
    using same-file resolveCompanionElapsedForState + already-imported RoomState/RoomStateDelta;
    new test mirrors existing test imports) -> no boundary violation possible. Not weakened.
- main.ts line count: wc -l = 7588 -> split-count 7589 = GOD_FILE baseline (<=7589). OK.
- `git diff --check` -> clean (LF + whitespace). node_modules symlink NOT committed (staged selectively).

### Resume instruction
- Worktree symlinked node_modules -> /Users/bala/Sites/OnTime/node_modules and
  companion/node_modules -> /Users/bala/Sites/OnTime/companion/node_modules (deps
  install via npm not done; identical-commit symlink is the toolchain enabler).
- Next: conformance matrix + final closeout report. Do NOT merge; orchestrator owns merge + ledger.

## Context exception log

(none yet)

## Closeout summary (FIX-100)

- **Fix**: `companion/src/main.ts` `updateRoomActiveLiveCueId` re-anchors a running
  timer's `currentTime` via `resolveCompanionElapsedForState(state, now)` BEFORE the
  `lastUpdate` bump, and carries `currentTime`+`lastUpdate` in the `ROOM_STATE_DELTA`
  (wire == store). +1 net line; split-count 7589 = god-file baseline.
- **Scenarios covered**: S1, S2, S3, S4 — all Conformed (see conformance matrix).
- **Test names** (`companion/src/main.livecue-elapsed.test.ts`):
  - `S1 running: activeLiveCueId change re-anchors currentTime + lastUpdate (no backward jump)`
  - `S2 paused: activeLiveCueId change leaves currentTime unchanged, bumps lastUpdate`
  - `S3 no-op: unchanged activeLiveCueId triggers no state mutation and no delta`
  - `S4 hardening: bad lastUpdate/currentTime on a running timer stays finite after re-anchor`
- **Test-quality self-check** (global rule): each test names a plausible defect
  (S1 backward-jump, S2 paused-fold regression, S3 no-op-guard removal, S4 NaN
  persistence); asserts EXACT observable values (8000/5000/ANCHOR/finite + deepEqual
  delta), no not-nil/field-presence-only; lowest faithful layer (direct store + delta
  emit, no server/frontend); S4 consolidates 3 hardening branches in one loop. PASS.
- **Validation**: `cd companion && npm test` = 112 pass / 0 fail (build green, drift-guard
  green). `npm run guardrails`: `guardrails:static` PASS; `boundaries` ENV-BLOCKED
  (node 23.5.0; identical failure on base; PR adds no imports/deps). `git diff --check` clean.
- **main.ts line count**: wc -l 7588 → split-count 7589 (= baseline, <=7589).
- **PR**: https://github.com/Balagopalaji/OnTime/pull/105 (commits 212aaac fix + tests;
  74c22c1 spec + conformance matrix). Title/body per brief; baton `needs-claude-review`.
- **Amendments**: none requested, none applied.
- **Divergence/blockers**: `boundaries` sub-gate env-blocked (node version; documented,
  not a code regression). RepoPrompt MCP transport unreliable mid-run (ask_oracle/apply_edits
  hung 1800s); edits applied via Bash/Python, review + conformance done inline (context
  exception logged). No other divergence.
- **NOT done (by design)**: merge (orchestrator owns); `rebuild-progress.md` ledger
  status change (orchestrator owns).

## Context exception log

1. **RepoPrompt MCP transport hung** (`apply_edits` then `ask_oracle` review: 1800s
   no-response; connection closed). Insufficient for: in-process edit + oracle review.
   Follow-up: applied edits via `python3` exact-string replace with `assert count==1`
   (verifiable, idempotent); ran native `code-review` skill methodology INLINE (diff is
   4 effective lines — angles A-E + reuse/simplification/altitude/conventions/sweep run
   by orchestrator against diff + 3 callers + resolver + frontend consumer). Gate
   decision enabled: T2 review = CLEAN, proceed to commit. One earlier oracle GO +
   Option-B endorsement did succeed (chat new-chat-F5D4E4) before the transport degraded.
2. **`boundaries` guardrail env-blocked** (node 23.5.0 unsupported by dependency-cruiser).
   Verified identical failure on base commit. PR adds zero imports/deps -> no boundary
   risk. Not weakened; recorded as env-blocked.
