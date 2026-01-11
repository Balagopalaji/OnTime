---
Type: Index
Status: current
Owner: KDB
Last updated: 2026-01-10
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

## Doc Creation Rules
- Prefer updating an existing doc when the scope fits (avoid new files by default).
- Create a new doc only for a new module/major feature area that does not fit existing scopes.
- Every new doc must include front matter (Type, Status, Owner, Last updated, Scope) and be added to this index.
- Update `docs/doc-matrix.md` when a new feature or doc is introduced.
- Do not create new subfolders under `docs/` without explicit approval.

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

## References
- `docs/local-mode.md` (parallel sync architecture)
- `docs/timer-logic.md` (authoritative timer math)
- `docs/edge-cases.md`
- `docs/cloud-lock-design.md` (cloud controller lock design)
- `docs/agent-handoff.md` (cross-device agent handoff log)

## Tasklists
- `docs/tasks.md`
- `docs/phase-2-tasklist.md`

## Archive Policy
- Archived docs are historical only and never sources of truth.
- If an archived doc conflicts with current docs, current docs win.
