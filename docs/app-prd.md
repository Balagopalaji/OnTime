---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2026-01-27
Scope: End-to-end product requirements for OnTime (Client + Cloud + Local).
---

# OnTime App PRD

## Goals / Non-goals
**Goals**
- Provide reliable timer control and viewing for live events.
- Support dual-sync operation: Firebase (cloud) + Companion (local).
- Keep public viewer access simple while enforcing controller and operator permissions.
- Maintain a modular product structure (timer core, show control, planner) with tiered access.

**Non-goals**
- Advanced show-control integrations beyond current scope (see Phase 2 plans).
- Full LAN distribution without Companion (see `docs/local-offline-lan-plan.md`).

## Roles & Permissions
- **Owner/Controller**: Authenticated user who can create rooms, manage timers, and control playback.
- **Operator**: Authenticated user approved via invite code; can edit cues for their role only (Phase 3).
- **Viewer (Cloud)**: Public read-only access via shareable link.
- **Viewer (LAN)**: Paired via QR/manual code; read-only via role-bound tokens.

## User Flows
- Create room → open controller → manage rundown → start/pause/reset timers → share viewer link.
- Cloud viewer opens link → sees active timer, clock, and messages with no auth.
- LAN viewer pairs via QR/manual code → receives read-only token and connects over HTTPS/WSS (trust required).
- Local mode: controller connects to Companion for low-latency updates; cloud remains as backup.
- Phase 3: owner generates invite code → operators join and edit role-specific cues.

## Current Behavior (Reality)
- Client uses dual data sources (Firebase + Companion) coordinated by `UnifiedDataContext`.
- Public viewer route is accessible without authentication.
- Timer math is anchored to shared rules in `docs/timer-logic.md`.
- Local mode flows and edge cases are documented in `docs/local-mode.md` and `docs/edge-cases.md`.

### Parallel Sync Principles (Core Architecture)
- **No single primary:** Firebase and Companion are equal sources of truth.
- **Dual-write always:** If a channel is available, we write to it. We do not switch write targets.
- **Timestamp arbitration:** Readers pick the freshest `lastUpdate`.
- **Confidence window:** Mode is only a tie-breaker when timestamps are within ~2s.
- **Safe reconnect:** A returning source must sync before it can override state.

## Controller Lock Enforcement (Target: Milestone 5)

Show Control + Production tiers will enforce single-controller lock to prevent concurrent writes from multiple controllers. Basic tier remains unlocked (multiple controllers allowed) until explicitly upgraded.

**Basic/Standalone behavior:** Basic rooms can operate as a simple local timer when offline (no cloud sync), but still use cloud sync + viewer URLs when online.

Companion mode lock is implemented; cloud mode lock is planned for Milestone 5.

**Lock enforcement applies to:**
- **Companion mode:** In-memory lock with Socket.IO events (existing).
- **Cloud mode:** Firestore lock document with Cloud Functions (Milestone 5).

**Behavior:**
- Only one controller can write to a room at a time.
- Second controller sees read-only UI with request/force takeover options.
- Heartbeat (30s) + stale detection (90s) ensures abandoned locks can be reclaimed.
- Viewers are unaffected; public read access always works.

**Future (Enterprise):**
- Shared control policy with authority levels (Owner/Operator/Assistant).
- See `docs/cloud-lock-design.md` for full design details.

**Planned (Follow-up): Cloud handover presence**
- Add cloud presence list (`rooms/{roomId}/clients/*`) so controllers can hand over without a request in cloud mode.
- Companion already provides this via `roomClients`; cloud will mirror the same UX once presence is available.

## Planned Phases (Roadmap)
- Phase 2: Electron controller + transport hardening + show-control core + cloud lock enforcement (see `docs/phase-2-overview.md`).
- Phase 3: LAN offline viewers + Show Planner (sections/segments, cues, crew chat), operator invite flow, and viewer-only Electron app (see `docs/local-offline-lan-plan.md` and Phase 3 docs).
  - LAN viewer delivery: Companion-served viewer bundle (versioned path) over HTTPS/WSS, private-subnet allowlist, and QR/manual pairing (code TTL 10 min, viewer token TTL 8 hours, max 20 devices).
  - Tier gating (Phase 3): Basic = timers only; Show Control = sections/segments + live cues; Production = manual cues + crew chat + multi-room dashboard.
- Phase 4: AI-assisted program ingestion + optional native viewer apps + undo/redo.

## Notes
- This is the end-to-end summary PRD; detailed UX and protocol requirements live in the client/local/server PRDs and `docs/interface.md`.

## Acceptance Criteria
- Controller and viewer stay in sync with deterministic timer math.
- Viewer access remains public and stable.
- Companion and cloud can both serve as viable sources with safe fallback.

## Out of Scope
- Detailed protocol schemas (see `docs/interface.md`).
- Companion implementation specifics (see `docs/local-server-prd.md`).
