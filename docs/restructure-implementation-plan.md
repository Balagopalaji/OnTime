---
Type: Plan
Status: current
Owner: KDB
Last updated: 2025-12-29
Scope: Implementation plan for documentation restructure and PRD alignment.
---

# Implementation Plan: Documentation Restructure & PRD Alignment (Final.v11)

Establish a single source of truth for all OnTime components and reconcile documentation with the current state of the codebase.

## Definitions
- **Owner**: The team or individual accountable for the document's content and future updates. Required in all canonical front matter.
- **Status: current**: Denotes that the documented features are **implemented** and **verified** against the actual codebase or automated tests.

## Phased Approach

### Phase 0: Inventory & Reality Check
Audit existing documentation to distinguish between "implemented" reality and "future" plans. **Exclude all documents in `docs/archive/` from this inventory.**
- **Verification Method**: Compare documented features against the actual codebase or automated tests.
- **Output**: `docs/doc-matrix.md` (Type: Index). **Columns**: Feature, Canonical Doc, Type, Status, Code Reference, Owner Verified, Verified Date, Checklist Reference.
- **Requirement**: Mismatches found during review must be explicitly noted in the matrix.
- **Manual Review Checkpoint**: Generate `docs/review-checklist-phase-0.md` from all items marked `Status: current`. After sign-off, update the doc-matrix verification columns.

### Phase 1: Doc Taxonomy & Index
Define the project's documentation hierarchy.
- **Taxonomy (Types)**: Every canonical document must be assigned one of the following kinds: **PRD**, **Interface**, **Plan**, **Reference**, **Tasklist**, or **Index**.
- **Output**: `docs/README.md` (Type: Index) defining this taxonomy and providing a high-level jump-list, including a link to `docs/doc-matrix.md`.
- **Front Matter**: **All canonical docs** (including index files) must include:
    - `Type`: The taxonomy kind (PRD, Interface, Plan, Reference, Tasklist, or Index).
    - `Status`: The current lifecycle state (**current | planned | draft | deprecated**).
    - `Owner` (accountable entity).
    - `Last updated` (YYYY-MM-DD).
    - `Scope`: Brief description of what this doc covers.
- **Archive Reference Cleanup (Phase 1)**: Remove references to `docs/archive/` within the new `docs/README.md`.

### Phase 2: Product & Component PRDs
Establish the "What" and "Why" using a standardized template.
- **Template**: Goals/Non-goals, Roles & Permissions, User Flows, Current Behavior (Reality), Planned Phases (Roadmap), Acceptance Criteria, Out of Scope.
- **Documents**: `docs/app-prd.md`, `docs/client-prd.md`, `docs/cloud-server-prd.md`, `docs/local-server-prd.md`.
- **Cross-Linking**: Every PRD must contain links to `docs/interface.md`, relevant implementation plans (e.g. `docs/local-offline-lan-plan.md`), and `docs/timer-logic.md` (where relevant).
- **Manual Review Checkpoint**: Generate `docs/review-checklist-prd.md` for PRD sign-off. After sign-off, update the doc-matrix verification columns.

### Phase 3: Interface Specification
Create the technical "How" as the single protocol authority.
- **Target**: `docs/interface.md` (Type: Interface).
- **Requirement**: Must include a **Version Header** (e.g., `v1.0.0`) and a **Changelog** section.
- **Versioning Policy**: Follow Semantic Versioning (SemVer) principles (Major=Breaking, Minor=Features, Patch=Fixes).
- **Interface Scope**: Firestore schemas, WebSocket events, REST APIs, Bridge sync logic, Error codes, Auth roles, PNA/CORS, and Versioning policy.

### Phase 4: Plans & References
Audit and link all remaining active documentation.
- **Strategy**: Utilizing the `docs/doc-matrix.md` from Phase 0, classify and link **every** non-archive document in the codebase.
- **Lifecycle (Status)**:
    - **current**: Features are implemented and matched to code reality.
    - **planned**: Future target state/features.
    - **draft**: Use this status for documents not yet ready for formal classification. **Drafts are also subject to the archive reference exclusion policy.**
    - **deprecated**: Superseded documents; must be listed in the index with pointers to their replacement.
- **Initial Categorization (Examples)**:
    - **Plans**: `docs/local-mode-plan.md`, `docs/local-offline-lan-plan.md`, `docs/parallel-sync-plan-by-agent.md`, `docs/undo-redo-future-plan.md`, `docs/backend-implementation-plan.md`.
    - **References**: `docs/timer-logic.md`, `docs/edge-cases.md`, `docs/modularity-architecture.md`, `docs/show-control-architecture.md`, `docs/show-control-decisions.md`, `docs/architecture-update-2025-12.md`, `docs/phase-2-overview.md`, `docs/offline-local-mode.md`.
    - **Tasklists**: `docs/tasks.md`, `docs/parallel-sync-tasklist.md`, `docs/phase-2-tasklist.md`, `docs/drag-drop-tasklist.md`, `docs/delete-undo-tasklist.md`, `docs/backend-tasks.md`.

### Phase 5: Cross-Reference Cleanup & Archive Reference Cleanup
- **Cleanup**: Update all root-level project docs (`README.md`, `AGENTS.md`, `CLAUDE.md`).
- **Archive Reference Cleanup (Phase 5)**: Remove all references to `docs/archive/` from these root files.

## Verification Plan
1. **Reality Audit**: All features marked `Status: current` must correspond to existing code and be verified against actual implementation.
2. **Link integrity**: No broken internal links; index and doc-matrix are mutually linked.
3. **Archive Exclusion**: **No non-archived document (regardless of Type) should contain references or links to the `docs/archive/` directory.**
4. **Taxonomy Enforcement**: Every non-archive doc is assigned one of the 6 taxonomy types and an appropriate lifecycle status.
