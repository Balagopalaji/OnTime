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
    - [x] Enumerate non-archive docs and map to implemented/planned features
    - [x] **Exclude the archive directory from Phase 0 inventory**
    - [x] Identify conflicts and duplications
    - [x] **Reality Check**: Verify "Current" features against code/tests; record mismatches in `docs/doc-matrix.md`
    - [x] Produce feature-to-doc matrix in `docs/doc-matrix.md` (**Columns**: Feature, Canonical Doc, Type, Status, Code Reference, Owner Verified, Verified Date, Checklist Reference)
    - [x] Generate `docs/review-checklist-phase-0.md` for all `Status: current` items; update doc-matrix after sign-off
- [ ] **Phase 1: Doc Taxonomy & Index**
    - [x] Create `docs/README.md` (`Type: Index`) defining doc types (**PRD / Interface / Plan / Reference / Tasklist / Index**)
    - [x] Link `docs/doc-matrix.md` (`Type: Index`) from `docs/README.md`
    - [x] **Apply mandatory front matter** to ALL canonical docs:
        - `Type: PRD | Interface | Plan | Reference | Tasklist | Index`
        - `Status: current | planned | draft | deprecated`
        - **Note**: `Status: current` indicates intended implemented scope; verification is tracked in doc-matrix columns.
        - `Owner` (team/person accountable)
        - `Last updated` (YYYY-MM-DD)
        - `Scope`
    - [x] **Archive Reference Cleanup (Phase 1)**: Remove references to the archive directory from `docs/README.md`
- [x] **Phase 2: PRDs (Whole App)**
    - [x] Define PRD template sections (Goals/Non-goals, Roles, Flows, Current/Planned, Acceptance, Out of Scope)
    - [x] Create root `docs/app-prd.md`
    - [x] Refactor `docs/client-prd.md` (from `docs/frontend-prd.md`)
    - [x] Refactor `docs/cloud-server-prd.md` (from `docs/backend-prd.md`)
    - [x] Create `docs/local-server-prd.md`
    - [x] **Requirement**: Each PRD must link to `docs/interface.md` and relevant plan docs
    - [x] **Requirement**: Link to `docs/timer-logic.md` from PRDs where relevant
    - [x] Generate `docs/review-checklist-prd.md` for PRD sign-off; update doc-matrix after sign-off
- [x] **Phase 3: Interface Spec (Single Source of Truth)**
    - [x] Create `docs/interface.md` with **Version Header** and **Changelog Section**
    - [x] **Versioning Policy**: Use SemVer principles (Major = breaking protocol change, Minor = new capability, Patch = fix/clarity)
    - [x] Include explicit protocol sections:
        - Firestore schemas & security rules
        - WebSocket events & JSON payloads
        - REST API endpoints
        - Bridge sync protocol & arbitration
    - [x] Include supporting details:
        - Error codes
        - Auth/role scopes
        - PNA/CORS requirements
        - Versioning/deprecation policy
    - [x] Add deprecation notice header before archiving `docs/websocket-protocol.md`
- [x] **Phase 4: Plans & References**
    - [x] Audit and link all remaining active documentation (Final classification derived from `docs/doc-matrix.md`):
        - Plans: `docs/local-mode.md`, `docs/local-offline-lan-plan.md`, `docs/restructure-implementation-plan.md`
        - References: `docs/timer-logic.md`, `docs/edge-cases.md`, `docs/phase-2-overview.md`
        - Tasklists: `docs/tasks.md`, `docs/phase-2-tasklist.md`, `docs/restructure-tasklist.md`, `docs/review-checklist-phase-0.md`, `docs/review-checklist-prd.md`
    - [x] **Deprecated**: Identify docs superseded by the new structure, archive them, and remove them from `docs/README.md`.
    - [x] **Status: draft**: For docs not yet ready for full classification. Must also follow archive exclusion policy.
- [ ] **Phase 5: Cross-Reference Cleanup & Archive Exclusion**
    - [x] Update root `README.md`, `AGENTS.md`, `CLAUDE.md`
    - [x] **Archive Reference Cleanup (Phase 5)**: Remove all references to the archive directory from root `README.md`, `AGENTS.md`, `CLAUDE.md`
    - [x] Final link validation
