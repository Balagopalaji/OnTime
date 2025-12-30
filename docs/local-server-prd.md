---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2025-12-30
Scope: Companion local server requirements (Electron/Node).
---

# OnTime Local Server (Companion) PRD

## Goals / Non-goals
**Goals**
- Provide a low-latency local relay for controller/viewer clients.
- Offer token-based auth for local connections.
- Persist room state for offline continuity.
- Support show-control signal emission (live cues, presentation updates) for Phase 2.

**Non-goals**
- Full LAN viewer distribution in Phase 1 (see `docs/local-offline-lan-plan.md`).
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
- Multi-controller connections are currently allowed (no lock enforcement). Phase 2b introduces controller lock + takeover enforcement.

## Phase 2b Authority Enforcement
- Companion enforces a single authoritative controller per room.
- Non-authoritative controllers receive `PERMISSION_DENIED` on write attempts.
- Lock state includes device + user identity, last heartbeat timestamp, and active controller id.
- Force takeover policy:
  - Immediate force requires **re-auth or room PIN** (even for same user).
  - If no response after timeout, force takeover allowed with confirmation (no PIN).
- Takeover attempts are logged in Companion cache for audit.
 - Controller request notifications are emitted to the active controller (event type TBD in `docs/interface.md`).

## Phase 2 Show Control Signals
- Companion emits `LIVE_CUE_CREATED`, `LIVE_CUE_UPDATED`, `LIVE_CUE_ENDED`, `PRESENTATION_LOADED`, and `PRESENTATION_UPDATE` events (see `docs/interface.md`).
- PowerPoint slide tracking:
  - Windows: COM API.
  - macOS: AppleScript (slide tracking only).
- PowerPoint video timing (elapsed/remaining) is sourced from Companion detection logic (Windows only; COM API + media hooks/polling as needed).
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
- Optional viewer-only Electron app (desktop LAN) to avoid browser trust prompts.

## Acceptance Criteria
- Valid tokens are required for local connections.
- State updates are broadcast reliably to connected clients.
- Cache restore works after Companion restart.
- Companion emits show-control updates with enough data to derive slide progress and video remaining time.
- Companion cache is versioned; migrations run on update with fallback to last good backup on failure.

## Out of Scope
- Protocol contracts (see `docs/interface.md`).
- Cloud persistence (see `docs/cloud-server-prd.md`).
- Frontend UX details (see `docs/client-prd.md`).
