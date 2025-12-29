---
Type: Interface
Status: current
Owner: KDB
Last updated: 2025-12-30
Scope: Canonical protocol contract for Client, Cloud (Firebase), and Local (Companion).
---

# Interface Specification (v1.0.0)

**Changelog**
- v1.0.0 (2025-12-30): Initial consolidated interface specification; aligned with current Companion + Firebase behavior.

## 1. Scope and Roles
- **Controller**: Authenticated owner role; can write and control timers.
- **Viewer**: Read-only access to room state.
- **Companion**: Local relay server with token-based auth.

## 2. Frontend ↔ Cloud (Firestore)

### 2.1 Collections and Schemas
**`rooms/{roomId}`** (metadata)
- `ownerId: string`
- `title: string`
- `timezone: string`
- `createdAt: timestamp | number`
- `order?: number`
- `tier?: 'basic' | 'show_control' | 'production'`
- `features?: { localMode: boolean; showControl: boolean; powerpoint: boolean; externalVideo: boolean }`
- `config.warningSec: number`
- `config.criticalSec: number`
- `_version?: number` (1 = legacy room-state-in-room; 2 = state subcollection)

**Legacy room state (v1, when `_version` is absent or 1)**
- `state.activeTimerId: string | null`
- `state.isRunning: boolean`
- `state.startedAt: timestamp | number | null`
- `state.elapsedOffset: number`
- `state.currentTime?: number`
- `state.lastUpdate?: number`
- `state.progress: Record<string, number>`
- `state.showClock: boolean`
- `state.clockMode?: '24h' | 'ampm'`
- `state.message.text: string`
- `state.message.visible: boolean`
- `state.message.color: 'green' | 'yellow' | 'red' | 'blue' | 'white' | 'none'`
- `state.activeLiveCueId?: string`

**`rooms/{roomId}/state/current`** (v2 room state)
- `activeTimerId: string | null`
- `isRunning: boolean`
- `startedAt: number | timestamp | null` (epoch ms preferred)
- `elapsedOffset: number`
- `currentTime?: number`
- `lastUpdate?: number`
- `progress: Record<string, number>`
- `showClock: boolean`
- `clockMode?: '24h' | 'ampm'`
- `message.text: string`
- `message.visible: boolean`
- `message.color: 'green' | 'yellow' | 'red' | 'blue' | 'white' | 'none'`
- `activeLiveCueId?: string`

**`rooms/{roomId}/timers/{timerId}`**
- `title: string`
- `speaker?: string`
- `duration: number` (seconds)
- `originalDuration?: number` (seconds)
- `type: 'countdown' | 'countup' | 'timeofday'`
- `order: number`
- `adjustmentLog?: Array<{ timestamp: number; delta: number; deviceId: string; reason: 'manual' | 'sync' | 'migration' }>`

**`rooms/{roomId}/liveCues/{cueId}`** (show control tier; planned)
- `id: string`
- `source: 'powerpoint' | 'external_video' | 'pdf'`
- `title: string`
- `duration?: number`
- `startedAt?: number`
- `status?: 'playing' | 'paused' | 'ended'`
- `config?: { warningSec?: number; criticalSec?: number }`
- `metadata?: { slideNumber?: number; totalSlides?: number; slideNotes?: string; filename?: string; player?: string; parentTimerId?: string; autoAdvanceNext?: boolean }`

### 2.2 Security Rules (Summary)
- Public read access to rooms/timers for viewers.
- Owner-only writes for rooms/timers/state.

## 3. Frontend ↔ Local (Companion)

### 3.1 Token Model
- Token retrieved from Companion HTTP endpoint (loopback by default).
- Token is required for all WebSocket `JOIN_ROOM` calls.
- Role is inferred from `clientType: 'controller' | 'viewer'`.

### 3.2 WebSocket Events
**Client → Server: `JOIN_ROOM`**
```json
{
  "type": "JOIN_ROOM",
  "roomId": "abc123",
  "token": "jwt-token",
  "clientType": "controller",
  "clientId": "client-uuid",
  "takeOver": false
}
```
Notes:
- `clientType` defaults to `viewer` unless explicitly set to `controller`.
- `clientId` defaults to the socket id if not provided.

**Server → Client: `HANDSHAKE_ACK`**
```json
{
  "type": "HANDSHAKE_ACK",
  "success": true,
  "companionMode": "minimal",
  "companionVersion": "1.0.0",
  "capabilities": {
    "powerpoint": false,
    "externalVideo": false,
    "fileOperations": true
  },
  "systemInfo": {
    "platform": "darwin",
    "hostname": "host-name"
  }
}
```

**Server → Client: `HANDSHAKE_ERROR`**
```json
{
  "type": "HANDSHAKE_ERROR",
  "code": "INVALID_TOKEN",
  "message": "Invalid token."
}
```
**Handshake error codes (current):** `INVALID_TOKEN`, `INVALID_PAYLOAD`, `CONTROLLER_TAKEN`.

**Server → Client: `ROOM_STATE_SNAPSHOT`**
```json
{
  "type": "ROOM_STATE_SNAPSHOT",
  "roomId": "abc123",
  "state": {
    "activeTimerId": "timer-1",
    "isRunning": true,
    "currentTime": 12345,
    "lastUpdate": 1234567890
  },
  "timestamp": 1234567890
}
```

**Server → Client: `ROOM_STATE_DELTA`**
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

**Client → Server: `TIMER_ACTION`**
```json
{
  "type": "TIMER_ACTION",
  "action": "START",
  "roomId": "abc123",
  "timerId": "timer-1",
  "timestamp": 1234567890,
  "clientId": "client-uuid",
  "currentTime": 12345
}
```

**Client → Server: `ROOM_STATE_PATCH`**
```json
{
  "type": "ROOM_STATE_PATCH",
  "roomId": "abc123",
  "changes": {
    "activeTimerId": "timer-2",
    "isRunning": false,
    "currentTime": 120000,
    "lastUpdate": 1234567895
  },
  "clientId": "client-uuid",
  "timestamp": 1234567895
}
```
Notes:
- `timestamp` is optional; server uses `Date.now()` if omitted.

**Client → Server: `SYNC_ROOM_STATE`**
```json
{
  "type": "SYNC_ROOM_STATE",
  "roomId": "abc123",
  "timers": [],
  "state": {
    "activeTimerId": "timer-1",
    "isRunning": true,
    "currentTime": 12345,
    "lastUpdate": 1234567890
  },
  "sourceClientId": "client-uuid",
  "timestamp": 1234567890
}
```
Notes:
- `timers` is optional; when omitted, only state is applied.

**Timer CRUD (Client → Server)**
- `CREATE_TIMER`, `UPDATE_TIMER`, `DELETE_TIMER`, `REORDER_TIMERS`

**Timer CRUD (Server → Client)**
- `TIMER_CREATED`, `TIMER_UPDATED`, `TIMER_DELETED`, `TIMERS_REORDERED`

**Show Control Events (planned)**
- `LIVE_CUE_CREATED`, `LIVE_CUE_UPDATED`, `LIVE_CUE_ENDED`
- `PRESENTATION_LOADED`, `PRESENTATION_UPDATE`

### 3.3 Error Codes
**Generic `ERROR` event codes:** `INVALID_PAYLOAD`, `PERMISSION_DENIED`

**`TIMER_ERROR` codes:** `INVALID_PAYLOAD`, `INVALID_FIELDS`, `NOT_FOUND`

**`HANDSHAKE_ERROR` codes:** `INVALID_TOKEN`, `INVALID_PAYLOAD`, `CONTROLLER_TAKEN`

**Show-control errors (planned):** `FEATURE_UNAVAILABLE`

### 3.4 PNA/CORS Requirements
- `GET /api/token` includes `Access-Control-Allow-Private-Network: true` to satisfy browser private-network access.
- LAN-mode endpoints should include PNA headers when LAN binding is enabled (planned).
- Origins must be allowlisted by Companion.

## 4. Companion REST API (Loopback by Default)
- `GET /api/token` → `{ token, expiresAt }` (JSON), or HTML when using `?return=` for trust flow
- `POST /api/open` → `{ success: true }` (file open; requires Bearer token)
- `GET /api/file/metadata?path=...` → `{ size, duration?, resolution?, warning? }`

## 5. Bridge Protocol (Local ↔ Cloud)
- Controllers emit `SYNC_ROOM_STATE` to align Companion with Firebase.
- Timestamp arbitration uses lastUpdate/currentTime; see `docs/local-mode.md`.

## 6. Versioning & Deprecation
- This spec follows SemVer.
- Breaking protocol changes require a major version bump and migration notes.
- Deprecated events must be listed in the changelog with replacement guidance.
