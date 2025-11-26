# StageTime Backend PRD (MVP1)

## 1. Scope & Platform
Backend for StageTime MVP1 relies entirely on Firebase:
- **Auth:** Firebase Authentication with Google Sign-In and Email/Password providers.
- **Database:** Cloud Firestore (near-real-time sync).
- **Hosting:** Firebase Hosting for web assets.
- **Cloud Functions:** Not required for MVP1; all logic handled client-side with security rules enforcement.

Goals:
- Provide deterministic timer state for controller/viewer clients.
- Enforce owner-only writes via security rules.
- Keep viewer route publicly readable (confirmed decision).

## 2. Data Model
### 2.1 Collection: `rooms`
| Field | Type | Description | Notes |
| --- | --- | --- | --- |
| `ownerId` | string | UID of creating user; used for authorization. | Required; immutable post-create. |
| `title` | string | Human-readable room name (e.g., "Q3 Town Hall"). | 3–80 chars recommended. |
| `timezone` | string | IANA timezone ID (e.g., `America/New_York`). | Drives display context. |
| `createdAt` | timestamp | Firestore server timestamp at creation. | Set via `FieldValue.serverTimestamp()`. |
| `config.warningSec` | number | Seconds remaining threshold for yellow state (default 120). | Must be > `config.criticalSec`. |
| `config.criticalSec` | number | Seconds remaining threshold for red state (default 30). | Must be > 0. |
| `activeTimerId` | string/null | ID of currently selected timer. | Null when idle. |
| `isRunning` | boolean | True when timer is actively counting. | Drives controller button state. |
| `startedAt` | timestamp/null | Firestore timestamp when current run started. | Convert via `.toMillis()` client-side; null when paused/stopped. |
| `pausedAt` | timestamp/null | Optional timestamp for UI reference. | Stored as raw timestamp to ensure consistent typing. |
| `elapsedOffset` | number | Accumulated elapsed milliseconds for the *active* timer. | Defaults to 0 on timer reset. |
| `progress` | map | Map of `timerId` -> `elapsedMs`. | Preserves state of non-active timers. |
| `showClock` | boolean | Whether to display the current time instead of the timer. | Default false. |
| `message.text` | string | Overlay message content. | Optional; limit to ≤64 chars. |
| `message.visible` | boolean | Whether viewer shows message overlay. | Default false. |
| `message.color` | string | Color theme key (e.g., `red`, `blue`, `white`, `none`). | Controlled vocabulary. |

### 2.2 Sub-collection: `timers`
Path: `/rooms/{roomId}/timers/{timerId}`

| Field | Type | Description | Notes |
| --- | --- | --- | --- |
| `title` | string | Timer segment name (e.g., "Introduction"). | Required. |
| `speaker` | string | Optional presenter name. | Empty string allowed. |
| `duration` | number | Planned duration in seconds. | For `countdown` timers; default 300. |
| `type` | string | Timer behavior: `countdown`, `countup`, or `timeofday`. | MVP focuses on `countdown`; others supported by schema. |
| `order` | number | Integer used to sort rundown list. | Maintain unique sequence; prefer dense increments (e.g., 10,20,30) to simplify reindexing. |

### 2.3 Derived Interfaces
```ts
type RoomSyncState = {
  activeTimerId: string | null;
  isRunning: boolean;
  startedAt: FirebaseFirestore.Timestamp | null;
  elapsedOffset: number;
  progress: Record<string, number>;
  showClock: boolean;
  pausedAt: FirebaseFirestore.Timestamp | null;
  message: {
    text: string;
    visible: boolean;
    color: 'red' | 'yellow' | 'green' | 'blue' | 'white' | 'none';
  };
};
```

## 3. Core Operations
### Create Room
1. Authenticated user submits title/timezone.
2. Backend write: add document to `rooms` with `ownerId = uid`, defaults for config and sync state, `createdAt = serverTimestamp`.
3. Immediately create default timer(s) optionally (client-driven).

### Update Room Sync State
Used by controller actions; all writes require `request.auth.uid == ownerId`.
- **Start Timer:**
  ```ts
  await updateRoomState(roomId, {
    activeTimerId,
    isRunning: true,
    startedAt: FieldValue.serverTimestamp(), // stored as Firestore Timestamp
  }, uid);
// Clients must call startedAt?.toMillis() before mixing with Date.now()
  ```
- **Pause Timer:** Compute elapsed `elapsedOffset = (Date.now() - startedAt) + elapsedOffset`, then write `isRunning: false`, `startedAt: null`, updated `elapsedOffset`.
- **Reset Timer:** Set `elapsedOffset = 0`, `isRunning = false`, `startedAt = null`.

### Timer CRUD
- List timers ordered by `order`.
- Create/update/delete restricted to owner; operations performed via standard Firestore doc APIs.
- Reordering implemented by updating `order` values in a batch, using either dense integers (1,2,3) or spaced increments (10,20,30) to keep values unique and allow mid-list inserts without full reindexing.

### Delete Room
- Owner-initiated. Client should delete room doc then cascade delete timers (via Firestore multi-path deletion or recursive delete script). Ensure viewer URLs become invalid.

## 4. Timer Synchronization Algorithm
1. **Start:** Controller writes `isRunning = true`, `startedAt = server timestamp`, leaves `elapsedOffset` as-is, and updates `activeTimerId` in the same batch to avoid mismatched states for viewers.
2. **Client Calculation:** All clients compute `elapsed = (Date.now() - startedAt.toMillis()) + elapsedOffset`. Remaining countdown = `durationMs - elapsed`.
3. **Pause:** Controller computes `elapsedOffset` using latest `startedAt` and writes `isRunning = false`, `startedAt = null`. It *also* updates `progress[activeTimerId] = elapsedOffset` to persist the state.
4. **Resume:** Write new `startedAt = server timestamp` with previously accumulated `elapsedOffset`.
5. **Switch Timer:** When changing `activeTimerId`, the controller must save the current `elapsedOffset` to `progress[oldTimerId]` and load `progress[newTimerId]` into `elapsedOffset`.
5. **Overtime:** When remaining < 0, frontend displays overtime but backend continues tracking via negative result. No additional fields required.

This approach avoids transmitting "time remaining" directly, minimizing drift. Clients always anchor to authoritative timestamps.

## 5. Messaging Channel
`message` map updated atomically with timer changes if needed. Allowed colors: `red`, `yellow`, `green`, `blue`, `white`, `none`. Controller can set `visible` true/false to toggle overlay, and viewer listens accordingly. Future enhancements (animations) can extend the map but remain backward-compatible.

## 6. Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read: if true; // public viewer access (intentional)
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null;

      match /timers/{timerId} {
        allow read: if true;
        allow write: if request.auth != null &&
                      request.auth.uid == get(/databases/$(database)/documents/rooms/$(roomId)).data.ownerId;
      }
    }
  }
}
```
Notes:
- Public read access enables unrestricted viewer links (confirmed requirement).
- Owner-only writes enforced both on room doc and timers subcollection.
- Ensure `ownerId` always populated; validation handled client-side before write.

## 7. Integrations & Configuration
- **Firebase Project Files:** `firebase.json` (hosting + Firestore config), `.firebaserc` (project aliases). Deploy via `firebase deploy`.
- **Environment:** Frontend requires Firebase config object (apiKey, authDomain, projectId, etc.) injected via Vite env variables.
- **Auth Providers:** Enable Google Sign-In and Email/Password in Firebase console. Optional: enforce email verification for controllers.
- **Indexes:** Create composite index for `rooms` queries if filtering by `ownerId` and ordering by `createdAt`. Single-field index on `timers.order` (default).
- **Hosting:** Deploy built frontend to Firebase Hosting; viewer/controller share bundle.

## 8. Operational Considerations
- **Realtime Costs:** Frequent updates (e.g., timer tick) happen client-side; Firestore writes occur only on user actions (start/pause/reset). Expect manageable load.
- **Batch Reorder:** Use batched writes to prevent partially updated rundown orders.
- **Rate Limits:** Anticipated low; still guard against rapid start/pause toggles by debouncing in frontend.
- **Backup/Export:** Use Firebase scheduled export for rooms collection if needed (future enhancement).
- **Scalability:** Single collection suits MVP; monitor growth for potential sharding.

## 9. Cross-References
- Frontend PRD §5 describes how `useTimerEngine` consumes `startedAt` and `elapsedOffset`.
- Frontend PRD §7 references security rules for guard logic.
- Shared terminology: "Rundown" = timers subcollection ordered list; "Active Timer" = `activeTimerId` context.

## 10. Open Questions & Assumptions
- **Viewer Access:** Remains public with no auth gating; ensure no sensitive data stored on room documents.
- **Room Limits:** Not enforced at backend for MVP; consider Firestore rule restrictors later.
- **Message Color Palette:** Final palette to be validated with design; backend accepts string values but frontend should constrain.

Review this PRD alongside `docs/frontend-prd.md` to ensure end-to-end alignment.