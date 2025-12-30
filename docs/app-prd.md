---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2025-12-30
Scope: End-to-end product requirements for OnTime (Client + Cloud + Local).
---

# OnTime App PRD

## Goals / Non-goals
**Goals**
- Provide reliable timer control and viewing for live events.
- Support dual-sync operation: Firebase (cloud) + Companion (local).
- Keep public viewer access simple while enforcing controller permissions.
- Maintain a modular product structure (timer core, show control, planner) with tiered access.

**Non-goals**
- Advanced show-control integrations beyond current scope (see Phase 2 plans).
- Full LAN distribution without Companion (see `docs/local-offline-lan-plan.md`).

## Roles & Permissions
- **Owner/Controller**: Authenticated user who can create rooms, manage timers, and control playback.
- **Viewer**: Read-only public access to room state via shareable link.

## User Flows
- Create room → open controller → manage rundown → start/pause/reset timers → share viewer link.
- Viewer opens link → sees active timer, clock, and messages with no auth.
- Local mode: controller connects to Companion for low-latency updates; cloud remains as backup.

## Current Behavior (Reality)
- Client uses dual data sources (Firebase + Companion) coordinated by `UnifiedDataContext`.
- Public viewer route is accessible without authentication.
- Timer math is anchored to shared rules in `docs/timer-logic.md`.
- Local mode flows and edge cases are documented in `docs/local-mode.md` and `docs/edge-cases.md`.

## Planned Phases (Roadmap)
- Phase 2: Electron controller + transport hardening + show-control core (see `docs/phase-2-overview.md`).
- Phase 3: LAN offline viewers + manual run-of-show (“Show Planner”) (see `docs/local-offline-lan-plan.md`).
- Phase 4: AI-assisted program ingestion + optional native viewer apps.

## Notes
- This is the end-to-end summary PRD; detailed UX and protocol requirements live in the client/local/server PRDs and `docs/interface.md`.

## Acceptance Criteria
- Controller and viewer stay in sync with deterministic timer math.
- Viewer access remains public and stable.
- Companion and cloud can both serve as viable sources with safe fallback.

## Out of Scope
- Detailed protocol schemas (see `docs/interface.md`).
- Companion implementation specifics (see `docs/local-server-prd.md`).
