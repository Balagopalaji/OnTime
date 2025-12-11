# Phase 1B Implementation Guide (Repo Prompt Workflow)

## Overview
This guide breaks Phase 1B into **5 focused steps**, each designed to fit within Repo Prompt's 30k token limit. Phase 1B adds production hardening: authentication, persistence, offline queue, and hybrid sync.

**Total Duration:** Weeks 3-5  
**Goal:** Reliable, secure local mode with Firestore fallback.

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

## Step 1: Token-Based Authentication

### 🎯 Goal
Replace 6-digit PIN with secure token authentication.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 70-85)
docs/websocket-protocol.md (lines 1-70, 260-290)
companion/src/main.ts
```

**Estimated tokens:** ~12k

### 📝 Task Description
```markdown
Implement secure token authentication in Companion:
- Generate JWT token on startup (instead of 6-digit PIN)
- Store token in system keychain (macOS: Keychain, Windows: Credential Manager)
- Display token in system tray menu (click to copy)
- Validate token on JOIN_ROOM (reject invalid tokens)
- Token expires after 24 hours, regenerate on Companion restart
- Add /api/token endpoint to retrieve current token (for future CLI tool generation)
```

### ✅ Acceptance Criteria
- [ ] Companion generates JWT token on startup
- [ ] Token stored securely in system keychain
- [ ] Invalid token returns HANDSHAKE_ERROR
- [ ] Token shown in system tray (copyable)

**Note:** Use `keytar` npm package for cross-platform keychain access.

---

## Step 2: State Persistence (Local Cache)

### 🎯 Goal
Save room state to disk, survive Companion restarts.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 73-80)
docs/modularity-architecture.md (lines 45-100)
companion/src/main.ts
```

**Estimated tokens:** ~14k

### 📝 Task Description
```markdown
Add local state persistence to Companion:
- Cache location:
  - macOS: ~/Library/Application Support/OnTime/cache/rooms.json
  - Windows: %APPDATA%\OnTime\cache\rooms.json
  - Linux: ~/.config/ontime/cache/rooms.json
- On startup: Load state from cache, merge with Firestore (if online)
- On state change: Debounced write to cache (every 2 seconds, batch changes)
- On shutdown: Flush pending writes
- Handle corrupted cache gracefully (delete and start fresh)
```

### ✅ Acceptance Criteria
- [ ] Room state persists across Companion restarts
- [ ] Cache file created in correct OS-specific location
- [ ] Corrupted cache handled without crashes
- [ ] Debounced writes avoid excessive disk I/O

**Test:** Start Companion, create room state, restart Companion, verify state restored.

---

## Step 3: Offline Queue & Sync

### 🎯 Goal
Queue actions when offline, replay on reconnect.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 56-68)
docs/websocket-protocol.md (lines 200-250)
frontend/src/context/CompanionDataContext.tsx
```

**Estimated tokens:** ~16k

### 📝 Task Description
```markdown
Implement offline queue in CompanionDataProvider:
- Queue structure: Array of { action, timestamp, roomId, timerId }
- When connection lost: Store actions in localStorage (key: ontime:queue:{roomId})
- On reconnect: Replay actions in timestamp order
- Conflict resolution: Last-Write-Wins (newer timestamp overwrites)
- UI indicator: Show "📤 Syncing..." badge during replay
- Clear queue after successful replay

Actions to queue:
- TIMER_ACTION (START/PAUSE/RESET)
- Future: createTimer, updateTimer, deleteTimer (Phase 1C)
```

### ✅ Acceptance Criteria
- [ ] Actions queued when Companion disconnected
- [ ] Queue persisted in localStorage
- [ ] Queue replayed on reconnect (correct order)
- [ ] Conflicts resolved (Last-Write-Wins)
- [ ] UI shows sync status

**Test:** Disconnect WiFi, perform 5 timer actions, reconnect WiFi, verify all actions replayed.

---

## Step 4: Hybrid Sync (Firestore + WebSocket)

### 🎯 Goal
Write to both Firestore and WebSocket, prioritize WebSocket for reads.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 51-60)
docs/show-control-architecture.md (lines 88-95, 160-170)
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/FirebaseDataContext.tsx
```

**Estimated tokens:** ~18k

### 📝 Task Description
```markdown
Implement hybrid sync in CompanionDataProvider:
- Write strategy: Write to BOTH WebSocket and Firestore simultaneously
- Read strategy: Prioritize WebSocket (local), fallback to Firestore if Companion offline
- Connection detection:
  - If WebSocket connected: Use WebSocket
  - If WebSocket disconnected: Use Firestore
- Optimistic UI: Apply changes immediately, rollback if both fail
- Error handling: Log Firestore failures, don't block WebSocket updates

Firestore write targets (from show-control-architecture.md):
- /rooms/{roomId}/state/current (RoomState updates)
- /rooms/{roomId} (Room config, if tier/features change)
```

### ✅ Acceptance Criteria
- [ ] Timer actions write to both WebSocket AND Firestore
- [ ] WebSocket prioritized for reads (faster)
- [ ] Firestore fallback works when Companion offline
- [ ] No duplicate state updates (deduplicate Firestore → WebSocket echo)

**Test:** 
1. Start timer via WebSocket → Verify Firestore updated
2. Stop Companion → Timer actions still work via Firestore
3. Restart Companion → WebSocket reconnects, no state loss

---

## Step 5: Feature Flags & Firestore Rules

### 🎯 Goal
Implement tier-based access, update Firestore security rules.

### 📄 Repo Prompt Files
```
docs/modularity-architecture.md (lines 102-135)
docs/local-mode-plan.md (lines 118-145)
firebase/firestore.rules
frontend/src/context/FirebaseDataContext.tsx
```

**Estimated tokens:** ~16k

### 📝 Task Description
```markdown
Add feature flag infrastructure:
- Update Room creation to include tier and features:
  - Default tier: 'basic'
  - Default features: { localMode: true, showControl: false, ... }
- Add version field: _version: 2 (for migration detection)
- Update Firestore rules per local-mode-plan.md § 5.1:
  - Public read for Room config
  - Authenticated write for Room owner
  - Tier-based access for liveCues subcollection
- Test rules in emulator (NOT production yet)

Update RoomState writes to use new subcollection path:
- Old: /rooms/{roomId}
- New: /rooms/{roomId}/state/current
```

### ✅ Acceptance Criteria
- [ ] New rooms created with tier and features
- [ ] Firestore rules updated in firebase/firestore.rules
- [ ] Rules tested in emulator (npm run emulator)
- [ ] Existing rooms still work (backward compatible via _version check)

**Firestore Rules Deployment:**
- **Emulator:** Rules auto-reload from `firebase/firestore.rules`
- **Production:** Defer to Phase 1C (after full testing)

**Test:** Create room, verify `tier: 'basic'` and `features` in Firestore console.

---

## Verification: Phase 1B Complete

### End-to-End Test
1. **Start Companion** with token authentication
2. **Create Room** → Verify tier and features saved
3. **Start Timer** → Verify written to BOTH WebSocket and Firestore
4. **Restart Companion** → Verify state restored from cache
5. **Disconnect WiFi** → Perform 3 timer actions → Verify queued
6. **Reconnect WiFi** → Verify queue replayed
7. **Stop Companion** → Timer still works via Firestore
8. **Restart Companion** → WebSocket reconnects, hybrid sync resumes

### Success Criteria
- [x] Token authentication works
- [x] State persists across restarts
- [x] Offline queue replays on reconnect
- [x] Hybrid sync (WebSocket + Firestore) working
- [x] Feature flags infrastructure ready

---

## Token Budget Summary

| Step | Tokens | Files |
|:-----|:-------|:------|
| 1. Token auth | ~12k | 3 files |
| 2. State persistence | ~14k | 3 files |
| 3. Offline queue | ~16k | 3 files |
| 4. Hybrid sync | ~18k | 4 files |
| 5. Feature flags | ~16k | 4 files |

All steps **fit within 30k token limit** ✅

---

## Tips for Success

### Using Repo Prompt
```bash
# Example for Step 1
repo-prompt include \
  docs/local-mode-plan.md:70-85 \
  docs/websocket-protocol.md:1-70 \
  companion/src/main.ts

# Copy output, paste to Chat (Edit Mode)
```

### Between Steps
- **Commit after each step** (git commit -m "Phase 1B Step 1: Token auth")
- **Test acceptance criteria** before moving on
- **Update task.md** to track progress

### If You Get Stuck
- Reference `docs/architecture-update-2025-12.md`
- Check `docs/websocket-protocol.md` for event formats
- Ask in Compose (Planning) mode: "How should X work?"

---

## Next: Phase 1C

After completing Phase 1B, move to `phase-1c-implementation-guide.md` (to be created) for:
- File operations API (`/api/open`, `/api/file/metadata`)
- Attachment system integration
- Pre-show workflow (PowerPoint import prep)

**Last Updated:** December 12, 2025  
**Ready for:** Implementation
