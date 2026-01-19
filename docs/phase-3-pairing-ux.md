---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Phase 3 LAN viewer pairing UX spec.
---

# Phase 3 LAN Viewer Pairing UX

## Goals
- Provide a clear, low-friction pairing flow for LAN viewers.
- Keep viewer tokens read-only and short-lived.
- Offer QR and manual entry paths for reliability in venues.
- Make controller flows and viewer panel behavior explicit for Phase 3A planning.

## Scope
- Documentation-only spec for pairing UX, viewer panels, and controller workflows.
- No schema or implementation changes in this pass.

## Entry Points
- **Companion UI (primary):** A "LAN Viewers" panel shows pairing status, QR code, and connected devices.
- **Controller UI (secondary):** A "Share LAN Viewer" action opens the same QR/code in the controller.

## Controller Workflows (Sections, Segments, Cues, Ack, Crew Chat)
### Sections and segments
1. Owner (TD/Director role) creates a section (session header) with title, optional planned time and notes.
2. Owner (TD/Director role) creates segments inside a section, orders them, and assigns planned start/duration.
3. Operators can view all sections/segments but do not edit (owner-only in Phase 3).
4. Reorder flow prompts when planned times exist (shift future, shift section, shift none).

### Cues
1. Owner (TD/Director role) or operator selects a segment or section to add a cue.
2. Cue creation requires role, trigger type, and title; optional notes.
3. Trigger type determines fields (timed offset, fixed time, follow, sequential, floating).
4. Role-based editing applies: operators can only edit their role's cues; TD/Director can edit all.

### Acknowledgment
1. Cues enter Standby/Warning/Imminent/Go based on time-to-cue.
2. At Go, operators can mark Done, Skip, or +30s delay (manual ack required).
3. Ack updates are visible to all roles and persist across refresh.

### Crew chat
1. Owner (TD/Director role) can send to all or filtered roles.
2. Operators can send to all or to specific roles; role-targeted messages are highlighted for that role.
3. Viewer clients read only; no send capability.

## Role-Based Viewer Panels and Filters
- **Owner/TD (Controller):** Sees full rundown, all cues, all roles, and crew chat. Can filter roles in the timeline.
- **Operator (Controller):** Sees full rundown read-only plus "Your Cues" panel; role filter defaults to their role.
- **Viewer (Cloud/LAN):** Read-only. Role filter restricted to assigned role (LAN token) or "All" (cloud public view).
- **Viewer-only Electron app:** Same as LAN viewer but avoids browser trust friction.

## Viewer Panel Spec (Text-Only)
### Panel layout
- Header: Room name, role badge, connection status.
- Main display: Active timer (large), segment title, optional message banner.
- Right panel: "Now Playing" live cue status (presentation/video).
- Bottom panel: "Upcoming Cues" list for selected role.
- Footer: "Jump to Now" action for cue list if scrolled.

### Panel behavior
- Live cues and manual cues never mix; separate panels.
- Role filter applies to Upcoming Cues only, not live cues.
- Show the next 3-5 cues by default; allow scroll for full list.
- Cue cards show title, trigger type, time-to-cue, and ack state.
- Imminent cues pulse (visual only); optional audio ping (nice-to-have).

## Pairing Flow (Viewer Device)
1. Viewer opens the LAN URL shown in the QR/code.
2. Viewer selects role (if not pre-bound by QR) and enters pairing code (`XXXX-XXXX`, uppercase A-Z/0-9).
3. Companion validates code and issues a viewer token bound to room + role.
4. Viewer connects via HTTPS/WSS using the viewer token.
5. Viewer enters read-only mode with role-based filters pre-selected.

## Manual Fallback
- If QR fails, operator reads the LAN URL and pairing code aloud.
- Viewer can manually enter both on a simple "Connect" screen.

## Trust Flow Placement (LAN)
- Trust guidance lives in the Companion "LAN Viewers" panel.
- Viewer-side shows a "Trust Required" screen when HTTPS/WSS fails, with retry and a short link back to the Companion guidance.
- No HTTP fallback.

## Token Rules
- Pairing codes TTL: 10 minutes (not persisted across Companion restart).
- Viewer tokens TTL: 8 hours (persisted in Companion cache).
- Revocation: operators can revoke a device token from the Companion UI; revocation takes effect immediately on reconnect.
- Token endpoint remains loopback-only; LAN pairing uses a separate pairing path, not `/api/token`.

## Device Management
- Companion UI lists connected viewers with device name, role, last seen.
- Owner can rename or revoke a viewer.
- Max 20 devices per room; warn when capacity reached.

## Error States
- Invalid/expired pairing code: show "Code expired" and prompt to request a new code.
- Token revoked: show "Viewer disconnected" and return to connect screen.
- Role mismatch: show "Role not allowed" and require re-pair.
- Trust failure: show "Secure connection required" with retry and guidance link.
- Not on LAN allowlist: show "Private network required" and block connection.

## Permissions (Phase 3)
- **Owner (TD/Director role):** Full CRUD on sections/segments/cues; timer control; room config; crew chat admin.
- **Operator:** Full CRUD on own role cues only; read-only for sections/segments and other roles; can send crew chat to all or targeted roles.
- **Viewer (Cloud):** Public read-only for timers, live cues, messages, and viewer panels.
- **Viewer (LAN):** Read-only via role-bound token; cannot send chat or control.

## Open Questions
- Whether to allow device auto-reconnect without re-entering pairing code after restart (if token still valid).
- Whether pairing should be room-specific or global per Companion.
