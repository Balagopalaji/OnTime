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
  - If ignored, requester can **Force Takeover** immediately (no timeout required).
  - Force takeover requires **re-auth OR room PIN**, even for same user.
- **Room PIN (optional):** per-room code for fast authorized takeover; set by room owner.
- **Viewer-only mode (optional):** hides takeover controls for observers who never want control.
- **Avoid accidental takeovers:** offer quick actions like “Create new room” or “Copy room” (with forced rename) as alternatives to taking over.

**Viewer sharing**
- Default QR and share URL point to `https://<web-app>/view/:roomId` (cloud viewer).
- LAN/offline viewer links are Phase 3 (see `docs/local-offline-lan-plan.md`).
- Phase 3 UI should offer a “Local network viewer” option (only when Companion is connected), with a warning about certificate trust.

## Show Control UI (Phase 2c)
- Live cue overlays and tech viewer variants are Show Control tier only.
- Presentation tracking displays slide progress (e.g., “7/24”) and video elapsed/remaining time.
- Video remaining time is derived from live cue metadata:
  - `videoDuration` (ms), `videoElapsed` (ms)
  - `videoRemaining` derived client-side if not provided

## Planned Phases (Roadmap)
- Phase 2: Electron controller + transport hardening + show-control core (`docs/phase-2-overview.md`).
- Phase 3: LAN offline viewers + manual run-of-show (“Show Planner”).
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
