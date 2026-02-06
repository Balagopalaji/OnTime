# Agent Context

> **Read this first** when starting work on OnTime.

---

## Quick Overview

OnTime is a show timer platform with three operation modes:
- **Cloud** — Firebase-backed, multi-device sync
- **Local** — Companion desktop app for offline/LAN use
- **Auto** — Prefers Companion when connected; otherwise Cloud if online, Local if cloud offline

**Key architectural pattern:** `UnifiedDataContext` merges Cloud + Companion data, handles room authority, caches snapshots, and queues offline events.

---

## Architecture Diagrams

| Diagram | Purpose | Status |
|---------|---------|--------|
| [timer-lifecycle.md](./timer-lifecycle.md) | Timer states, transitions, elapsed math | Done |
| [system-context.md](./system-context.md) | High-level component relationships | Done |
| data-flow.md | Create/update paths, write-through | Planned |
| auth-roles.md | Owner/operator/viewer + rule gates | Planned |
| rundown-model.md | Section/Segment/Timer data model | Planned |
| rundown-interactions.md | DnD, reorder, bootstrap logic | Planned |
| sync-arbitration.md | Cloud vs Companion precedence | Planned |

---

## Source-of-Truth Files

| Domain | File |
|--------|------|
| Timer logic | `docs/timer-logic.md` |
| Timer tuple migration/helpers | `frontend/src/context/firebase-timer-state-utils.ts` |
| Timer tuple regression tests | `frontend/src/context/FirebaseDataContext.test.ts` |
| Types | `frontend/src/types/index.ts` |
| Timer utils | `frontend/src/utils/timer-utils.ts` |
| Firebase timer writes | `frontend/src/context/FirebaseDataContext.tsx` |
| Data context interface | `frontend/src/context/DataContext.tsx` |
| Unified orchestration | `frontend/src/context/UnifiedDataContext.tsx` |
| Firebase rules | `firebase/firestore.rules` |
| Interface contract | `docs/interface.md` |

---

## Current Phase Status

- **Phase 1** (Core timer + Firebase): Complete
- **Phase 2** (Companion + local mode): Complete
- **Phase 3** (Unified arbitration): In progress
  - 3A: Unified data context — Done
  - 3B: Arbitration logic — Done
  - 3C: Sections/Segments/Cues — In progress

---

## Known Invariants

1. Elapsed time can be negative (bonus time) — never clamp
2. Every timer mutation must write a full state tuple (see timer-lifecycle.md)
3. Duration changes reset progress to 0
4. Nudge modifies duration, not elapsed
5. Do not emit partial state updates (e.g., changing `activeTimerId` without elapsed + anchors)

---

## Non-Goals (Out of Scope)

- v1 migration (v2 is baseline)
- Multi-room simultaneous control
- Real-time collaborative editing (single controller per room)
