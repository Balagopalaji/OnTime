---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-12
Scope: Phase 3 LAN viewer pairing UX spec.
---

# Phase 3 LAN Viewer Pairing UX

## Goals
- Provide a clear, low-friction pairing flow for LAN viewers.
- Keep viewer tokens read-only and short-lived.
- Offer QR and manual entry paths for reliability in venues.

## Entry Points
- **Companion UI (primary):** A "LAN Viewers" panel shows pairing status, QR code, and connected devices.
- **Controller UI (secondary):** A "Share LAN Viewer" action opens the same QR/code in the controller.

## Pairing Flow (Viewer Device)
1. Viewer opens the LAN URL shown in the QR/code.
2. Viewer enters a short pairing code (format: `XXXX-XXXX`, 8 chars, uppercase A-Z/0-9).
3. Companion issues a viewer token bound to the room and role.
4. Viewer connects via HTTPS/WSS using the viewer token.

## Manual Fallback
- If QR fails, operator reads the LAN URL and pairing code aloud.
- The viewer can manually enter both on a simple "Connect" screen.

## Token Rules
- Pairing codes TTL: 10 minutes (not persisted across Companion restart).
- Viewer tokens TTL: 8 hours (persisted in Companion cache).
- Revocation: operators can revoke a device token from the Companion UI; revocation takes effect immediately on reconnect.

## Device Management
- Companion UI lists connected viewers with device name, role, last seen.
- Operators can rename or revoke a viewer.

## Error States
- Invalid or expired pairing code: show "Code expired" and prompt to request a new code.
- Token revoked: show "Viewer disconnected" and return to connect screen.

## Open Questions
- Whether to allow device auto-reconnect without re-entering pairing code after restart (if token still valid).
- Whether pairing should be room-specific or global per Companion.
