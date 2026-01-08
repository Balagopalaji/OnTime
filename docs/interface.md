---
Type: Interface
Status: current
Owner: KDB
Last updated: 2025-12-30
Scope: Canonical protocol contract for Client, Cloud (Firebase), and Local (Companion).
---

# Interface Specification (v1.2.0)

**Changelog**
- v1.2.0 (2025-12-30): Added planned show cue + crew chat schemas (Phase 3).
- v1.1.0 (2025-12-30): Added live cue video timing metadata fields (additive).
- v1.0.0 (2025-12-30): Initial consolidated interface specification; aligned with current Companion + Firebase behavior.

## 1. Scope and Roles
- **Controller**: Authenticated owner role; can write and control timers.
- **Viewer**: Read-only access to room state.
- **Companion**: Local relay server with token-based auth.

**Viewer timer sizing**
- Viewer timer typography uses `FitText` with `vhMax`/`vwMax` caps to avoid overflow on extreme aspect ratios.

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
- `state.timerDelegate?: { userId: string; role: string; level: 'adjustments_only' | 'full_control'; delegatedAt: number; delegatedBy: string }` (Phase 3 planned)
- `state.showCallerMode?: { enabled: boolean; audioStandby: boolean; audioWarning: boolean; audioGo: boolean; ttsEnabled: boolean; ttsFormat: 'role_number' | 'full_title'; autoAdvanceTimedSec: number; autoFireFollow: boolean }` (Phase 3 planned)

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
- `timerDelegate?: { userId: string; role: string; level: 'adjustments_only' | 'full_control'; delegatedAt: number; delegatedBy: string }` (Phase 3 planned)
- `showCallerMode?: { enabled: boolean; audioStandby: boolean; audioWarning: boolean; audioGo: boolean; ttsEnabled: boolean; ttsFormat: 'role_number' | 'full_title'; autoAdvanceTimedSec: number; autoFireFollow: boolean }` (Phase 3 planned)

**`rooms/{roomId}/timers/{timerId}`**
- `title: string`
- `speaker?: string`
- `duration: number` (seconds)
- `originalDuration?: number` (seconds)
- `type: 'countdown' | 'countup' | 'timeofday'`
- `order: number`
- `segmentId?: string` (optional link to segment)
- `segmentOrder?: number` (sequence within segment; 0 = primary timer)
- `adjustmentLog?: Array<{ timestamp: number; delta: number; deviceId: string; reason: 'manual' | 'sync' | 'migration' }>`
Notes:
- Timers with the same `segmentId` are sequential; `segmentOrder` controls display/order.
- Parallel timers are not supported in Phase 3; use a second room for truly concurrent timers.

**`rooms/{roomId}/sections/{sectionId}`** (Phase 3: session/group headers)
- **Purpose:** Session/grouping layer above segments (e.g., "Morning Session", "Worship Set").
- `id: string`
- `title: string`
- `order: number`
- `notes?: string`
- `plannedDurationSec?: number` (optional)
- `plannedStartAt?: number` (optional time-of-day)
- `createdAt?: number`
- `updatedAt?: number`
Notes:
- Sections are grouping headers; they can optionally carry cues via `sectionId` on cues.

**`rooms/{roomId}/segments/{segmentId}`** (Phase 3: rundown items)
- **Purpose:** Ordered items within a section (e.g., "Speaker 1", "Song 2").
- `id: string`
- `sectionId?: string` (optional grouping)
- `title: string`
- `order: number`
- `plannedStartAt?: number` (optional time-of-day)
- `plannedDurationSec?: number`
- `primaryTimerId?: string` (optional link to default segment timer)
- `notes?: string`
- `createdAt?: number`
- `updatedAt?: number`
Notes:
- If `primaryTimerId` is unset, the timer with `segmentOrder = 0` is the default segment timer.
- Segment start is considered active when the operator starts the segment or when any segment timer starts.

**`rooms/{roomId}/liveCues/{cueId}`** (Phase 2c: presentation-driven, auto-generated)
- **Purpose:** Auto-generated cues from Companion detecting PowerPoint/video state. Not manually authored.
- `id: string`
- `source: 'powerpoint' | 'external_video' | 'pdf'`
- `title: string`
- `duration?: number`
- `startedAt?: number`
- `status?: 'playing' | 'paused' | 'ended'`
- `config?: { warningSec?: number; criticalSec?: number }`
- `metadata?: { slideNumber?: number; totalSlides?: number; slideNotes?: string; filename?: string; instanceId?: number; player?: string; parentTimerId?: string; autoAdvanceNext?: boolean; videoPlaying?: boolean; videoDuration?: number; videoElapsed?: number; videoRemaining?: number; videoTimingUnavailable?: boolean }`
  - Video timing fields are in milliseconds. `videoRemaining` may be computed client-side (`videoDuration - videoElapsed`) when not provided.
  - `videoTimingUnavailable` is set to true when video timing data is not available (macOS PowerPoint).
- `updatedAt?: number` (write-through timestamp)
- `writeSource?: 'companion' | 'controller'` (write-through origin; distinct from cue `source`)

**`rooms/{roomId}/cues/{cueId}`** (Phase 3: manual rundown cues, Show Planner)
- **Purpose:** Manually authored cues in the Show Planner rundown. Operators create these for coordinating lighting, sound, video, stage management, etc.
- `id: string`
- `roomId: string`
- `role: string` (e.g., LX, AX, VX, SM, TD, Director, FOH, Custom)
- `title: string`
- `notes?: string`
- `sectionId?: string` (optional section-level cue)
- `segmentId?: string` (optional linkage to rundown segment)
- `triggerType: 'timed' | 'fixed_time' | 'sequential' | 'follow' | 'floating'`
- `offsetMs?: number` (timed: relative to segment or timer start)
- `timeBase?: 'actual' | 'planned'` (timed: default actual start; planned is optional)
- `targetTimeMs?: number` (fixed_time: absolute time-of-day)
- `afterCueId?: string` (follow: auto-fire after another cue completes)
- `approximatePosition?: number` (floating: 0-100% placement within segment)
- `triggerNote?: string` (e.g., "When pastor says 'let us pray'")
- `ackState?: 'pending' | 'done' | 'skipped'`
- `ackAt?: number`
- `ackBy?: string`
- `createdBy: string`
- `createdAt?: number`
- `updatedAt?: number`
- `editedBy?: string`
- `editNote?: string` (e.g., "edited by LX 2m ago")
Notes:
- Visual cue states (Standby/Warning/Imminent/Go) are derived client-side from time-to-cue.
- Manual acknowledgment sets `ackState` and freezes the cue as done or skipped.
- Role labels are freeform; recommended values: LX, AX, VX, SM, TD, Director, FOH, Custom.
- **Tech viewer separates sources:**
  - `liveCues` appear in a **Now Playing** status panel.
  - `cues` appear in an **Upcoming Cues** list sorted by time-to-cue.
Trigger notes:
- Timed cues follow countdown states; `timeBase` defaults to actual start.
- If `sectionId` is set and `segmentId` is unset, timed cues anchor to section start.
- Sequential cues enter Standby when they are the next cue for that role; Go is manual.
- Follow cues fire when their parent cue is marked Done (optional delay is UI-driven).
- Floating cues are placed visually; operators can drag to approximate positions.

**`rooms/{roomId}/crewChat/{messageId}`** (crew messaging; planned)
- `id: string`
- `roomId: string`
- `senderId: string`
- `senderName?: string`
- `senderRole?: string`
- `message: string`
- `audience: 'all' | 'roles'`
- `roles?: string[]` (when audience is `roles`)
- `type?: 'text' | 'preset'`
- `presetId?: string` (when type is `preset`)
- `createdAt: number`

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
  "ownerId": "owner-uid",
  "takeOver": false
}
```
Notes:
- `clientType` defaults to `viewer` unless explicitly set to `controller`.
- `clientId` defaults to the socket id if not provided.
- `ownerId` is optional; Companion caches it when it matches `userId` to enforce owner-only PIN edits.
- `takeOver` is ignored; lock enforcement uses explicit control events (`REQUEST_CONTROL`, `FORCE_TAKEOVER`, `HAND_OVER`).

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

**Server → Client: `COMPANION_MODE_CHANGED`**
```json
{
  "type": "COMPANION_MODE_CHANGED",
  "companionMode": "show_control",
  "capabilities": {
    "powerpoint": true,
    "externalVideo": false,
    "fileOperations": true
  },
  "timestamp": 1234567890
}
```
Notes:
- Emitted to all connected clients when Companion mode changes.
- Clients should update local capabilities state without reconnecting.
- The `timestamp` field indicates when the mode change occurred.

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

**Client → Server: `HEARTBEAT`**
```json
{
  "type": "HEARTBEAT",
  "roomId": "abc123",
  "clientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Server → Client: `CONTROLLER_LOCK_STATE`**
```json
{
  "type": "CONTROLLER_LOCK_STATE",
  "roomId": "abc123",
  "lock": {
    "clientId": "client-uuid",
    "deviceName": "Chrome on macOS",
    "userId": "owner-uid",
    "userName": "Operator",
    "lockedAt": 1234567890,
    "lastHeartbeat": 1234567890,
    "roomId": "abc123"
  },
  "timestamp": 1234567890
}
```
Notes:
- `lock` is `null` when no controller is authoritative.

**Client → Server: `REQUEST_CONTROL`**
```json
{
  "type": "REQUEST_CONTROL",
  "roomId": "abc123",
  "clientId": "client-uuid",
  "deviceName": "Chrome on macOS",
  "timestamp": 1234567890
}
```

**Server → Client: `CONTROL_REQUEST_RECEIVED`**
```json
{
  "type": "CONTROL_REQUEST_RECEIVED",
  "roomId": "abc123",
  "requesterId": "client-uuid",
  "requesterName": "Chrome on macOS",
  "requesterUserId": "user-uid",
  "requesterUserName": "Operator",
  "timestamp": 1234567890
}
```

**Client → Server: `DENY_CONTROL`**
```json
{
  "type": "DENY_CONTROL",
  "roomId": "abc123",
  "requesterId": "client-uuid",
  "timestamp": 1234567890
}
```

**Server → Client: `CONTROL_REQUEST_DENIED`**
```json
{
  "type": "CONTROL_REQUEST_DENIED",
  "roomId": "abc123",
  "requesterId": "client-uuid",
  "reason": "denied_by_controller",
  "deniedByName": "Chrome on macOS",
  "deniedByUserId": "user-uid",
  "deniedByUserName": "Operator",
  "timestamp": 1234567890
}
```

**Client → Server: `FORCE_TAKEOVER`**
```json
{
  "type": "FORCE_TAKEOVER",
  "roomId": "abc123",
  "clientId": "client-uuid",
  "pin": "4821",
  "reauthenticated": true,
  "timestamp": 1234567890
}
```
Notes:
- Provide either `pin` or `reauthenticated` for immediate takeover.

**Client → Server: `HAND_OVER`**
```json
{
  "type": "HAND_OVER",
  "roomId": "abc123",
  "targetClientId": "client-uuid",
  "timestamp": 1234567890
}
```

**Server → Client: `ROOM_PIN_STATE`**
```json
{
  "type": "ROOM_PIN_STATE",
  "roomId": "abc123",
  "pin": "4821",
  "updatedAt": 1234567890
}
```

**Server → Client: `ROOM_CLIENTS_STATE`**
```json
{
  "type": "ROOM_CLIENTS_STATE",
  "roomId": "abc123",
  "clients": [
    {
      "clientId": "client-uuid",
      "clientType": "controller",
      "deviceName": "Chrome on macOS",
      "userId": "user-uid",
      "userName": "Operator",
      "connectedAt": 1234567890
    }
  ],
  "timestamp": 1234567890
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
Notes:
- `currentTime` is optional and used when switching timers to preserve stored progress; if omitted while switching, the server resets `currentTime` to 0.

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
- Only the following change keys are accepted: `activeTimerId`, `isRunning`, `currentTime`, `lastUpdate`.

**Planned Phase 3 events (Companion offline support, optional)**
- Cue CRUD: `CREATE_CUE`, `CUE_CREATED`, `UPDATE_CUE`, `CUE_UPDATED`, `DELETE_CUE`, `CUE_DELETED`, `REORDER_CUES`, `CUES_REORDERED`.
- Cue acknowledgment: `ACK_CUE`, `CUE_ACKED`.
- Timer delegation: `DELEGATE_TIMER`, `TIMER_DELEGATED`, `RECLAIM_TIMER`, `TIMER_RECLAIMED`.
- Crew chat: `SEND_CHAT`, `CHAT_MESSAGE`.
Notes:
- Firestore is the canonical store for cues/chat; Companion events are optional to enable offline/LAN flows.

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

**Server → Client: `TIMER_ERROR`**
```json
{
  "type": "TIMER_ERROR",
  "roomId": "abc123",
  "code": "INVALID_FIELDS",
  "message": "Timer requires non-empty title and duration > 0.",
  "clientId": "client-uuid",
  "timestamp": 1234567899
}
```

**Show Control Events (planned)**
- `LIVE_CUE_CREATED`, `LIVE_CUE_UPDATED`, `LIVE_CUE_ENDED`
- `PRESENTATION_LOADED`, `PRESENTATION_UPDATE`
- `PRESENTATION_CLEAR` (presentation closed or idle/backgrounded; payload includes `cueId` when available)

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
- `GET /api/file/metadata?path=...` → `{ size, duration?, resolution?, warning? }` (requires Bearer token)
- `GET /api/file/exists?path=...` → `{ exists: boolean }` (validates path before open; requires Bearer token)

Phase 2c hardening requirement: file endpoints must enforce path normalization, allowlist roots, and reject symlinks/network paths.

## 5. Bridge Protocol (Local ↔ Cloud)
- Controllers emit `SYNC_ROOM_STATE` to align Companion with Firebase.
- Timestamp arbitration uses lastUpdate/currentTime; see `docs/local-mode.md`.

## 6. Versioning & Deprecation
- This spec follows SemVer.
- Breaking protocol changes require a major version bump and migration notes.
- Deprecated events must be listed in the changelog with replacement guidance.
