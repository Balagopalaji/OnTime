---
unit: U7
title: Companion disk room-cache persistence adapter
branch: backlog/u7-companion-disk-cache
base_branch: main
base_sha: 54f9a255164f96198615c56ee7d1f07044c2a26a
spec: docs/rebuild-plan.md §4 (U7 row) + docs/rebuild-companion-coupling.md Appendix A
plan: docs/rebuild-extraction-rules.md (authoritative)
target: app-internal (apps/local-companion)
phase: implement
authorization: branch + pr ONLY (no merge, no label/status changes)
oracle: DISABLED by brief (prior stall) — no ask_oracle calls; blocked decisions escalate to orchestrator
---

# U7 — Companion disk room-cache persistence adapter

## Scope (from Appendix A)

Extract the disk room-cache persistence into a persistence adapter over a `RoomCacheStores` bag +
injected fs/path/timer/clock/logger. **Do not** rewrite room mutation logic. `applyRoomTombstone` and
all socket/domain helpers stay in main.ts; only the trailing `scheduleRoomCacheWrite()` is the adapter
touchpoint. Behavior-preserving: on-disk cache shape + write triggers must stay byte-identical.

## Characterization (current behavior in companion/src/main.ts)

Symbols to extract (all referenced ONLY inside main.ts — verified: 0 test imports):
- Constants: `CACHE_VERSION = 2`, `CACHE_WRITE_DEBOUNCE_MS = 2000`.
- State: `cacheWriteTimer: NodeJS.Timeout | null`, `lastWriteTs = 0` (set but never read — purely internal).
- Functions: `getCachePath` (stays — shared via `getCacheBaseDir`; injected as resolver),
  `loadRoomCache`, `backupCorruptedCache`, `trimBackups`, `scheduleRoomCacheWrite`, `flushRoomCache`,
  `writeRoomCache`.
- `RoomCacheStores` bag (8 persisted maps): `roomStateStore`, `roomTimersStore`, `roomCuesStore`,
  `roomControlAuditStore`, `roomPinStore`, `roomOwnerStore`, `roomViewerTokenStore`, `roomTombstoneStore`.
- Public API main.ts needs (call signatures unchanged): `loadRoomCache(): Promise<void>`,
  `scheduleRoomCacheWrite(): void`, `flushRoomCache(): Promise<void>`.

On-disk shape (`writeRoomCache` payload, 2-space JSON):
`{ version:2, lastWrite:<now>, rooms, timers(sorted by .order), cues(sorted by .order ?? 0),
 controlAudit, pins, owners, tombstones, viewerTokens }`.

Load semantics: version mismatch / missing rooms → fresh; ENOENT → fresh; parse error → backup+trim;
expired viewer tokens pruned (expiresAt <= now); expired tombstones skipped; active tombstones delete
room/timer/cue data; controlAudit sliced to last 50; pin/owner updatedAt defaults to now when non-numeric.

## Design

New module `companion/src/room-cache.ts`, marker `// rebuild-target: app-internal (apps/local-companion)`.
Mirrors the token-server (U3) injected-deps convention. Exports `createRoomCacheAdapter(deps)` returning
`{ load, scheduleWrite, flush }`. Byte-faithful bodies (copy exact logic; substitute fs/path/now/log/timer
from deps). Adapter owns `cacheWriteTimer`/`lastWriteTs` as closure state.

main.ts: remove cache constants/state/6 function bodies; build `const roomCache = createRoomCacheAdapter({...})`
after the 8 store declarations; keep 3 hoisted thin `function` declarations delegating to `roomCache` so the
~30 `scheduleRoomCacheWrite()` call sites + `controlAuditDeps.scheduleWrite` resolve unchanged (TDZ-safe:
calls happen at runtime, after the const initializes). Bag uses structural typing for the persisted entry
shapes (room-cache.ts owns the on-disk entry interfaces); main.ts store declarations unchanged.

Tests: `companion/src/room-cache.test.ts` (node:test) with in-memory fake fs + controllable clock + fake
timer. Covers Obs-3 round-trip + Appendix A boundary list.

## Decision: implement directly (not delegated)

Rationale: single-file, fully-characterized, byte-faithfulness-critical extraction; the brief hard-disables
oracle (`ask_oracle`) due to a prior stall, and the boundary is narrow. Gate = exhaustive verification
(tsc build, full companion `node --test`, guardrails script), not delegation.

## Task ledger

| ID | Task | Status | Evidence |
|----|------|--------|----------|
| 1 | Create room-cache.ts adapter | done | companion/src/room-cache.ts (createRoomCacheAdapter + injected seams + RoomCacheStores bag) |
| 2 | Write room-cache tests | done | companion/src/room-cache.test.ts (13 tests, all Appendix A + Obs-3 round-trip) |
| 3 | Wire main.ts + shrink | done | import + adapter wiring + 3 delegating fns; removed 2 consts + state + 6 fn bodies |
| 4 | Validate + lower ratchet | done | build 0 err; 126/126 tests; guardrails pass; ratchet 7588 -> 7387 |
| 5 | Conformance matrix + commit/PR | done | docs/spec/u7-companion-disk-cache.conformance.md; PR opened (not merged) |

## Validation log

| Command | Result |
|---|---|
| `npm ci` (root) | OK — 1513 pkgs (Node 23.5.0 EBADENGINE warn is expected locally; CI Node 20) |
| electron binary | present (hoisted at root node_modules/electron/dist) |
| `cd companion && npm run build` | OK — tsc 0 errors |
| `cd companion && node --test dist/*.test.js` | OK — 126 pass / 0 fail (incl. 13 new room-cache tests) |
| `node scripts/check-rebuild-guardrails.mjs` | OK — guardrails passed (population 6/10; ratchet 7387; G1 marker; boundaries) |
| `git diff --check` / `grep -rl $'\r'` | OK — clean (LF only) |

main.ts: 7588 -> 7387 (split-based), net -201. Guardrail baseline lowered 7588 -> 7387.

## Review/escape ledger

- Two initial test failures were TEST bugs (called `flush()` without a pending debounce -> no-op, matching production before-quit semantics). Fixed by `scheduleWrite()` then `flush()` in the round-trip + sorted-write tests. Adapter behavior unchanged.
- Divergence (accepted): in-memory `lastWriteTs` not carried into the adapter — it was written on load/write but never read anywhere (grep-verified). Observable on-disk `lastWrite` field preserved. See conformance matrix §5.
- Oracle: disabled by brief (prior stall). No ask_oracle calls; no blocked decisions arose.

## Closeout

All closeout gates satisfied: spec-conformance matrix written (docs/spec/u7-companion-disk-cache.conformance.md, unreconciled = {}); full companion suite green; guardrails green with ratchet lowered; LF hygiene clean. PR opened against main — NOT merged (per authorization scope: branch+pr only).
