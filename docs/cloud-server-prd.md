---
Type: PRD
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Cloud (Firebase) backend requirements and data model for OnTime.
---

# OnTime Cloud Server PRD

## Goals / Non-goals
**Goals**
- Provide persistent, globally accessible room/timer state.
- Enforce lock-holder writes via security rules while keeping viewer reads public (Milestone 5).
- Support parallel sync with Companion when available.
- Support operator access (invite code + approved operators + blocklist) for Phase 3 cues.

**Non-goals**
- Local Companion server behavior (see `docs/local-server-prd.md`).
- LAN viewer delivery (see `docs/local-offline-lan-plan.md`).

## Roles & Permissions
- **Controller (lock holder)**: Authenticated write access to room and timers (Show Control + Production tiers).
- **Controller (non-authoritative)**: Read-only access; must request/force takeover.
- **Operator**: Authenticated user approved via invite code; can write cues for their role (Phase 3).
- **Viewer (Cloud)**: Public read-only access (no auth required).
- **Viewer (LAN)**: Paired via QR/manual code; read-only via role-bound tokens (Companion-issued).

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
- Phase 3: security rules for sections, segments, cues, crew chat, operators, blocked, config/invite.
- Phase 3: `joinAsOperator` Cloud Function for invite validation and operator creation.
- Role-based cue ownership (operators can edit only their role cues; TD/Director override).
- Cloud-to-Companion sync improvements (see `docs/local-mode.md`).

## Acceptance Criteria
- Viewer read access remains public and reliable.
- Lock-holder writes enforced by Firestore rules (Milestone 5).
- Operator access enforced by rules + Cloud Function validation.
- Data model fields match frontend expectations.

## Out of Scope
- WebSocket protocol details (see `docs/interface.md`).
- Companion token issuance and LAN handling.

## Legacy MVP Spec (Historical)
The legacy Firebase-only spec has been removed to avoid duplicating the canonical contract.
See `docs/interface.md` for the authoritative schema and rules. Use git history if you need the legacy text.
