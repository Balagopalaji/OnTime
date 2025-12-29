---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2025-12-29
Scope: Cloud (Firebase) backend requirements and data model for OnTime.
---

# OnTime Cloud Server PRD

## Goals / Non-goals
**Goals**
- Provide persistent, globally accessible room/timer state.
- Enforce owner-only writes via security rules while keeping viewer reads public.
- Support parallel sync with Companion when available.

**Non-goals**
- Local Companion server behavior (see `docs/local-server-prd.md`).
- LAN viewer delivery (see `docs/local-offline-lan-plan.md`).

## Roles & Permissions
- **Owner/Controller**: Authenticated write access to room and timers.
- **Viewer**: Public read-only access (no auth required).

## User Flows
- Controller writes room/timer state to Firebase; viewers read via public link.
- Cloud state remains available for remote viewers when Companion is offline.

## Current Behavior (Reality)
- Firebase is the cloud persistence layer with public reads and owner-only writes.
- Data model fields are consumed by the frontend and mirrored by Companion.
- Sync behavior is coordinated with Companion per `docs/local-mode.md`.
- Timer math rules are defined in `docs/timer-logic.md`.

## Planned Phases (Roadmap)
- Security rule refinements for new collections (e.g., live cues).
- Cloud-to-Companion sync improvements (see `docs/local-mode.md`).

## Acceptance Criteria
- Viewer read access remains public and reliable.
- Owner-only writes enforced by Firestore rules.
- Data model fields match frontend expectations.

## Out of Scope
- WebSocket protocol details (see `docs/interface.md`).
- Companion token issuance and LAN handling.

## Legacy MVP Spec (Historical)
The legacy Firebase-only spec has been removed to avoid duplicating the canonical contract.
See `docs/interface.md` for the authoritative schema and rules. Use git history if you need the legacy text.
