# Architecture Diagrams

Visual documentation of OnTime's architecture. Each diagram is validated against source code and kept under ~80 lines for readability.

---

## Available Diagrams

### [Timer Lifecycle](./timer-lifecycle.md)
State machine for timer operations (start, pause, reset, nudge, duration edit). Covers elapsed time calculation and the key invariants for state updates.

**Source files:** `docs/timer-logic.md`, `frontend/src/utils/timer-utils.ts`, `frontend/src/types/index.ts`

### [System Context](./system-context.md)
High-level component relationships: Frontend, Companion, Firebase, UnifiedDataContext orchestration. Includes operation modes (auto/local/cloud).

**Source files:** `docs/phase-2-overview.md`, `docs/phase-3-overview.md`, `CLAUDE.md`

---

## Planned Diagrams

| Diagram | Description |
|---------|-------------|
| Data Flow | Create/update paths, write-through behavior, cache strategy |
| Auth & Roles | Owner/operator/viewer permissions, Firestore rule gates |
| Rundown Model | Section → Segment → Timer/Cue data relationships |
| Rundown Interactions | Drag-and-drop, reorder logic, bootstrap flow |
| Sync Arbitration | Cloud vs Companion precedence, offline queue, staleness |

---

## For Agents

See [agent-context.md](./agent-context.md) for a quick-start guide including:
- Architecture overview
- Source-of-truth file locations
- Current phase status
- Key invariants and non-goals
