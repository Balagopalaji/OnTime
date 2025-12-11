# Phase 1A Implementation Guide (Repo Prompt Workflow)

## Overview
This guide breaks Phase 1A into **6 focused steps**, each designed to fit within Repo Prompt's 30k token limit. Each step includes exact files to include, estimated token usage, and clear acceptance criteria.

**Total Duration:** Weeks 1-2  
**Goal:** Basic WebSocket relay. Timer syncs over LAN.

---

## Workflow

### For Each Step:
1. **Copy the "Repo Prompt Files" list** below
2. **Run Repo Prompt** with those files to generate context
3. **Open Chat (Edit Mode)** in your AI assistant
4. **Paste Repo Prompt output** + the "Task Description"
5. **Verify** using the "Acceptance Criteria"
6. **Move to next step**

---

## Step 1: Initialize Companion App Skeleton

### 🎯 Goal
Create Electron app with basic structure, no WebSocket yet.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 1-25)
docs/modularity-architecture.md (lines 1-42)
package.json (if exists)
```

**Estimated tokens:** ~8k

### 📝 Task Description
```markdown
Create an Electron application skeleton in /companion directory with:
- package.json with electron, socket.io dependencies
- src/main.ts entry point
- System tray icon with "OnTime Companion - Minimal Mode" label
- Generate 6-digit PIN on startup, display in tray menu
- Cross-platform support (macOS, Windows, Linux)
- No WebSocket server yet - just app shell
```

### ✅ Acceptance Criteria
- [ ] `npm run dev` in /companion launches Electron app
- [ ] System tray shows "OnTime Companion"
- [ ] Console logs 6-digit PIN on startup
- [ ] App runs on your OS (test macOS/Windows)

---

## Step 2: Add WebSocket Server (Minimal Mode)

### 🎯 Goal
WebSocket server on port 4000, basic connection handling.

### 📄 Repo Prompt Files
```
docs/websocket-protocol.md (lines 1-100)
docs/local-mode-plan.md (lines 26-50)
companion/src/main.ts
companion/package.json
```

**Estimated tokens:** ~12k

### 📝 Task Description
```markdown
Add WebSocket server to Companion app:
- Socket.io server on ws://localhost:4000
- Implement JOIN_ROOM event handler
- Validate 6-digit PIN from client
- Send HANDSHAKE_ACK with companionMode: "minimal"
- Log connections to console
- Reject connections with invalid PIN (HANDSHAKE_ERROR)
```

### ✅ Acceptance Criteria
- [ ] WebSocket server starts on port 4000
- [ ] Can connect via browser console: `new WebSocket('ws://localhost:4000')`
- [ ] Sending invalid PIN returns HANDSHAKE_ERROR
- [ ] Sending valid PIN returns HANDSHAKE_ACK with capabilities

**Test command:**
```javascript
// Browser console test
const ws = new WebSocket('ws://localhost:4000');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send(JSON.stringify({type: 'JOIN_ROOM', token: '123456', roomId: 'test'}));
```

---

## Step 3: Add Room State Management

### 🎯 Goal
In-memory room state, broadcast ROOM_STATE_DELTA to clients.

### 📄 Repo Prompt Files
```
docs/websocket-protocol.md (lines 77-130)
docs/modularity-architecture.md (lines 45-100)
companion/src/main.ts
```

**Estimated tokens:** ~10k

### 📝 Task Description
```markdown
Implement room state management in Companion:
- In-memory Map<roomId, RoomState>
- RoomState interface: { activeTimerId, isRunning, currentTime, lastUpdate }
- On client JOIN_ROOM: send ROOM_STATE_SNAPSHOT
- On TIMER_ACTION from client: update state, broadcast ROOM_STATE_DELTA to all connected clients in that room
- Handle START/PAUSE/RESET actions
```

### ✅ Acceptance Criteria
- [ ] Multiple clients can connect to same room
- [ ] TIMER_ACTION from one client broadcasts to others
- [ ] State persists while Companion is running
- [ ] Logging shows state changes

**Test:** Connect 2 browser tabs, send TIMER_ACTION from one, see ROOM_STATE_DELTA in the other.

---

## Step 4: Create TypeScript Types

### 🎯 Goal
Shared type definitions for Room, RoomState, and features.

### 📄 Repo Prompt Files
```
docs/modularity-architecture.md (lines 45-100)
docs/show-control-architecture.md (lines 27-92)
frontend/src/types/index.ts (if exists)
docs/backend-prd.md (lines 47-63)
```

**Estimated tokens:** ~14k

### 📝 Task Description
```markdown
Update /frontend/src/types to include:
- Split Room and RoomState interfaces per modularity-architecture.md
- Room: { id, ownerId, tier, features }
- RoomState: { activeTimerId, isRunning, currentTime, lastUpdate, activeLiveCueId? }
- RoomFeatures interface
- Tier type: 'basic' | 'show_control' | 'production'
- Keep backward compatibility with existing Timer interface
```

### ✅ Acceptance Criteria
- [ ] No TypeScript errors in /frontend
- [ ] Existing FirebaseDataContext still compiles (may have type warnings - OK for now)
- [ ] New types exported from types/index.ts

---

## Step 5: Create CompanionDataProvider

### 🎯 Goal
Frontend WebSocket client matching FirebaseDataContext interface.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 51-60)
docs/websocket-protocol.md (lines 1-130)
frontend/src/context/FirebaseDataContext.tsx
frontend/src/types/index.ts
```

**Estimated tokens:** ~18k

### 📝 Task Description
```markdown
Create /frontend/src/context/CompanionDataContext.tsx:
- React context provider using Socket.io client
- Connect to ws://localhost:4000
- Implement same interface as FirebaseDataContext (read-only subset for now)
- Handle JOIN_ROOM, HANDSHAKE_ACK, ROOM_STATE_SNAPSHOT, ROOM_STATE_DELTA
- Update local React state on server events
- Expose companionMode and capabilities from HANDSHAKE_ACK
- Add connection status indicator (connected/disconnected/reconnecting)
```

### ✅ Acceptance Criteria
- [ ] Provider can replace FirebaseDataProvider in a test page
- [ ] Connection status updates correctly
- [ ] Room state syncs from Companion to frontend
- [ ] No timer control yet (read-only for now)

**Test:** Create `/test-companion` route that uses CompanionDataProvider, verify state displays.

---

## Step 6: Add Timer Control to CompanionDataProvider

### 🎯 Goal
Frontend can send TIMER_ACTION to Companion, see state update.

### 📄 Repo Prompt Files
```
docs/websocket-protocol.md (lines 98-112)
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/FirebaseDataContext.tsx (startTimer, pauseTimer, resetTimer methods)
```

**Estimated tokens:** ~12k

### 📝 Task Description
```markdown
Add timer control methods to CompanionDataProvider:
- startTimer(roomId, timerId): emit TIMER_ACTION with action: "START"
- pauseTimer(roomId, timerId): emit TIMER_ACTION with action: "PAUSE"  
- resetTimer(roomId, timerId): emit TIMER_ACTION with action: "RESET"
- Optimistic updates: update local state immediately, then emit to server
- Handle ROOM_STATE_DELTA response
```

### ✅ Acceptance Criteria
- [ ] Test page can start/pause/reset timers
- [ ] Multiple viewers see updates in real-time (<50ms latency)
- [ ] Works offline (disconnect internet, timer still syncs over WebSocket)

**Test:** Open controller + viewer on same machine, disconnect WiFi, verify timer syncs.

---

## Step 7: Feature Flag Infrastructure (Optional - can defer to 1B)

### 🎯 Goal
Add tier and features fields to Room schema, basic UI hiding.

### 📄 Repo Prompt Files
```
docs/modularity-architecture.md (lines 45-127)
docs/prd-alignment-analysis.md (lines 45-95)
frontend/src/types/index.ts
firebase/firestore.rules
```

**Estimated tokens:** ~16k

### 📝 Task Description
```markdown
Prepare for tier-based features:
- Add tier: 'basic' field to Room creation
- Add features: { localMode: true, showControl: false, ... } to Room
- Update Firestore rules to allow reading Room and state subcollections
- Add version detection: if (room._version === 2) { /* use new model */ }
- No UI changes yet - just data model prep
```

### ✅ Acceptance Criteria
- [ ] New rooms created with tier and features fields
- [ ] Firestore rules allow reading /rooms/{id} and /rooms/{id}/state/current
- [ ] Existing rooms still work (backward compatible)

---

## Verification: Phase 1A Complete

### End-to-End Test
1. **Start Companion:** `cd companion && npm run dev`
2. **Get PIN** from system tray
3. **Open Controller:** Navigate to test page using CompanionDataProvider
4. **Connect:** Enter PIN, verify HANDSHAKE_ACK
5. **Open Viewer:** Second browser tab, same room
6. **Start Timer:** In controller
7. **Verify:** Viewer updates <50ms
8. **Disconnect Internet:** Turn off WiFi
9. **Control Timer:** Should still work via WebSocket
10. **Reconnect Internet:** Verify no errors

### Success Criteria
- [x] All 6 steps complete
- [x] Offline timer sync works
- [x] Multi-client real-time updates
- [x] Companion runs in Minimal Mode (~20-50 MB RAM)

---

## Token Budget Summary

| Step | Tokens | Files |
|:-----|:-------|:------|
| 1. Companion skeleton | ~8k | 3 files |
| 2. WebSocket server | ~12k | 4 files |
| 3. State management | ~10k | 3 files |
| 4. TypeScript types | ~14k | 4 files |
| 5. CompanionDataProvider | ~18k | 4 files |
| 6. Timer control | ~12k | 3 files |
| 7. Feature flags (optional) | ~16k | 4 files |

All steps **fit within 30k token limit** ✅

---

## Tips for Success

### Using Repo Prompt
```bash
# Example for Step 1
repo-prompt include \
  docs/local-mode-plan.md:1-25 \
  docs/modularity-architecture.md:1-42 \
  package.json

# Copy output, paste to Chat (Edit Mode)
```

### Between Steps
- **Commit after each step** (git commit -m "Phase 1A Step 1: Companion skeleton")
- **Test acceptance criteria** before moving on
- **Take screenshots** of working features for walkthrough doc

### If You Get Stuck
- Reference `docs/architecture-update-2025-12.md` § Message for Future AI Agents
- Check `docs/websocket-protocol.md` for event examples
- Ask in Compose (Planning) mode: "Why isn't X working?"

---

## Next: Phase 1B

After completing Phase 1A, move to `phase-1b-implementation-guide.md` (to be created) for:
- Token authentication (PIN validation)
- State persistence (local cache)
- Offline queue & conflict resolution
- Hybrid sync (WebSocket + Firestore)

**Last Updated:** December 11, 2025  
**Ready for:** Implementation
