# Local Mode Foundation (Phase 1A: Proof of Concept) Checklist

## 1. Companion App Skeleton
- [ ] **Create Architecture Doc** (`companion/ARCHITECTURE.md`)
    - [ ] Define full event schema (JSON examples)
    - [ ] Define queue implementation (pseudocode)
    - [ ] Define platform-specific paths
    - [ ] Define Phase 1A test plan
- [ ] Initialize Electron project in `/companion`
- [ ] Set up Express + Socket.io server (port 4000)
- [ ] Implement in-memory `RoomState` storage
- [ ] Implement WebSocket events (Basic):
    - [ ] `JOIN_ROOM` (No Auth)
    - [ ] `ROOM_STATE_UPDATE`
    - [ ] `TIMER_ACTION`
    - [ ] `CONNECTION_STATUS`

## 2. Frontend Integration
- [ ] Create `CompanionDataProvider` context
- [ ] Implement `useSocket` hook
- [ ] Map `DataContext` methods to WebSocket events
- [ ] Add "Connection Mode" toggle (Cloud/Local) to UI
- [ ] Update `App.tsx` to support dynamic DataProvider switching

## 3. Verification (Phase 1A)
- [ ] **Latency Test:** Start timer -> Viewer updates <50ms (measure via console/profiler)
- [ ] **State Consistency:** Start/Pause/Reset -> Viewer matches Controller
- [ ] **Payload Validation:** Verify `ROOM_STATE_UPDATE` contains full `RoomState`
