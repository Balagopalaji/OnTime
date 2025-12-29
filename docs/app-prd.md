---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2025-12-29
Scope: End-to-end product requirements for OnTime (Client + Cloud + Local).
---

# OnTime App PRD

## Goals / Non-goals
**Goals**
- Provide reliable timer control and viewing for live events.
- Support dual-sync operation: Firebase (cloud) + Companion (local).
- Keep public viewer access simple while enforcing controller permissions.

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
- LAN viewer hosting and pairing (see `docs/local-offline-lan-plan.md`).
- Show-control features and tiered capabilities (see `docs/phase-2-overview.md`).

## Acceptance Criteria
- Controller and viewer stay in sync with deterministic timer math.
- Viewer access remains public and stable.
- Companion and cloud can both serve as viable sources with safe fallback.

## Out of Scope
- Detailed protocol schemas (see `docs/interface.md`).
- Companion implementation specifics (see `docs/local-server-prd.md`).
