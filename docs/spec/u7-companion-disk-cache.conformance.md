# U7 — Companion disk room-cache persistence adapter: Spec–Implementation Conformance Matrix

- **Spec:** `docs/rebuild-plan.md` §4 (U7 row) + `docs/rebuild-companion-coupling.md` Appendix A
  (disk room-cache spot-check). Authoritative rules: `docs/rebuild-extraction-rules.md`.
- **Implementation:** `companion/src/room-cache.ts` (+ tests `companion/src/room-cache.test.ts`);
  wiring in `companion/src/main.ts`; ratchet in `scripts/check-rebuild-guardrails.mjs`.
- **Target destination:** app-internal (`apps/local-companion`) — `// rebuild-target:` marker present.
- **Base SHA:** `54f9a255164f96198615c56ee7d1f07044c2a26a` (main @ 54f9a25).

Legend: ✅ Conformed (with evidence) · ⚠️ Diverged (accepted, with reason) · ❌ Not-built.

## 1. Unit definition (rebuild-plan §4, U7 row)

| Requirement | Status | Evidence |
|---|---|---|
| Extract companion disk-cache persistence into an adapter | ✅ | `companion/src/room-cache.ts` `createRoomCacheAdapter(deps)` factory; main.ts builds it once (`const roomCache = createRoomCacheAdapter({...})`) and delegates via 3 hoisted functions. |
| Adapter over a `RoomCacheStores` bag | ✅ | `RoomCacheStores` interface (8 persisted maps) in `room-cache.ts`; main.ts passes its stores as the bag (`stores: { roomStateStore, …, roomTombstoneStore }`). |
| Injected fs / clock (+ timer / logger) | ✅ | `RoomCacheAdapterDeps`: `fs: RoomCacheFs`, `now: () => number`, `timer: RoomCacheTimer`, `log: RoomCacheLog`, plus `path: RoomCachePath` and `getCachePath: () => string`. main.ts injects real node fs/path/console/Date.now/timer. |
| Target destination stated (G1/G3) | ✅ | `// rebuild-target: app-internal (apps/local-companion)` header; guardrail G1 passes. |

## 2. Appendix A — Suggested PR scope

| Requirement | Status | Evidence |
|---|---|---|
| Extract ONLY the disk cache adapter + scheduler, NOT room mutation logic | ✅ | Only `load/write/schedule/flush/backup/trim` moved; `applyRoomTombstone`, socket handlers, CRUD helpers remain in main.ts (diff confined to constants/state/wiring + 6-fn deletion). |
| Inject deps: cache-path resolver, fs-like API, clock, logger, debounce-timer API, `RoomCacheStores` bag | ✅ | All six present in `RoomCacheAdapterDeps`; `getCachePath`/`getCacheBaseDir` stay in main.ts (shared with viewer/settings/ssl) and are injected as the resolver. |
| Leave socket handlers and domain helpers in main.ts | ✅ | Untouched — no handler/control-lock/seed edits (U8b region clean; FIX-100 `updateRoomActiveLiveCueId` + FIX-088S seed path preserved; their tests green). |
| Pass `scheduleRoomCacheWrite` back as the persistence-invalidation callback | ✅ | Hoisted `function scheduleRoomCacheWrite()` in main.ts delegates to `roomCache.scheduleWrite()`; 25 call sites + `controlAuditDeps.scheduleWrite` resolve unchanged. |
| Add boundary tests BEFORE moving anything (char-first) | ✅ | `companion/src/room-cache.test.ts` (13 tests) authored against the adapter with in-memory fake fs/clock/timer; all Appendix A boundary scenarios covered. |

## 3. Appendix A — Boundary tests to add first

| Scenario | Status | Test |
|---|---|---|
| Load valid v2 cache populates all persisted stores | ✅ | `load: valid v2 cache populates every persisted store` |
| Version mismatch / no rooms is ignored | ✅ | `load: version mismatch is ignored` + `load: missing rooms key is ignored` |
| Expired viewer tokens are pruned/skipped | ✅ | `load: expired viewer tokens are pruned, valid ones kept` |
| Expired tombstones are skipped | ✅ | `load: expired tombstone is skipped (not stored, room data untouched)` |
| Active tombstones delete room/timer/cue data | ✅ | `load: active tombstone deletes room/timer/cue data and is stored` |
| Corrupted cache is backed up and old backups trimmed to 3 | ✅ | `load: corrupted cache is backed up and old backups trimmed to 3` |
| Write serializes sorted timers/cues + audit/pins/owners/tombstones/viewer-tokens | ✅ | `write: timers serialized sorted by order, cues by (order ?? 0)` + round-trip asserts on-disk key order/shape |
| Debounce coalesces writes | ✅ | `scheduleWrite: rapid calls coalesce into one debounced write` |
| Flush clears the pending timer and writes once | ✅ | `flush: cancels the pending debounce and writes exactly once` + `flush: with no pending write is a no-op` |

## 4. Behavior preservation & audit debt

| Requirement | Status | Evidence |
|---|---|---|
| On-disk cache shape byte-faithful (version, key order, 2-space JSON, sorted collections) | ✅ | `writeRoomCache` body copied verbatim (seam substitutions only); round-trip test pins `Object.keys` order = `[version,lastWrite,rooms,timers,cues,controlAudit,pins,owners,tombstones,viewerTokens]`, `version===2`, sorted timers/cues. |
| Write triggers unchanged (debounce 2000ms, flush-on-quit) | ✅ | `CACHE_WRITE_DEBOUNCE_MS=2000` preserved in module; `loadRoomCache()` awaited in bootstrap, `void flushRoomCache()` in `before-quit` — call sites untouched. |
| Sixth-audit Obs-3 — pin cache-shape/round-trip when U7 carves the code | ✅ | `round-trip: write then load reproduces all persisted stores (Obs-3)` — serialize→write→read→deserialize equivalence across all 8 stores. |
| God-file ratchet shrinks + baseline lowered (this gate broke main) | ✅ | main.ts 7588 → **7387** (split-based, −201); `GOD_FILE_LINE_BASELINES['companion/src/main.ts']` lowered 7588 → 7387; guardrail passes. |
| Extraction-rule §4 purity (no electron/socket/firebase/react; no main.ts import) | ✅ | `room-cache.ts` imports only `@ontime/interface-contracts`, `@ontime/shared-types` (types), `./control-audit-utils` (type), node-builtin types; no `companion/src/main` import; guardrail passes. |
| §7 line-ending hygiene (LF only) | ✅ | `grep -rl $'\r'` over changed files = empty; `git diff --check` clean. |

## 5. Divergences (accepted)

| Item | Divergence | Reason | Status |
|---|---|---|---|
| In-memory `lastWriteTs` | Not carried into the adapter (it was set on load/write but **never read** anywhere — verified by grep across the repo). | Dropping unobservable dead state instead of propagating it to a new module (minimalism rule). The observable on-disk `lastWrite` field is preserved. | ⚠️ Accepted (unobservable; no behavioral effect) |

## 6. Coverage proof

- **Audited:** U7 row (§4); Appendix A PR-scope (5 items); Appendix A boundary-test list (9 scenarios);
  Obs-3 cache-shape pin; god-file ratchet; §4 purity; §7 line endings.
- **Unreconciled:** `{}` (none).

## 7. Validation evidence (cmds + results)

| Command | Result |
|---|---|
| `npm ci` (worktree root) | ✅ 1513 packages installed (Node 23.5.0 EBADENGINE warning is expected locally; CI is Node 20). |
| electron binary present | ✅ hoisted at root `node_modules/electron/dist`. |
| `cd companion && npm run build` (`tsc -p tsconfig.json`) | ✅ 0 errors. |
| `cd companion && node --test dist/*.test.js` | ✅ 126 pass / 0 fail (incl. 13 new room-cache tests). |
| `node scripts/check-rebuild-guardrails.mjs` | ✅ "Rebuild guardrail checks passed." (population 6/10 baseline 6; ratchet 7387; G1 marker; boundaries). |
| `git diff --check` / `grep -rl $'\r'` | ✅ clean (LF only). |
