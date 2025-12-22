---
IMPLEMENTATION COMPLETE - DEPRECATED
This document describes Phase 1 implementation steps which are now complete.
Current architecture: See `docs/local-mode-plan.md` (parallel sync)
Last accurate: December 2024 (Phase 1D Step 3.5 completion)
Use case: Historical reference only; do NOT use for new development.
---

> ⚠️ Deprecated
> Historical Phase 1 guide. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

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

**Note:** Step 1 requires adding HTTP server on port 4001 (in addition to WebSocket on 4000).

### 📝 Task Description
```markdown
Implement secure token authentication in Companion:
- Generate JWT token on startup (instead of 6-digit PIN)
- Store token in system keychain (macOS: Keychain, Windows: Credential Manager, Linux: libsecret)
- Display token in system tray menu (click to copy)
- Validate token on JOIN_ROOM (reject invalid tokens)
- Token expires after 24 hours, regenerate on Companion restart

Secure token endpoint:
- Add HTTP server on port 4001 (Express or Node http module)
- Add GET /api/token endpoint (localhost only, no external access)
- Bind to 127.0.0.1 AND ::1 (IPv4 + IPv6 loopback)
- Require Origin header check (must be localhost or 127.0.0.1 or ::1)
- Return: { token: string, expiresAt: number }
- CORS: Allow http://localhost:5173 (Vite dev server) and http://localhost:3000 (alternative)
- Make CORS origin configurable via env var: COMPANION_ALLOWED_ORIGINS

Frontend integration:
- Add token input field to test page
- Auto-fetch from http://localhost:4001/api/token when Companion detected (separate HTTP port)
- Store token in sessionStorage (not localStorage - more secure)
- Update JOIN_ROOM payload: Replace `token: PIN` with `token: JWT_TOKEN`
- Remove 6-digit PIN logic from frontend entirely

Server changes:
- Include clientId in all ROOM_STATE_DELTA broadcasts
- Delta format: { type: 'ROOM_STATE_DELTA', roomId, changes, clientId, timestamp }

Keytar fallback (when keytar unavailable):
- Storage location:
  - macOS: ~/Library/Application Support/OnTime/tokens.enc
  - Windows: %APPDATA%\OnTime\tokens.enc
  - Linux: ~/.config/ontime/tokens.enc
- Encryption: AES-256-GCM with PBKDF2 key derivation
- Salt: Machine ID from `node-machine-id` (stable across reboots)
- Iterations: 100,000 (PBKDF2)
- Log warning: "Using file-based token storage (less secure than keychain)"
- Fallback activates automatically if keytar.setPassword() fails
```

### ✅ Acceptance Criteria
- [ ] Companion generates JWT token on startup
- [ ] HTTP server on port 4001 running (test: curl http://localhost:4001/api/token)
- [ ] Token stored in keychain (or encrypted file if keytar unavailable)
- [ ] `/api/token` endpoint returns token (localhost only, CORS protected)
- [ ] Frontend can fetch token from endpoint
- [ ] Invalid token returns HANDSHAKE_ERROR
- [ ] Token shown in system tray (copyable)

**Security Notes:**
- `/api/token` bound to 127.0.0.1 AND ::1 (IPv4 + IPv6 loopback, no LAN access)
- Origin header validated (http://localhost:5173 or :3000)
- Runs on separate port 4001 (HTTP) from WebSocket 4000
- Token in sessionStorage (cleared on tab close)

**Keytar Installation:**
```bash
# If build fails, fallback activates automatically
npm install keytar --save-optional
```

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

Corrupted cache handling:
- Try to parse cache JSON
- If parse fails:
  1. Backup corrupted file to rooms.json.backup.{timestamp}
  2. Log error with backup location
  3. Start with empty state
  4. Don't delete original (helps debugging)
- Max backups: Keep last 3, delete older

Cache structure:
{
  "version": 2,
  "lastWrite": 1234567890,
  "rooms": {
    "room-id-1": { /* RoomState */ },
    "room-id-2": { /* RoomState */ }
  }
}
```

### ✅ Acceptance Criteria
- [ ] Room state persists across Companion restarts
- [ ] Cache file created in correct OS-specific location
- [ ] Corrupted cache backed up (not deleted)
- [ ] Backup files limited to last 3
- [ ] Debounced writes avoid excessive disk I/O
- [ ] Logs show backup location on corruption

**Test:** 
1. Create room state, restart → state restored
2. Manually corrupt cache file → Companion starts, backup created

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
- Queue structure: Array of { action, timestamp, roomId, timerId, clientId }
- When connection lost: Store actions in localStorage (key: ontime:queue:{roomId})
- On reconnect: Replay actions in timestamp order
- Conflict resolution: Last-Write-Wins (newer timestamp overwrites)
- UI indicator: Show "📤 Syncing..." badge during replay
- Clear queue after successful replay

Queue limits (prevent unbounded growth):
- Max queue size: 100 actions per room
- If queue full during enqueue: Drop oldest actions (FIFO)
- If queue full during replay: Pause enqueue, finish replay first, then resume
- Log warning when dropping actions
- Show UI warning: "Queue full, some actions may be lost"
- Metric: Log queue depth to help tune limit

Timestamp handling:
- Use Date.now() for monotonic timestamps
- Do NOT use server time (avoids clock skew)
- Include clientId to detect own actions (avoid echo)

Actions to queue:
- TIMER_ACTION (START/PAUSE/RESET)
- Future: createTimer, updateTimer, deleteTimer (Phase 1C)
```

### ✅ Acceptance Criteria
- [ ] Actions queued when Companion disconnected
- [ ] Queue persisted in localStorage
- [ ] Queue limited to 100 actions (oldest dropped)
- [ ] Queue replayed on reconnect (correct order)
- [ ] Conflicts resolved (Last-Write-Wins by timestamp)
- [ ] UI shows sync status and queue-full warning
- [ ] Timestamps monotonic (Date.now)

**Test:** 
1. Disconnect WiFi, perform 5 timer actions, reconnect → all replayed
2. Disconnect WiFi, perform 150 actions → oldest 50 dropped, warning shown

---

## Step 4: Hybrid Sync (Firestore + WebSocket)

### 🎯 Goal
Write to both Firestore and WebSocket, prioritize WebSocket for reads.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 56-68)
docs/show-control-architecture.md (lines 88-95, 160-170)
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/FirebaseDataContext.tsx
companion/src/main.ts
```

**Estimated tokens:** ~20k

**Note:** Companion needs to include clientId in ROOM_STATE_DELTA broadcasts.

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

Firestore path migration (CRITICAL):
- OLD path: /rooms/{roomId} (monolithic)
- NEW path: /rooms/{roomId}/state/current (RoomState updates)

Frontend changes (FirebaseDataContext):
- Update startTimer/pauseTimer/resetTimer to write to /state/current
- Keep reading from old path for backward compatibility

Companion changes (if hybrid sync enabled):
- Update TIMER_ACTION handlers to write to /state/current
- Read from /rooms/{roomId} (config) + /rooms/{roomId}/state/current separately
- Cache both in memory

Backend changes: None (Firebase-only, no Cloud Functions)

Full migration in Phase 1C

Frontend changes required:
1. Update FirebaseDataContext.startTimer/pauseTimer/resetTimer:
   - Write to /rooms/{roomId}/state/current (not /rooms/{roomId})
2. Add version detection:
   - If room._version === 2: Use new paths
   - If room._version missing: Use old paths (legacy)

Echo deduplication:
- Each action gets unique clientId (UUID on provider init)
- When receiving ROOM_STATE_DELTA:
  - Check if delta.clientId === ourClientId
  - If yes: Skip (it's our own action echoed back)
  - If no: Apply (it's from another client)
- Prevents double-applying Firestore writes that also come via WebSocket
```

### ✅ Acceptance Criteria
- [ ] Timer actions write to BOTH WebSocket AND Firestore
- [ ] Firestore writes to /rooms/{roomId}/state/current (new path)
- [ ] Version detection works (v2 uses new paths, legacy uses old)
- [ ] WebSocket prioritized for reads (faster)
- [ ] Firestore fallback works when Companion offline
- [ ] Echo deduplication working (no double-updates)
- [ ] clientId included in all actions

**Test:** 
1. Start timer via WebSocket → Verify Firestore /state/current updated
2. Open DevTools → Network → Verify no duplicate state updates
3. Stop Companion → Timer actions still work via Firestore
4. Restart Companion → WebSocket reconnects, no state loss

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

Version/migration handling:
- If room._version === 2: Use new data model
- If room._version === undefined (missing): Assume legacy (v1)
- Legacy rooms:
  - Read from /rooms/{roomId} (monolithic)
  - Write to /rooms/{roomId} (keep old structure)
  - Show "Upgrade to v2" banner in UI
- New rooms:
  - Read from /rooms/{roomId} (config) + /rooms/{roomId}/state/current
  - Write to /rooms/{roomId}/state/current

Backward compatibility strategy:
- Phase 1B: Support both v1 and v2 side-by-side
- Phase 1C: Add migration tool (one-click upgrade)
- Phase 2: Deprecate v1 (after 90% migration)
```

### ✅ Acceptance Criteria
- [ ] New rooms created with tier, features, and _version: 2
- [ ] Firestore rules updated in firebase/firestore.rules
- [ ] Rules tested in emulator (npm run emulator)
- [ ] Version detection working (v2 vs legacy)
- [ ] Legacy rooms still work (no breaking changes)
- [ ] Frontend logs version in console for debugging

**Firestore Rules Deployment:**
- **Emulator:** Rules auto-reload from `firebase/firestore.rules`
- **Production:** Defer to Phase 1C (after full testing)

**Test:** 
1. Create new room → Verify `_version: 2` in Firestore
2. Open old room (no _version) → Verify still works (legacy mode)
3. Check console → Should log "Room v2" or "Room v1 (legacy)"

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
| 4. Hybrid sync | ~20k | 5 files |
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
