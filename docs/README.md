# OnTime Documentation Index

## 📚 Quick Start Guide

### New to OnTime?
1. **Product Overview**: [`frontend-prd.md`](frontend-prd.md) + [`backend-prd.md`](backend-prd.md) (Current MVP)
2. **Phase 1 Architecture**: [`local-mode-plan.md`](local-mode-plan.md) → [`modularity-architecture.md`](modularity-architecture.md)
3. **Implementation**: [`tasks.md`](tasks.md) for current phase

### Starting Phase 1A Implementation?
1. [`local-mode-plan.md`](local-mode-plan.md) § 4 (Phased Implementation)
2. [`websocket-protocol.md`](websocket-protocol.md) (WebSocket API)
3. [`modularity-architecture.md`](modularity-architecture.md) (Feature flags & tiers)

---

## 📄 Core Documentation

### Product Requirements (Current MVP)
- [`frontend-prd.md`](frontend-prd.md) - React frontend spec (controller + viewer)
- [`backend-prd.md`](backend-prd.md) - Firebase data model + security rules

**Note:** PRDs describe the **current system** (no Companion App). Phase 1 docs below describe **future architecture**.

### Phase 1 Architecture (Local Mode + Show Control)
- **[`local-mode-plan.md`](local-mode-plan.md)** - **START HERE** - Companion App, offline mode, phases
- **[`modularity-architecture.md`](modularity-architecture.md)** - Feature flags, tiers, resource optimization
- **[`websocket-protocol.md`](websocket-protocol.md)** - Complete WebSocket API spec
- [`show-control-architecture.md`](show-control-architecture.md) - PowerPoint, live cues (Phase 2+)

### Decision Logs
- [`show-control-decisions.md`](show-control-decisions.md) - Design decisions for show control
- [`architecture-update-2025-12.md`](architecture-update-2025-12.md) - **CHANGELOG** - Modularity updates (Dec 2025)

### Task Management
- [`tasks.md`](tasks.md) - Current implementation checklist
- [`backend-tasks.md`](backend-tasks.md) - Backend-specific tasks

---

## 🔄 Data Model Evolution

### Current MVP (Firebase-only)
```
/rooms/{roomId} { activeTimerId, isRunning, startedAt, ... }
/rooms/{roomId}/timers/{timerId} { title, duration, order, ... }
```

### Phase 1 (Modular Architecture)
```
/rooms/{roomId} { tier, features }  ← Config (read once)
/rooms/{roomId}/state/current { activeTimerId, isRunning, ... }  ← Real-time
/rooms/{roomId}/liveCues/{id} { ... }  ← Show Control tier+
```

**Why?** Reduces sync overhead by 80% - config cached, only state syncs every second.

---

## 🎯 Implementation Phases

### Phase 1A: Proof of Concept (Weeks 1-2)
**Goal:** Offline timers via WebSocket  
**Read:** `local-mode-plan.md` § 4.1, `websocket-protocol.md` § 8.1

### Phase 1B: Production (Weeks 3-5)
**Goal:** Secure offline mode + tiers  
**Read:** `modularity-architecture.md` § 2-4; walkthrough: `phase-1b-walkthrough.md`

### Phase 1C: File Ops (Weeks 6-7)
**Goal:** Prep for show control  
**Read:** `local-mode-plan.md` § 4.3; implementation guide: `phase-1c-implementation-guide.md`

---

## 🔍 Common Questions

**Q: Which data model is correct?**  
PRDs = Current MVP | Architecture docs = Phase 1+ design

**Q: What's the difference between local-mode-plan and show-control?**  
`local-mode-plan` = Foundation (offline, WebSocket) | `show-control` = Advanced features (PowerPoint, Phase 2)

**Q: Where's the WebSocket spec?**  
[`websocket-protocol.md`](websocket-protocol.md)

---

## Known Issues

**Undo/Redo Temporarily Disabled**  
The undo/redo system is currently stubbed out (buttons do nothing). This was done to unblock Phase 1A development. See [`undo-redo-future-plan.md`](undo-redo-future-plan.md) for the implementation plan. Will be addressed after Phase 1C, before production.

---

## Environment Variables (Current MVP)
- `VITE_USE_MOCK`: `false` for Firebase
- `VITE_USE_FIREBASE_EMULATOR`: `true` for local dev
- Required: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, etc.

## Manual QA Checklist
- Room CRUD: Create, list, delete
- Controller: Start/pause/reset timers, switch active timer
- Viewer: Open `/room/:id/view` unauthenticated, verify sync
- Offline: Simulate network loss, verify reconnection

**For detailed architecture navigation, see the full document tree above.**
