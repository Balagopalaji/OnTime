# Companion Coupling Map

_Started: 2026-07-04. Partial map for the next Stage 1b units._

This document is intentionally not a full taxonomy of `companion/src/main.ts`. It records enough verified
coupling evidence to pick the next subsystem-sized unit without returning to blind helper shaving.

Classifications are hypotheses to confirm at carve time:

- **core / byte-faithful:** keep characterize-first, byte-faithful or near-byte-faithful extraction.
- **leaf-candidate:** can likely move behind a tested boundary, then be rewritten internally after that boundary holds.
- **unclear:** add or tighten characterization before moving.

Each row includes direct and transitive coupling: stores, events/routes, startup/shutdown hooks, and
disk/process effects.

## Current Findings

| Region | Classification | Coupling Evidence | Next Step |
| --- | --- | --- | --- |
| Disk room cache (`loadRoomCache`, `writeRoomCache`, debounce/flush) | **leaf-candidate, adapter only** | No socket events are owned by cache functions, but the store footprint is broad. `loadRoomCache` / `writeRoomCache` read or write `roomStateStore`, `roomTimersStore`, `roomCuesStore`, `roomControlAuditStore`, `roomPinStore`, `roomOwnerStore`, `roomViewerTokenStore`, `roomTombstoneStore`, and `lastWriteTs` (`companion/src/main.ts:7734`, `companion/src/main.ts:7944`). Cache invalidation is transitive: `appendControlAudit` receives `scheduleRoomCacheWrite` through deps (`companion/src/main.ts:1159`, `companion/src/control-audit-utils.ts:21`), and room/timer/cue helpers schedule writes when creating or normalizing stores (`companion/src/main.ts:6599`, `companion/src/main.ts:7299`). Startup loads cache before viewer/token setup (`companion/src/main.ts:3342`); shutdown flushes cache from `before-quit` without awaiting (`companion/src/main.ts:3568`). Disk effects include read/write, corrupted-cache backup, backup trimming, and debounce timers (`companion/src/main.ts:7737`, `companion/src/main.ts:7890`, `companion/src/main.ts:7921`). | Do **not** rewrite room mutation logic. First add/verify boundary tests, then extract a persistence adapter over an explicit `RoomCacheStores` bag plus injected filesystem, clock, logger, and timer APIs. |
| Loopback token endpoint (`/api/token`, token server start) | **leaf-candidate, tight boundary** | Pure token routes use static `token` / `expiresAt`, loopback checks, and origin validation; they do not touch room stores (`companion/src/main.ts:7325`, `companion/src/main.ts:7334`). Bootstrap creates/persists the companion token and starts token servers after socket servers (`companion/src/main.ts:3351`, `companion/src/main.ts:3384`). Token servers bind loopback HTTP `4001` and HTTPS `4441`, IPv4 and IPv6 (`companion/src/main.ts:7705`, `companion/src/main.ts:7720`), and are closed on `before-quit` (`companion/src/main.ts:3568`). | Clearest first leaf. Characterize `/api/token` behavior and server lifecycle, then extract only the token handler/server lifecycle. Keep pairing, file routes, and socket auth out of this PR. |
| `/api/status-window` | **leaf-candidate if injected** | Shares `createTokenHandler` and loopback/origin checks, but calls Electron UI through `showStatusWindow(token, expiresAt)` (`companion/src/main.ts:7406`, `companion/src/main.ts:7432`). | Include with token endpoint only if `showStatusWindow` is injected and tests pin headless/non-headless response shape. Otherwise split out later. |
| File routes (`/api/open`, `/api/file/exists`, `/api/file/metadata`) | **unclear / separate adapter candidate** | Shares loopback/CORS/auth helpers with token routes, but has filesystem and process effects: path validation, `open`/`cmd`/`xdg-open`, and `ffprobe` (`companion/src/main.ts:7444`, `companion/src/main.ts:7515`, `companion/src/main.ts:7589`, `companion/src/main.ts:3949`, `companion/src/main.ts:3981`). | Do not bundle with token server extraction. Map and characterize as a file-operations adapter later. |
| Pairing routes and viewer-token room management | **unclear / core-adjacent** | Pairing HTTP routes share auth helpers but read/write `roomViewerTokenStore`, `roomPairingCodeStore`, `roomClientStore`, emit room-client state, disconnect viewer sockets, and schedule cache writes (`companion/src/main.ts:1508`, `companion/src/main.ts:1564`, `companion/src/main.ts:1927`, `companion/src/main.ts:2033`, `companion/src/main.ts:2043`, `companion/src/main.ts:2092`). `JOIN_ROOM` also verifies viewer tokens and mutates viewer client state (`companion/src/main.ts:5518`, `companion/src/main.ts:5580`). | Add characterization before any move. Do not classify as a leaf from route names alone. |
| Control-lock / takeover / request / disconnect core | **core / byte-faithful** | Shares controller, client, pending-request, timeout, PIN, audit, and cache invalidation stores. Recent PRs deliberately carved only characterized units. | Keep serialized, characterize-first, and byte-faithful until the lock/request seam is stable. No stale-heartbeat takeover in Stage 1b. |
| Sync / room-state / timer-cue mutation core | **core / byte-faithful** | Socket handlers mutate `roomStateStore`, timer/cue maps, tombstones, pins, and emit room deltas/events while scheduling cache writes (`companion/src/main.ts:6247`, `companion/src/main.ts:6368`, `companion/src/main.ts:6502`, `companion/src/main.ts:6599`). | Keep serialized and test-led. Do not rewrite from PRDs. |

## Recommended Next Unit

The next implementation PR should target the **loopback token endpoint** only:

1. Add focused tests for `createTokenHandler` or a testable wrapper:
   - rejects non-loopback remote address;
   - rejects invalid origin;
   - handles `OPTIONS /api/token`;
   - returns `{ token, expiresAt }` for valid loopback `GET`;
   - supports safe `return=` HTML redirect without broadening origin rules.
2. Extract the token handler/server lifecycle behind injected `createServer` / `createHttpsServer` and close handles.
3. Leave pairing routes, viewer token store, `JOIN_ROOM`, file open/metadata routes, room cache, and tray UI out unless a narrower test proves the boundary.

The disk cache adapter is also a plausible leaf-candidate, but it should follow after a stronger
serialization contract because its direct store footprint is much wider.

---

## Appendix A — Disk room-cache spot-check (full)

_Read-only coupling spot-check (Codex explorer sub-agent, post-#57). Verdict + evidence preserved for the
U7 cache-adapter unit. Key claims re-verified by the orchestrator: `applyRoomTombstone` (main.ts:1003–1017)
spans persisted + live/session + control state; `control-audit` never crosses the wire._

**Verdict: LEAF-CANDIDATE** — a plausible characterize-boundary → extract candidate, but only as a
**persistence adapter over an explicit "room persistence state bag."** No socket ownership inside the cache
functions. The hidden coupling is *store breadth*, not control-flow ownership.

Evidence (`companion/src/main.ts`):
- **Constants/state/functions:** `CACHE_VERSION`, `CACHE_WRITE_DEBOUNCE_MS` (87–89); `cacheWriteTimer`,
  `lastWriteTs` (1189–1190); `getCachePath()` (1638–1640); `loadRoomCache`, `backupCorruptedCache`,
  `trimBackups`, `scheduleRoomCacheWrite`, `flushRoomCache`, `writeRoomCache` (7734–7977).
- **Direct store footprint:** `loadRoomCache()` writes `roomStateStore`, `roomTimersStore`, `roomCuesStore`,
  `roomControlAuditStore`, `roomPinStore`, `roomOwnerStore`, `roomViewerTokenStore`, `roomTombstoneStore`,
  `lastWriteTs` (7774–7879). `writeRoomCache()` reads those persisted stores + writes `lastWriteTs`
  (7944–7973).
- **Transitive/helper coupling:** `controlAuditDeps` injects `scheduleRoomCacheWrite` into `appendControlAudit`
  (1160–1163); `getRoomTimers`, `normalizeTimerOrder`, `getRoomCues`, `getRoomState` create/mutate backing
  stores and schedule cache writes (6599–6654, 7299–7322).
- **⚠️ `applyRoomTombstone()` (1003–1017) is broader than disk cache** — it deletes persisted stores PLUS
  live/session stores (`liveCuesStore`, `roomControllerStore`, `roomClientStore`, `pendingHandshakeStore`,
  `roomPairingCodeStore`) and calls `clearPendingControlRequest(roomId, 'room_unsubscribed')`, then schedules
  persistence. **It is a cross-cutting domain op that ends in a cache write — it must NOT be pulled into the
  cache adapter; only its trailing `scheduleRoomCacheWrite()` is the adapter touchpoint.**
- **Socket events:** none owned by cache functions. Cache writes are *triggered* by socket/API handlers
  (3508–3527): `SYNC_ROOM_STATE`, `SEED_COMPANION_CACHE`, `ROOM_STATE_PATCH`, timer/cue CRUD/reorder, control
  events, `SET_ROOM_PIN`, `DELETE_ROOM`.
- **Startup/shutdown:** `await loadRoomCache()` after app/settings/PPT setup, before viewer/token setup
  (3338–3345); `void flushRoomCache()` (not awaited) in `app.on('before-quit')` (3568–3577).
- **Disk/process effects:** path via `process.platform`/`APPDATA`/`os.homedir()`/`path.join`
  (1613–1639); `fs.readFile`, `JSON.parse`, `fs.mkdir`, `fs.copyFile`, `fs.readdir`, `fs.unlink`,
  `fs.writeFile` (7737, 7892–7915, 7941–7971); `setTimeout`/`clearTimeout` debounce (7921–7935).

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

_Read-only coupling spot-check (Codex explorer sub-agent, post-#57). Verdict + evidence preserved for the U3
`/api/token` unit. Key claim re-verified by the orchestrator: `verifyTokenPayload` (main.ts:3667) is shared by
the HTTP auth path AND socket `JOIN_ROOM` (5518); `authorizeRequest` (3813) is used by pairing (1928/1978/
2015/2063) and file routes (7466/7537/7611), NOT by `createTokenHandler`._

**Verdict: LEAF-CANDIDATE, with a tight boundary.** The loopback token server itself is extractable, but
"local HTTP/auth-ish" must NOT include pairing/viewer-token room management or Socket.IO join semantics in the
first PR.

Evidence (`companion/src/main.ts`):
- **Constants/state:** token constants/origins (65, 69, 71); server handles (985); `currentToken`,
  `currentTokenExpiresAt`, `jwtSecret` (1185).
- **Token lifecycle:** `generateJwt`, `persistToken`, `saveTokenToKeychain`, encrypted-file fallback (1471,
  1590, 2663, 2695).
- **Auth/CORS helpers (SHARED — keep in `main.ts`):** `isLoopback`, `parseAllowedOrigins`, `validateOrigin`,
  `verifyTokenPayload`, `authorizeRequest`, `authorizeCorsOnly` (2763, 2834, 2847, 3667, 3813). ⚠️
  `verifyTokenPayload` is also used by socket `JOIN_ROOM` incl. viewer-token checks + writes to
  `roomViewerTokenStore` (5518, 5579); `verifyTokenPayload` accepts BOTH `sub === 'companion'` and
  `sub === 'viewer'` (3672). Do NOT extract these helpers with the token server — `JOIN_ROOM`, pairing, and
  file routes all depend on them (a shared auth module is a separate later unit).
- **Routes:** token server `GET`/`OPTIONS /api/token` + optional HTML redirect via `return` (7334);
  `GET`/`OPTIONS /api/status-window` opens an Electron status window via `showStatusWindow` (7406) — leaf only
  if `showStatusWindow` is injected; file routes `/api/open`, `/api/file/exists`, `/api/file/metadata`
  (7444/7515/7589) share the same local auth — separate adapter, leave out; pairing routes live on the
  viewer/socket HTTP server but use the same auth helpers (1927).
- **Startup/shutdown:** bootstrap creates token, persists secret/settings, creates tray, starts socket then
  token servers (3351, 3384); token servers bind loopback HTTP 4001 + HTTPS 4441, IPv4 and IPv6 (7705, 7720);
  closed on `before-quit` (3568).
- **Disk/process effects:** JWT secret → settings (3357, 1701); token → keychain or encrypted file (1590,
  2687); file routes can spawn `open`/`cmd`/`xdg-open` and run `ffprobe` (3949, 3981).

**Suggested PR scope:** extract only companion-token lifecycle (generate/verify-companion/persist), the
loopback/CORS authorization *usage* for `/api/token`, and token-server creation/start/close. Optionally
`/api/status-window` only via injected `showStatusWindow`. Leave out pairing routes, viewer token store,
`JOIN_ROOM`, room cache, and file open/metadata routes.

**Boundary tests:** rejects non-loopback remote address; rejects invalid origin; handles `OPTIONS /api/token`;
returns `{ token, expiresAt }` for valid loopback `GET`; supports safe `return=` HTML redirect without
broadening origin rules; `authorizeRequest` accepts only companion JWT, rejects viewer JWT; server lifecycle
starts both IPv4/IPv6 handles and closes them without touching room/socket stores.
