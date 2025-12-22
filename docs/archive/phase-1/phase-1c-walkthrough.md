> ⚠️ Deprecated
> Historical Phase 1 walkthrough. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Phase 1C Walkthrough (File Ops, Timer CRUD, Migration, Packaging)

Use this as a quick validation/checklist for Phase 1C.

## Prereqs
- Companion running (`npm run dev` in `companion`) or installed build from `dist_out` after `npm run fetch-ffprobe && npm run dist`.
- Frontend running (`npm run dev` in `frontend`), authenticated as the room owner.
- ffprobe bundled or on PATH; if missing, `/api/file/metadata` returns a warning.

## 1) File Operations API
- `curl -i -X POST http://127.0.0.1:4001/api/open -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "{\"path\":\"/Users/YOU/Downloads/file.pdf\"}"` → `200 { "success": true }`.
- `curl -i --get http://127.0.0.1:4001/api/file/metadata -H "Authorization: Bearer $TOKEN" --data-urlencode "path=/Users/YOU/Downloads/video.mp4"` → duration/resolution; if ffprobe missing, expect `warning: "ffprobe missing"`.
- Invalid path outside home → `400 { "error": "invalid_path" }`; missing token/origin → `401 { "error": "unauthorized" }`.

## 2) Timer CRUD (WebSocket + Offline Queue)
- Via CompanionDataProvider (Controller/Companion test page): create/update/delete/reorder timers; multiple clients see updates immediately.
- Disconnect WS/Companion, perform actions → queue builds (cap 100) with warning; reconnect → replay in order, dedupe echoes by clientId.
- Firestore write-through: timers persist under `/rooms/{roomId}/timers/{timerId}`.

## 3) Room Migration (v1 → v2)
- Open legacy room (no `_version`) → “Upgrade to v2” banner in Dashboard.
- Trigger migration: root doc gains `tier/features/_version: 2`; state moves to `/rooms/{roomId}/state/current`; backup stored for rollback.
- Rollback (within 30 days) restores legacy doc/state.

## 4) Offline + Hybrid Sync
- `_version: 2` rooms: WS prioritized; Firestore fallback when WS down.
- Stop Companion → actions still write via Firestore; restart → WS resumes, echo dedupe skips self.
- Offline queue drains on reconnect; UI shows syncing badge.

## 5) Packaging & ffprobe Bundling (Maintainers)
- From `companion/`: `npm install && npm run fetch-ffprobe && npm run dist` → artifacts in `dist_out/` (`.dmg`, `.exe` NSIS, `.AppImage`).
- `fetch-ffprobe` pulls default LGPL ffprobe; override with vetted URLs via `FFPROBE_URL_MAC/WIN/LINUX` and keep license/attribution.
- Verify `companion/bin/ffprobe` exists before packaging; end users only install the artifacts (no npm).

## Handy Paths
- Cache: `~/Library/Application Support/OnTime/cache/rooms.json` (macOS), `%APPDATA%\\OnTime\\cache\\rooms.json` (Windows), `~/.config/ontime/cache/rooms.json` (Linux).
- Token fallback: `~/Library/Application Support/OnTime/tokens.enc` (macOS) etc.
- ffprobe bundle target: `companion/bin/ffprobe` (included via extraResources).

