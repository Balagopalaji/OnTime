# Phase 1C Implementation Guide (Repo Prompt Workflow)

## Overview
This guide breaks Phase 1C into **4 focused steps**, each designed to fit within Repo Prompt's 30k token limit. Phase 1C completes the local mode foundation: file operations, full CRUD, migration tools, and production deployment.

**Total Duration:** Week 6  
**Goal:** Production-ready local mode with complete feature set.

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

## Step 1: File Operations API

### 🎯 Goal
Add file operations endpoints to Companion for attachments and media.

### 📄 Repo Prompt Files
```
docs/local-mode-plan.md (lines 61-70)
companion/src/main.ts
```

**Estimated tokens:** ~10k

### 📝 Task Description
```markdown
Add file operations API to Companion HTTP server (port 4001):

Endpoints:
- POST /api/open (body: { path })
  - Opens file in default OS application
  - Validates path is within allowed directories
  - Returns: 200 { success: true } | 400 { error: 'invalid_path' } | 401 { error: 'unauthorized' } | 500 { error: 'open_failed' }

- GET /api/file/metadata?path={path}
  - Extracts file metadata (duration, resolution for videos)
  - Supported types: mp4, mov, avi, mkv (video)
  - Returns: 200 { duration?: number, resolution?: string, size?: number, warning?: string } | 400/401/500 as above

Security:
- Enforce Companion token auth + Origin checks (same as /api/token)
- Bind to 127.0.0.1/::1 only (already in use)
- Only allow paths within user's home directory (resolve realpath; block '..' traversal and symlinks escaping home)
- Deny system roots (/System, /Library, /Windows, /etc) even if under home symlink
- Validate file exists before opening
- Log all file operations (path, caller/clientId, result); avoid logging raw tokens; consider redacting full path if sensitive

Platform support:
- macOS: Use 'open' command (spawn, shell: false)
- Windows: Use 'start' via `cmd /c start "" "<path>"` (no shell injection)
- Linux: Use 'xdg-open' (spawn, shell: false)

Dependencies:
- ffprobe (for video metadata extraction) — optional
- Check if ffprobe installed, log warning if missing; return { warning: 'ffprobe missing' } with size if available
- Allowlist extensions for metadata (e.g., mp4, mov, avi, mkv); return 400 for unsupported types

Shipping note (Phase 1 requirement):
- For production Companion builds, bundle a known-good `ffprobe` binary with the app so end users do not need to install FFmpeg separately.
- Licensing requirement: the bundled `ffprobe` MUST be from an **LGPL-only** FFmpeg build (no GPL / no “nonfree” components). Do not ship a GPL/nonfree build unless explicitly approved and documented.
- Keep runtime behavior “optional” (return `warning: 'ffprobe missing'`) as a safety net for dev builds and edge cases.
```

### ✅ Acceptance Criteria
- [ ] `/api/open` endpoint works (test with a PDF file)
- [ ] `/api/file/metadata` extracts video duration
- [ ] Path validation prevents system file access
- [ ] Works on macOS (test on your OS)
- [ ] Logs warning if ffprobe not installed

### Execution Checklist
- Implement POST `/api/open` with token/origin checks, realpath validation, blocked roots, spawn per OS (no shell).
- Implement GET `/api/file/metadata` with allowlisted extensions, ffprobe optional handling, and defined JSON errors.
- Bind to loopback only; reuse `/api/token` CORS/origin allowlist.
- Log operations (caller, result) without logging raw tokens; optionally redact full paths.
- Define HTTP status + response shapes (200/400/401/500).

### Failure Modes / How to handle
- Path invalid or escapes home → 400 `{ error: 'invalid_path' }`
- Unauthorized/missing token/origin → 401 `{ error: 'unauthorized' }`
- ffprobe missing → 200 `{ warning: 'ffprobe missing', size? }`
- Unsupported extension → 400 `{ error: 'unsupported_type' }`
- spawn/open fails → 500 `{ error: 'open_failed' }`

---

## Step 2: Timer CRUD Operations

### 🎯 Goal
Add full timer create/update/delete to CompanionDataProvider.

### 📄 Repo Prompt Files
```
docs/websocket-protocol.md (lines 131-180)
frontend/src/context/CompanionDataContext.tsx
frontend/src/context/FirebaseDataContext.tsx
companion/src/main.ts
```

**Estimated tokens:** ~16k

### 📝 Task Description
```markdown
Add timer CRUD to WebSocket protocol:

New events (Client → Server):
- CREATE_TIMER: { type, roomId, timer: Partial<Timer> }
- UPDATE_TIMER: { type, roomId, timerId, changes: Partial<Timer> }
- DELETE_TIMER: { type, roomId, timerId }
- REORDER_TIMERS: { type, roomId, timerIds: string[] }

Validation & responses:
- Validate required fields (ids as strings, duration > 0, title length limits)
- Reject invalid payloads with TIMER_ERROR { code, message }
- Server generates timerId if client omits
- Reorder: roomId + ordered timerIds[], keep FIFO for unknowns
- Deduplicate echoes: if payload.clientId === our clientId, skip applying
- Queue CRUD when WS disconnected/handshake not ack’d; replay FIFO on reconnect; cap queue (same limits as actions)
 - Define limits on fields (title length, allowed changes keys) and normalize order values on the server

Server responses:
- TIMER_CREATED: { type, roomId, timer: Timer }
- TIMER_UPDATED: { type, roomId, timerId, changes }
- TIMER_DELETED: { type, roomId, timerId }
- TIMERS_REORDERED: { type, roomId, timerIds }
- TIMER_ERROR: { type, roomId, code, message }

Companion changes:
- Store timers in room cache
- Broadcast timer changes to all connected clients
- Persist timer changes to disk cache
- Write to Firestore (hybrid sync)

Frontend changes:
- Implement createTimer/updateTimer/deleteTimer in CompanionDataProvider
- Remove "Not yet implemented" stubs
- Add to offline queue (queue timer CRUD when offline)
- Match FirebaseDataContext interface exactly
 - Deduplicate echoes: skip if payload.clientId === our clientId

Hybrid sync:
- Write timer changes to BOTH WebSocket AND Firestore
- Firestore path: /rooms/{roomId}/timers/{timerId}
- Include version field in timer writes
```

### ✅ Acceptance Criteria
- [ ] Can create timer via CompanionDataProvider
- [ ] Can update timer (title, duration, etc.)
- [ ] Can delete timer
- [ ] Can reorder timers (drag & drop)
- [ ] Changes sync to Firestore
- [ ] Multiple clients see updates immediately
- [ ] Offline queue works for timer CRUD

### Execution Checklist
- Add WS events CREATE/UPDATE/DELETE/REORDER + TIMER_ERROR, with payload validation (id string, duration > 0, title length, allowed change keys).
- Server generates timerId if absent; normalize order on REORDER_TIMERS.
- Echo dedupe: skip payloads where payload.clientId === our clientId.
- Offline queue: enqueue CRUD when WS disconnected/handshake not ack’d; replay FIFO; cap queue.
- Write-through to Firestore `/rooms/{roomId}/timers/{timerId}` with version field; align with FirebaseDataContext interface.
- Update websocket-protocol.md if event set changes.

### Failure Modes / How to handle
- Invalid payload → emit TIMER_ERROR { code, message }, do not apply.
- Missing permission/auth → TIMER_ERROR or ignore; log.
- Reorder with missing/extra ids → normalize order, ignore unknowns, or return error (document choice).
- Echoed update (same clientId) → drop silently.

---

## Step 3: Room Migration Tool (v1 → v2)

### 🎯 Goal
Add one-click migration from legacy to v2 data model.

### 📄 Repo Prompt Files
```
docs/modularity-architecture.md (lines 45-127)
docs/prd-alignment-analysis.md (lines 120-155)
frontend/src/context/FirebaseDataContext.tsx
```

**Estimated tokens:** ~14k

### 📝 Task Description
```markdown
Create room migration utility:

Migration process:
1. Check if room._version === 2 (skip if already migrated)
2. Read current room data from /rooms/{roomId}
3. Split into Room config and RoomState:
   - Room: { id, ownerId, tier: 'basic', features: {...}, _version: 2 }
   - RoomState: { activeTimerId, isRunning, currentTime, lastUpdate }
4. Write RoomState to /rooms/{roomId}/state/current
5. Update Room document with tier, features, _version
6. Keep old fields for 30 days (backward compatibility)
7. Log migration success
8. During migration, lock room (reject timer CRUD) for <1s to prevent divergence; unlock after success/failure

UI integration:
- Add "Upgrade to v2" banner in dashboard for legacy rooms
- Show migration status (pending, in progress, complete, failed)
- Disable timer operations during migration (< 1 second)
- Show success toast after migration

Rollback:
- Add /api/rooms/{roomId}/rollback endpoint (owner + auth only)
- Keep JSON backup (timestamped) in Firestore or disk cache; retain 30 days max
- Rollback reads backup and restores legacy doc/state; reject if >30 days

Testing:
- Create test room with old data model
- Trigger migration
- Verify new paths populated
- Verify old room still works during migration window
```

### ✅ Acceptance Criteria
- [ ] Migration button appears for legacy rooms (_version missing)
- [ ] Migration completes without errors
- [ ] New paths populated:
  - /rooms/{roomId} has tier, features, _version: 2
  - /rooms/{roomId}/state/current has timer state
- [ ] Old room data preserved for 30 days
- [ ] Rollback works within 30-day window
- [ ] No downtime during migration

### Execution Checklist
- Detect legacy rooms (no _version or _version === 1); show “Upgrade to v2” banner.
- Migration steps: read legacy doc → split into config + state → write state to /state/current → update root with tier/features/_version:2; keep old fields 30 days.
- Store JSON backup (Firestore doc or disk cache) with timestamp; lock room CRUD during migration (<1s); unlock on success/failure.
- Rollback endpoint: owner+auth only, restores from backup if within 30 days, otherwise reject.
- Log migration success/failure; show status in UI (pending/in progress/complete/failed).

### Failure Modes / How to handle
- Permission denied on state write/update → abort, leave legacy intact, surface error.
- Backup missing/older than 30 days → rollback rejects.
- Concurrent CRUD during migration → lock/reject briefly, then resume.

---

## Step 4: Production Deployment & Cleanup

### 🎯 Goal
Deploy Firestore rules, clean up legacy code, production checklist.

### 📄 Repo Prompt Files
```
firebase/firestore.rules
docs/local-mode-plan.md (lines 118-145)
docs/README.md
```

**Estimated tokens:** ~12k

###📝 Task Description
```markdown
Production deployment tasks:

Firestore Rules:
- Review firebase/firestore.rules for any test-only rules
- Add comments explaining tier-based access
- Test rules in emulator one final time
- Deploy to production: firebase deploy --only firestore:rules
- Verify rules in Firebase Console

Code cleanup:
- Remove any console.log debugging statements
- Remove "Phase 1A/1B/1C" TODO comments
- Update error messages from generic to user-friendly
- Add JSDoc comments to public APIs

Documentation updates:
- Update docs/README.md with "Production Ready" badge
- Add deployment guide (how to deploy rules, companion app)
- Document environment variables for production
- Create troubleshooting guide

Production checklist:
- [ ] Firestore rules deployed
- [ ] Security rules tested (try unauthorized access)
- [ ] Token authentication working
- [ ] Hybrid sync working (WebSocket + Firestore)
- [ ] Offline mode tested (disconnect WiFi)
- [ ] Room migration tested
- [ ] File operations tested
- [ ] Error handling graceful (no crashes)
- [ ] Logs helpful for debugging

Create release notes:
- Document Phase 1 (A/B/C) completion
- List all features added
- Migration guide for existing users
- Known limitations (Phase 2 features not yet available)
```

### ✅ Acceptance Criteria
- [ ] Firestore rules deployed to production
- [ ] All console.log removed
- [ ] Error messages user-friendly
- [ ] Documentation updated
- [ ] Release notes written
- [ ] Companion packaging plan documented
- [ ] Production checklist complete

### Execution Checklist
- Review rules: owner-only for rooms/state; liveCues read/write gated by showControl + owner; emulator test before deploy.
- Deploy rules: `firebase deploy --only firestore:rules`; verify in console.
- Remove dev `console.log`/debug noise (keep server audit logs).
- Update docs/README.md, add deployment guide and env var list; add release notes for Phase 1 completion.
- Production checklist: token auth, hybrid sync, offline mode, migration, file ops, security tests (unauthorized writes/paths) validated.
- Run lint/tests: `cd frontend && npm run lint && npm run test`; `cd companion && npm run build` (lint not configured there).
- Where possible, add small scripts/automation for manual steps (e.g., curl tests for endpoints, basic rule checks) to ease validation; keep them out of prod builds if they’re dev-only.

#### Companion Distribution (Phase 1 definition-of-done)
- Companion is a separate desktop app installed on the **Controller/operator machine only** (Viewers do not install Companion).
- Local Mode requires Companion; cloud/Firebase mode does not.
- Produce signed installers/artifacts per OS (initially manual updates are acceptable; auto-update can be Phase 2+):
  - macOS: `.dmg` (codesigned + notarized)
  - Windows: installer (NSIS or MSIX; codesigned)
  - Linux: AppImage (and/or deb/rpm)
- Bundle `ffprobe` inside the Companion app and invoke it by absolute path (do not rely on PATH).
- Phase 2 (Show Control) may add OS-specific dependencies for PowerPoint integration; keep those out of Phase 1 Minimal Mode installers unless explicitly required.

#### FFmpeg/ffprobe Licensing Notes (must be decided before shipping)
- MUST ship an **LGPL-only** FFmpeg/ffprobe build (no GPL / no “nonfree” components). Do not ship a GPL/nonfree build unless explicitly approved and documented.
- Bundling `ffprobe` means we are redistributing third-party software:
  - Include the applicable license text(s) in the installer/app resources.
  - Provide attribution and a source offer/URL consistent with the distributed binary’s license and build configuration.
  - Record build flags/source provenance for the shipped binary (so compliance is auditable).

### Failure Modes / How to handle
- Unauthorized access still succeeds in emulator → fix rules before deploy.
- Missing env vars in prod → document required variables; fail fast with clear errors.
- Legacy references to Phase 1A/B TODOs → clean up.

---

## Verification: Phase 1C Complete

### End-to-End Test
1. **Create Room** (v2 should auto-detect)
2. **Add Timers** via CompanionDataProvider
3. **Test File Operations** (/api/open with a file)
4. **Migrate Legacy Room** (if you have one)
5. **Test Offline Mode**:
   - Disconnect WiFi
   - Create/update/delete timers
   - Reconnect → Verify queue replays
6. **Test Hybrid Sync**:
   - Stop Companion
   - Timer operations work via Firestore
   - Restart Companion → WebSocket takes over
7. **Security Test**:
   - Try to access file outside home directory
   - Try to access room you don't own
   - Try to write to Firestore without auth

### Success Criteria

- [ ] File operations working
- [ ] Full timer CRUD via WebSocket
- [ ] Room migration (v1 → v2) working
- [ ] Production Firestore rules deployed
- [ ] Offline mode fully functional
- [ ] Security validated (no unauthorized access)

---

## Token Budget Summary

| Step | Tokens | Files |
|:-----|:-------|:------|
| 1. File operations | ~10k | 2 files |
| 2. Timer CRUD | ~16k | 4 files |
| 3. Room migration | ~14k | 3 files |
| 4. Production deployment | ~12k | 3 files |

All steps **fit within 30k token limit** ✅

---

## Tips for Success

### Using Repo Prompt
```bash
# Example for Step 1
repo-prompt include \
  docs/local-mode-plan.md:61-70 \
  companion/src/main.ts

# Copy output, paste to Chat (Edit Mode)
```

### Between Steps
- **Commit after each step** (git commit -m "Phase 1C Step 1: File operations")
- **Test acceptance criteria** before moving on
- **Update docs/README.md** with progress

### If You Get Stuck
- Reference `docs/architecture-update-2025-12.md`
- Check `docs/websocket-protocol.md` for event formats
- Review Phase 1A/1B guides for patterns

---

## Next: Phase 2 (Show Control)

After completing Phase 1C, Phase 1 is **complete**! 🎉

Phase 2 will add:
- PowerPoint integration (presentation monitoring)
- Live cue tracking
- Dual-timer system
- External video monitoring (Production tier)

**Duration:** 4-6 weeks  
**Guide:** To be created after Phase 1C completion

---

**Last Updated:** December 13, 2025  
**Ready for:** Implementation  
**Prerequisites:** Phase 1A ✅ Phase 1B ✅
