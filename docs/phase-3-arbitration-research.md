---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-28
Scope: Curated summary of arbitration research and raw reports.
---

# Phase 3 Arbitration Research Summary

Date: 2026-01-27
Branch: fix/companion-cloud-issues (research snapshot)

## Why this doc exists
Short, curated summary of arbitration findings to keep the investigation durable. Paste raw research reports below this section if needed.

## Parallel Sync Philosophy (baseline)
- Dual-write to Cloud + Companion when available.
- No single master; arbitration by freshness (timestamps) with confidence window.
- Reconnect should **sync before authority flips**.

## Findings summary (curated)
- **Lock state mixing**: Cloud + Companion both write to `controllerLocks` without source separation; last event wins.
- **Authority mutation bypasses timestamps**: `handleRoomStateSnapshot/Delta` sets `roomAuthority.source` via `shouldPreferCloudAuthority`, not freshness.
- **Global hold**: `companionHoldUntilRef['*']` applies to all rooms after HANDSHAKE_ACK.
- **Timers/Cues**: `getTimers()` and `getCues()` prefer cloud when online; no timestamp arbitration.
- **PIN**: `mergeRoomPin` has cloud-preferred short-circuit; in-flight flag can stick if emit fails.

## Impact on observed bugs
- Authority flips on Companion reconnect (cloud lock overridden by companion event).
- Force takeover inconsistencies when source flips or lock state drifts.
- Perceived “jumps” when reconnecting because authority changes before sync completes.

## Recommended next steps (high-level)
1. **Phase 1 (minimal fix)**: prevent Companion lock events from overwriting cloud lock while cloud authoritative; scope hold to room not '*'.
2. **Phase 2 (structural)**: introduce a single arbitration helper and route all domains (room state, locks, cues, timers, pins) through it.

## Raw reports
### gemini say this

  ✦ Parallel-Sync Arbitration Investigation Report

    A) Flow Maps

    1. Controller Authority / Lock State
     * Cloud Entry: Firestore subscription to rooms/{roomId}/lock/current (via useEffect in UnifiedDataContext).
     * Companion Entry: Socket event CONTROLLER_LOCK_STATE -> handleControllerLockState.
     * Arbitration:
         * Logic: resolveControllerLockState calculates the derived status (authoritative/read-only), but the source
  data
           (controllerLocks) is mutated by both entry points.
         * Conflict: handleControllerLockState allows Companion to overwrite the lock state unless holdActive is
  true
           (temp 2-4s hold).
         * Persistence: In-memory controllerLocks ref (React state).

    2. Room State (Timers + Clock)
     * Cloud Entry: FirebaseDataContext (always active) -> firebase.getRoom().
     * Companion Entry: Socket ROOM_STATE_SNAPSHOT/DELTA -> companionRooms state.
     * Arbitration: getRoom(roomId) -> calls pickSource() -> calls resolveRoomSource().
         * Winner Decider: resolveRoomSource (Lines 588-625).
         * Key Factors: Timestamps, Confidence Window (2000ms), Mode.
     * Persistence: React State (companionRooms), LocalStorage (ROOM_CACHE_KEY).

    3. Room PIN Sync
     * Cloud Entry: Firestore rooms/{roomId}/config/pin subscription.
     * Companion Entry: Socket ROOM_PIN_STATE.
     * Arbitration: mergeRoomPin() (Lines 1328-1400).
         * Logic: Cloud wins if online and value exists. Companion updates ignored if they conflict with Cloud while
           Cloud is preferred.
         * Sync: Pushes Cloud -> Companion if Cloud is newer.
     * Persistence: React State (roomPins).

    4. Live Cues
     * Cloud Entry: Firestore rooms/{roomId}/liveCues subscription.
     * Companion Entry: Socket LIVE_CUE_* events.
     * Arbitration: getLiveCueRecords (Lines 4260-4320).
         * Logic: Merges lists. If shouldUseCompanion is true, it prefers Companion updates for the same Cue ID
  based on
           updatedAt.
     * Persistence: React State (companionLiveCues).

    B) Arbitration Rules List

     1. Timestamp Priority: In all modes, a strictly newer timestamp (> confidence window) always wins.
         * Exception: viewerSyncGuard forces Cloud while syncing.
     2. Confidence Window: 2000ms (4000ms on churn). If difference is within window, retain current authority.
     3. Mode Bias (Tie-Breaking):
         * Auto: companionTs > firebaseTs ? Companion : Cloud.
         * Local: companionTs >= firebaseTs ? Companion : Cloud.
         * Cloud: firebaseTs >= companionTs ? Cloud : Companion.
     4. Lock Hold: handleControllerLockState ignores Companion events if holdActive is true AND
        shouldPreferCloudAuthority is true.

    C) Divergences & Critical Issues

     1. Lock Source Mixing (Critical):
         * Issue: The design requires "One Lock Source Per Room". Currently, handleControllerLockState updates the
  same
           controllerLocks state variable that Firestore uses.
         * Impact: If holdActive expires (after 2-4s), a stray Companion event can overwrite the Cloud lock state in
  the
           UI, causing authority flips or "phantom" locks, even in Cloud mode.
     2. Cloud Mode Weakness:
         * Issue: resolveRoomSource in Cloud mode (firebaseTs >= companionTs ? 'cloud' : 'companion') allows
  Companion to
           win if it has a newer timestamp.
         * Impact: If the Companion machine's clock is fast (e.g., +5s), it will always win arbitration, even in
  Cloud
           mode, effectively ignoring the user's "Cloud" preference.
     3. Tie-Breaker Rarity:
         * Issue: controllerTieBreaker only runs on exact timestamp matches.
         * Impact: Distributed systems rarely have exact matches. This mechanism is largely ineffective against
  clock
           drift.
     4. PIN Sync Loops:
         * Issue: mergeRoomPin relies on cloudToCompanionInFlight. If a socket emit fails (network blip) but the
  flag
           remains true, future Companion PIN updates might be ignored or sync might stall.

    D) Consolidation Plan (Conceptual)

    To fix the fragmentation and "flip" bugs, we need a Single Source of Truth helper that all handlers consult
  before
    updating state.

    Proposed Helper: shouldAcceptUpdate(roomId, source, incomingTs)

    Integration Points:
     1. `handleControllerLockState`: Call shouldAcceptUpdate. If it returns false, discard the payload completely.
  Do not
        let it touch state.
     2. `handleRoomState*`: Already largely handled by resolveRoomSource, but setCompanionRooms should effectively
  be
        gated or the getRoom logic tightened to enforce Mode constraints more strictly (e.g., in Cloud Mode, ignore
        Companion unless it's significantly newer or we are degraded).
     3. `mergeRoomPin`: Simplify to use the same shouldAcceptUpdate logic to decide if Companion data is valid.

    Immediate Recommendation:
    Strengthen handleControllerLockState. It should check roomAuthority.source. If authority is 'cloud', ignore
  Companion
    lock events entirely (not just during hold). This enforces the "One Lock Source" rule.

  --------------
 ### claude says this

  ⏺ Now I have all the information needed. Let me compile the comprehensive parallel-sync arbitration
    investigation report.

    ---
    Parallel-Sync Arbitration Investigation Report

    Executive Summary

    The OnTime parallel-sync architecture maintains dual connections (Cloud/Firebase +
    Companion/WebSocket) with writes to both when available and reads determined by timestamp
    arbitration. The investigation reveals fragmented arbitration logic across multiple paths with
    several divergence points that can cause authority flips and PIN inconsistencies.

    ---
    Domain A: Controller Authority / Lock State

    Flow Diagram

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         CONTROLLER LOCK FLOW                                 │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │                                                                              │
    │   CLOUD PATH                          COMPANION PATH                         │
    │   ──────────                          ──────────────                         │
    │                                                                              │
    │   Firebase Functions:                 Companion main.ts:                     │
    │   ├── acquireLock()                   ├── handleJoinRoom()                  │
    │   ├── updateHeartbeat()               │   └── setControllerLock()           │
    │   ├── requestControl()                ├── handleHeartbeat()                 │
    │   ├── forceTakeover()                 ├── handleRequestControl()            │
    │   └── handoverLock()                  ├── handleForceTakeover()             │
    │         │                             └── handleHandOver()                   │
    │         ▼                                     │                              │
    │   Firestore:                          In-Memory:                             │
    │   rooms/{roomId}/lock/current         roomControllerStore (Map)              │
    │         │                                     │                              │
    │         ▼                                     ▼                              │
    │   Frontend subscribes via             Socket emits:                          │
    │   onSnapshot() in useEffect           CONTROLLER_LOCK_STATE                  │
    │   [line 2781-2803]                    [emitControllerLockState()]            │
    │         │                                     │                              │
    │         └─────────────┬───────────────────────┘                              │
    │                       ▼                                                      │
    │              applyControlPayload()                                           │
    │              [line 2654-2734]                                                │
    │                       │                                                      │
    │                       ▼                                                      │
    │   ┌─────────────────────────────────────────┐                               │
    │   │         ARBITRATION POINT               │                               │
    │   │   handleControllerLockState()           │                               │
    │   │   [line 3875-3900]                      │                               │
    │   │                                         │                               │
    │   │   RULE: If shouldHold && holdActive     │                               │
    │   │         → SKIP companion lock update    │                               │
    │   │         else → apply via applyControl   │                               │
    │   └─────────────────────────────────────────┘                               │
    │                       │                                                      │
    │                       ▼                                                      │
    │              controllerLocks state                                           │
    │              setControllerLocks()                                            │
    │                       │                                                      │
    │                       ▼                                                      │
    │              resolveControllerLockState()                                    │
    │              [line 97-117]                                                   │
    │              Returns: 'authoritative' | 'read-only' | 'requesting' |        │
    │                       'displaced'                                            │
    └─────────────────────────────────────────────────────────────────────────────┘

    Entry Points
    Source: Cloud
    Entry Point: Firestore onSnapshot(lockDoc)
    Handler: Sets controllerLocks via applyControlPayload() [line 2783-2797]
    ────────────────────────────────────────
    Source: Companion
    Entry Point: Socket CONTROLLER_LOCK_STATE
    Handler: handleControllerLockState() [line 3875-3900]
    Arbitration Logic (Lock State)

    Location: handleControllerLockState() [line 3875-3900]

    const shouldHold =
      shouldPreferCloudAuthority(payload.roomId) &&
      holdActive
    if (shouldHold) return  // ← SKIP companion lock
    applyControlPayload(payload, { broadcast: true })

    Key Functions:
    - shouldPreferCloudAuthority(roomId) [line 1077-1079]: Returns true if shouldUseCloudLock(roomId)
    && firebase.connectionStatus === 'online'
    - shouldUseCloudLock(roomId) [line 1064-1075]: Returns true if tier is show_control or production
    AND (authority is cloud OR companion not live OR effectiveMode is cloud)
    - isHoldActive(roomId) [line 951]: Returns true if getHoldUntil(roomId) > Date.now()

    Persistence/Cache

    - State: controllerLocks (React state)
    - Ref: controllerLocksRef.current
    - Cloud: rooms/{roomId}/lock/current (Firestore)
    - Companion: roomControllerStore (in-memory Map)

    Identified Divergence: Lock Source Mixing During Authority Transition

    When shouldPreferCloudAuthority returns true, companion lock events are skipped. However, the
    holdUntil window (companionHoldUntilRef.current['*']) is set globally on HANDSHAKE_ACK [line
    3358-3359]:
    const holdUntil = Date.now() + getConfidenceWindowMs(reconnectChurn)
    companionHoldUntilRef.current['*'] = holdUntil

    Problem: The global '*' key applies to ALL rooms, not just the room being joined. This can cause
    lock state from cloud to be held even for rooms that should use companion authority.

    ---
    Domain B: Room State (Timers + showClock/message)

    Flow Diagram

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         ROOM STATE FLOW                                      │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │                                                                              │
    │   WRITE PATH (Dual-Write)                                                   │
    │   ───────────────────────                                                   │
    │   Controller action (e.g., startTimer)                                      │
    │         │                                                                   │
    │         ├──→ shouldUseCompanion(roomId)?                                    │
    │         │    ├── YES → emitOrQueue() to Companion                           │
    │         │    │         + canWriteThrough() → Firestore                      │
    │         │    └── NO  → ensureCloudWriteAllowed() → Firestore only           │
    │         │              + markControllerWrite('cloud')                       │
    │                                                                              │
    │   READ PATH                                                                 │
    │   ─────────                                                                 │
    │   Cloud:                              Companion:                            │
    │   FirebaseDataProvider                Socket events:                        │
    │   └── onSnapshot(rooms)               ├── ROOM_STATE_SNAPSHOT               │
    │       onSnapshot(state/current)       │   [handleRoomStateSnapshot]         │
    │       onSnapshot(timers)              └── ROOM_STATE_DELTA                  │
    │           │                               [handleRoomStateDelta]            │
    │           │                                   │                             │
    │           └───────────────┬───────────────────┘                             │
    │                           ▼                                                 │
    │   ┌─────────────────────────────────────────────────────────────────────┐  │
    │   │                    ARBITRATION FUNCTIONS                             │  │
    │   │                                                                      │  │
    │   │  1. handleRoomStateSnapshot() [line 3384-3528]                      │  │
    │   │     - Staleness check: snapshotTs + confidenceWindowMs < existingTs │  │
    │   │     - Sets roomAuthority source to 'companion' or 'cloud'           │  │
    │   │     - Uses shouldPreferCloudAuthority() to override                 │  │
    │   │                                                                      │  │
    │   │  2. getRoom() [line 4090-4168]                                      │  │
    │   │     - Calls pickSource() to decide cloud vs companion               │  │
    │   │     - Returns room from resolved source                             │  │
    │   │                                                                      │  │
    │   │  3. pickSource() [line 4064-4088]                                   │  │
    │   │     - If holdActive && shouldPreferCloudAuthority → 'cloud'         │  │
    │   │     - Uses controllerTieBreaker from lastControllerWriteRef         │  │
    │   │     - Calls resolveRoomSource()                                     │  │
    │   │                                                                      │  │
    │   │  4. resolveRoomSource() [line 588-630]                              │  │
    │   │     - CENTRAL ARBITRATION FUNCTION                                  │  │
    │   │     - Confidence window: 2000ms (4000ms on reconnect churn)         │  │
    │   │     - Mode-based tie-breaking                                       │  │
    │   └─────────────────────────────────────────────────────────────────────┘  │
    │                           │                                                 │
    │                           ▼                                                 │
    │                    Room returned to UI                                      │
    └─────────────────────────────────────────────────────────────────────────────┘

    Central Arbitration: resolveRoomSource() [line 588-630]

    export const resolveRoomSource = ({
      isCompanionLive,      // socket?.connected && handshakeStatus === 'ack'
      viewerSyncGuard,      // authority.status === 'syncing' && isViewerClient
      firebaseTs,           // room.state.lastUpdate
      companionTs,          // companionState.lastUpdate
      authoritySource,      // roomAuthority[roomId].source
      mode,                 // 'auto' | 'cloud' | 'local'
      effectiveMode,        // 'cloud' | 'local'
      confidenceWindowMs,   // 2000ms or 4000ms
      controllerTieBreaker, // 'cloud' | 'companion' from lastControllerWrite
    }): 'cloud' | 'companion' => {
      if (!isCompanionLive) return 'cloud'
      if (viewerSyncGuard) return 'cloud'

      // RULE 1: Equal timestamps use controllerTieBreaker
      if (firebaseTs === companionTs && controllerTieBreaker) {
        return controllerTieBreaker
      }

      // RULE 2: Within confidence window → prefer authority source
      if (Math.abs(firebaseTs - companionTs) < confidenceWindowMs) {
        if (authoritySource === 'companion') return 'companion'
        return 'cloud'
      }

      // RULE 3: Outside confidence window → mode-based
      if (mode === 'auto') {
        return companionTs > firebaseTs ? 'companion' : 'cloud'
      }
      if (effectiveMode === 'local') {
        return companionTs >= firebaseTs ? 'companion' : 'cloud'
      }
      return firebaseTs >= companionTs ? 'cloud' : 'companion'
    }

    Staleness Check in handleRoomStateSnapshot [line 3392-3394]

    const isStale =
      snapshotTs + confidenceWindowMs < existingTs ||
      snapshotTs + confidenceWindowMs < firebaseTs
    Note: This rejects snapshots that are older than BOTH existing companion state AND Firebase state
    by the confidence window.

    Persistence/Cache

    - Companion state: companionRooms (React state), companionRoomsRef.current
    - Cached snapshots: cachedSnapshotsRef.current, persisted to localStorage under
    ontime:companionRoomCache.v2
    - Authority: roomAuthority (React state)
    - Last controller write: lastControllerWriteRef.current[roomId] (not persisted)

    Identified Divergences:

    1. Authority set in handleRoomStateSnapshot bypasses pickSource logic:
    // line 3508-3517
    setRoomAuthority((prev) => ({
      ...prev,
      [payload.roomId]: {
        source: shouldPreferCloudAuthority(payload.roomId)
          ? 'cloud'        // ← FORCES CLOUD regardless of timestamp
          : 'companion',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
    1. When shouldPreferCloudAuthority returns true, this FORCES cloud authority even if companion has
    newer data.
    2. getRoom() can return cached data before arbitration:
    // line 4132-4135
    if (!isCompanionLive()) {
      if (firebaseRoom) return mergeProgressFromCache(firebaseRoom)
      return cachedRoom  // ← No arbitration, just returns cache
    }
    3. Timer list arbitration is separate from room state:
    getTimers() [line 4170-4194] prefers Firebase timers when available, regardless of room authority
    source:
    if (!shouldUseCompanion(roomId)) {
      return firebaseTimers.length > 0 ? firebaseTimers : cached
    }
    // ...
    if (firebaseTimers.length > 0) {
      return firebaseTimers  // ← Always prefers Firebase for timer metadata
    }

    ---
    Domain C: Room PIN Sync

    Flow Diagram

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         ROOM PIN SYNC FLOW                                   │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │                                                                              │
    │   CLOUD PATH                          COMPANION PATH                         │
    │   ──────────                          ──────────────                         │
    │                                                                              │
    │   Firestore:                          Socket:                               │
    │   rooms/{roomId}/config/pin           handleSetRoomPin()                    │
    │         │                             → roomPinStore.set()                  │
    │         ▼                             → emitRoomPinStateToController()      │
    │   onSnapshot(pinDoc) [line 2948]              │                             │
    │         │                                     ▼                             │
    │         ▼                             ROOM_PIN_STATE event                  │
    │   mergeRoomPin(roomId, {                      │                             │
    │     source: 'cloud'                           ▼                             │
    │   })                                  handleRoomPinState() [line 3910]      │
    │         │                             → applyControlPayload()               │
    │         └─────────────┬───────────────────────┘                             │
    │                       ▼                                                      │
    │   ┌─────────────────────────────────────────────────────────────────────┐  │
    │   │                    mergeRoomPin() [line 1328-1405]                   │  │
    │   │                                                                      │  │
    │   │   ARBITRATION RULES:                                                │  │
    │   │                                                                      │  │
    │   │   1. Cloud preferred when online + existing cloud PIN differs:      │  │
    │   │      if (cloudPreferred && current.source === 'cloud' &&            │  │
    │   │          currentValue && next.source === 'companion' &&             │  │
    │   │          next.value !== currentValue) return prev                   │  │
    │   │      → REJECTS companion PIN if cloud PIN exists and differs        │  │
    │   │                                                                      │  │
    │   │   2. In-flight sync check:                                          │  │
    │   │      if (syncState.cloudToCompanionInFlight) {                      │  │
    │   │        if (sameValue || nextUpdatedAt >= currentUpdatedAt)          │  │
    │   │          clear inFlight flag                                        │  │
    │   │      }                                                              │  │
    │   │                                                                      │  │
    │   │   3. Timestamp arbitration:                                         │  │
    │   │      if (hasValidCurrent && !hasValidNext) return prev              │  │
    │   │      if (nextUpdatedAt <= currentUpdatedAt) return prev             │  │
    │   │                                                                      │  │
    │   │   4. Cloud → Companion sync (owner only):                           │  │
    │   │      if (next.source === 'cloud' && next.value !== null)            │  │
    │   │        → socket.emit('SET_ROOM_PIN')                                │  │
    │   │        → set cloudToCompanionInFlight = true                        │  │
    │   └─────────────────────────────────────────────────────────────────────┘  │
    │                       │                                                     │
    │                       ▼                                                     │
    │              roomPins state                                                  │
    │              setRoomPins()                                                   │
    └─────────────────────────────────────────────────────────────────────────────┘

    Persistence/Cache

    - State: roomPins (React state)
    - Sync tracking: roomPinSyncRef.current[roomId] with flags:
      - cloudToCompanionInFlight
      - pendingCloudPin
      - pendingCloudUpdatedAt
      - lastCloudSyncedAt
    - Companion: roomPinStore (in-memory Map in main.ts)
    - Cloud: rooms/{roomId}/config/pin (Firestore)

    Identified Divergences:

    1. cloudToCompanionInFlight can get stuck:
    // line 1392-1402
    roomPinSyncRef.current[roomId] = {
      ...roomPinSyncRef.current[roomId],
      cloudToCompanionInFlight: true,
      lastCloudSyncedAt: next.updatedAt,
    }
    socket.emit('SET_ROOM_PIN', { ... })
    1. If the socket.emit fails silently (e.g., socket disconnects before emission), the
    cloudToCompanionInFlight flag stays true, blocking future companion PIN updates.
    2. Cloud-preferred rule ignores timestamps:
    // line 1343-1351
    if (
      cloudPreferred &&
      current?.source === 'cloud' &&
      currentValue &&
      next.source === 'companion' &&
      next.value !== currentValue
    ) {
      return prev  // ← REJECTS companion PIN without checking timestamps
    }
    2. This can reject a newer companion PIN if cloud PIN exists and differs.
    3. Owner-only PIN sync but no error on non-owner attempts:
    // line 1381-1383
    const roomOwnerId = firebase.getRoom(roomId)?.ownerId
    if (!roomOwnerId || !user?.uid || roomOwnerId !== user.uid) return
    3. Non-owners silently fail to sync cloud→companion. No error surfaced.

    ---
    Domain D: Cues / Live Cues

    Flow Diagram

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         LIVE CUES FLOW                                       │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │                                                                              │
    │   CLOUD PATH                          COMPANION PATH                         │
    │   ──────────                          ──────────────                         │
    │                                                                              │
    │   FirebaseDataProvider:               Socket events:                        │
    │   onSnapshot(liveCues)                ├── LIVE_CUE_CREATED                  │
    │         │                             ├── LIVE_CUE_UPDATED                  │
    │         ▼                             ├── LIVE_CUE_ENDED                    │
    │   firebase.getLiveCueRecords()        ├── PRESENTATION_LOADED               │
    │         │                             ├── PRESENTATION_UPDATE               │
    │         │                             └── PRESENTATION_CLEAR                │
    │         │                                     │                             │
    │         └─────────────┬───────────────────────┘                             │
    │                       ▼                                                      │
    │   ┌─────────────────────────────────────────────────────────────────────┐  │
    │   │                    getLiveCueRecords() [line 4211-4292]             │  │
    │   │                                                                      │  │
    │   │   ARBITRATION:                                                      │  │
    │   │   1. If !isCompanionLive || !shouldUseCompanion → return firebase   │  │
    │   │                                                                      │  │
    │   │   2. Merge logic:                                                   │  │
    │   │      - Start with companion records                                 │  │
    │   │      - For each firebase record:                                    │  │
    │   │        - Skip powerpoint cues not in companion                      │  │
    │   │        - Newer updatedAt wins                                       │  │
    │   │        - Tie: prefer companion if source is controller              │  │
    │   │                                                                      │  │
    │   │   3. Video metadata merge (mergeCueVideos):                         │  │
    │   │      - Preserves rich videos[] from existing when incoming is       │  │
    │   │        shallow                                                      │  │
    │   └─────────────────────────────────────────────────────────────────────┘  │
    │                                                                              │
    │   WRITE-THROUGH (Companion → Cloud):                                        │
    │   ─────────────────────────────────                                         │
    │   resolveLiveCueWriteSource() [line 2045-2054]                             │
    │   - If lock held + bridgeController → write to Firestore                   │
    │   - Rate limited via recordLiveCueRate()                                   │
    │                                                                              │
    └─────────────────────────────────────────────────────────────────────────────┘

    Manual Cues (Phase 3) Flow

    getCues() [line 4196-4208]:
      - If firebase.connectionStatus === 'online' && firebaseCues.length > 0
        → return firebaseCues  (NO ARBITRATION, just prefers cloud when online)
      - Else return companionCues or firebaseCues

    Identified Divergence:

    - No timestamp arbitration for manual cues: getCues() simply prefers Firebase when online,
    regardless of whether companion cues are newer.

    ---
    Cross-Domain Summary

    Key Arbitration Functions
    ┌──────────────────────────────┬───────────────┬───────────┬──────────────────────────────────────┐
    │           Function           │   Location    │  Domain   │                Notes                 │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ resolveRoomSource()          │ line 588-630  │ Room      │ Central timestamp arbitration        │
    │                              │               │ State     │                                      │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ pickSource()                 │ line          │ Room      │ Adds holdActive +                    │
    │                              │ 4064-4088     │ State     │ controllerTieBreaker                 │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ mergeRoomPin()               │ line          │ PIN       │ Cloud-preferred + timestamp          │
    │                              │ 1328-1405     │           │                                      │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ handleControllerLockState()  │ line          │ Lock      │ holdActive bypass                    │
    │                              │ 3875-3900     │           │                                      │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ shouldPreferCloudAuthority() │ line          │ All       │ Tier-based cloud preference          │
    │                              │ 1077-1079     │           │                                      │
    ├──────────────────────────────┼───────────────┼───────────┼──────────────────────────────────────┤
    │ shouldUseCloudLock()         │ line          │ Lock      │ Tier + mode + connection check       │
    │                              │ 1064-1075     │           │                                      │
    └──────────────────────────────┴───────────────┴───────────┴──────────────────────────────────────┘
    Timing Constants
    Constant: BASE_CONFIDENCE_WINDOW_MS
    Value: 2000ms
    Location: line 582
    Purpose: Normal timestamp arbitration window
    ────────────────────────────────────────
    Constant: CHURN_CONFIDENCE_WINDOW_MS
    Value: 4000ms
    Location: line 583
    Purpose: Expanded window on reconnect churn
    ────────────────────────────────────────
    Constant: STALE_THRESHOLD_MS (cloud)
    Value: 90000ms
    Location: lock.ts:4
    Purpose: Cloud lock staleness
    ────────────────────────────────────────
    Constant: FORCE_TAKEOVER_TIMEOUT_MS (cloud)
    Value: 30000ms
    Location: lock.ts:5
    Purpose: REQUEST_CONTROL timeout
    ────────────────────────────────────────
    Constant: CONTROL_REQUEST_TIMEOUT_MS (companion)
    Value: 30000ms
    Location: main.ts
    Purpose: Companion force takeover timeout
    ────────────────────────────────────────
    Constant: HEARTBEAT_INTERVAL_MS
    Value: 30000ms
    Location: UnifiedDataContext
    Purpose: Cloud heartbeat interval
    Divergence Summary
    #: 1
    Domain: Lock
    Issue: Global hold key '*' affects all rooms
    Impact: Authority held incorrectly for other rooms
    Location: line 3359
    ────────────────────────────────────────
    #: 2
    Domain: State
    Issue: handleRoomStateSnapshot forces cloud authority when shouldPreferCloudAuthority
    Impact: Ignores timestamp, companion data lost
    Location: line 3508-3517
    ────────────────────────────────────────
    #: 3
    Domain: State
    Issue: getRoom() returns cache without arbitration when companion offline
    Impact: Stale data possible
    Location: line 4132-4135
    ────────────────────────────────────────
    #: 4
    Domain: State
    Issue: getTimers() always prefers Firebase timers
    Impact: Timer metadata doesn't follow room authority
    Location: line 4184-4186
    ────────────────────────────────────────
    #: 5
    Domain: PIN
    Issue: cloudToCompanionInFlight can get stuck on silent emit failure
    Impact: Blocks companion PIN updates
    Location: line 1392-1402
    ────────────────────────────────────────
    #: 6
    Domain: PIN
    Issue: Cloud-preferred rule ignores timestamps
    Impact: Newer companion PIN rejected
    Location: line 1343-1351
    ────────────────────────────────────────
    #: 7
    Domain: Cues
    Issue: getCues() has no timestamp arbitration
    Impact: Cloud always wins when online
    Location: line 4196-4208
    ────────────────────────────────────────
    #: 8
    Domain: Lock
    Issue: Cloud lock subscription doesn't coordinate with companion lock events
    Impact: Both sources can race
    Location: line 2781-2803 vs 3875-3900
    Paths That Bypass Arbitration

    1. !isCompanionLive() → always returns cloud [line 609]
    2. viewerSyncGuard → always returns cloud [line 610]
    3. holdActive && shouldPreferCloudAuthority → forces cloud in multiple places
    4. getCues() when connectionStatus === 'online' → prefers Firebase
    5. getTimers() when Firebase has timers → prefers Firebase

    Where Authority Can Flip Without Sync

    1. On HANDSHAKE_ACK: Global hold applied, then shouldPreferCloudAuthority may flip authority to
    cloud
    2. On ROOM_STATE_SNAPSHOT with degraded status: Authority set based on shouldPreferCloudAuthority,
    not timestamps
    3. On Firebase timestamp update: firebaseTs jumps, triggering source flip without companion being
    notified
    4. Mode change: effectiveMode change affects resolveRoomSource tie-breaking without revalidation

    ---
    Consolidation Plan (If Single Arbitration Helper)

    Proposed Single Entry Point: resolveSource(domain, roomId, options)

    Would plug into:
    1. pickSource() [line 4064] - room state
    2. handleControllerLockState() [line 3875] - lock
    3. mergeRoomPin() [line 1328] - PIN
    4. getCues() [line 4196] - manual cues
    5. getLiveCueRecords() [line 4211] - live cues
    6. handleRoomStateSnapshot() [line 3384] - authority assignment

    Required inputs:
    - cloudTs: Timestamp from cloud source
    - companionTs: Timestamp from companion source
    - authoritySource: Current roomAuthority[roomId].source
    - mode / effectiveMode: User mode preference
    - isCompanionLive: Connection status
    - isViewerClient: Client type guard
    - holdActive: Hold window status
    - shouldPreferCloud: Tier-based preference
    - lastControllerWrite: Recent write source for tie-breaking

    Would NOT replace: Domain-specific logic like cloudToCompanionInFlight tracking for PIN sync.

    ---
    Answers to Key Questions

    1. Where is the single authoritative arbitration function today (if any)?

    resolveRoomSource() [line 588-630] is the central function but it's only used for room state via
    pickSource(). Lock, PIN, and cues each have separate logic.

    2. For each domain, do we have "cloud wins when timestamps close" or something else?

    - Room State: Within confidence window, authority source wins (could be either)
    - Lock: No timestamp arbitration; holdActive check bypasses companion
    - PIN: Cloud-preferred when online; timestamps only used as secondary
    - Cues: Cloud wins when online (no timestamp check for manual cues)

    3. Do any paths bypass arbitration and just "accept" companion or cloud?

    Yes - see "Paths That Bypass Arbitration" section above.

    4. Where can authority flip without sync (the bug we see)?

    See "Where Authority Can Flip Without Sync" section above. Key culprits:
    - Global hold key '*' on HANDSHAKE_ACK
    - shouldPreferCloudAuthority forcing cloud in authority assignment
    - Firebase timestamp jumps without companion notification

    5. Does the system currently treat cloud as master in some flows, despite docs saying equal?

    Yes. Despite docs stating "mutual backups" and "timestamp arbitration":
    - shouldPreferCloudAuthority forces cloud for Show Control+ tiers
    - getCues() prefers Firebase when online
    - getTimers() prefers Firebase for timer metadata
    - PIN merge rejects companion if cloud value exists and differs

  --------------
  ### codex says this

  • Got it. I dug through the live code and mapped the actual data paths + arbitration points. Below is the domain-
  by-
    domain flow map, then a cross‑domain arbitration rules list, divergences, and a consolidation plan (no edits).

    Controller Authority / Lock State

    Text flow diagram

    - Cloud path: Firestore lock doc → onSnapshot → applyControlPayload → controllerLocks / displacements / pending
      state
    - Companion path: socket CONTROLLER_LOCK_STATE → handleControllerLockState (hold guard) → applyControlPayload →
      controllerLocks
    - UI lock state: resolveControllerLockState checks controllerLocks + pending requests + displacement

    Entry points

    - Cloud: rooms/{roomId}/lock/current subscription in frontend/src/context/UnifiedDataContext.tsx (lock
  onSnapshot)
      updates controllerLocks via applyControlPayload (type: CONTROLLER_LOCK_STATE).
    - Companion: socket CONTROLLER_LOCK_STATE in frontend/src/context/UnifiedDataContext.tsx →
      handleControllerLockState → applyControlPayload.
    - Control requests:
        - Cloud: callables in frontend/src/context/UnifiedDataContext.tsx use httpsCallable to functions/src/lock.ts
          (requestControl, denyControl, forceTakeover, handoverLock, updateHeartbeat, acquireLock).
        - Companion: socket events in companion/src/main.ts (REQUEST_CONTROL, FORCE_TAKEOVER, DENY_CONTROL,
  HAND_OVER).

    Arbitration function(s)

    - Lock “winner” is whoever last wrote controllerLocks via applyControlPayload; there is no source-aware merge.
  The
      hold guard only blocks companion lock events when isHoldActive && shouldPreferCloudAuthority.
    - resolveControllerLockState in frontend/src/context/UnifiedDataContext.tsx decides view state: authoritative
  when
      no lock, or lock matches clientId; requesting if pending; displaced if set.

    Persistence/cache

    - controllerLocks state in UnifiedDataContext, updated by both sources.
    - controlDisplacements, controlRequests, pendingControlRequests tracked in-memory.
    - Companion maintains authoritative lock in memory (roomControllerStore) in companion/src/main.ts.
    - Cloud lock state stored in Firestore doc rooms/{roomId}/lock/current, updated by functions/src/lock.ts.

    Key notes

    - The cloud lock subscription emits timestamp: Date.now() on receipt, not the lock doc’s stored timestamp; this
      makes lock events time-local and can affect downstream logic using lastHeartbeat for “stale” decisions
  (notably
      live cue write routing).
    - Companion and cloud lock events can both mutate the same controllerLocks map without source segregation.

    ———

    Room State (Timers + showClock/message)

    Text flow diagram

    - Cloud state: Firestore rooms/{roomId} and rooms/{roomId}/state/current snapshots → FirebaseDataContext state
      overrides → firebase.getRoom() used in UnifiedDataContext.getRoom().
    - Companion state: socket ROOM_STATE_SNAPSHOT / ROOM_STATE_DELTA → companionRooms state + possibly roomAuthority
      update → getRoom() arbitration via pickSource().

    Entry points

    - Cloud: frontend/src/context/FirebaseDataContext.tsx onSnapshot of:
        - room state doc (v1/2) updates stateOverrides
        - timers, cues, liveCues for room
    - Companion: frontend/src/context/UnifiedDataContext.tsx handlers:
        - handleRoomStateSnapshot
        - handleRoomStateDelta

    Arbitration function(s)

    - Central: resolveRoomSource() in frontend/src/context/UnifiedDataContext.tsx
        - Inputs: firebaseTs, companionTs, authoritySource, mode, effectiveMode, confidenceWindowMs,
          controllerTieBreaker, viewerSyncGuard, isCompanionLive.
    - Wrapper: pickSource() adds:
        - hold override: if isHoldActive(roomId) && shouldPreferCloudAuthority(roomId) return 'cloud'
        - controller tie-breaker: last write within confidence window, but only if firebaseTs === companionTs
    - Ingestion guard: handleRoomStateSnapshot and handleRoomStateDelta
        - Staleness check: ignore companion updates if incomingTs + confidenceWindowMs < existingTs OR < firebaseTs.
        - If isSnapshotStale() (duration-based plausibility), mark authority degraded but still store companion
  data.

    Persistence/cache

    - Companion state stored in companionRooms (in-memory) and also persisted in localStorage room cache
      (ontime:companionRoomCache.v2).
    - Firebase state stored in FirebaseDataContext as rooms + stateOverrides.
    - roomAuthority map in UnifiedDataContext determines arbitration bias and viewer sync guard.

    Key notes

    - Authority updates on companion snapshots/deltas are not timestamp-based; they depend on
      shouldPreferCloudAuthority(roomId) which is tied to cloud lock eligibility + online state, not data freshness.
    - Global hold window: companionHoldUntilRef.current['*'] set on HANDSHAKE_ACK and used for all rooms; during
  hold,
      pickSource() forces cloud (if shouldPreferCloudAuthority) regardless of timestamps.

    ———

    Room PIN Sync

    Text flow diagram

    - Cloud pin: Firestore rooms/{roomId}/config/pin → mergeRoomPin with source: 'cloud'.
    - Companion pin: socket ROOM_PIN_STATE → mergeRoomPin with source: 'companion'.
    - Outbound sync:
        - cloud → companion: mergeRoomPin may emit SET_ROOM_PIN if cloud is newer and owner is local, or a later
          useEffect replays pending pin.
        - companion → cloud: syncMissingCloudPin compares cloud doc, writes if missing/stale and owner is current
  user.

    Entry points

    - Cloud: pin onSnapshot in frontend/src/context/UnifiedDataContext.tsx (per room).
    - Companion: socket ROOM_PIN_STATE in applyControlPayload, triggered by companion/src/main.ts.

    Arbitration function(s)

    - mergeRoomPin in frontend/src/context/UnifiedDataContext.tsx:
        - Prefers existing cloud value if cloud online and current source is cloud, blocking companion override.
        - Enforces updatedAt monotonicity: ignores updates without valid timestamp or with older timestamps.
        - Handles cloudToCompanionInFlight flag and pending pin replay.
    - setRoomPin decides write path:
        - If shouldUseCloudLock(roomId): cloud-only write.
        - Else: dual-write to cloud (best effort) and companion.

    Persistence/cache

    - Cloud pin: Firestore doc rooms/{roomId}/config/pin.
    - Companion pin: in-memory roomPinStore (persisted to local cache in Companion).
    - Frontend: roomPins state + roomPinSyncRef + roomPinSyncStatusRef.

    Key notes

    - mergeRoomPin uses firebase.connectionStatus !== 'offline' as “cloud preferred” even if in local mode; this can
      block companion updates when cloud is merely connected, not authoritative.
    - cloudToCompanionInFlight is cleared only when a companion update arrives with same/greater timestamp/value; if
      the companion never echoes (e.g., emit fails), the flag can stay true and alter later decisions.

    ———

    Cues + Live Cues

    Text flow diagram

    - Cues:
        - Cloud: Firestore rooms/{roomId}/cues → FirebaseDataContext → getCues().
        - Companion: socket cue events → companionCues + write-through to Firestore (writeCueThrough).
    - Live Cues:
        - Cloud: Firestore rooms/{roomId}/liveCues → FirebaseDataContext → getLiveCueRecords().
        - Companion: socket LIVE_CUE_* / PRESENTATION_* → companionLiveCues + write-through (writeLiveCueThrough)
          subject to rate limiting and lock.

    Arbitration function(s)

    - Cues: getCues() in frontend/src/context/UnifiedDataContext.tsx
        - If Firebase has cues and cloud is online → Firebase wins.
        - Else fallback to companion list.
        - No timestamp arbitration.
    - Live cues: getLiveCueRecords()
        - Merges companion and firebase by updatedAt.
        - Special case: powerpoint cues from companion hold priority (firebase record ignored if no companion
  record).
        - On equal updatedAt, companion wins over controller for PPT cues.
    - Live cue write routing: resolveLiveCueWriteSource() uses controller lock + heartbeat recency (5s) to pick
      'controller' or 'companion' or null.

    Persistence/cache

    - Cloud: Firestore collections cues and liveCues (cached in FirebaseDataContext state).
    - Companion: companionCues and companionLiveCues in memory.

    Key notes

    - Cues have no confidence window arbitration; cloud dominance is based on “online + has data,” not timestamps.
    - Live cues do have timestamp arbitration, but only within the live-cue domain; it does not affect
  roomAuthority.

    ———

    Cross‑Domain Arbitration Rules (Actual, Not Docs)

    - Confidence window: 2000ms base, 4000ms when reconnectChurn is true (getConfidenceWindowMs) in frontend/src/
      context/UnifiedDataContext.tsx.
    - Room state source: resolveRoomSource() uses:
        - Cloud if companion not live or viewer is syncing.
        - Tie-breaker only when firebaseTs === companionTs and lastControllerWriteRef is within the confidence
  window.
        - Within window (abs(firebaseTs - companionTs) < window), choose authoritySource (cloud if not companion).
        - Else choose based on mode + effectiveMode.
    - Authority updates: Companion snapshots/deltas directly set roomAuthority.source to companion or cloud based on
      shouldPreferCloudAuthority, not on timestamps.
    - Hold window: After HANDSHAKE_ACK, companionHoldUntilRef['*'] = now + confidenceWindowMs which forces cloud in
      pickSource() when cloud authority preferred.
    - PIN arbitration: mergeRoomPin blocks companion overwrites when:
        - cloud online AND current pin source is cloud AND current pin value exists AND incoming companion value
          differs.
        - timestamp comparison only if updatedAt is valid.
    - Cues: Cloud wins when online and has any cues; no timestamp arbitration.
    - Live cues: Merge by updatedAt; PPT/companion can take precedence on equal timestamps.

    ———

    Divergences / Places Bypassing Arbitration

    1. Timers list arbitration is not timestamp-based.
        - getTimers() prefers Firebase if any timers exist (even if companion is fresher). No confidence window.
  This
          is a direct bypass of the room‑state arbitration path. (frontend/src/context/UnifiedDataContext.tsx)
    2. Cues arbitration ignores timestamps entirely.
        - If cloud is online and has cues, those win. Companion data is ignored even if newer. (frontend/src/
  context/
          UnifiedDataContext.tsx)
    3. Authority updates are source‑policy based, not freshness‑based.
        - handleRoomStateSnapshot/Delta sets roomAuthority.source to 'cloud' when shouldPreferCloudAuthority is
  true,
          even if companion data is fresher; this can flip authority without a sync. (frontend/src/context/
          UnifiedDataContext.tsx)
    4. Lock sources are merged without source tag or precedence.
        - Both cloud and companion lock events write into controllerLocks; last event wins. Hold only blocks
  companion
          while hold is active and cloud is preferred. (frontend/src/context/UnifiedDataContext.tsx)
    5. PIN sync has asymmetric “cloud‑preferred” rule.
        - If cloud is online and current pin source is cloud, companion updates are ignored even if newer. This is
  not
          governed by confidence windows. (frontend/src/context/UnifiedDataContext.tsx)
    6. Global hold for all rooms.
        - companionHoldUntilRef['*'] set on HANDSHAKE_ACK affects every room; a single reconnect causes temporary
  cloud
          preference across all rooms. (frontend/src/context/UnifiedDataContext.tsx)
    7. Cloud lock timestamping uses client time, not server time.
        - Cloud lock subscription uses Date.now() for payload timestamp, which can distort cross‑source comparisons
          where timestamps are used indirectly (e.g., live cue write routing). (frontend/src/context/
          UnifiedDataContext.tsx)

    ———

    Where Authority Can Flip Without Sync

    - Companion snapshot/delta sets roomAuthority.source based on shouldPreferCloudAuthority rather than timestamps;
  if
      cloud is eligible and online, it can flip to cloud even while ingesting companion updates. (frontend/src/
  context/
      UnifiedDataContext.tsx)
    - After a reconnect, HANDSHAKE_ACK sets a hold window for all rooms; during hold, pickSource() forces cloud when
      cloud authority is preferred, regardless of timestamps.

    ———

    Single “Source of Truth” Arbitration Function Today?

    - Room state: resolveRoomSource() + pickSource() is the closest single authority, but it is only used in
  getRoom()
      and depends on a separate authority‑mutation path.
    - Other domains (timers, cues, pin, live cues): each has its own arbitration or hard-coded preference logic.

    ———

    Consolidation Plan (No Code, Exact Integration Points)

    If you want a single arbitration helper, these are the hook points:

    1. Room State
        - Keep resolveRoomSource() but move authority mutation to a single function (called by
  handleRoomStateSnapshot/
          Delta and any cloud snapshot handler), so updates are timestamp-driven rather than policy-only.
    2. Timers
        - Replace getTimers() preference logic with a shared arbitration helper (timestamp-based if you track
          lastUpdate or derived timestamps per source).
    3. Cues
        - Replace getCues() hard preference with the same arbitration helper (or a cue-specific comparator), ideally
          using updatedAt.
    4. PIN
        - Replace mergeRoomPin() cloud‑preferred short-circuit with the shared arbitration helper; keep “owner-only”
          and “cloud offline” gating as separate constraints.
    5. Lock State
        - Add a lock-source aware merge function (cloud vs companion) and call it from both
  handleControllerLockState
          and the cloud lock onSnapshot callback, instead of writing directly to controllerLocks.
    6. Live Cues
        - Extract the getLiveCueRecords() merge logic into a shared arbitration helper for record merging, and reuse
          the same logic for write-through decisions.

    ———

    If you want, I can also produce a compact diagram (single page) or a timeline of “authority flip” sequences with
    concrete timestamps to compare against logs.

    Next steps (pick one)

    1. Build a minimal “authority flip” timeline from real logs you’ve observed and map each line to the specific
       handler above.
    2. Produce a standalone diagram (Mermaid or ASCII) for the four domains in one view.
