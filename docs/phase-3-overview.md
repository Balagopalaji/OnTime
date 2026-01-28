---
Type: Plan
Status: planned
Owner: KDB
Last updated: 2026-01-27
Scope: Phase 3 plan for Show Controller definition, LAN offline viewers, and Show Planner build.
---

# Phase 3 Overview (OnTime)

Phase 3 focuses on defining and delivering the Show Controller/Planner experience, then shipping LAN offline viewers so the experience works in venues without reliable internet. The standalone PowerPoint video timer app is deferred until after Phase 3 core.

**Scope boundary:** Phase 3 covers Show Controller definition, LAN offline viewer infrastructure, and Show Controller build. It does not include the standalone PPT timer app or Phase 4 AI/undo-redo work.

## Goals
- Define Show Controller/Planner workflows, cue authority model, and viewer requirements before building LAN distribution.
- Deliver LAN offline viewers with secure pairing, trusted HTTPS, and role-bound tokens.
- Ship Show Controller/Planner features (sections, segments, cues, crew chat) with role-based viewer panels.
- Preserve timer logic invariants and parallel sync stability.
- Reinforce parallel sync principles (no single primary; timestamp arbitration with confidence window).

## Key Dependencies
- `docs/local-offline-lan-plan.md` (LAN viewer constraints and security).
- `docs/interface.md` (Phase 3 schema fields for sections, segments, cues, crew chat).
- `docs/local-mode.md` (parallel sync rules).
- `docs/timer-logic.md` (authoritative timer math).

## Scope Breakdown

### Must-have
- Show Controller definition pass (flows, data model, viewer requirements).
- LAN viewer infrastructure (Companion-served viewer bundle, HTTPS/WSS trust, pairing/tokens, allowlist, revocation).
- Show Controller/Planner build (sections/segments, cues, cue states/ack, crew chat, role-based viewer panels).
- Role-based permissions and gating aligned with tier strategy.

### Nice-to-have
- Viewer-only Electron app (trust-bypass) and controller second-display output (viewer-only).
- Prefer VLC for external video playback (fallback to default player).

### Deferred
- Standalone PowerPoint video timer app (see `docs/phase-3-standalone-ppt-timer.md`).
- Mobile LAN viewers until trust flow is proven.

## Milestones

### Phase 3A — Show Controller Definition
- **Goals:** clarify planner workflows and viewer requirements.
- **Key work:** confirm section/segment/cue semantics; define controller roles and permissions; document viewer panels and role filters.
- **Outputs:** PRD deltas, updated interface notes if gaps found, updated tasks.

### Phase 3B — LAN Offline Viewer Infrastructure
- **Goals:** secure and reliable offline viewer delivery on LAN.
- **Key work:** Companion-served viewer bundle (versioned path), HTTPS/WSS cert strategy, PNA/CORS headers, pairing + token issuance + revocation, private subnet allowlist, cache/versioning.
- **Defaults:** pairing code TTL 10 min, viewer token TTL 8 hours, max 20 devices per room (reusable until expiry unless revoked).
- **Outputs:** LAN viewer delivery working offline with role-bound tokens.

### Phase 3C — Show Controller Build
- **Goals:** deliver manual planning and cueing workflows.
- **Key work:** CRUD + ordering for sections/segments/timers, cues with trigger types and ack states, crew chat, viewer panels for upcoming cues, role scoping.
- **Outputs:** end-to-end planner usable in a live show context.

### Phase 3D — Hardening + Release
- **Goals:** stabilize, test, and document Phase 3 features.
- **Key work:** reliability checks, performance targets, QA checklists, doc updates.

## Phase 2 Carryover (Explicitly In Scope)
- Tier selection UI (target: Phase 3A/3C).
- Viewer-only Electron build target (target: Phase 3B).
- Crash recovery banner on force-quit relaunch (target: Phase 3A/3D).
- Auto-update pipeline for Electron controller (target: Phase 3D).
- RAM target reduction work for Minimal mode (target: Phase 3D).
- macOS version bump step (target: Phase 3D).
- Viewer second-display option (fullscreen) for internal workflows (target: Phase 3C).
- UI polish pass with gating copy clarity (target: Phase 3D).
- Prefer VLC for external video playback when available (target: Phase 3C).

## Success Criteria
- LAN viewers load offline via HTTPS on private subnets and remain read-only.
- Pairing tokens expire and revocation survives Companion restart.
- Show Controller workflows cover real show needs without breaking timer math or sync.
- Parallel sync remains stable (no drift, queue replay regressions, authority flapping).
