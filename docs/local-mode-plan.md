# Implementation Plan: Local Mode Foundation (Phase 1)

## 1. Goal
Establish a stable, offline-capable "Local Mode" where the OnTime Controller and Viewers communicate via a local Companion App (WebSocket Relay) instead of Firebase. This serves as the foundation for future Show Control features.

## 2. Architecture

### 2.1 The "Hybrid" Transport Layer
The frontend will support two distinct transport mechanisms:
1.  **Firebase (Cloud):** Existing implementation. Used for remote access and persistence.
2.  **Companion (Local):** New implementation. Used for low-latency LAN communication and offline resilience.

### 2.2 The Companion App (Electron)
A lightweight Node.js/Electron application running on the operator's machine.
*   **Server:** Runs a WebSocket server (e.g., `socket.io`) on port 4000.
*   **State:** Maintains an in-memory copy of the `RoomState`.
*   **Relay:** Broadcasts state changes to all connected clients (Controller, Viewers).
*   **API:** Exposes HTTP endpoints for file operations.
*   **Security:** Token-based authentication for LAN connections.
*   **Distribution (Phase 1 definition-of-done):** Companion is a separate desktop app installed on the **Controller/operator machine only** (Viewers do not install Companion). Local Mode requires Companion; cloud/Firebase mode does not.
*   **Modes:** Configurable operation modes to minimize resource usage:
    *   **Minimal Mode:** WebSocket relay only (timers, offline sync). ~20-50 MB RAM, 1-2% CPU.
    *   **Show Control Mode:** Adds PowerPoint/presentation monitoring via COM API. ~75-100 MB RAM, 3-5% CPU.
    *   **Full Production Mode:** All sensors including external video player monitoring. ~100-150 MB RAM, 5-10% CPU.

## 3. Technical Specifications

### 3.1 WebSocket Protocol (Event Schema)

**Client → Server Events:**
*   `JOIN_ROOM`: `{ type: "JOIN_ROOM", roomId: string, token: string }`
*   `TIMER_ACTION`: `{ type: "TIMER_START" | "TIMER_PAUSE" | "TIMER_RESET", roomId: string, timerId: string }`
*   `TIMER_UPDATE`: `{ type: "TIMER_UPDATE", roomId: string, timerId: string, changes: Partial<Timer> }`
*   `SET_ACTIVE_TIMER`: `{ type: "SET_ACTIVE_TIMER", roomId: string, timerId: string }`

**Example: TIMER_START**
```json
{
  "type": "TIMER_START",
  "roomId": "abc123",
  "timerId": "timer-1",
  "timestamp": 1234567890
}
```

**Server → Client Events:**
*   `ROOM_STATE_SNAPSHOT`: `{ type: "ROOM_STATE_SNAPSHOT", roomId: string, state: RoomState }`
*   `ROOM_STATE_DELTA`: `{ type: "ROOM_STATE_DELTA", roomId: string, changes: Partial<RoomState> }`
*   `ERROR`: `{ type: "ERROR", code: string, message: string }`

### 3.2 Frontend Integration (`CompanionDataProvider`)
We will implement the `DataProvider` interface using a WebSocket client.
*   **Connection:** Connects to `ws://localhost:4000` with auth token.
*   **State Management:** Updates local React state on `ROOM_STATE_*` events.
*   **Optimistic Updates:** Applies changes locally immediately, then emits to socket.

### 3.3 Hybrid Sync Strategy
*   **Write-Through:** Controller writes to *both* WebSocket and Firestore (if online).
*   **Read Preference:** Viewers prefer WebSocket data for latency, falling back to Firestore.
*   **Offline Queue Implementation:**
    *   **Storage:** Persisted to disk (`~/.ontime/queue/pending.json`).
    *   **Conflict Resolution:** Last-Write-Wins (newer timestamp overwrites).
    *   **Flush Strategy:** On reconnect, replay actions in timestamp order.

### 3.4 File Operations API (Required for Phase 2)
*   `POST /api/open`: Opens local file in default OS app. Body: `{ path: string }`.
*   `GET /api/file/exists`: Checks file existence. Query: `?path=...`.
*   `GET /api/file/metadata`: Extracts duration/resolution. Query: `?path=...`.

**Video metadata note:** Duration/resolution extraction should use a bundled `ffprobe` binary in production Companion builds so end users do not need separate FFmpeg installs. The bundled `ffprobe` MUST come from an **LGPL-only** FFmpeg build (no GPL / no “nonfree” components) unless explicitly approved and documented. If `ffprobe` is not present (dev builds/edge cases), return a warning and fallback to size-only metadata.

### 3.5 Security & Authentication
*   **Token:** Companion exposes a short-lived token via `GET /api/token` (loopback only + Origin allowlist).
*   **Handshake:** Clients provide token in `JOIN_ROOM` payload.
*   **HTTP auth:** File operations require `Authorization: Bearer <token>`.
*   **Validation:** Server rejects invalid/expired tokens and invalid Origins; never logs raw tokens.

### 3.6 State Initialization
*   **Cache Location (Platform-Specific):**
    *   Windows: `%APPDATA%\OnTime\cache\rooms.json`
    *   macOS: `~/Library/Application Support/OnTime/cache/rooms.json`
    *   Linux: `~/.config/ontime/cache/rooms.json`
*   **Startup:** Companion loads state from local cache.
*   **Sync:** If online, fetches latest from Firebase to update cache.
*   **Fallback:** If offline + no cache, starts empty.

### 3.7 Feature Flags & Modularity
*   **Room Configuration:** Each room has feature flags determining available capabilities.
*   **Tier-Based Access:**
    *   **Basic Tier:** Core timers, offline mode (Companion Minimal)
    *   **Show Control Tier:** PowerPoint integration, live cues, dual-header UI
    *   **Production Tier:** External video monitoring, multi-operator roles
*   **Data Model:** Advanced features use optional fields and subcollections to minimize sync overhead for basic users.
*   **UI Adaptation:** Controller automatically hides/shows features based on room tier and active capabilities.

## 4. Phased Implementation Strategy

### Phase 1A: Proof of Concept (Weeks 1-2)
*   **Goal:** Basic WebSocket relay. Timer syncs over LAN.
*   **Scope:**
    *   Electron App Skeleton (Port 4000) with Minimal Mode.
    *   WebSocket Server (No Auth).
    *   `CompanionDataProvider` (Read/Write).
    *   Basic `ROOM_STATE_UPDATE` broadcast.
    *   Feature flag infrastructure (room config).

### Phase 1B: Production Hardening (Weeks 3-5)
*   **Goal:** Reliable, secure local mode.
*   **Scope:**
    *   Token-based Authentication.
    *   State Initialization (Cache).
    *   Offline Queue & Conflict Resolution.
    *   Hybrid Sync Logic.

### Phase 1C: File Operations (Weeks 6-7)
*   **Goal:** Ready for Show Control.
*   **Scope:**
    *   Implement `/api/open` and metadata endpoints.
    *   Secure path validation.
    *   Attachment system integration.

## 5. Edge Cases & Implementation Notes

### 5.1 Firestore Security Rules Update
With the new data model separation, security rules must be updated:

```javascript
match /rooms/{roomId} {
  // Room config: Public read for viewers (share-by-roomId), owner write.
  // If we ever need "private rooms", change reads to authenticated-only and gate viewer access explicitly.
  allow read: if true;
  allow write: if isOwner(roomId);
  
  // RoomState subcollection (v2): public read for viewers, owner write.
  match /state/current {
    allow read: if true;
    allow write: if isOwner(roomId);
  }

  // Timers: public read for viewers, owner write.
  match /timers/{timerId} {
    allow read: if true;
    allow write: if isOwner(roomId);
  }
  
  // LiveCues: Show Control tier+ only (auth read + owner write).
  match /liveCues/{cueId} {
    allow read: if isAuthenticated() && hasShowControlTier(roomId);
    allow write: if isOwner(roomId) && hasShowControlTier(roomId);
  }

  // Migration backups (rollback support): owner-only.
  match /migrationBackups/{backupId} {
    allow read, write: if isOwner(roomId);
  }
}
```

**Action:** Update `/firebase/firestore.rules` in Phase 1A.

### 5.2 Tier Upgrade Cache Invalidation
**Scenario:** User upgrades from Basic → Show Control mid-session.

**Solution:** Use Firestore real-time listener on Room config:
```typescript
const roomRef = doc(db, 'rooms', roomId);
onSnapshot(roomRef, (snap) => {
  const room = snap.data() as Room;
  if (room.tier !== currentTier) {
    updateFeatureFlags(room.features);
    reloadUI();  // Show newly unlocked features
  }
});
```

**Why:** `onSnapshot` provides instant tier changes without polling. Firestore doesn't charge extra reads for real-time updates after initial subscription.

**Action:** Implement in `FirebaseDataContext` during Phase 1A.

## 6. Verification Plan
*   **Phase 1A:** Disconnect internet -> Start Timer -> Viewer updates <50ms. Verify tier upgrade triggers UI reload.
*   **Phase 1B:** Restart Companion -> State persists. Internet drops -> Changes queued -> Reconnect -> Syncs.
*   **Phase 1C:** Click "Open Video" in Controller -> VLC launches.
