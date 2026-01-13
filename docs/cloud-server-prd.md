---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2026-01-10
Scope: Cloud (Firebase) backend requirements and data model for OnTime.
---

# OnTime Cloud Server PRD

## Goals / Non-goals
**Goals**
- Provide persistent, globally accessible room/timer state.
- Enforce lock-holder writes via security rules while keeping viewer reads public (Milestone 5).
- Support parallel sync with Companion when available.

**Non-goals**
- Local Companion server behavior (see `docs/local-server-prd.md`).
- LAN viewer delivery (see `docs/local-offline-lan-plan.md`).

## Roles & Permissions
- **Controller (lock holder)**: Authenticated write access to room and timers.
- **Controller (non-authoritative)**: Read-only access; must request/force takeover.
- **Viewer**: Public read-only access (no auth required).

## User Flows
- Controller writes room/timer state to Firebase; viewers read via public link.
- Cloud state remains available for remote viewers when Companion is offline.

## Current Behavior (Reality)
- Firebase is the cloud persistence layer with public reads and authenticated writes.
- Cloud controller lock enforcement is not yet implemented (see Milestone 5).
- Data model fields are consumed by the frontend and mirrored by Companion.
- Sync behavior is coordinated with Companion per `docs/local-mode.md`.
- Timer math rules are defined in `docs/timer-logic.md`.

## Planned Phases (Roadmap)
- Milestone 5: Cloud controller lock enforcement (lock document + Cloud Functions + rules).
- Security rule refinements for new collections (live cues, sections, segments, show planner cues, crew chat).
- Role-based cue ownership (operators can edit only their role cues; TD/Director override).
- Cloud-to-Companion sync improvements (see `docs/local-mode.md`).

## Acceptance Criteria
- Viewer read access remains public and reliable.
- Lock-holder writes enforced by Firestore rules (Milestone 5).
- Data model fields match frontend expectations.

## Out of Scope
- WebSocket protocol details (see `docs/interface.md`).
- Companion token issuance and LAN handling.

## Legacy MVP Spec (Historical)
The legacy Firebase-only spec has been removed to avoid duplicating the canonical contract.
See `docs/interface.md` for the authoritative schema and rules. Use git history if you need the legacy text.
