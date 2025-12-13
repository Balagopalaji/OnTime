# WebSocket Protocol Specification

## 1. Overview

This document defines the WebSocket communication protocol between the **OnTime Frontend** (Controller/Viewers) and the **Companion App** (local server).

**Connection:** `ws://localhost:4000`

---

## 2. Connection Handshake

### 2.1 Client → Server: `JOIN_ROOM`

**Purpose:** Authenticate and join a room session.

```json
{
  "type": "JOIN_ROOM",
  "roomId": "abc123",
  "token": "jwt-token-from-http-api",
  "clientType": "controller" | "viewer",
  "clientId": "client-uuid"
}
```

**Fields:**
- `roomId`: Target room identifier
- `token`: short-lived token from Companion `GET /api/token` (loopback-only + Origin allowlist)
- `clientType`: Distinguishes controllers from viewers
- `clientId`: Unique client identifier for reconnection

---

### 2.2 Server → Client: `HANDSHAKE_ACK`

**Purpose:** Confirm connection and provide Companion capabilities.

```json
{
  "type": "HANDSHAKE_ACK",
  "success": true,
  "companionMode": "minimal" | "show_control" | "production",
  "companionVersion": "1.0.0",
  "capabilities": {
    "powerpoint": false,     // true if Show Control+ mode
    "externalVideo": false,  // true if Production mode
    "fileOperations": true   // true for all modes
  },
  "systemInfo": {
    "platform": "darwin" | "win32" | "linux",
    "hostname": "Johns-MacBook-Pro"
  }
}
```

**Why This Matters:**
- Frontend knows if connected Companion supports PowerPoint features
- UI can disable/hide features unavailable in current mode
- Prevents user confusion when Minimal Mode is running

---

### 2.3 Server → Client: `HANDSHAKE_ERROR`

**Purpose:** Reject connection with reason.

```json
{
  "type": "HANDSHAKE_ERROR",
  "code": "INVALID_TOKEN" | "ROOM_NOT_FOUND" | "SERVER_BUSY",
  "message": "Invalid token. Please fetch a fresh token from the Companion app."
}
```

---

## 3. Room State Synchronization

### 3.1 Server → Client: `ROOM_STATE_SNAPSHOT`

**Purpose:** Send full room state on initial connection.

```json
{
  "type": "ROOM_STATE_SNAPSHOT",
  "roomId": "abc123",
  "state": {
    "activeTimerId": "timer-1",
    "isRunning": true,
    "currentTime": 12345,
    "lastUpdate": 1234567890,
    "activeLiveCueId": "cue-1"  // Optional (Show Control+ only)
  },
  "timestamp": 1234567890
}
```

---

### 3.2 Client → Server: `TIMER_ACTION`

**Purpose:** Control timer state (start, pause, reset).

```json
{
  "type": "TIMER_ACTION",
  "action": "START" | "PAUSE" | "RESET",
  "roomId": "abc123",
  "timerId": "timer-1",
  "timestamp": 1234567890,
  "clientId": "client-uuid"
}
```

---

### 3.3 Server → Client: `ROOM_STATE_DELTA`

**Purpose:** Broadcast incremental state changes to all clients.

```json
{
  "type": "ROOM_STATE_DELTA",
  "roomId": "abc123",
  "changes": {
    "isRunning": false,
    "currentTime": 12350,
    "lastUpdate": 1234567892
  },
  "clientId": "client-uuid",
  "timestamp": 1234567892
}
```

---

### 3.4 Timer CRUD (Minimal Mode)

These events manage timers (create/update/delete/reorder) and are available in Minimal Mode.

**Client → Server: `CREATE_TIMER`**
```json
{
  "type": "CREATE_TIMER",
  "roomId": "abc123",
  "timer": {
    "id": "timer-uuid-optional",
    "title": "Opening Remarks",
    "duration": 300,
    "speaker": "Host",
    "type": "countdown",
    "order": 10
  },
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Client → Server: `UPDATE_TIMER`**
```json
{
  "type": "UPDATE_TIMER",
  "roomId": "abc123",
  "timerId": "timer-1",
  "changes": { "title": "Updated title", "duration": 240 },
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Client → Server: `DELETE_TIMER`**
```json
{
  "type": "DELETE_TIMER",
  "roomId": "abc123",
  "timerId": "timer-1",
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Client → Server: `REORDER_TIMERS`**
```json
{
  "type": "REORDER_TIMERS",
  "roomId": "abc123",
  "timerIds": ["timer-3", "timer-1", "timer-2"],
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Server → Clients: `TIMER_CREATED/UPDATED/DELETED/TIMERS_REORDERED`**
```json
{
  "type": "TIMER_CREATED",
  "roomId": "abc123",
  "timer": { "id": "timer-1", "roomId": "abc123", "title": "Opening", "duration": 300, "type": "countdown", "order": 10 },
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

```json
{
  "type": "TIMER_UPDATED",
  "roomId": "abc123",
  "timerId": "timer-1",
  "changes": { "duration": 240 },
  "clientId": "client-uuid",
  "timestamp": 1234567891
}
```

```json
{
  "type": "TIMER_DELETED",
  "roomId": "abc123",
  "timerId": "timer-1",
  "clientId": "client-uuid",
  "timestamp": 1234567892
}
```

```json
{
  "type": "TIMERS_REORDERED",
  "roomId": "abc123",
  "timerIds": ["timer-3", "timer-1", "timer-2"],
  "clientId": "client-uuid",
  "timestamp": 1234567893
}
```

**Server → Client: `TIMER_ERROR`**
```json
{
  "type": "TIMER_ERROR",
  "roomId": "abc123",
  "code": "INVALID_PAYLOAD" | "INVALID_FIELDS" | "NOT_FOUND",
  "message": "Timer requires non-empty title and duration > 0.",
  "clientId": "client-uuid",
  "timestamp": 1234567899
}
```

## 4. Show Control Events (Show Control+ Modes Only)

### 4.1 Server → Clients: `LIVE_CUE_CREATED`

**Purpose:** Notify that a live cue has started (e.g., PowerPoint video detected).

```json
{
  "type": "LIVE_CUE_CREATED",
  "roomId": "abc123",
  "cue": {
    "id": "cue-ppt-video-1",
    "source": "powerpoint",
    "title": "Intro Video (Slide 5)",
    "duration": 154,
    "startedAt": 1234567890,
    "status": "playing",
    "metadata": {
      "slideNumber": 5,
      "totalSlides": 67,
      "slideNotes": "Cue lights down at end"
    }
  }
}
```

**Note:** Only emitted when Companion is in `show_control` or `production` mode.

---

### 4.2 Server → Clients: `LIVE_CUE_UPDATED`

**Purpose:** Update existing live cue (pause, resume, progress).

```json
{
  "type": "LIVE_CUE_UPDATED",
  "roomId": "abc123",
  "cueId": "cue-ppt-video-1",
  "changes": {
    "status": "paused",
    "currentTime": 45
  }
}
```

---

### 4.3 Server → Clients: `LIVE_CUE_ENDED`

**Purpose:** Notify that a live cue has finished.

```json
{
  "type": "LIVE_CUE_ENDED",
  "roomId": "abc123",
  "cueId": "cue-ppt-video-1"
}
```

---

## 5. Presentation Monitoring (Show Control+ Only)

### 5.1 Server → Clients: `PRESENTATION_LOADED`

**Purpose:** Notify that a PowerPoint presentation was opened.

```json
{
  "type": "PRESENTATION_LOADED",
  "roomId": "abc123",
  "presentation": {
    "filename": "Sunday-Sermon.pptx",
    "path": "/Users/john/Documents/Sermon.pptx",
    "totalSlides": 67,
    "detectedVideos": [
      {
        "slideNumber": 5,
        "filename": "intro.mp4",
        "duration": 154
      },
      {
        "slideNumber": 28,
        "filename": "testimony.mp4",
        "duration": 135
      }
    ]
  }
}
```

---

### 5.2 Server → Clients: `PRESENTATION_UPDATE`

**Purpose:** Broadcast slide changes.

```json
{
  "type": "PRESENTATION_UPDATE",
  "roomId": "abc123",
  "currentSlide": 23,
  "totalSlides": 67,
  "slideTitle": "Main Point 2",
  "slideNotes": "Wait for applause",
  "upcomingCues": [
    {
      "slideNumber": 28,
      "type": "video",
      "title": "Testimony Video",
      "slidesAway": 5
    }
  ]
}
```

---

## 6. Error Handling

### 6.1 Server → Client: `ERROR`

**Purpose:** Notify client of errors.

```json
{
  "type": "ERROR",
  "code": "FEATURE_UNAVAILABLE" | "PERMISSION_DENIED" | "INVALID_ACTION",
  "message": "PowerPoint monitoring is not available in Minimal Mode. Please restart Companion in Show Control mode.",
  "context": {
    "companionMode": "minimal",
    "requestedFeature": "powerpoint"
  }
}
```

---

## 7. Heartbeat & Connection Management

### 7.1 Ping/Pong

**Client → Server** (every 30 seconds):
```json
{ "type": "PING", "timestamp": 1234567890 }
```

**Server → Client:**
```json
{ "type": "PONG", "timestamp": 1234567890 }
```

**Timeout:** If no PONG received within 5 seconds, client assumes disconnection.

---

### 7.2 Reconnection Protocol

1. **Client detects disconnect** (no PONG or WebSocket close)
2. **UI shows:** "⚠️ Companion Disconnected - Attempting to reconnect..."
3. **Retry Strategy:**
   - Attempt 1: Immediate
   - Attempt 2-5: Every 2 seconds
   - Attempt 6+: Every 10 seconds
4. **On Reconnect:** Send `JOIN_ROOM` with same `clientId` to resume session

---

## 8. Mode-Specific Behavior

### 8.1 Minimal Mode

**Available Events:**
- ✅ `JOIN_ROOM`, `HANDSHAKE_ACK`
- ✅ `ROOM_STATE_SNAPSHOT`, `ROOM_STATE_DELTA`
- ✅ `TIMER_ACTION`
- ✅ `CREATE_TIMER`, `UPDATE_TIMER`, `DELETE_TIMER`, `REORDER_TIMERS`
- ✅ `TIMER_CREATED`, `TIMER_UPDATED`, `TIMER_DELETED`, `TIMERS_REORDERED`, `TIMER_ERROR`
- ❌ `LIVE_CUE_*`, `PRESENTATION_*`

**Companion Response:** If client requests show control feature, send `ERROR` with `code: "FEATURE_UNAVAILABLE"`.

---

### 8.2 Show Control Mode

**Available Events:**
- ✅ All Minimal Mode events
- ✅ `LIVE_CUE_CREATED/UPDATED/ENDED`
- ✅ `PRESENTATION_LOADED/UPDATE`
- ❌ External video monitoring

---

### 8.3 Production Mode

**Available Events:**
- ✅ All Show Control Mode events
- ✅ External video monitoring
- ✅ Advanced integrations

---

## 9. Security Considerations

### 9.1 Token Validation
- All `JOIN_ROOM` requests must include a valid token
- Token is served via `GET /api/token` on the loopback-only Companion HTTP server (Origin allowlist)
- Token regenerates on Companion restart and expires (see Companion implementation)

### 9.2 Local-Only Connections
- Companion binds to `127.0.0.1` (localhost only)
- Does not accept external network connections (future: opt-in LAN mode with better auth)

### 9.3 Action Validation
- Phase 1: minimal validation focuses on payload shape + token authentication.
- Future hardening (Phase 2+): restrict control events to controller role and enforce room ownership/permissions.

---

## 10. Example Flow: Minimal Mode Connection

```
1. User launches Companion in Minimal Mode
   Companion → token available via http://127.0.0.1:4001/api/token

2. User opens OnTime Controller, toggles "Local Mode"
   Frontend → ws://localhost:4000

3. Frontend sends JOIN_ROOM
   {
     "type": "JOIN_ROOM",
     "roomId": "abc123",
     "token": "jwt-token-from-http-api",
     "clientType": "controller"
   }

4. Companion validates token, sends HANDSHAKE_ACK
   {
     "type": "HANDSHAKE_ACK",
     "success": true,
     "companionMode": "minimal",
     "capabilities": {
       "powerpoint": false,
       "externalVideo": false
     }
   }

5. Frontend hides PowerPoint integration UI
   (Because companionMode !== 'show_control')

6. Companion sends current state
   {
     "type": "ROOM_STATE_SNAPSHOT",
     "state": { ... }
   }

7. Connection established ✅
```

---

**Version:** 1.0  
**Last Updated:** December 11, 2025
