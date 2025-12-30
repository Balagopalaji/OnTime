---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2025-12-30
Scope: Client (frontend) requirements and behavior for the OnTime app.
---

# OnTime Client PRD

## Goals / Non-goals
**Goals**
- Deliver a controller and viewer experience aligned with the current dual-sync architecture (Firebase + Companion).
- Keep public viewer access frictionless while enforcing owner-only control.
- Maintain deterministic timer math using the shared timer logic rules.
- Keep web and native controller UX visually consistent (shared colors, layout, and interactions).

**Non-goals**
- LAN viewer hosting and certificate management (see `docs/local-offline-lan-plan.md`).
- Room lock takeover UX beyond what is already implemented (tracked in plans).
- AI-assisted program ingestion (planned later).

## Roles & Permissions
- **Owner/Controller**: Authenticated user with write access to a room.
- **Viewer**: Public read-only access (no auth required).

## User Flows
- Create room → open controller → start/pause/reset timers → share viewer link.
- Viewer opens link → sees active timer and messages → no auth required.

## Current Behavior (Reality)
- Dual-connection model for data: Firebase + Companion, with mode bias defined in `docs/local-mode.md`.
- Viewer is public; controller is owner-only.
- Timer math and transitions follow `docs/timer-logic.md`.
- Edge-case handling and local caching behavior described in `docs/edge-cases.md`.

## Phase 2 UX (Electron Controller + Transport)
**Mode selector + status**
- Header status indicator with expandable dropdown (always visible during a show).
- LED-style status states using the existing app palette (reuse dashboard colors).
- Status mapping (existing palette):
  - Local+Cloud: success/green
  - Local only: info/blue
  - Cloud only: warning/amber
  - Reconnecting: warning/amber (pulse)
  - Offline: error/red
- Non-blocking banners on state change; auto-dismiss for non-critical states; never modal.

**Auto-connect**
- Always attempt Companion connection on launch (even in Cloud mode).
- If Companion is missing, continue in Cloud mode with a subtle “Companion not detected” state.

**First-run setup**
- Cloud works out of the box; Local mode is opt-in.
- If Local is selected and Companion is missing, show a contextual prompt with download link.

**Read-only remote controller**
- When local is authoritative, remote controllers show “View Only” banner; controls disabled.
- “Request Control” triggers the takeover flow (Phase 2b).
- Takeover prompt copy (Phase 2b):
  - “Room is being controlled elsewhere.”
  - “Controlled by: {deviceName}”
  - “Last active: {minutes} ago”
  - “Taking over will disconnect their session.”
  - Buttons: “Cancel” / “Take Over Control”

**Control handoff & takeover (Phase 2b)**
- **Hand Over (current controller initiates):** select target device and transfer control instantly.
  - Same-user device switch: one-click confirm.
  - Different user: confirm “Transfer control to {user}? They will have full control.”
- **Request Control:** sends a non-blocking notification to the current controller.
  - Requester sees a waiting state with countdown (e.g., 0:30).
  - **Force Takeover Now** is available immediately with **re-auth or room PIN**.
  - If no response after timeout, **Force Takeover** is allowed with confirmation (no PIN).
  - Prompt tone varies by last-active time (active vs. stale).
- **Room PIN (optional):** per-room code for fast authorized takeover; set by room owner.
- **PIN display (authoritative controller only):**
  - Show compact “PIN: 4821” in header by default.
  - Provide a hide toggle (default OFF) for operators who prefer to mask it.
  - If no PIN is set, show “PIN: Not set” with link to set one.
  - Hide PIN display when not authoritative.
  - Optional copy button when visible.
- **Viewer-only mode (optional):** hides takeover controls for observers who never want control.
- **Room in use guard:** when a different device has control, show a “Room in use” screen with safe alternatives:
  - **Start new room** (fresh empty room).
  - **Copy this room** (new room with timers copied + reset progress, auto-name “Copy of {name}” and forced rename).
  - **Request control** (non-blocking request + optional force takeover).
  - Only show this guard when an active controller is present (heartbeat < 90s). If stale, show softer “Room appears inactive” messaging.
- **Attention banner for takeover requests:**
  - Red/amber pulsing border, high-contrast copy, visible countdown.
  - Optional audio chime (default ON; can be disabled in settings).
- **Post-takeover notice:** displaced controller sees “Control transferred to {device} at {time}” with **Reclaim Control** action.
  - **Reclaim Control** follows the same takeover flow (request → wait/force).

**Viewer sharing**
- Default QR and share URL point to `https://<web-app>/view/:roomId` (cloud viewer).
- LAN/offline viewer links are Phase 3 (see `docs/local-offline-lan-plan.md`).
- Phase 3 UI should offer a “Local network viewer” option (only when Companion is connected), with a warning about certificate trust.

## Show Control UI (Phase 2c)
**Tier gating**
- Live cue overlays and tech viewer variants are Show Control tier only.

**Tech viewer roles**
- Built-in roles: LX, AX, VX, SM, TD, Director, FOH, Custom.
- Role selection highlights your cues and allows hiding other roles per operator.
- If no cues exist yet, show an empty state ("No cues configured yet").

**Cue list + states (read-only in Phase 2c)**
- Cues render from `rooms/{roomId}/cues` when present; authoring is Phase 3.
- State thresholds (defaults):
  - Future: > 2:00
  - Standby: 2:00 - 1:00 (show "STBY" badge)
  - Warning: 1:00 - 0:10 (pulse border)
  - Imminent: < 0:10 (strong pulse)
  - Go: 0:00 (flash, stays active until acknowledgment)
- Go state requires manual acknowledgment: **Done**, **Skip**, or **+30s** (delay the Go window).
- Completed cues are muted with checkmark; skipped cues are struck through.

**Presentation status panel**
- Shows slide progress (e.g., "7/24") and video timing.
- If no presentation is detected, show "No presentation detected" with a collapse option.

**Video timing display**
- Remaining time is the most prominent element.
- Pulse amber when < 30s remain; pulse red when < 10s remain.
- Video remaining time is derived from live cue metadata:
  - `videoDuration` (ms), `videoElapsed` (ms)
  - `videoRemaining` derived client-side if not provided

**Platform support**
- Windows: slide tracking + video timing.
- macOS: slide tracking only; show "video timing unavailable on macOS".

**Phase 2c layout (tech viewer)**
```
HEADER: Room | Timer Status | Role: [LX] | Connection | PIN: 4821 | Settings
---------------------------------------------------------------
MAIN DISPLAY                         | STATUS PANEL
Current timer (large)                | Slide 7/24
"Pastor Introduction"                | Video remaining 0:45
                                     | Progress bar
                                     | -------------------------
                                     | YOUR CUES (LX)
                                     | GO: Cue 12 [Done] [Skip] [+30s]
                                     | STBY Cue 13 in 1:30
                                     | -------------------------
                                     | OTHER CUES (collapsible)
                                     | AX Cue 8 in 0:30
                                     | VX Cue 5 in 1:00
                                     | [Scroll] [Jump to NOW]
```

**Phase 3 preview (Show Planner)**
- Left rundown panel with segments and nested cues.
- Cue timeline placement within segments.
- Crew chat widget (small, collapsible, optional audio notifications).
- Multi-room dashboard for breakout monitoring.
```
HEADER: Room | Timer Status | Role: [LX] | Connection | PIN: 4821 | Settings
--------------------------------------------------------------------------------
RUNDOWN (left)          | MAIN DISPLAY (center)        | STATUS PANEL (right top)
Segment list + cues     | Current timer (large)        | Slide 7/24
Current segment marked  | "Worship Set"                | Video remaining 0:45
Add segment button      |                               | Progress bar
                         |                               | ----------------------
                         |                               | YOUR CUES (LX)
                         |                               | GO: Cue 12 [Done] [Skip]
                         |                               | STBY Cue 13 in 1:30
                         |                               | ----------------------
                         |                               | OTHER CUES (collapsible)
                         |                               | AX Cue 8 in 0:30
                         |                               | VX Cue 5 in 1:00
                         |                               | ----------------------
                         |                               | CREW CHAT (collapsible)
                         |                               | TD: Hold cue 15
                         |                               | SM: Copy that
                         |                               | [Send]
```

## Planned Phases (Roadmap)
- Phase 2: Electron controller + transport hardening + show-control core (`docs/phase-2-overview.md`).
- Phase 3: LAN offline viewers + manual run-of-show (“Show Planner”), including crew chat and multi-room monitoring.
- Phase 4: AI-assisted program ingestion (image/PDF/Excel → auto-fill) and optional native viewer apps.

## Acceptance Criteria
- Controller actions update timers and messages for viewers without drift.
- Viewer route works without authentication and renders active timer state.
- Timer math remains consistent with `docs/timer-logic.md`.
- Status indicator reflects current transport state without blocking operator actions.

## Out of Scope
- Protocol contracts (see `docs/interface.md`).
- Companion server implementation details (see `docs/local-server-prd.md`).
- Cloud security rules (see `docs/cloud-server-prd.md`).

## Legacy MVP UI Spec (Pre-Phase 1D)
The original UI spec is preserved for reference here:
- `docs/archive/mvp-ui-spec.md`

This PRD should be reviewed alongside `docs/cloud-server-prd.md` to ensure end-to-end consistency.
