---
Type: Index
Status: draft
Owner: KDB
Last updated: 2025-12-29
Scope: Feature-to-document mapping with implementation verification status.
---

# Documentation Feature Matrix

This matrix maps features to their canonical documentation and verification status.
Fill in Owner Verified / Verified Date after manual review checklists are completed.

| Feature | Canonical Doc | Type | Status | Code Reference | Owner Verified | Verified Date | Checklist Reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Room management (create/delete/list, metadata) | `docs/app-prd.md` | PRD | current | `frontend/src/context/UnifiedDataContext.tsx` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Timer CRUD + reorder | `docs/client-prd.md` | PRD | current | `frontend/src/context/UnifiedDataContext.tsx` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Timer math & transitions | `docs/timer-logic.md` | Reference | current | `frontend/src/utils/timer-utils.ts`, `frontend/src/hooks/useTimerEngine.ts` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Viewer display + status | `docs/client-prd.md` | PRD | current | `frontend/src/routes/ViewerPage.tsx` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Message overlay + presets | `docs/client-prd.md` | PRD | current | `frontend/src/components/controller/MessagePanel.tsx` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| App modes (auto/local/cloud) - loopback Companion | `docs/local-mode.md` | Reference | current | `frontend/src/context/AppModeContext.tsx` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| App modes (auto/local/cloud) - LAN/offline Companion | `docs/local-offline-lan-plan.md` | Plan | planned | n/a |  |  |  |
| Companion connection + token flow | `docs/local-server-prd.md` | PRD | current | `frontend/src/context/CompanionConnectionContext.tsx`, `companion/src/main.ts` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Parallel sync queue + replay | `docs/local-mode.md` | Reference | draft | `frontend/src/context/UnifiedDataContext.tsx` |  |  |  |
| Bridge sync (Local ↔ Cloud) | `docs/local-mode.md` | Reference | planned | `frontend/src/context/UnifiedDataContext.tsx` |  |  |  |
| Firestore schema + rules | `docs/cloud-server-prd.md` | PRD | current | `firebase/firestore.rules` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Companion WebSocket protocol | `docs/interface.md` | Interface | draft | `companion/src/main.ts` |  |  |  |
| LAN viewers (offline) | `docs/local-offline-lan-plan.md` | Plan | planned | n/a |  |  |  |
