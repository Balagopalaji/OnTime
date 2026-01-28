---
Type: Index
Status: current
Owner: KDB
Last updated: 2026-01-28
Scope: Canonical documentation index and taxonomy for the OnTime repo.
---

# OnTime Documentation Index

This index lists canonical documentation by type and links to the feature matrix.

## Taxonomy
- **PRD**: Product requirements (What/Why).
- **Interface**: Protocol contracts (How).
- **Plan**: Phased implementation roadmap.
- **Reference**: Authoritative logic or decisions.
- **Tasklist**: Execution tracking.
- **Index**: Doc indexes and matrices.

## Core Architecture
- **Parallel sync:** Dual-channel Cloud + Companion with timestamp-based conflict resolution and safe reconnect.

## Doc Creation Rules
- Prefer updating an existing doc when the scope fits (avoid new files by default).
- Create a new doc only for a new module/major feature area that does not fit existing scopes.
- Every new doc must include front matter (Type, Status, Owner, Last updated, Scope) and be added to this index.
- Update `docs/doc-matrix.md` when a new feature or doc is introduced.
- Do not create new subfolders under `docs/` without explicit approval.

## Which Doc Should I Use?
- `docs/local-mode.md`: Runtime behavior for local/parallel sync (local-first app mode).
- `docs/local-server-prd.md`: Companion server requirements (tokens, sockets, show-control signals).
- `docs/local-offline-lan-plan.md`: Phase 3 plan for LAN/offline viewer hosting (not current behavior).

## Indexes
- `docs/README.md` (this file)
- `docs/doc-matrix.md` (feature-to-doc matrix)

## PRDs
- `docs/app-prd.md` (overall product requirements)
- `docs/client-prd.md` (frontend requirements)
- `docs/cloud-server-prd.md` (Firebase cloud requirements)
- `docs/local-server-prd.md` (Companion requirements)

## Interface
- `docs/interface.md` (canonical protocol contract)

## Plans
- `docs/local-offline-lan-plan.md` (local/offline + LAN viewers)
- `docs/phase-2-overview.md`
- `docs/phase-3-overview.md`
- `docs/phase-4-overview.md`
- `docs/phase-3-unified-arbitration-plan.md` (parallel sync arbitration plan)
- `docs/phase-3-arbitration-roadmap.md` (arbitration implementation roadmap)
- `docs/phase-3-standalone-ppt-timer.md` (standalone PowerPoint video timer draft)

## References
- `docs/local-mode.md` (parallel sync architecture)
- `docs/timer-logic.md` (authoritative timer math)
- `docs/edge-cases.md`
- `docs/cloud-lock-design.md` (cloud controller lock design)
- `docs/agent-handoff.md` (cross-device agent handoff log)
- `docs/ppt-video-debug.md` (PowerPoint video timing debug notes)
- `docs/phase-3-decisions.md` (Phase 3 scope locks and open questions)
- `docs/phase-3-pairing-ux.md` (Phase 3 LAN viewer pairing UX)
- `docs/phase-3-bundle-strategy.md` (Phase 3 LAN viewer bundle strategy)
- `docs/phase-3-cert-trust-ux.md` (Phase 3 LAN viewer cert trust UX)
- `docs/phase-3-unified-arbitration-plan.md` (arbitration source of truth)
- `docs/phase-3-arbitration-research.md` (arbitration research summary)
- `docs/phase-3-arbitration-agent-guide.md` (arbitration agent guide)

## Tasklists
- `docs/tasks.md`
- `docs/phase-2-tasklist.md`
- `docs/phase-3-tasklist.md`
- `docs/phase-3-agent-prompts.md`

## Archive Policy
- Archived docs are historical only and never sources of truth.
- If an archived doc conflicts with current docs, current docs win.
