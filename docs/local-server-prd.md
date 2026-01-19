---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Companion local server requirements (Electron/Node).
---

# OnTime Local Server (Companion) PRD

## Goals / Non-goals
**Goals**
- Provide a low-latency local relay for controller/viewer clients.
- Offer token-based auth for local connections.
- Persist room state for offline continuity.
- Support show-control signal emission (live cues, presentation updates) for Phase 2.
- Host LAN viewer bundle with secure pairing + HTTPS/WSS trust flow (Phase 3).

**Non-goals**
- LAN viewer distribution outside the Phase 3 plan (see `docs/local-offline-lan-plan.md`).
- Advanced show-control integrations beyond current scope.

## Roles & Permissions
- **Controller**: Authorized to issue timer actions and CRUD operations.
- **Viewer**: Read-only access to room state.

## User Flows
- Companion runs on the operator machine and exposes local WebSocket + token endpoints.
- Controller joins with token, syncs room state, and broadcasts updates to viewers.

## Current Behavior (Reality)
- Local WebSocket relay with token validation and room state cache.
- HTTP token endpoint on loopback with Origin allowlist.
- State persistence in Companion cache to survive restarts.
- Companion enforces a single authoritative controller per room (lock + takeover).
- Cloud controller lock enforcement is **not** implemented yet (Milestone 5; see `docs/cloud-lock-design.md`).
- Existing Companion trust flow modal + trust-page launch is available for local controller setup.

## Build & Run Notes (Companion + Controller)
- **Companion (local mode):**
  - Dev: `cd companion && npm run dev`.
  - Dist: `cd companion && npm run dist` or `npm run dist:dev` for `-dev.N`.
  - Token endpoint: `https://127.0.0.1:4441/api/token` (use Bearer token for `/api/open` + `/api/file/metadata`).
  - `ffprobe` missing returns `{"warning":"ffprobe missing","size":...}` (no crash).
  - Windows PPT timing uses `companion/bin/ppt-probe.exe` (STA helper); PowerShell fallback can’t enumerate Shapes.

- **Controller (Electron):**
  - Dev: `cd controller && npm run dev`.
  - Dist: `cd controller && npm run dist` or `npm run dist:dev` for `-dev.N`.
  - Frontend build is embedded via `npm run build:frontend` (uses `VITE_APP_BASE=./`).

## Phase 2b Authority Enforcement
- Companion enforces a single authoritative controller per room.
- Non-authoritative controllers receive `PERMISSION_DENIED` on write attempts.
- Lock state includes device + user identity, last heartbeat timestamp, and active controller id.
- Force takeover policy:
  - Immediate force requires **re-auth or room PIN** (even for same user).
  - If no response after timeout, force takeover allowed with confirmation (no PIN).
- Room PIN edits are **owner-only**; Companion caches `ownerId` (from JOIN_ROOM or first authenticated owner) to enforce offline.
- Takeover attempts are logged in Companion cache for audit.
- Controller request notifications are emitted to the active controller (event type TBD in `docs/interface.md`).

## Phase 2 Show Control Signals
- Companion emits `LIVE_CUE_CREATED`, `LIVE_CUE_UPDATED`, `LIVE_CUE_ENDED`, `PRESENTATION_LOADED`, and `PRESENTATION_UPDATE` events (see `docs/interface.md`).
- PowerPoint slide tracking:
  - Windows: COM API.
  - macOS: AppleScript (slide tracking only).
  - Local-only in Phase 2: PPT detection runs on the PowerPoint machine; remote operator control requires a LAN Companion bridge or cloud relay (planned).
- PowerPoint video timing (elapsed/remaining) is sourced from Companion detection logic (Windows only; COM API + media hooks/polling as needed).

**PowerPoint AppleScript troubleshooting (macOS)**
- **Automation permissions:** macOS must allow Companion to control **System Events** and **Microsoft PowerPoint** (System Settings → Privacy & Security → Automation).
- **Frontmost requirement (macOS-only):** slide tracking only updates when PowerPoint is the frontmost app. Background = no updates. Windows helper does not require foreground.
- **Idle behavior:** last known slide persists until PowerPoint closes; no idle timeout clears the status card.
- **String escaping:** the AppleScript is embedded in a JS template literal for `osascript -e`; JSON strings must use escaped quotes (`\"`). Do not remove backslashes or the script will fail to compile.
- **Known syntax pitfall:** errors like `Expected end of line but found class name (-2741)` usually mean a property name is not valid for the installed PowerPoint dictionary (e.g., `current slide` on some versions). Avoid unrecognized properties.
- **Supported slide index call (current implementation):** `current show position of slide show view of slide show window 1`.
- **Debug logs (dev-only):** create a file named `ppt.debug` in `~/Library/Application Support/ontime-companion` (Companion userData) to enable `ppt.log` and `ppt.script.applescript` output.
- **Log locations:** `ppt.log` captures osascript stdout/stderr; `ppt.script.applescript` captures the exact script passed to `osascript -e` for syntax debugging.
- **Discovery in Script Editor (safe validation):**
  - `tell application "Microsoft PowerPoint" to return properties of slide show view of slide show window 1`
  - `tell application "Microsoft PowerPoint" to return properties of slide show window 1`
  - If these fail, the dictionary likely differs; adjust the script to use only supported properties.
- Video timing fields are surfaced via live cue metadata (`videoDuration`, `videoElapsed`, optional `videoRemaining` in ms).
- If media duration is unavailable, the UI should show “Unknown duration” with a neutral state.

## Phase 2 File Operations
- `/api/open` opens a local file in the default app (token required).
- `/api/file/metadata` returns duration/resolution (token required).
- `/api/file/exists` validates path presence before open (token required).
- All endpoints must enforce path normalization, allowlist roots, and reject symlinks/network paths.

## Phase 2 Companion UX
- Menu bar/tray UI with quick status dropdown:
  - Companion mode (Minimal/Show Control/Production)
  - Connected clients count
  - Quick actions (restart, quit)
- Include Companion version in `HANDSHAKE_ACK`; client shows non-blocking warning for major mismatch.

## Planned Phases (Roadmap)
- Phase 2: show-control signal pipeline (live cues, presentation updates, slide progress, video elapsed/remaining time).
- Phase 3: LAN viewer hosting and pairing (cert strategy + static viewer bundle), see `docs/local-offline-lan-plan.md`.
- Phase 3: pairing defaults — pairing code TTL 10 min (not persisted across restart), viewer token TTL 8 hours, max 20 devices per room.
- Phase 3: companion cue queue for offline cue actions (dedicated queue, cap 150).
- Optional viewer-only Electron app (desktop LAN) to avoid browser trust prompts.
- LAN-only operator join is deferred; offline LAN mode remains owner-only for operator actions.

## Acceptance Criteria
- Valid tokens are required for local connections.
- State updates are broadcast reliably to connected clients.
- Cache restore works after Companion restart.
- Companion emits show-control updates with enough data to derive slide progress and video remaining time.
- Companion cache is versioned; migrations run on update with fallback to last good backup on failure.
- LAN viewers can pair via QR/manual and remain read-only with role-bound tokens.

## Out of Scope
- Protocol contracts (see `docs/interface.md`).
- Cloud persistence (see `docs/cloud-server-prd.md`).
- Frontend UX details (see `docs/client-prd.md`).
