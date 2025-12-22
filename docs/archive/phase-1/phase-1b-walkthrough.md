> ⚠️ Deprecated
> Historical Phase 1 walkthrough. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Phase 1B Walkthrough (Token Auth, Cache, Offline Queue, Hybrid Sync)

Use this as a quick validation/checklist for Phase 1B.

## Prereqs
- Companion running (`npm run dev` in `companion`), fetch fresh token from `/api/token`.
- Frontend running (`npm run dev` in `frontend`), logged in to Firebase (ownerId matches your UID for rooms you write).

## 1) Token Auth
- `curl http://localhost:4001/api/token` with Origin `http://localhost:5173` returns token/expiresAt.
- Invalid token -> HANDSHAKE_ERROR on JOIN_ROOM.
- Tray “Copy token” works, token in sessionStorage on frontend.

## 2) State Persistence
- Perform timer actions (Start/Pause/Reset) to change state.
- Verify cache file: `~/Library/Application Support/OnTime/cache/rooms.json` (or OS equivalent).
- Restart Companion → ROOM_STATE_SNAPSHOT reflects prior state. Corrupt cache → backup created (`rooms.json.backup.*`).

## 3) Offline Queue
- Stop Companion (or disconnect WS), perform timer actions → queue depth rises; capped at 100 with warning.
- Restart Companion + Join → “📤 Syncing…” appears; queue drains to 0; actions replay in order.

## 4) Hybrid Sync (WS + Firestore)
- For `_version: 2` rooms, writes go to `/rooms/{roomId}/state/current`; legacy rooms write to root doc.
- Echo dedupe: deltas from our own clientId are skipped.
- Stop Companion → actions still write via Firestore; restart Companion → WS takes over.

## 5) Feature Flags Defaults
- New rooms: `_version: 2`, `tier: 'basic'`, `features: { localMode: true, showControl: false, powerpoint: false, externalVideo: false }`, seeded `state/current`.
- Legacy rooms (no `_version`): treated as v1; optional “Upgrade to v2” can be added later.

## 6) Firestore Rules (dev sanity)
- Owner-only writes to rooms/state; liveCues gated by showControl.
- For manual test rooms, set `ownerId` to your UID.

## Handy Paths
- Cache: `~/Library/Application Support/OnTime/cache/rooms.json` (macOS), `%APPDATA%\\OnTime\\cache\\rooms.json` (Windows), `~/.config/ontime/cache/rooms.json` (Linux).
- Token fallback: `~/Library/Application Support/OnTime/tokens.enc` (macOS) etc.
- Firestore state (v2): `/rooms/{roomId}/state/current`.
