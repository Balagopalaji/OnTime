# Cloud Controller Lock - Design Document

**Status:** Draft
**Author:** Planning Session
**Date:** 2026-01-10
**Milestone:** 5 (Pass A)

---

## 1. Overview

### Problem

Controller lock/takeover enforcement exists only in the Companion (local) path. In cloud/Firebase mode, multiple controllers can write to a room concurrently without restriction. This creates:

- **Security gap:** Any authenticated user can overwrite another controller's state
- **UX inconsistency:** Lock semantics differ between local and cloud modes
- **Data integrity risk:** Simultaneous writes can corrupt room state

### Goal

Enforce single authoritative controller when the room is controlled via Firebase (cloud path), achieving parity with Companion lock semantics.

### Non-Goals (Pass A)

- Shared/multi-controller mode (Pass B)
- Role-based permissions (Phase 3)
- Audit logging (Pass B)

---

## 2. Lock Schema

### Firestore Document

**Location:** `rooms/{roomId}/lock`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Yes | Unique client identifier (per-tab) |
| `userId` | string | Yes | Firebase Auth UID (per-account) |
| `deviceName` | string | No | Human-readable device identifier |
| `userName` | string | No | Display name of lock holder |
| `lockedAt` | timestamp | Yes | When lock was first acquired |
| `lastHeartbeat` | timestamp | Yes | Updated every heartbeat interval |
| `controlPolicy` | string | No | `'exclusive'` (default; only value in Pass A) or `'shared_with_pin'` (future) |

### Example Document

```json
{
  "clientId": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "userId": "firebase-uid-here",
  "deviceName": "MacBook Pro - Chrome",
  "userName": "Sarah",
  "lockedAt": "2026-01-10T14:30:00Z",
  "lastHeartbeat": "2026-01-10T14:35:30Z",
  "controlPolicy": "exclusive"
}
```

### Relationship to Room State

```
rooms/{roomId}/
├── lock                    ← NEW: Controller lock document
├── state/current           ← Protected by lock
├── timers/{timerId}        ← Protected by lock
└── liveCues/{cueId}        ← Protected by lock (Show Control tier)
```

The `lock` document is separate from room state to:
- Avoid write contention (heartbeat updates don't trigger state listeners)
- Allow independent security rules
- Keep lock lifecycle separate from room data

---

## 3. Client Identity

### Requirement: ClientId Persistence

**Problem:** Default `crypto.randomUUID()` generates a new ID on every page load. If a controller refreshes their browser, they lose their lock because the `clientId` changes.

**Solution:** Persist `clientId` in `sessionStorage`.

```typescript
// Frontend: clientId generation with persistence
const getOrCreateClientId = (): string => {
  const STORAGE_KEY = 'ontime-client-id'
  const existing = sessionStorage.getItem(STORAGE_KEY)
  if (existing) return existing

  const newId = crypto.randomUUID()
  sessionStorage.setItem(STORAGE_KEY, newId)
  return newId
}
```

**Behavior:**
- Same tab, refresh → same `clientId` → keeps lock
- Same browser, new tab → new `clientId` → must request/force
- Different browser/device → new `clientId` → must request/force

### Identity Fields

| Field | Scope | Purpose | Used In |
|-------|-------|---------|---------|
| `clientId` | Per-tab (sessionStorage) | Lock ownership (single-tab enforcement) | Cloud Functions, UI |
| `userId` | Per-account (Firebase Auth) | Firestore rules enforcement | Rules, audit |
| `deviceName` | Per-device (user agent + generated) | UX display in takeover UI | UI only |

### Enforcement Layers

```
Layer 1: Firestore Rules (userId)
├── Blocks writes from different users
├── Cannot distinguish same user's multiple tabs
└── Allows service account (Companion) for liveCues

Layer 2: Cloud Functions (clientId)
├── Enforces single-tab lock ownership
├── Validates clientId on lock operations
└── Handles staleness, takeover, heartbeat
```

**Tradeoff:** Same user with multiple tabs can all pass Firestore rules, but only one tab is the "official" lock holder.

**Write prevention for non-lock-holding tabs:**

1. **Frontend blocks writes:** The UI checks `controllerLockState` before any write. If state is `read-only`, UI disables controls and prevents write calls. This is the primary enforcement.

2. **Lock operations rejected:** Cloud Functions reject `acquireLock`, `updateHeartbeat`, etc. if `clientId` doesn't match.

3. **Direct Firestore writes:** If a non-lock tab bypasses UI and writes directly, rules will allow it (same userId). This is a minor gap, but:
   - Requires intentional bypass (not accidental)
   - Same user = not a security issue, just data consistency
   - Can tighten later by routing writes through Functions if needed

**Tab duplication note:** Some browsers clone `sessionStorage` on tab duplication, so a duplicated tab may share the same `clientId` and appear authoritative. This is a UX edge case; document it for Pass A and consider a future mitigation (per-tab instance token).

**Recommendation for Pass A:** Frontend enforcement is sufficient. Add Cloud Function write proxies in Pass B if needed.

---

## 4. Cloud Functions API

All lock operations use Cloud Functions to ensure atomic, server-timestamped operations.

### 4.1 `acquireLock`

**Purpose:** Attempt to acquire lock for a room.

**Input:**
```typescript
{
  roomId: string
  clientId: string
  userId: string
  deviceName?: string
  userName?: string
  forceIfStale?: boolean  // Allow acquisition if current lock is stale
}
```

**Logic:**
```
1. Start Firestore transaction
2. Read current lock document
3. If no lock exists:
   - Create lock with provided data
   - Return { success: true, lock: newLock }
4. If lock exists and clientId matches:
   - Update lastHeartbeat (reconnection case)
   - Return { success: true, lock: existingLock }
5. If lock exists and is stale (lastHeartbeat > 90s ago):
   - If forceIfStale: replace lock
   - Else: return { success: false, error: 'LOCK_STALE', staleLock: existingLock }
6. If lock exists and is active:
   - Return { success: false, error: 'CONTROLLER_TAKEN', currentLock: existingLock }
7. Commit transaction
```

**Output:**
```typescript
{
  success: boolean
  lock?: ControllerLock
  error?: 'CONTROLLER_TAKEN' | 'LOCK_STALE' | 'TRANSACTION_FAILED'
  currentLock?: ControllerLock  // When locked by another
}
```

### 4.2 `releaseLock`

**Purpose:** Release a held lock (voluntary handover or disconnect).

**Input:**
```typescript
{
  roomId: string
  clientId: string
}
```

**Logic:**
```
1. Read current lock document
2. If no lock exists: return { success: true } (idempotent)
3. If lock.clientId !== provided clientId:
   - Return { success: false, error: 'NOT_LOCK_HOLDER' }
4. Delete lock document
5. Return { success: true }
```

### 4.3 `forceTakeover`

**Purpose:** Force acquisition of lock from another controller.

**Input:**
```typescript
{
  roomId: string
  clientId: string
  userId: string
  deviceName?: string
  userName?: string
  pin?: string           // Room PIN for authorized takeover
  reauthenticated?: boolean  // User re-authenticated
}
```

**Authorization (one must be true):**
1. `pin` matches room's PIN (from a cloud PIN document, e.g., `rooms/{roomId}/config/pin` with owner-only writes)
2. `reauthenticated` flag is true (frontend confirms re-auth)
3. Lock is stale (lastHeartbeat > 90s ago)
4. Request timeout elapsed (30s since REQUEST_CONTROL)

**Note on request timeout:** Use server-stored timestamps to avoid spoofing. Store `requestedAt` in a Firestore doc (e.g., `rooms/{roomId}/controlRequests/{requestId}` or a single `rooms/{roomId}/controlRequest`), and have Cloud Functions validate the elapsed time using server timestamps. Client-provided timestamps must not be trusted.

**Logic:**
```
1. Read current lock document
2. If no lock: treat as acquireLock
3. Validate authorization:
   - Check PIN if provided
   - Check reauthenticated flag
   - Check staleness
   - Check pending request timeout
4. If unauthorized: return { success: false, error: 'PERMISSION_DENIED' }
5. Replace lock with new controller data
6. Return { success: true, lock: newLock, previousHolder: oldLock }
```

### 4.4 `updateHeartbeat`

**Purpose:** Refresh heartbeat timestamp to prevent stale detection.

**Input:**
```typescript
{
  roomId: string
  clientId: string
}
```

**Logic:**
```
1. Read current lock document
2. If no lock or clientId doesn't match:
   - Return { success: false, error: 'NOT_LOCK_HOLDER' }
3. Update lastHeartbeat to serverTimestamp()
4. Return { success: true }
```

**Note:** This could be a direct Firestore write (no Function) if rules validate clientId. Function provides consistency.

---

## 5. Firestore Security Rules

### Principles

1. **Lock only blocks writes** - viewers can always read
2. **Lock holder validated by userId** - rules check Firebase Auth UID (not per-tab clientId)
3. **Public read access unchanged** - no authentication required to view rooms
4. **No stale checks in rules** - all staleness logic lives in Cloud Functions
5. **Service account bypass for liveCues** - Companion can write liveCues regardless of lock

### Design Decision: userId vs clientId in Rules

Per-tab `clientId` cannot be reliably passed to Firestore rules without minting custom claims per session (expensive). Instead:

- **Rules enforce by `userId`** - Firebase Auth UID, available in `request.auth.uid`
- **Cloud Functions validate `clientId`** - for lock ownership checks
- **Lock document stores both** - `userId` for rules, `clientId` for UI/multi-tab detection

This means: same user, multiple tabs = all tabs pass rules, but only one holds the lock (enforced by Cloud Functions on write operations that go through them).

### Rule Pseudocode

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: Check if requester's userId matches lock holder
    function isLockHolderByUserId(roomId) {
      let lock = get(/databases/$(database)/documents/rooms/$(roomId)/lock);
      // Lock doesn't exist = anyone can write (first controller wins)
      // Lock exists = only lock holder's userId can write
      return !exists(/databases/$(database)/documents/rooms/$(roomId)/lock)
          || lock.data.userId == request.auth.uid;
    }

    // Helper: Check if request is from service account (Companion)
    function isServiceAccount() {
      return request.auth.token.firebase.sign_in_provider == 'custom'
          && request.auth.token.service_account == true;
    }

    match /rooms/{roomId} {
      // Public read access (viewers)
      allow read: if true;

      // Lock document: managed by Cloud Functions only
      match /lock {
        allow read: if true;  // Anyone can see lock state (for UI)
        allow write: if false; // Only Cloud Functions can write
      }

      // Room state: requires lock (by userId)
      match /state/{stateId} {
        allow read: if true;
        allow write: if request.auth != null && isLockHolderByUserId(roomId);
      }

      // Timers: requires lock (by userId)
      match /timers/{timerId} {
        allow read: if true;
        allow write: if request.auth != null && isLockHolderByUserId(roomId);
      }

      // Live cues: requires lock OR service account (Companion)
      match /liveCues/{cueId} {
        allow read: if true;
        allow write: if request.auth != null
            && (isLockHolderByUserId(roomId) || isServiceAccount());
      }
    }
  }
}
```

### Important Notes

1. **userId-based enforcement:** Rules use `request.auth.uid` (Firebase Auth UID), not per-tab clientId. This is simpler and doesn't require custom claims.

2. **Multi-tab caveat:** Same user with multiple tabs will all pass rules. Cloud Functions enforce single-tab lock via `clientId` for lock operations.

3. **No stale checks in rules:** Removed. `request.time` comparisons are brittle with clock skew. All staleness logic is in Cloud Functions only.

4. **Service account for liveCues:** Companion may write liveCues via service account even when a cloud lock exists. Rules explicitly allow this.

5. **Viewer access guaranteed:** All `allow read: if true` rules ensure unauthenticated viewers work.

---

## 6. Frontend Integration

### 6.1 Heartbeat Loop

**Location:** Controller pages only (not viewer pages)

```typescript
// In UnifiedDataContext or dedicated hook
useEffect(() => {
  if (roomAuthority !== 'cloud' || !isController) return

  const HEARTBEAT_INTERVAL = 30_000 // 30 seconds

  const sendHeartbeat = async () => {
    try {
      await cloudFunctions.updateHeartbeat({ roomId, clientId })
    } catch (error) {
      console.error('Heartbeat failed:', error)
      // Don't auto-release on failure; stale detection handles this
    }
  }

  // Send immediately, then every 30s
  sendHeartbeat()
  const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

  return () => clearInterval(interval)
}, [roomId, clientId, roomAuthority, isController])
```

### 6.2 Lock Subscription

**Subscribe to lock document for real-time updates:**

```typescript
useEffect(() => {
  if (roomAuthority !== 'cloud') return

  const lockRef = doc(db, 'rooms', roomId, 'lock')

  const unsubscribe = onSnapshot(lockRef, (snapshot) => {
    if (snapshot.exists()) {
      const lock = snapshot.data() as ControllerLock
      setControllerLocks(prev => ({ ...prev, [roomId]: lock }))
    } else {
      setControllerLocks(prev => ({ ...prev, [roomId]: null }))
    }
  })

  return () => unsubscribe()
}, [roomId, roomAuthority])
```

### 6.3 State Mapping

The existing `resolveControllerLockState()` function works unchanged:

```typescript
export const resolveControllerLockState = ({
  roomId,
  clientId,
  controllerLocks,
  controlDisplacements,
  pendingControlRequests,
}): ControllerLockState => {
  if (controlDisplacements[roomId]) return 'displaced'

  const lock = controllerLocks[roomId]
  if (!lock) return 'authoritative'  // No lock = you can take it
  if (lock.clientId === clientId) return 'authoritative'

  const pending = pendingControlRequests[roomId]
  if (pending?.requesterId === clientId) return 'requesting'

  return 'read-only'
}
```

The only change: `controllerLocks` is now populated from either:
- Companion Socket.IO events (when `roomAuthority === 'companion'`)
- Firestore subscription (when `roomAuthority === 'cloud'`)

### 6.4 Queue Flush Validation

**Before flushing offline write queue, validate lock:**

```typescript
const flushEventQueue = async (roomId: string) => {
  // Re-check lock before flushing
  const lockDoc = await getDoc(doc(db, 'rooms', roomId, 'lock'))

  if (lockDoc.exists()) {
    const lock = lockDoc.data() as ControllerLock
    if (lock.clientId !== clientId) {
      // We lost the lock while offline - discard queue
      console.warn('Lock lost while offline, discarding queued events')
      setEventQueue(prev => prev.filter(e => e.roomId !== roomId))
      setControlDisplacements(prev => ({
        ...prev,
        [roomId]: { reason: 'lock_lost_while_offline', timestamp: Date.now() }
      }))
      return
    }
  }

  // Safe to flush
  const roomEvents = eventQueue.filter(e => e.roomId === roomId)
  for (const event of roomEvents) {
    await processEvent(event)
  }
  setEventQueue(prev => prev.filter(e => e.roomId !== roomId))
}
```

---

## 7. Timing Constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| `HEARTBEAT_INTERVAL` | 30 seconds | Balance between freshness and write cost |
| `STALE_THRESHOLD` | 90 seconds | 3 missed heartbeats = definitely gone |
| `FORCE_TAKEOVER_TIMEOUT` | 30 seconds | After REQUEST_CONTROL, allow force without PIN |
| `LOCK_ACQUIRE_RETRY` | 3 attempts | Retry on transaction conflict |

### Stale Detection Timeline

```
t=0s    Controller A sends heartbeat
t=30s   Controller A sends heartbeat
t=60s   Controller A loses connection (no heartbeat sent)
t=90s   Lock becomes stale (90s since last heartbeat)
t=90s+  Controller B can acquire lock (forceIfStale)
```

---

## 8. Authority Resolution

### Rule: One Lock Source Per Room

```typescript
const getLockSource = (roomAuthority: RoomAuthority): 'companion' | 'cloud' | null => {
  if (roomAuthority.source === 'companion') return 'companion'
  if (roomAuthority.source === 'cloud') return 'cloud'
  return null // Pending - no lock enforcement yet
}
```

### Behavior Matrix

| `roomAuthority.source` | Lock Source | Lock Storage | Events |
|------------------------|-------------|--------------|--------|
| `'companion'` | Companion | In-memory (`roomControllerStore`) | Socket.IO |
| `'cloud'` | Firebase | Firestore (`rooms/{roomId}/lock`) | Firestore listener |
| `'pending'` | None | N/A | Wait for resolution |

### No Lock Mixing

When Companion is connected but room uses cloud authority:
- **Do not** attempt to reconcile Companion lock with Firestore lock
- **Do** use Firestore lock exclusively
- Companion lock is only used when `roomAuthority.source === 'companion'`

This matches the existing parallel-sync model.

---

## 9. Edge Cases

### 9.1 Tab Refresh

**Scenario:** Controller refreshes browser tab.

**Behavior:**
1. `clientId` persists in `sessionStorage` → same ID after refresh
2. On load, call `acquireLock()` with same `clientId`
3. Function sees matching `clientId` → updates `lastHeartbeat`, returns success
4. Controller retains lock

### 9.2 Tab Close

**Scenario:** Controller closes browser tab.

**Release Strategy (dual approach):**

1. **`visibilitychange` event** (accelerate staleness):
   ```typescript
   document.addEventListener('visibilitychange', () => {
     if (document.visibilityState === 'hidden') {
       // Stop heartbeat loop - lock will go stale faster
       clearInterval(heartbeatInterval)
     } else {
       // Resume heartbeat
       startHeartbeatLoop()
     }
   })
   ```

2. **Stale threshold** (guaranteed cleanup):
   - Lock goes stale after 90s without heartbeat
   - Next controller can acquire with `forceIfStale: true`

**Note on `beforeunload`:**

`navigator.sendBeacon()` cannot call Firebase callable functions - it only works with plain HTTP endpoints. Options:
- **Option A:** Create a dedicated HTTPS Cloud Function endpoint (`/api/release-lock`) that accepts POST with JSON body
- **Option B:** Skip `beforeunload` entirely and rely on stale detection (simpler, 90s worst-case delay)

**Recommendation:** Start with Option B (stale-only). Add HTTPS endpoint later if 90s delay proves problematic in practice.

### 9.3 Offline Controller

**Scenario:** Controller loses network connectivity.

**Behavior:**
1. Heartbeat requests fail (network error)
2. Lock remains in Firestore with old `lastHeartbeat`
3. After 90s, lock becomes stale
4. Other controllers can force takeover
5. When original controller reconnects:
   - If lock still held: resume (update heartbeat)
   - If lock taken: show "displaced" UI, discard queued writes

### 9.4 Simultaneous Acquisition (Race)

**Scenario:** Two controllers open room at exact same moment.

**Behavior:**
1. Both call `acquireLock()` simultaneously
2. Cloud Function uses Firestore transaction
3. Transaction serializes: one wins, one loses
4. Winner: receives lock, becomes authoritative
5. Loser: receives `CONTROLLER_TAKEN` error, shown read-only UI

### 9.5 Room Without Lock Document

**Scenario:** Existing room from before lock feature was deployed.

**Behavior:**
1. First controller to open room calls `acquireLock()`
2. No existing lock document
3. Lock created for first controller
4. Subsequent controllers see lock, must request/force

**No migration required** - additive feature.

---

## 10. Phase 3 Compatibility

### Relationship to timerDelegate

Phase 3 introduces `timerDelegate` - the ability to assign specific timers to operators.

**How lock and delegation interact:**

```
Lock Holder (TD/Owner)
├── Can assign timers to operators via timerDelegate
├── Can revoke delegation
└── Retains authority over unassigned timers

Delegate (Operator)
├── Can control assigned timer only
├── Cannot modify room state or other timers
└── Does not hold room lock
```

**Implementation consideration:** The lock system should support delegation by:
1. Lock document stores primary controller
2. Timer documents can have `delegatedTo: userId` (align with `timerDelegate.userId` in `docs/interface.md`)
3. Rules check: `isLockHolder(roomId) || isDelegatedToUser(timerId)`

### Shared Control Policy (Pass B)

The `controlPolicy` field is reserved for future use:

| Policy | Behavior |
|--------|----------|
| `'exclusive'` | Single controller, request/force handover (Pass A) |
| `'shared_with_pin'` | Multiple controllers with PIN, conflict resolution (Pass B) |

Pass B requirements (not in scope for Pass A):
- Conflict resolution strategy (last-write-wins, or per-timer locking)
- Audit log of controller actions
- PIN management for shared access
- UI for "who's editing what"

---

## 11. Implementation Checklist

### Pass A Tasks

- [ ] **A1:** Add `lock` document schema to Firestore
- [ ] **A2:** Implement Cloud Functions (`acquireLock`, `releaseLock`, `forceTakeover`, `updateHeartbeat`)
- [ ] **A3:** Update Firestore security rules (lock holder check)
- [ ] **A3b:** Define cloud PIN storage location + owner-only write rules
- [ ] **A3c:** Define Companion service account claims contract (liveCues bypass)
- [ ] **A4:** Persist `clientId` in `sessionStorage`
- [ ] **A5:** Add heartbeat loop to controller pages (30s interval)
- [ ] **A6:** Subscribe to lock document in `UnifiedDataContext`
- [ ] **A7:** Integrate lock state with existing `resolveControllerLockState()`
- [ ] **A8:** Add queue flush validation
- [ ] **A9:** Implement `visibilitychange` handler (stop heartbeat when hidden)
- [ ] **A10:** Test: simultaneous acquisition, refresh, offline, takeover
- [ ] **A11:** Update documentation (interface.md, client-prd.md, local-mode.md)

### Documentation Updates

| Document | Changes |
|----------|---------|
| `docs/interface.md` | Add lock schema, Cloud Functions API |
| `docs/client-prd.md` | Add control lock enforcement section |
| `docs/local-mode.md` | Add cloud mode parity note |
| `docs/app-prd.md` | Clarify lock enforcement across tiers |
| `docs/phase-2-tasklist.md` | Add Milestone 5 |

---

## 12. Open Questions

### Resolved

1. ~~**Custom claims vs Function validation:**~~ **Resolved:** Use `userId` in rules, `clientId` in Cloud Functions only. No custom claims needed.

2. ~~**Beacon API for release:**~~ **Resolved:** Skip `beforeunload`/beacon for now. Rely on stale detection (90s). Add HTTPS endpoint later if needed.

3. ~~**Stale check in rules:**~~ **Resolved:** No stale checks in rules. All staleness logic in Cloud Functions only.

### Remaining

4. **Heartbeat direct write:** Should `updateHeartbeat` be a Cloud Function or a direct Firestore write?
   - Cloud Function: Consistent, validates clientId, but adds latency
   - Direct write: Faster, but rules can only validate userId (same user, different tab could update)
   - **Recommendation:** Start with Cloud Function for safety; optimize later if latency is an issue.

5. **Service account token for Companion:** Companion liveCues writes require a custom auth claim contract. Define the token minting path and claims (e.g., `sign_in_provider: 'custom'`, `service_account: true`, `companionId`) and document where tokens are issued.

6. **Multi-tab same-user behavior:** If same user has two tabs, both pass rules but only one holds lock. Should we:
   - Allow direct writes from non-lock-holding tab? (current design)
   - Route all writes through Cloud Functions? (stricter, more latency)
   - **Recommendation:** Accept current design; Cloud Functions for lock ops, direct writes for state/timers guarded by userId.

---

## Appendix: Comparison with Companion Lock

| Aspect | Companion | Cloud (Proposed) |
|--------|-----------|------------------|
| Storage | In-memory `roomControllerStore` | Firestore `rooms/{roomId}/lock` |
| Heartbeat | Socket.IO `HEARTBEAT` event | Cloud Function `updateHeartbeat` |
| Stale threshold | 5s (frontend UI check) | 90s (server-side) |
| Acquisition | `setControllerLock()` on JOIN_ROOM | `acquireLock()` Cloud Function |
| Release | Socket disconnect (immediate) | Stale detection (90s delay) |
| Force takeover | PIN or 30s timeout | PIN or 90s stale |
| Events | Socket.IO broadcast | Firestore realtime listener |

**Note:** Companion's 5s is a frontend UI staleness check for display purposes; actual lock release happens on socket disconnect. Cloud mode relies on server-side stale detection since tab close cannot reliably call Cloud Functions. Cloud rules currently allow writes when no lock doc exists; this is a known race window until the lock is created. UI must acquire the lock before enabling writes.
