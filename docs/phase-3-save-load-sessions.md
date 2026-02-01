---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-02-01
Scope: Save/Load Sessions feature — Phase 3 scope. Export/Import to file deferred to Phase 4.
---

# Save/Load Sessions — Spec

## Summary

Users can save the current state of a room as a **session** (snapshot or template) and later restore it as a new room on any device. Sessions are stored in the cloud under user scope. Offline saves are queued locally and uploaded on reconnect.

This feature builds on existing parallel sync, tombstone, and dual-write infrastructure. It introduces no new arbitration complexity — sessions are static snapshots, not live-synced entities.

## Guardrails (Do Not Violate)
- Restore always creates a **new room** (no overwrite-in-place).
- Sessions are **static snapshots** only; never treated as live data.
- Do not bypass tombstones; block save/restore for tombstoned rooms.
- Use subcollections for snapshots (no single 1MB doc).
- Metadata list only on load; fetch snapshot on demand.
- After completing any implementation pass, run `npm run lint` and `npm run test` in `frontend/`.

## Goals

- **Prep → venue workflow:** Build a rundown at home, restore it at the venue on a different device.
- **Reusable templates:** Save a proven show structure and re-use it without risk of accidental modification.
- **Resilience:** Save works offline via companion local queue.
- **Safety:** Restore always creates a new room. No overwrite of live rooms. No resurrection of tombstoned rooms.

## Non-goals (Phase 4)

- Export/import session as downloadable JSON file.
- Shared/team sessions (multi-user access to same session).
- Session diffing or merge.
- Auto-save / scheduled snapshots.

---

## Data Model

### Cloud (Firestore)

Sessions are stored under user scope, independent of room lifecycle. Snapshot data is split into subcollections to avoid the 1MB Firestore document limit as show-control data grows.

```
users/{uid}/sessions/{sessionId}        ← session document (meta fields live here)
users/{uid}/sessions/{sessionId}/snapshot/
    ├── room      (document)
    ├── state     (document)
    ├── timers/   (collection of timer documents)
    └── cues/     (collection of cue documents)
```

#### Session document (`users/{uid}/sessions/{sessionId}`)

The session document itself holds all metadata fields. There is no separate `meta` subcollection.

| Field              | Type                        | Description                                      |
|--------------------|-----------------------------|--------------------------------------------------|
| `schemaVersion`    | `number`                    | Always `1` for initial release.                  |
| `name`             | `string`                    | User-provided session name.                      |
| `createdAt`        | `Timestamp`                 | Firestore server timestamp.                      |
| `createdBy`        | `string`                    | UID of the user who saved.                       |
| `sourceRoomId`     | `string`                    | Room ID at time of save (informational).         |
| `sourceRoomTitle`  | `string`                    | Denormalized room title at time of save.         |
| `kind`             | `'snapshot' \| 'template'`  | Session type.                                    |
| `locked`           | `boolean`                   | `true` for templates. Prevents casual deletion.  |
| `sizeEstimate`     | `number`                    | Approximate byte count of full snapshot.         |

#### `snapshot/room` document

Subset of `Room` fields (no runtime/sync fields):

| Field       | Type           |
|-------------|----------------|
| `title`     | `string`       |
| `timezone`  | `string`       |
| `config`    | `RoomConfig`   |
| `features`  | `RoomFeatures` |
| `tier`      | `Tier`         |

#### `snapshot/state` document

Saved as a reset state — never captures a running timer:

| Field            | Type     | Value on save                |
|------------------|----------|------------------------------|
| `activeTimerId`  | `null`   | Always null.                 |
| `isRunning`      | `false`  | Always false.                |
| `elapsedOffset`  | `0`      | Always 0.                    |
| `startedAt`      | `null`   | Always null.                 |
| `lastUpdate`     | `number` | `Date.now()` at save time.   |
| `progress`       | `{}`     | Empty — no elapsed state.    |
| `showClock`      | `boolean`| Preserved from source room.  |
| `clockMode`      | `string` | Preserved from source room.  |
| `message`        | `object` | Preserved from source room.  |

#### `snapshot/timers/{timerId}` documents

Full `Timer` objects from the source room. On save, IDs are preserved as-is. On **restore**, new IDs are generated.

Fields saved: `title`, `duration`, `speaker`, `type`, `order`. Fields **not** saved: `id`, `roomId`, `updatedAt`, `adjustmentLog`, `originalDuration`.

#### `snapshot/cues/{cueId}` documents

Full `Cue` objects from the source room (minus runtime ack state). On **restore**, new IDs are generated.

Fields saved: `role`, `title`, `notes`, `order`, `triggerType`, `offsetMs`, `timeBase`, `targetTimeMs`, `triggerNote`, `approximatePosition`, `createdByRole`.

Fields **not** saved: `id`, `roomId`, `sectionId`, `segmentId`, `afterCueId`, `ackState`, `ackAt`, `ackBy`, `createdBy`, `createdAt`, `updatedAt`, `editedBy`, `editedByRole`, `editNote`.

> **Note:** `sectionId`, `segmentId`, and `afterCueId` reference IDs that won't exist in the restored room. These are excluded for now. When sections/segments are saved in a future iteration, these references will be remapped.

---

## Local Queue (Companion Offline)

When the user is offline (no Firestore connectivity), the companion writes a session file to its cache directory:

```
~/Library/Application Support/OnTime/cache/sessions/session-<sessionId>.json
```

File format mirrors the cloud structure:

```json
{
  "sessionId": "...",
  "meta": { ... },
  "snapshot": {
    "room": { ... },
    "state": { ... },
    "timers": [ ... ],
    "cues": [ ... ]
  }
}
```

**Upload on reconnect:**
1. On Firestore connectivity restored, scan the local sessions directory.
2. For each file, write to `users/{uid}/sessions/{sessionId}` (session document + snapshot subcollections).
3. On successful write, delete the local file.
4. Last-write-wins. No merge logic. No conflict resolution.

**Local cap:** 10 session files. Check count before writing. If at cap, block save and show warning.

---

## Limits

| Scope           | Limit                          | Enforcement            |
|-----------------|--------------------------------|------------------------|
| Cloud snapshots | 50 per user                    | Client UI + Cloud Function on create |
| Cloud templates | 20 per user                    | Client UI + Cloud Function on create |
| Cloud total     | 70 per user                    | Cloud Function (hard)  |
| Local queue     | 10 session files               | Companion file count (hard) |

- **Client-side:** Disable "Save" button when at limit. Show count (e.g., "42/50 snapshots").
- **Cloud Function:** On `sessions/{sessionId}` document create, count existing sessions for the user. If over cap, delete the newly created session and return an error. *(Recommended but not launch-blocking — can ship with client-only enforcement first.)*

---

## Save Flow

1. User clicks **Save Session** (or **Save as Template**) from the Dashboard room card menu.
2. Client validates:
   - Room is not tombstoned.
   - User is under session cap.
3. Client prompts for a session name (pre-filled with room title + date).
4. Client reads current room data: room meta, state, timers, cues.
5. Client resets state fields (see snapshot/state above).
6. Client strips runtime fields from timers and cues.
7. Client estimates size; warn if > 700KB.
8. **If online:** Write to Firestore (session document + snapshot subcollection docs).
9. **If offline:** Write JSON to companion local cache directory.
10. Show confirmation toast.

---

## Restore Flow

1. User navigates to `/sessions` page.
2. Client fetches session metadata list: `users/{uid}/sessions` ordered by `createdAt desc`, limit 25, with load-more pagination.
3. User clicks a session → client fetches full snapshot on demand (room + state + timers + cues subcollection docs).
4. User clicks **Restore as New Room**.
5. Confirmation dialog: *"This creates a new room with all timers stopped. Continue?"*
6. Client creates a new room via existing `createRoom()`:
   - New `roomId` (auto-generated).
   - Room fields from `snapshot/room`.
   - `ownerId` = current user UID.
   - `_version` = 2.
   - `createdAt` = now.
   - **Note for implementers:** Check the `createRoom()` signature in `UnifiedDataContext.tsx`. If it accepts initial state, pass the reset state inline. If not, write state to `rooms/{newRoomId}/state/current` immediately after creation with reset values + `lastUpdate = now`.
7. Client writes timers to `rooms/{newRoomId}/timers/` with **new IDs**, preserving order.
8. Client writes cues to `rooms/{newRoomId}/cues/` with **new IDs** (if any).
9. Navigate to new room controller page.

---

## Delete Flow

- **Snapshots** (`locked: false`): Delete with single confirmation (*"Delete session 'Sunday Service Jan 26'?"*).
- **Templates** (`locked: true`): Require explicit unlock first. UI shows a toggle or "Unlock" button, then delete becomes available. Two-step to prevent accidental deletion of reusable templates.

Deletion removes the session document and all `snapshot/` subcollection docs. Client-side batch delete.

---

## UI

### Dashboard (room card)

Add to the existing room card actions (kebab menu or button row):

- **Save Session** — saves as `kind: 'snapshot'`, `locked: false`.
- **Save as Template** — saves as `kind: 'template'`, `locked: true`.

### Sessions Page (`/sessions`)

New route. Accessible from dashboard sidebar/nav.

**List view:**
- Cards or rows showing: `name`, `sourceRoomTitle`, `createdAt` (relative time), `kind` badge (snapshot/template), lock icon if locked.
- Sorted by `createdAt desc`. Paginated (25 per page, load-more).
- Filter tabs or toggle: All / Snapshots / Templates.
- Count display: "42/50 snapshots · 8/20 templates".

**Session detail (inline or panel):**
- Preview: room title, timezone, timer count, cue count.
- Actions: **Restore as New Room**, **Delete** (or **Unlock + Delete** for templates).

### Offline indicator

When saving offline, show toast: *"Session saved locally. Will upload when online."*

---

## Security Rules (Firestore)

```
match /users/{uid}/sessions/{sessionId} {
  // Session document (metadata) — only the owning user can read/write
  allow read, write: if request.auth != null && request.auth.uid == uid;

  // Snapshot subcollection (room, state, timers, cues)
  match /snapshot/{doc=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

---

## Types (TypeScript)

```typescript
export type SessionKind = 'snapshot' | 'template'

export type SessionMeta = {
  id: string                    // client-side, from doc ID
  schemaVersion: number
  name: string
  createdAt: number             // epoch ms (from Firestore Timestamp)
  createdBy: string
  sourceRoomId: string
  sourceRoomTitle: string
  kind: SessionKind
  locked: boolean
  sizeEstimate: number
}

export type SessionSnapshotRoom = {
  title: string
  timezone: string
  config: RoomConfig
  features?: RoomFeatures
  tier?: Tier
}

export type SessionSnapshotState = {
  activeTimerId: null
  isRunning: false
  elapsedOffset: 0
  startedAt: null
  lastUpdate: number
  progress: Record<string, number>
  showClock: boolean
  clockMode?: '24h' | 'ampm'
  message: {
    text: string
    visible: boolean
    color: MessageColor
  }
}

export type SessionSnapshotTimer = {
  title: string
  duration: number
  speaker?: string
  type: TimerType
  order: number
}

export type SessionSnapshotCue = {
  role: OperatorRole
  title: string
  notes?: string
  order?: number
  triggerType: CueTriggerType
  offsetMs?: number
  timeBase?: 'actual' | 'planned'
  targetTimeMs?: number
  triggerNote?: string
  approximatePosition?: number
  createdByRole?: OperatorRole
}

// Full session (used after fetching snapshot on demand)
export type Session = {
  meta: SessionMeta
  snapshot: {
    room: SessionSnapshotRoom
    state: SessionSnapshotState
    timers: SessionSnapshotTimer[]
    cues: SessionSnapshotCue[]
  }
}
```

---

## Migration / Schema Evolution

- `schemaVersion: 1` is the initial release.
- Future schema changes increment the version. The restore flow checks `schemaVersion` and applies migrations if needed before restoring.
- Subcollection structure is forward-compatible: adding new subcollections (e.g., `snapshot/sections/`, `snapshot/segments/`) doesn't break existing sessions.

---

## Dependencies (Already Completed)

The following Phase 3 arbitration work is prerequisite and already shipped:

- [x] Truthful timestamps (`toMillis` utility, Firestore timestamp normalization).
- [x] Room-aware handshake (per-room authority tracking in UnifiedDataContext).
- [x] Companion cache seeding (`SEED_COMPANION_CACHE` event, cross-tab guards).
- [x] Tombstone deletion sync (`deleted_rooms/{roomId}` with TTL cleanup).
- [x] Sync integrity guardrails (snapshot staleness checks, delta validation).

These are not modified by the Save/Load feature. Sessions are static snapshots and do not participate in live arbitration.

---

## Testing Checklist

- [ ] Save session from dashboard (online).
- [ ] Save session from dashboard (offline — companion local queue).
- [ ] Offline session uploads on reconnect.
- [ ] Restore session creates new room with new IDs.
- [ ] Restored room has reset state (not running, no elapsed).
- [ ] Timer and cue IDs are unique (no collision with source room).
- [ ] Sessions list pagination works (25 per page).
- [ ] Session detail shows correct timer/cue counts.
- [ ] Template cannot be deleted without unlock.
- [ ] Snapshot can be deleted with single confirmation.
- [ ] Cap enforcement: save blocked at 50 snapshots / 20 templates.
- [ ] Local cap: save blocked at 10 local files.
- [ ] Tombstoned room cannot be saved as session.
- [ ] Size warning at > 700KB estimated size.
- [ ] Security rules: user can only access own sessions.
- [ ] Cross-device: session saved on device A appears on device B after list refresh.
