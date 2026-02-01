---
Type: Index
Status: draft
Owner: KDB
Last updated: 2026-02-01
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
| Companion controller lock + takeover | `docs/local-server-prd.md` | PRD | current | `companion/src/main.ts` |  |  |  |
| Cloud controller lock enforcement (Milestone 5) | `docs/cloud-lock-design.md` | Reference | planned | `firebase/firestore.rules`, `firebase/functions/*` (planned), `frontend/src/context/UnifiedDataContext.tsx` |  |  | `docs/phase-2-tasklist.md` |
| Parallel sync principles | `docs/app-prd.md`, `docs/client-prd.md`, `docs/local-mode.md`, `docs/phase-3-unified-arbitration-plan.md` | PRD/Reference/Plan | current | `frontend/src/context/UnifiedDataContext.tsx` |  |  |  |
| Unified arbitration plan | `docs/phase-3-unified-arbitration-plan.md` | Plan | draft | n/a |  |  |  |
| Arbitration roadmap | `docs/phase-3-arbitration-roadmap.md` | Plan | draft | n/a |  |  |  |
| Arbitration agent guide | `docs/phase-3-arbitration-agent-guide.md` | Reference | draft | n/a |  |  |  |
| Arbitration research summary | `docs/phase-3-arbitration-research.md` | Reference | draft | n/a |  |  |  |
| Parallel sync queue + replay | `docs/local-mode.md` | Reference | current | `frontend/src/context/UnifiedDataContext.tsx` |  |  |  |
| Tombstone deletion sync | `docs/local-mode.md`, `docs/interface.md` | Reference/Interface | current | `frontend/src/context/UnifiedDataContext.tsx`, `companion/src/main.ts`, `firebase/firestore.rules` |  |  |  |
| Companion cache seeding (SEED_COMPANION_CACHE) | `docs/local-mode.md`, `docs/interface.md` | Reference/Interface | current | `frontend/src/context/UnifiedDataContext.tsx`, `companion/src/main.ts` |  |  |  |
| Dashboard pinned rooms | `docs/client-prd.md`, `docs/local-mode.md` | PRD/Reference | current | `frontend/src/routes/DashboardPage.tsx` |  |  |  |
| Bridge sync (Local ↔ Cloud) | `docs/local-mode.md` | Reference | current | `frontend/src/context/UnifiedDataContext.tsx` |  |  |  |
| Firestore schema + rules | `docs/cloud-server-prd.md` | PRD | current | `firebase/firestore.rules` | KDB | 2025-12-29 | `docs/archive/review-checklist-phase-0.md` |
| Companion WebSocket protocol | `docs/interface.md` | Interface | current | `companion/src/main.ts` |  |  |  |
| Show control cues + video timing (Companion, Windows PPT helper) | `docs/local-server-prd.md` | PRD | current | `companion/src/main.ts`, `companion/ppt-probe/Program.cs` |  |  |  |
| Show control viewer overlays (slide + video timing, Windows-only PPT timing) | `docs/client-prd.md` | PRD | current | `frontend/src/components/controller/PresentationStatusPanel.tsx` |  |  |  |
| Show planner cue states (STBY/Warning/Go + ack) | `docs/client-prd.md` | PRD | planned | n/a |  |  |  |
| Show planner cues (rundown cue list) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Rundown sections/sessions | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Rundown segments (items) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Segment timers (default + sequential sub-timers) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Schedule drift shift (recalculate downstream times) | `docs/client-prd.md` | PRD | planned | n/a |  |  |  |
| Crew chat (role-targeted messaging) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Multi-room dashboard (breakout monitoring) | `docs/client-prd.md` | PRD | planned | n/a |  |  |  |
| Cue trigger types (timed/sequential/follow/floating) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Timer control delegation | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| Show Caller Mode (app as caller) | `docs/interface.md` | Interface | planned | n/a |  |  |  |
| LAN viewers (offline) | `docs/local-offline-lan-plan.md` | Plan | planned | n/a |  |  |  |
| Phase 3 overview plan | `docs/phase-3-overview.md` | Plan | planned | n/a |  |  |  |
| Phase 4 overview plan | `docs/phase-4-overview.md` | Plan | draft | n/a |  |  |  |
| Phase 3 tasklist | `docs/phase-3-tasklist.md` | Tasklist | planned | n/a |  |  |  |
| Phase 3 agent prompts | `docs/phase-3-agent-prompts.md` | Tasklist | planned | n/a |  |  |  |
| Phase 3 decisions | `docs/phase-3-decisions.md` | Reference | draft | n/a |  |  |  |
| Phase 3 pairing UX | `docs/phase-3-pairing-ux.md` | Reference | draft | n/a |  |  |  |
| Phase 3 bundle strategy | `docs/phase-3-bundle-strategy.md` | Reference | draft | n/a |  |  |  |
| Phase 3 cert trust UX | `docs/phase-3-cert-trust-ux.md` | Reference | draft | n/a |  |  |  |
| Phase 3 troubleshooting log | `docs/phase-3-troubleshooting.md` | Reference | draft | n/a |  |  |  |
| Agent handoff log | `docs/agent-handoff.md` | Reference | current | n/a |  |  |  |
| PowerPoint video timing debug notes (Windows, dev-only) | `docs/ppt-video-debug.md` | Reference | current | `companion/src/main.ts` |  |  |  |
| Standalone PowerPoint video timer app | `docs/phase-3-standalone-ppt-timer.md` | Plan | draft | `companion/ppt-probe/Program.cs` |  |  |  |
| Save/Load Sessions | `docs/phase-3-save-load-sessions.md` | Plan | draft | n/a |  |  |  |