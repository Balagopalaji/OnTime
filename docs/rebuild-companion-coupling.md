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
