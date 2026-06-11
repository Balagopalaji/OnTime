# OnTime Rebuild Progress

_Updated: 2026-06-11._

This ledger keeps rebuild state outside chat context. Update it at the end of each rebuild PR.

## Current Stage

**Stage 1a COMPLETE (milestone M1, tag `M1-stage-1a`).** M1 audit ran; critical/systemic
follow-ups landed. Ready for **Stage 1b** (god-file carve-outs) — but see the Stage 1b
worklist below (collapse the duplication M1 found) and run an anti-duplication CI check after.

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

## Stage 1b worklist (the collapses M1 found — NOT yet done; do under the baton, each its own PR)

1. **H1 — remove dead arbitration fallback chain.** `frontend/src/context/UnifiedDataContext.tsx`
   `resolveRoomSource`: the `else` branch after `if (ARBITRATION_FLAGS.room) { … return decision.acceptSource }`
   is unreachable (room flag is `true`) and duplicates `arbitrate()`. Delete it. (Mind mixed CRLF/LF.)
2. **H2 — route inline remaining-math through `computeRemaining`.** 8 sites of `<timer>.duration * 1000 - <elapsed>`
   in `frontend/src/routes/ControllerPage.tsx` (~1080, 1084) and `DashboardPage.tsx` (~1020, 1053, 1074, 1102, 1124, 1393).
3. **Inline `computeElapsed` (found beyond the audit):** `DashboardPage.tsx` (~1122) reimplements elapsed
   as `now - room.state.startedAt + baseElapsed` instead of using `computeElapsed`/the shim. Collapse it.
4. **Anti-duplication CI check (do AFTER 1–3, else it false-positives):** add a positive guardrail in
   `scripts/check-rebuild-guardrails.mjs` flagging inline elapsed/remaining math (`now - startedAt`,
   `* 1000 - …elapsed`) outside `packages/`/shims, + an extraction-rule line in `rebuild-extraction-rules.md`.
   Verify FP-free before enabling (the broadened clamp regex + companion scope are already in #11).
5. **M2 — module-level mutable state** `lastAcceptedSource` in `packages/local-sync-arbitration/src/index.ts`:
   consider injecting the cache via options when multiple apps consume the package. No behavior change for 1a.

## Deferred (unchanged)

- full test-suite gating, blocked by known pre-existing `main` failures (useSortableList, CuesPanel, AppModeContext, UnifiedDataContext.test)
- companion typecheck in CI (companion is not typecheck-gated; add when convenient)
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
