# Seed vs Sync Room-State Investigation

_Fresh-context Fable investigation, 2026-07-06, over `origin/main` (companion suite verified green 92/92 in an isolated worktree). Triggered by PR #84 (U1 RoomState refactor), which surfaced a divergence between the companion's two room-state emit paths. #84 was kept **behavior-preserving** (the seed reverted to verbatim); this document grounds the two deliberate follow-up fixes tracked as separate work._

## Verdict: PARTIAL — verbatim seed time-values are CORRECT; the seed *shape* is a latent bug; the #84 "harmonization" was the genuinely dangerous variant

- The scary-looking half — seed sending **stored** `currentTime` while sync sends **live-computed** `currentTime` — is **not a bug**. The cloud `(currentTime, lastUpdate)` is a coherent anchored pair; the companion's running formula `currentTime + (now − lastUpdate)` reconstructs elapsed exactly (algebraically identical to the cloud `elapsedOffset + (now − startedAt)` since START sets `startedAt = lastUpdate`, `currentTime = elapsedOffset`). Paused: stored `currentTime` *is* the elapsed.
- The two paths legitimately need different anchors: **SYNC** is a live transfer (emit≈receipt) so `handleSyncRoomState` re-anchors `lastUpdate := companionNow` (H-1b) and pairs it with live elapsed. **SEED** is a historical transfer (state may be hours old); re-anchoring would erase accrued elapsed, and live-computing `currentTime` against the stored anchor **double-counts** it. `lastUpdate` also doubles as the seed's overwrite-arbitration key, so it must not be freshened.
- **Proof #84's projection was a real bug:** `state: toCompanionRoomState(room, computeCurrentTimeWithProgress(room))` with `lastUpdate: room.state.lastUpdate ?? Date.now()`; `handleSeedCompanionCache` stores verbatim (no re-anchor). Running timer started 30 min ago `(E0, T0)`: seeded value `E0 + (T_emit − T0)`, then companion computes `E0 + (T_emit − T0) + (now − T0)` ≈ **double** (~60 min shown for 30). Plus the `?? Date.now()` fabricated a fresh arbitration timestamp (stale could clobber fresh), and it dropped `activeLiveCueId` (companion reads it, `main.ts:777`). The revert to verbatim was the correct runtime call.
- What **is** wrong with verbatim: it ships the rich cloud shape (`startedAt`/`elapsedOffset`/`progress`/`clockMode`) onto a wire whose documented contract is the lean companion shape (`docs/interface.md` SEED example; `docs/timer-logic.md` §1). The `as RoomState` cast at `UnifiedDataContext.tsx` was tautological (`Room['state']` *is* `RoomState`) — the emit genuinely sends the superset.

## Correct seed contract (for the deliberate fix)

Emit the **lean companion projection of the STORED anchored pair** — projection like sync's field list, values like today's verbatim:

```
{ activeTimerId, isRunning,
  currentTime: room.state.currentTime,   // STORED — never computed
  lastUpdate:  room.state.lastUpdate,    // STORED — never Date.now(); omit the room's state entirely if absent
  showClock, message, title: room.title, timezone: room.timezone,
  activeLiveCueId }                      // companion reads it (main.ts:777)
```

`progress` is an owner decision (below). Never `startedAt`/`elapsedOffset`/`clockMode` — cloud clock-domain only.

## Findings (severity-ranked) + disposition

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| 1 | **HIGH** (LAN-conditional) | `SEED_COMPANION_CACHE` has no auth and no payload validation; seed-carried tombstones bypass the controller-access gate the other mutating handlers enforce. Any socket past the address allowlist can wipe rooms or force-overwrite state (arbitrarily large `lastUpdate` also freezes running elapsed via the clamp until SYNC/PATCH heals). | `main.ts:3227` (no gating), `:6064` (`_socket` ignored), tombstone path `:6085-6097`→`:701-716`; contrast `enforceControllerAccess` on SYNC/PATCH/TIMER_ACTION and `DELETE_ROOM` `:3248` | **Tracked** (auth-gate task). Loopback-only default limits blast radius; prioritize when LAN mode ships. Protocol change → owner sign-off + docs/interface.md. |
| 2 | MED | Seed gate defeated by `getRoomState`'s default `lastUpdate: Date.now()`: JOIN flushes before seed and initializes missing rooms with `Date.now()`, so the cloud seed's past `lastUpdate` fails `incomingTs > localTs` → **state seed silently no-ops for every never-cached open room**. Controllers heal via SYNC; viewer-only topologies (SYNC is controller-gated) keep zeroed state. | `UnifiedDataContext.tsx:3976-3986`, `main.ts:5418`, `:7021-7037`, gate `:6112-6114`, SYNC gate `:5974` | Fold into seed-contract fix (owner decision 3). |
| 3 | MED | Rich-seed store pollution is permanent (`{ ...existing, ...entry.state }` writes `startedAt`/`elapsedOffset`/`progress`/`clockMode`; SYNC spreads them forever; disk cache round-trips them; broadcast to clients). Latent wrong-elapsed read: a `ROOM_STATE_PATCH` switching `activeTimerId` without `currentTime` falls back to the **seeded, permanently-stale** `progress[nextId]`. | `main.ts:6116-6122`, `:521`, `:7377-7390`/`:7550`, fallback `:557-562`; validator accepts `activeTimerId`-only patches `:5942-5948` | Fold into seed-contract fix. No defect with current frontend (its patches always include `currentTime`, `UnifiedDataContext.tsx:5199-5210`); a third-party/older client triggers it. |
| 4 | LOW | Partial-state merge can pair a new `lastUpdate` with old elapsed (both optional in cloud `RoomState`) → wrong elapsed. Requires a legacy/partial Firestore doc. | shared-types `RoomState` optional `currentTime`/`lastUpdate` | Fold into seed-contract fix (validator: require finite `currentTime`+`lastUpdate` together). |
| 5 | LOW | Seed item gate rejects timers/cues lacking `updatedAt` even into an empty companion (`0 > 0` fails). Legacy items never reach the offline cache. | `main.ts:6133-6135`; pinned by mirror test `seedCompanionCache.test.ts:80-82` | Verify that's intended, not accidental. |
| 6 | INFO | `emitSyncRoomState`'s wire pair (live `currentTime` + cloud `lastUpdate`) is incoherent-by-design, safe only because SYNC re-anchors. #84 showed how easily it gets copied to a non-re-anchoring path. | `UnifiedDataContext.tsx:2999-3015` | Add a contract comment ("`lastUpdate` is arbitration metadata, not the elapsed anchor, on this payload"). |
| 7 | INFO | Seed test coverage is mirror-only (re-implements the logic instead of driving `handleSeedCompanionCache`/real `seedCompanion`). The #27 lesson (wire real handlers) hasn't reached the seed path. | `seedCompanionCache.test.ts` | Add real-handler characterization tests with the deliberate fix. |
| 8 | INFO | Cross-clock LWW in the seed gate (cloud writer clock vs companion-anchored local `lastUpdate`) can let stale cloud overwrite fresh local when the companion clock lags. | `docs/rebuild-progress.md` H-1b note | **Accepted by design** (H-1b "stale-source arbitration intentionally unchanged"). No action. |

## Deliberate fix recommendation (separate from the #84 refactor)

- **Frontend `seedCompanion`:** project to the lean contract with STORED values (copy `room.state.currentTime`/`lastUpdate` as-is; skip a room's `state` when `lastUpdate` is absent — never `?? Date.now()`; keep `activeLiveCueId`). Do NOT reuse sync's `computeCurrentTimeWithProgress` — that is the #84 defect.
- **Companion `handleSeedCompanionCache`:** replace `{ ...existing, ...entry.state }` with an explicit companion-shape projection; add a validator symmetric with `isValidSyncRoomStatePayload`; fix the gate-vs-default interaction (init unseen rooms with `lastUpdate: 0`, or bypass the gate for untouched defaults — check frontend arbitration consumers of the default first).
- **Companion characterization tests** (export the handler; drive socket-level like `main.handlers.test.ts`): rich seed → stored state has exactly the companion-contract keys; seed `(E0, T0)` running → `resolveCompanionElapsedForState(state, now) === E0 + (now − T0)` (the anti-#84 regression test); JOIN-then-seed on a fresh room → cloud state applies; seeded `progress` then `activeTimerId`-only PATCH → per owner decision.

## Owner decisions required
1. **Seed auth model** — require controller access / valid join token for seed (and specifically seed-carried tombstones)? (Protocol change; affects `docs/interface.md`.)
2. **`progress` in the seed contract** — keep it (useful for offline timer-switching; then the PATCH fallback stays and SYNC should refresh it) or drop it and delete the fallback. Current state (seeded once, never refreshed, silently read) is the worst combination.
3. **`getRoomState` default `lastUpdate`** — `0` vs `Date.now()`; also affects frontend snapshot arbitration (`snapshotTs`), so decide with that consumer in view.
