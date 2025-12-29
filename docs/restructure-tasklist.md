---
Type: Tasklist
Status: current
Owner: KDB
Last updated: 2025-12-29
Scope: Execution checklist for documentation restructure and PRD alignment.
---

# Task: OnTime Documentation Restructure & PRD Alignment

Establish clear sources of truth and reconcile documentation with the current code reality.

## Checklist

- [ ] **Phase 0: Inventory & Reality Check**
    - [ ] Enumerate non-archive docs and map to implemented/planned features
    - [ ] **Exclude `docs/archive/` from Phase 0 inventory**
    - [ ] Identify conflicts and duplications
    - [ ] **Reality Check**: Verify "Current" features against code/tests; record mismatches in `docs/doc-matrix.md`
- [ ] Produce feature-to-doc matrix in `docs/doc-matrix.md` (**Columns**: Feature, Canonical Doc, Type, Status, Code Reference, Owner Verified, Verified Date, Checklist Reference)
- [ ] Generate `docs/review-checklist-phase-0.md` for all `Status: current` items; update doc-matrix after sign-off
- [ ] **Phase 1: Doc Taxonomy & Index**
    - [ ] Create `docs/README.md` (`Type: Index`) defining doc types (**PRD / Interface / Plan / Reference / Tasklist / Index**)
    - [ ] Link `docs/doc-matrix.md` (`Type: Index`) from `docs/README.md`
    - [ ] **Apply mandatory front matter** to ALL canonical docs:
        - `Type: PRD | Interface | Plan | Reference | Tasklist | Index`
        - `Status: current | planned | draft | deprecated`
        - **Note**: `Status: current` implies features are implemented and **verified against code/tests**.
        - `Owner` (team/person accountable)
        - `Last updated` (YYYY-MM-DD)
        - `Scope`
    - [ ] **Archive Reference Cleanup (Phase 1)**: Remove references to `docs/archive/` from `docs/README.md`
- [ ] **Phase 2: PRDs (Whole App)**
    - [ ] Define PRD template sections (Goals/Non-goals, Roles, Flows, Current/Planned, Acceptance, Out of Scope)
    - [ ] Create root `docs/app-prd.md`
    - [ ] Refactor `docs/client-prd.md` (from `docs/frontend-prd.md`)
    - [ ] Refactor `docs/cloud-server-prd.md` (from `docs/backend-prd.md`)
- [ ] Create `docs/local-server-prd.md`
- [ ] **Requirement**: Each PRD must link to `docs/interface.md` and relevant plan docs
- [ ] **Requirement**: Link to `docs/timer-logic.md` from PRDs where relevant
- [ ] Generate `docs/review-checklist-prd.md` for PRD sign-off; update doc-matrix after sign-off
- [ ] **Phase 3: Interface Spec (Single Source of Truth)**
    - [ ] Create `docs/interface.md` with **Version Header** and **Changelog Section**
    - [ ] **Versioning Policy**: Use SemVer principles (Major = breaking protocol change, Minor = new capability, Patch = fix/clarity)
    - [ ] Include explicit protocol sections:
        - Firestore schemas & security rules
        - WebSocket events & JSON payloads
        - REST API endpoints
        - Bridge sync protocol & arbitration
    - [ ] Include supporting details:
        - Error codes
        - Auth/role scopes
        - PNA/CORS requirements
        - Versioning/deprecation policy
    - [ ] Add deprecation notice header in `docs/websocket-protocol.md`
- [ ] **Phase 4: Plans & References**
    - [ ] Audit and link all remaining active documentation (Final classification derived from `docs/doc-matrix.md`):
        - Plans: `docs/local-mode-plan.md`, `docs/local-offline-lan-plan.md`, `docs/parallel-sync-plan-by-agent.md`, `docs/undo-redo-future-plan.md`, `docs/backend-implementation-plan.md`
        - References: `docs/timer-logic.md`, `docs/edge-cases.md`, `docs/modularity-architecture.md`, `docs/show-control-architecture.md`, `docs/show-control-decisions.md`, `docs/architecture-update-2025-12.md`, `docs/phase-2-overview.md`, `docs/offline-local-mode.md`
        - Tasklists: `docs/tasks.md`, `docs/parallel-sync-tasklist.md`, `docs/phase-2-tasklist.md`, `docs/drag-drop-tasklist.md`, `docs/delete-undo-tasklist.md`, `docs/backend-tasks.md`
    - [ ] **Deprecated**: Identify docs superseded by the new structure and mark as **Status: deprecated** (examples: `docs/websocket-protocol.md`, `docs/prd-alignment-analysis-DEPRECATED.md`, `docs/README-DEPRECATION-NOTICE.md`) and list in `docs/README.md` with replacement links.
    - [ ] **Status: draft**: For docs not yet ready for full classification. Must also follow archive exclusion policy.
- [ ] **Phase 5: Cross-Reference Cleanup & Archive Exclusion**
    - [ ] Update root `README.md`, `AGENTS.md`, `CLAUDE.md`
    - [ ] **Archive Reference Cleanup (Phase 5)**: Remove all references to `docs/archive/` from root `README.md`, `AGENTS.md`, `CLAUDE.md`
    - [ ] Final link validation
