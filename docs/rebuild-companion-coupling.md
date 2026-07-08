---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-07-08
Scope: Verified coupling evidence for companion subsystem carve-outs.
---

# Companion Coupling Map

_Started: 2026-07-04. Updated 2026-07-08. Partial map for the next Stage 1b units._

This document is intentionally not a full taxonomy of `companion/src/main.ts`. It records enough verified
coupling evidence to pick the next subsystem-sized unit without returning to blind helper shaving.

Line numbers in `companion/src/main.ts` are intentionally avoided below in favor of **stable symbol names**;
the file has shed several carved-out modules (token server, control-lock / control-audit / pending-control
/ lock-handshake helpers) and will keep shrinking, so numeric anchors go stale. Symbols do not.

Classifications are hypotheses to confirm at carve time:

- **core / byte-faithful:** keep characterize-first, byte-faithful or near-byte-faithful extraction.
- **leaf-candidate:** can likely move behind a tested boundary, then be rewritten internally after that boundary holds.
- **extracted:** already moved behind a tested boundary into its own module.
- **unclear:** add or tighten characterization before moving.

Each row includes direct and transitive coupling: stores, events/routes, startup/shutdown hooks, and
disk/process effects.

## Current Findings

| Region | Classification | Coupling Evidence | Next Step |
| --- | --- | --- | --- |
| Disk room cache (`loadRoomCache`, `writeRoomCache`, debounce/flush) | **leaf-candidate, adapter only** | No socket events are owned by cache functions, but the store footprint is broad. `loadRoomCache` / `writeRoomCache` read or write `roomStateStore`, `roomTimersStore`, `roomCuesStore`, `roomControlAuditStore`, `roomPinStore`, `roomOwnerStore`, `roomViewerTokenStore`, `roomTombstoneStore`, and `lastWriteTs` (both in `companion/src/main.ts`). Cache invalidation is transitive: `appendControlAudit` receives `scheduleRoomCacheWrite` through `AppendControlAuditDeps` (`companion/src/control-audit-utils.ts`), and room/timer/cue helpers schedule writes when creating or normalizing stores (`getRoomTimers`, `normalizeTimerOrder`, `getRoomCues`, `getRoomState` in `companion/src/main.ts`). Startup loads cache (`loadRoomCache`) before viewer/token setup; shutdown flushes cache from `before-quit` (`flushRoomCache`, not awaited). Disk effects include read/write, corrupted-cache backup (`backupCorruptedCache`), backup trimming (`trimBackups`), and debounce timers (`scheduleRoomCacheWrite`). | Do **not** rewrite room mutation logic. First add/verify boundary tests, then extract a persistence adapter over an explicit `RoomCacheStores` bag plus injected filesystem, clock, logger, and timer APIs. |
| Loopback token endpoint (`/api/token`, token server start) | **extracted → `companion/src/token-server.ts`** | Token routes now live in `companion/src/token-server.ts` (`createTokenHandler`, `startTokenServer`, `startSecureTokenServer`): the `/api/token` + `/api/status-window` branches, an injected loopback gate (`IsLoopbackFn`) and origin validation (`ValidateOriginFn`), `OPTIONS` handling, and IPv4/IPv6 server lifecycle on loopback HTTP `4001` and HTTPS `4441`. They do not touch room stores. `companion/src/main.ts` retains only composition roots (`createTokenHandler`, `startTokenServer`) that build the deps and delegate to the module. Bootstrap persists the companion token and starts the token servers after the socket servers; servers are closed on `before-quit`. | Done. Keep pairing, file routes, and socket auth (`verifyTokenPayload`, `authorizeRequest`) in `companion/src/main.ts` — they remain shared with `JOIN_ROOM` and file/pairing routes. |
| `/api/status-window` | **extracted with token endpoint** | Served from `companion/src/token-server.ts` only when an optional `showStatusWindow` hook is injected (a headless-mode predicate gates the Electron window); reuses the same loopback/origin checks as `/api/token`. | Done — included in the token-server extraction via the injected `showStatusWindow` + headless predicate. |
| File routes (`/api/open`, `/api/file/exists`, `/api/file/metadata`) | **unclear / separate adapter candidate** | Shares loopback/CORS/auth helpers with token routes, but has filesystem and process effects: path validation, `open`/`cmd`/`xdg-open`, and `ffprobe`. | Do not bundle with the token server (already extracted). Map and characterize as a file-operations adapter next. |
| Pairing routes and viewer-token room management | **unclear / core-adjacent** | Pairing HTTP routes share auth helpers but read/write `roomViewerTokenStore`, `roomPairingCodeStore`, `roomClientStore`, emit room-client state, disconnect viewer sockets, and schedule cache writes. `JOIN_ROOM` also verifies viewer tokens and mutates viewer client state. | Add characterization before any move. Do not classify as a leaf from route names alone. |
| Control-lock / takeover / request / disconnect core | **core / byte-faithful** | Shares controller, client, pending-request, timeout, PIN, audit, and cache invalidation stores. Recent PRs deliberately carved only characterized units (`control-lock-utils.ts`, `control-audit-utils.ts`, `pending-control-timeout-utils.ts`, `lock-handshake-utils.ts`). | Keep serialized, characterize-first, and byte-faithful until the lock/request seam is stable. No stale-heartbeat takeover in Stage 1b. |
| Sync / room-state / timer-cue mutation core | **core / byte-faithful** | Socket handlers mutate `roomStateStore`, timer/cue maps, tombstones, pins, and emit room deltas/events while scheduling cache writes. Cue CRUD (`handleCreateCue`, `handleUpdateCue`, `handleDeleteCue`, `handleReorderCues`) is shipped and emits `CUE_CREATED`/`CUE_UPDATED`/`CUE_DELETED`/`CUES_REORDERED` plus `CUE_ERROR`. | Keep serialized and test-led. Do not rewrite from PRDs. |

## Recommended Next Unit

The **loopback token endpoint** unit has shipped as `companion/src/token-server.ts` (`createTokenHandler`,
`startTokenServer`, `startSecureTokenServer`), with `companion/src/main.ts` retaining only composition roots.

The next implementation PR should target the **disk room-cache adapter** described in Appendix A:

1. Extract only the disk cache adapter + scheduler, not room mutation logic.
2. Inject a deps object: cache-path resolver, fs-like API, clock, logger, debounce-timer API, and a
   `RoomCacheStores` bag for the persisted maps.
3. Leave socket handlers and domain helpers in `companion/src/main.ts`, passing `scheduleRoomCacheWrite`
   back as the persistence-invalidation callback.
4. Add the boundary tests listed in Appendix A before moving anything.

The file-operations adapter (`/api/open`, `/api/file/exists`, `/api/file/metadata`) is the next plausible
leaf after the cache adapter.

---

## Appendix A — Disk room-cache spot-check (full)

_Read-only coupling spot-check (Codex explorer sub-agent, post-#57). Updated 2026-07-08 to de-anchor from
line numbers (symbols only). Verdict + evidence preserved for the U7 cache-adapter unit. Key claims
re-verified by the orchestrator: `applyRoomTombstone` spans persisted + live/session + control state;
`control-audit` never crosses the wire._

**Verdict: LEAF-CANDIDATE** — a plausible characterize-boundary → extract candidate, but only as a
**persistence adapter over an explicit "room persistence state bag."** No socket ownership inside the cache
functions. The hidden coupling is *store breadth*, not control-flow ownership.

Evidence (`companion/src/main.ts`, by symbol):
- **Constants/state/functions:** `CACHE_VERSION`, `CACHE_WRITE_DEBOUNCE_MS`; `cacheWriteTimer`,
  `lastWriteTs`; `getCachePath()`; `loadRoomCache`, `backupCorruptedCache`, `trimBackups`,
  `scheduleRoomCacheWrite`, `flushRoomCache`, `writeRoomCache`.
- **Direct store footprint:** `loadRoomCache()` writes `roomStateStore`, `roomTimersStore`, `roomCuesStore`,
  `roomControlAuditStore`, `roomPinStore`, `roomOwnerStore`, `roomViewerTokenStore`, `roomTombstoneStore`,
  `lastWriteTs`. `writeRoomCache()` reads those persisted stores + writes `lastWriteTs`.
- **Transitive/helper coupling:** `controlAuditDeps` injects `scheduleRoomCacheWrite` into `appendControlAudit`
  (`companion/src/control-audit-utils.ts`); `getRoomTimers`, `normalizeTimerOrder`, `getRoomCues`, `getRoomState`
  create/mutate backing stores and schedule cache writes.
- **⚠️ `applyRoomTombstone()` is broader than disk cache** — it deletes persisted stores PLUS
  live/session stores (`liveCuesStore`, `roomControllerStore`, `roomClientStore`, `pendingHandshakeStore`,
  `roomPairingCodeStore`) and calls `clearPendingControlRequest(roomId, 'room_unsubscribed')`, then schedules
  persistence. **It is a cross-cutting domain op that ends in a cache write — it must NOT be pulled into the
  cache adapter; only its trailing `scheduleRoomCacheWrite()` is the adapter touchpoint.**
- **Socket events:** none owned by cache functions. Cache writes are *triggered* by socket/API handlers:
  `SYNC_ROOM_STATE`, `SEED_COMPANION_CACHE`, `ROOM_STATE_PATCH`, timer/cue CRUD/reorder, control events,
  `SET_ROOM_PIN`, `DELETE_ROOM`.
- **Startup/shutdown:** `await loadRoomCache()` after app/settings/PPT setup, before viewer/token setup;
  `void flushRoomCache()` (not awaited) in `app.on('before-quit')`.
- **Disk/process effects:** path via `process.platform`/`APPDATA`/`os.homedir()`/`path.join` (`getCachePath`);
  `fs.readFile`, `JSON.parse`, `fs.mkdir`, `fs.copyFile`, `fs.readdir`, `fs.unlink`, `fs.writeFile`
  (`loadRoomCache`/`backupCorruptedCache`/`trimBackups`/`writeRoomCache`); `setTimeout`/`clearTimeout` debounce
  (`scheduleRoomCacheWrite`/`flushRoomCache`).

**Suggested PR scope:** extract only the disk cache adapter + scheduler, NOT room mutation logic. Inject a deps
object: cache-path resolver, fs-like API, clock, logger, debounce-timer API, and a `RoomCacheStores` bag for
the persisted maps. Leave socket handlers and domain helpers in `main.ts`, passing `scheduleRoomCacheWrite`
back as the persistence-invalidation callback.

**Boundary tests to add first:** load valid v2 cache populates all persisted stores; version mismatch / no
rooms is ignored; expired viewer tokens and expired tombstones are pruned/skipped; active tombstones delete
room/timer/cue data; corrupted cache is backed up and old backups trimmed to 3; write serializes sorted
timers/cues + audit/pins/owners/tombstones/viewer-tokens; debounce coalesces writes; flush clears the pending
timer and writes once.

---

## Appendix B — Loopback token / local HTTP spot-check (full)

_Read-only coupling spot-check (Codex explorer sub-agent, post-#57). Updated 2026-07-08: this unit has been
extracted; line numbers replaced with symbols. Verdict + evidence preserved. Key claim re-verified by the
orchestrator: `verifyTokenPayload` is shared by the HTTP auth path AND socket `JOIN_ROOM`; `authorizeRequest`
is used by pairing and file routes, NOT by `createTokenHandler`._

**Verdict: EXTRACTED → `companion/src/token-server.ts`.** The loopback token server itself is now extracted.
"Local HTTP/auth-ish" must NOT have included pairing/viewer-token room management or Socket.IO join semantics,
and it did not — those remain in `companion/src/main.ts`.

Evidence (`companion/src/main.ts`, by symbol; extracted routes now in `companion/src/token-server.ts`):
- **Constants/state:** token constants/origins; server handles; `currentToken`, `currentTokenExpiresAt`,
  `jwtSecret`.
- **Token lifecycle:** `generateJwt`, `persistToken`, `saveTokenToKeychain`, encrypted-file fallback.
- **Auth/CORS helpers (SHARED — kept in `companion/src/main.ts`):** `isLoopback`, `parseAllowedOrigins`,
  `validateOrigin`, `verifyTokenPayload`, `authorizeRequest`, `authorizeCorsOnly`. ⚠️ `verifyTokenPayload` is
  also used by socket `JOIN_ROOM` incl. viewer-token checks + writes to `roomViewerTokenStore`;
  `verifyTokenPayload` accepts BOTH `sub === 'companion'` and `sub === 'viewer'`. These helpers were NOT
  extracted with the token server — `JOIN_ROOM`, pairing, and file routes all depend on them (a shared auth
  module is a separate later unit).
- **Routes (extracted to `companion/src/token-server.ts`):** token server `GET`/`OPTIONS /api/token` + optional
  HTML redirect via `return`; `GET`/`OPTIONS /api/status-window` opens an Electron status window via the
  injected `showStatusWindow` hook (headless predicate gates it). File routes `/api/open`, `/api/file/exists`,
  `/api/file/metadata` share the same local auth and remain in `companion/src/main.ts` — separate adapter,
  left out; pairing routes live on the viewer/socket HTTP server but use the same auth helpers, also left out.
- **Startup/shutdown:** bootstrap creates token, persists secret/settings, creates tray, starts socket then
  token servers; token servers bind loopback HTTP 4001 + HTTPS 4441, IPv4 and IPv6 (`startTokenServer`,
  `startSecureTokenServer` in `companion/src/token-server.ts`); closed on `before-quit`.
- **Disk/process effects:** JWT secret → settings; token → keychain or encrypted file; file routes can spawn
  `open`/`cmd`/`xdg-open` and run `ffprobe` (still in `companion/src/main.ts`).

**Extraction scope (landed):** companion-token lifecycle (generate/verify-companion/persist), the
loopback/CORS authorization *usage* for `/api/token`, and token-server creation/start/close. `/api/status-window`
included via injected `showStatusWindow`. Left out (still in `companion/src/main.ts`): pairing routes, viewer
token store, `JOIN_ROOM`, room cache, and file open/metadata routes.

**Boundary tests (landed):** rejects non-loopback remote address; rejects invalid origin; handles
`OPTIONS /api/token`; returns `{ token, expiresAt }` for valid loopback `GET`; supports safe `return=` HTML
redirect without broadening origin rules; `authorizeRequest` accepts only companion JWT, rejects viewer JWT;
server lifecycle starts both IPv4/IPv6 handles and closes them without touching room/socket stores.
