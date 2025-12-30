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
- Role selection is visible in the header for labeling and future filtering.

**Data model distinction**
- **Phase 2c:** Uses `liveCues` (presentation-driven, auto-generated from PowerPoint detection).
- **Phase 3:** Adds `cues` (manual rundown cues authored in Show Planner).
- Phase 2c shows presentation status only; cue lists and countdown states begin in Phase 3.

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
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER: Room | Timer | Role: [LX ▾] | ● Local+Cloud | PIN: 4821 | [⚙️]  │
├─────────────────────────────────────────────┬───────────────────────────┤
│                                             │ STATUS PANEL              │
│   MAIN DISPLAY                              │ ┌───────────────────────┐ │
│                                             │ │ ▶ Slide 7/24          │ │
│   ┌─────────────────────────────────┐       │ │ 🎬 Video: 0:45 left   │ │
│   │                                 │       │ │ ━━━━━━━━━░░░░ 75%     │ │
│   │          05:32                  │       │ └───────────────────────┘ │
│   │                                 │       │ (No presentation → show │
│   │    "Pastor Introduction"        │       │  "No presentation found")│
│   │                                 │       │                           │
│   └─────────────────────────────────┘       │ (Cue list begins Phase 3) │
└─────────────────────────────────────────────┴───────────────────────────┘
```

**Phase 3 preview (Show Planner)**
**Core concepts**
- Full rundown with **sections (sessions)** grouping segments (e.g., "Morning Session" → Speaker 1/2/3).
- Sections can carry optional **section-level cues** (e.g., "Open house lights at session start").
- Section cues use the same trigger types as segment cues; timed cues anchor to section start unless fixed_time is used.
- Unified cue timeline (all roles in place), with role-based styling and filters.
- Operators can create and edit their own cues; TD/Director can edit any cue.
- Crew chat widget for quick coordination.
- Multi-room dashboard for breakout monitoring.
- Planned start times define order; actual runtime can drift without changing the printed schedule.
- When a segment start time is edited, prompt to shift downstream times:
  - Shift all future segments
  - Shift until next break/section
  - Shift only this section
  - Don't shift (keep printed schedule)
- When dragging/reordering segments with planned times, prompt with the same options and include
  “Remember my choice” to avoid repeated prompts during rapid edits.
- If a segment has no planned time, allow drag reorder without any prompt.
- If order changes but planned times are kept, show a small “out of schedule order” badge.
- Each segment has a **default timer** by default; extra timers are optional and sequential.
- The default (master) segment timer is what viewers see by default; stage view can switch to an extra timer when needed.
- Segment start is triggered when the operator starts the segment **or** when any segment timer starts.
- Parallel timers are not supported in Phase 3; use a second room if a truly concurrent timer is required.

**Segment card behavior (Phase 3)**
- **Show mode (default):** compact cards for fast scanning during a show.
  - Title, planned start, duration.
  - Small cue badges per role (LX/AX/VX/SM) with counts.
  - Status chip (on time / behind / ahead).
- **Selected segment:** expands inline to show:
  - Notes, timers in the segment, and cue list.
  - “Add cue” / “Add timer” actions.
- **Edit mode:** explicit toggle (similar to QLab) that reveals reorder handles, edit/delete controls, and inline timeline editing.
  - Prevents accidental edits during live operation.

**Cue trigger types**
| Type | Behavior | Example |
| --- | --- | --- |
| timed | Fixed offset from segment/section start (default actual start) | "Lights up at 0:30" |
| fixed_time | Absolute clock time | "Must fire at 13:30" |
| sequential | Ordered, manual Go required | "After pastor finishes prayer" |
| follow | Auto-fires after another cue completes | "Fade out follows fade in" |
| floating | Approximate position, draggable | "Somewhere during worship" |
Notes:
- Timed cues default to **actual start**; operators can switch to **planned start** when needed.

**Cue ownership & permissions**
| Role | Own role cues | Other role cues | Segments | Timer control | Room config |
| --- | --- | --- | --- | --- | --- |
| TD/Director | Full CRUD | Full CRUD | Full CRUD | Full | Full |
| Operator (LX/AX/VX/SM) | Full CRUD | View only | View only | If delegated | None |
| Viewer | None | View only | View only | None | None |

**TD/Director command center (layout)**
```
HEADER: Room | Timer | Role: [TD ▾] | ● Local+Cloud | PIN: 4821 | [⚙️]
--------------------------------------------------------------------------------
RUNDOWN (left)        | MAIN DISPLAY (center)       | STATUS + CUES (right)
Opening Prayer        | NOW                         | ALL ROLES STATUS
▶ Worship Set ━━━━━   | 00:45 "Worship Set"         | LX: 3 pending
▸ Announcements       | NEXT: Announcements (3:00)  | AX: 2 pending
Message               |                             | VX: 1 pending
Closing               | CONTROLS: [⏮][▶][⏭][⏹]      | SM: 0 pending
[Add Segment]         | Timer: TD (you) [Delegate]  |
--------------------------------------------------------------------------------
TIMELINE (all roles, editable)
NOW | TRANSITION | NEXT SEGMENT
LX/AX/VX/SM cues in place; changeover zone highlighted
--------------------------------------------------------------------------------
CREW CHAT (expanded)
```

**Operator view (role-focused)**
```
HEADER: Room | Timer: SM (delegated) | Role: [LX ▾] | ● Local+Cloud | [⚙️]
--------------------------------------------------------------------------------
YOUR NEXT CUE (always visible)
● GO: House lights 50%   [Done] [Skip] [+30s]
--------------------------------------------------------------------------------
MAIN DISPLAY             | TIMELINE (unified, editable)
NOW / NEXT segment info  | Your cues large + highlighted; others compact + muted
Presentation panel       | Filters per role; drag to reposition your cues
```

**Timeline behavior**
- All cues remain in timeline order; other roles are compact but still in place.
- Your cues are larger, highlighted, and editable in-place.
- Filters can hide roles without reordering cues.
- Edited cues show "edited by {role}" with relative time.
- Offer a list view (top-to-bottom) for precise editing as an alternative to the timeline view.
- Extra segment timers appear as a small stack within the segment (sequential only).
- If multiple timers are active in a segment, operators can switch which timer is displayed on their view.
- Parallel timers are not supported; create a separate room if needed.

**Timer control delegation**
- TD/Director can delegate timer control to one operator at a time.
- Delegation levels: adjustments_only or full_control.
- All users see "Timer: {role} (delegated)" in header; audit entry recorded.

**Show Caller Mode (optional)**
- App provides standby/warning/GO calls with audio cues.
- Optional TTS ("Standby lighting cue 5") for budget shows without a director.
- Timed cues can auto-advance after GO; sequential cues remain manual.

**Phase 3 layout (full)**
```
HEADER: Room | Timer | Role: [LX] | Connection | PIN: 4821 | Settings
--------------------------------------------------------------------------------
RUNDOWN (left)          | MAIN DISPLAY (center)        | STATUS PANEL (right top)
Segment list + cues     | Current timer (large)        | Slide 7/24
Current segment marked  | "Worship Set"                | Video remaining 0:45
Add segment button      |                               | Progress bar
                         |                               | ----------------------
                         |                               | CUE TIMELINE (unified)
                         |                               | LX Cue 12 (highlighted)
                         |                               | AX Cue 8 (compact)
                         |                               | VX Cue 5 (compact)
                         |                               | ----------------------
                         |                               | CREW CHAT (collapsible)
                         |                               | TD: Hold cue 15
                         |                               | SM: Copy that
                         |                               | [Send]
```

**Cue list + states (Phase 3)**
- Phase 3 cue authoring in Show Planner; manual **acknowledgment works** (Done/Skip/+30s).
- State thresholds (defaults, configurable per room):
  - Future: > 2:00
  - Standby: 2:00 - 1:00 (show "STBY" badge)
  - Warning: 1:00 - 0:10 (pulse border)
  - Imminent: < 0:10 (strong pulse + optional audio ping)
  - Go: 0:00 (flash, stays active until acknowledgment)
- Sequential/follow/floating cues enter Standby when they are next for the role; Go is manual.
- Operators can mark their cues **Done/Skip** to cross them off; TD/Director can mark any cue.
- Go state requires manual acknowledgment: **Done**, **Skip**, or **+30s** (delay the Go window).
- Completed cues are muted with checkmark; skipped cues are struck through.

**Visual treatment (YOUR CUES vs OTHER CUES)**
- **Your role's cues:** Highlighted border (role color), enlarged text, pulsing animation when imminent.
- **Other roles' cues:** Normal size, muted/grayed styling, collapsible section.
- **Hidden roles:** Not displayed (configurable per operator).

**Audio notifications (optional, default ON)**
- Audio ping when your cue enters Imminent state (< 10s).
- Configurable in settings: enable/disable per role or globally.

**Cue list navigation**
- Scrollable list of upcoming cues.
- **"Jump to NOW"** button: Refocuses list to current/upcoming position after scrolling.

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
