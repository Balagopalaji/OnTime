# OnTime Documentation Index

## 📚 Quick Start Guide

### New to OnTime?
1. **Product Overview**: [`frontend-prd.md`](frontend-prd.md) + [`backend-prd.md`](backend-prd.md) (Current MVP)
2. **Phase 1 Architecture**: [`local-mode-plan.md`](local-mode-plan.md) → [`modularity-architecture.md`](modularity-architecture.md)
3. **Implementation**: [`tasks.md`](tasks.md) for current phase

### Starting Phase 1A Implementation?
1. [`local-mode-plan.md`](local-mode-plan.md) § 4 (Phased Implementation)
2. [`websocket-protocol.md`](websocket-protocol.md) (WebSocket API)
3. [`modularity-architecture.md`](modularity-architecture.md) (Feature flags & tiers)

---

## 📄 Core Documentation

### Product Requirements (Current MVP)
- [`frontend-prd.md`](frontend-prd.md) - React frontend spec (controller + viewer)
- [`backend-prd.md`](backend-prd.md) - Firebase data model + security rules

**Note:** PRDs describe the **current system** (no Companion App). Phase 1 docs below describe **future architecture**.

### Phase 1 Architecture (Local Mode + Show Control)
- **[`local-mode-plan.md`](local-mode-plan.md)** - **START HERE** - Companion App, offline mode, phases
- **[`modularity-architecture.md`](modularity-architecture.md)** - Feature flags, tiers, resource optimization
- **[`websocket-protocol.md`](websocket-protocol.md)** - Complete WebSocket API spec
- [`show-control-architecture.md`](show-control-architecture.md) - PowerPoint, live cues (Phase 2+)

### Decision Logs
- [`show-control-decisions.md`](show-control-decisions.md) - Design decisions for show control
- [`architecture-update-2025-12.md`](architecture-update-2025-12.md) - **CHANGELOG** - Modularity updates (Dec 2025)

### Task Management
- [`tasks.md`](tasks.md) - Current implementation checklist
- [`backend-tasks.md`](backend-tasks.md) - Backend-specific tasks

---

## 🔄 Data Model Evolution

### Current MVP (Firebase-only)
```
/rooms/{roomId} { activeTimerId, isRunning, startedAt, ... }
/rooms/{roomId}/timers/{timerId} { title, duration, order, ... }
```

### Phase 1 (Modular Architecture)
```
/rooms/{roomId} { tier, features }  ← Config (read once)
/rooms/{roomId}/state/current { activeTimerId, isRunning, ... }  ← Real-time
/rooms/{roomId}/liveCues/{id} { ... }  ← Show Control tier+
```

**Why?** Reduces sync overhead by 80% - config cached, only state syncs every second.

---

## 🎯 Implementation Phases

### Phase 1A: Proof of Concept (Weeks 1-2)
**Goal:** Offline timers via WebSocket  
**Read:** `local-mode-plan.md` § 4.1, `websocket-protocol.md` § 8.1

### Phase 1B: Production (Weeks 3-5)
**Goal:** Secure offline mode + tiers  
**Read:** `modularity-architecture.md` § 2-4; walkthrough: `phase-1b-walkthrough.md`

### Phase 1C: File Ops (Weeks 6-7)
**Goal:** Prep for show control  
**Read:** `local-mode-plan.md` § 4.3; implementation guide: `phase-1c-implementation-guide.md`

### Phase 1D: Main UI Local Mode + CI Packaging
**Goal:** Local Mode usable from the main UI + CI builds installers  
**Read:** walkthrough: `phase-1d-walkthrough.md`; implementation guide: `phase-1d-implementation-guide.md`

**Shipping decision (Phase 1):**
- Companion is a separate desktop app installed on the Controller/operator machine only.
- Local Mode requires Companion; cloud/Firebase mode remains available without it.
- Production Companion bundles `ffprobe` so video metadata works without requiring users to install FFmpeg separately (with proper third-party license attribution).
- Bundled `ffprobe` must come from an **LGPL-only** FFmpeg build (avoid GPL/nonfree unless explicitly approved and documented).

### Writing New Phase Guides
- Use `implementation-guide-playbook.md` to author future phase guides (structure, checklists, failure modes).

---

## 🔍 Common Questions

**Q: Which data model is correct?**  
PRDs = Current MVP | Architecture docs = Phase 1+ design

**Q: What's the difference between local-mode-plan and show-control?**  
`local-mode-plan` = Foundation (offline, WebSocket) | `show-control` = Advanced features (PowerPoint, Phase 2)

**Q: Where's the WebSocket spec?**  
[`websocket-protocol.md`](websocket-protocol.md)

---

## Known Issues

**Undo/Redo Temporarily Disabled**  
The undo/redo system is currently stubbed out (buttons do nothing). This was done to unblock Phase 1A development. See [`undo-redo-future-plan.md`](undo-redo-future-plan.md) for the implementation plan. Will be addressed after Phase 1C, before production.

---

## Environment Variables (Current MVP)
- `VITE_USE_MOCK`: `false` for Firebase
- `VITE_USE_FIREBASE_EMULATOR`: `true` for local dev
- Required: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, etc.

## Production Deployment (Phase 1)

### Firestore Rules
- Validate rules locally with the Firebase emulator (recommended before every deploy).
- Deploy rules: `firebase deploy --only firestore:rules`
- Verify in Firebase Console:
  - Owner-only writes still enforced for `/rooms/{roomId}`, `/timers`, `/state/current`, and `/migrationBackups`.
  - Viewer reads still work on `/room/:id/view`.

#### Firestore Rules Self-Test (copy/paste)
1. Start the emulator (or use your existing local setup):
   - `firebase emulators:start --only firestore`
2. Run the app against the emulator:
   - Set `VITE_USE_FIREBASE_EMULATOR=true` in `frontend/.env.local`
   - `cd frontend && npm run dev`
3. Sanity checks:
   - **Viewer access**: open a room viewer link in an incognito window and confirm it can read room + timers + state.
   - **Unauthorized write blocked**: in the incognito viewer, attempt any write action (create timer, rename timer) and confirm it fails.
   - **Owner write allowed**: in the authenticated controller, confirm room/timer/state writes succeed.
4. Migration checks (owner only):
   - Create a room as owner, then (in emulator data) set `_version` to `1`.
   - Click “Upgrade to v2” in Dashboard and confirm:
     - `/rooms/{roomId}` has `_version: 2` and `tier/features`
     - `/rooms/{roomId}/state/current` exists
     - `/rooms/{roomId}/migrationBackups/{backupId}` exists
   - Click “Rollback” and confirm root doc restores and `state/current` is removed.

### Companion App
- Ship Companion as a separate desktop app installed on the Controller/operator machine only.
- Produce signed installers per OS (manual distribution is fine for Phase 1; auto-update can be Phase 2+).
- Bundle `ffprobe` in production Companion builds so users do not need to install FFmpeg separately.
- Licensing: bundled `ffprobe` MUST be from an **LGPL-only** FFmpeg build (no GPL / no “nonfree” components) unless explicitly approved and documented.
- Packaging (maintainers):
  - From `companion/`: `npm install && npm run fetch-ffprobe && npm run dist` (outputs to `dist_out/`).
  - `fetch-ffprobe` downloads a default LGPL ffprobe; override via `FFPROBE_URL_MAC/WIN/LINUX` with a vetted LGPL-only binary and keep attribution.
  - End users install from the generated `.dmg` / `.exe` (NSIS) / `.AppImage`; they never run npm.

#### Companion API Self-Test (copy/paste)
1. Start Companion: `cd companion && npm run dev`
2. Fetch token:
   - `curl -s http://127.0.0.1:4001/api/token`
3. Test file open and metadata (macOS example):
   - `TOKEN='...'` (paste token)
   - `curl -i -X POST http://127.0.0.1:4001/api/open -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "{\"path\":\"/Users/YOU/Downloads/file.pdf\"}"`
   - `curl -i --get http://127.0.0.1:4001/api/file/metadata -H "Authorization: Bearer $TOKEN" --data-urlencode "path=/Users/YOU/Downloads/video.mp4"`
4. Security checks:
   - Try a path outside home (expect `400 { "error": "invalid_path" }`).
   - Try without `Authorization` header (expect `401 { "error": "unauthorized" }`).

### Frontend
- Keep Firebase credentials out of git; use `frontend/.env.local` with `VITE_` prefixes.
- Build: `cd frontend && npm run build`
- Deploy hosting (if applicable): `firebase deploy --only hosting`

## Manual QA Checklist
- Room CRUD: Create, list, delete
- Controller: Start/pause/reset timers, switch active timer
- Viewer: Open `/room/:id/view` unauthenticated, verify sync
- Offline: Simulate network loss, verify reconnection

## Production Checklist (Phase 1C “Done”)
- [ ] Firestore rules deployed and verified (unauthorized write blocked)
- [ ] Companion token auth working (WS + HTTP `/api/open`, `/api/file/metadata`)
- [ ] Hybrid sync working (WS primary, Firestore best-effort write-through)
- [ ] Offline mode tested (disconnect Companion or network; queue replays on reconnect)
- [ ] Room migration tested (v1 → v2) and rollback works (within 30 days)
- [ ] File operations tested (PDF open; video metadata returns duration when bundled ffprobe present)
- [ ] Logs contain audit signals but no secrets (no raw tokens)

## Troubleshooting
- “Missing or insufficient permissions” during migration/rollback usually means Firestore rules are not deployed or are missing `/migrationBackups` rules.
- If `/api/file/metadata` returns `{ "warning": "ffprobe missing" }`, it means `ffprobe` is not present on PATH (dev) or not bundled correctly (prod).
- If a viewer cannot see timers/state, confirm Firestore rules still allow public reads on `/rooms/{roomId}`, `/timers`, and `/state/current`.

## Phase 1 Release Notes (A/B/C)
- Local Mode foundation via Companion (WebSocket relay + disk cache)
- Token-based auth for local mode (JWT token via loopback `/api/token`)
- File operations API for attachments/media (`/api/open`, `/api/file/metadata`)
- Timer CRUD over WebSocket (create/update/delete/reorder) with offline queue replay
- v1 → v2 room migration with 30-day rollback using Firestore `migrationBackups`

**For detailed architecture navigation, see the full document tree above.**
