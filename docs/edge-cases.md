---
Type: Reference
Status: current
Owner: KDB
Last updated: 2025-12-29
Scope: Edge cases and resolutions for sync, lock, and timer behavior.
---

# OnTime Edge Cases and Resolutions

Last Updated: 2025-12-22
Status: CURRENT (Phase 1D target architecture)

---

## 1. Room Lock Conflicts

Scenario: Senior offline, junior takes over.

Target behavior (not yet implemented):
- Lock never auto-expires (no timeout)
- Warning prompt shows locked by, device name, and last active time
- Junior must explicitly confirm takeover
- Senior sees notification on reconnect
- If the senior reconnects to a taken-over room, offer "Create copy" to preserve their version

Current state:
- Companion server has basic single-controller lock
- No heartbeat or takeover prompt in web app

Design decision:
- User explicitly decides takeover; no automatic expiry

---

## 2. Multi-Device Timer Adjustments

Scenario: Operator adds/subtracts time mid-show and a snapshot arrives later.

Target behavior (not yet implemented):
- Timer has `adjustmentLog[]` tracking deltas
- Plausibility check uses duration, elapsed time, and adjustment totals
- Accept snapshot if adjusted elapsed is within 3x duration and 10% variance
- Only accept adjustments from the authorized controller with valid timestamps

Current state:
- Fixed 30s/24h staleness thresholds
- No adjustment log

---

## 3. Multi-Device Offline and Online Interleaving

Scenario: Device A offline makes Change 1 (ts: 100). Device B online makes Change 2 (ts: 200). Both reconnect.

Target behavior (not yet implemented):
- Orthogonal changes coexist by grouping per change type + target
- Keep latest per group, then replay in timestamp order
- Only replay actions stamped by the authorized controller (single-controller model)

Example grouping:
- STATE_CHANGE:timer1 -> keep ts: 100
- TIMER_CRUD:timer2 -> keep ts: 200

Current state:
- Queue replay is FIFO only; no grouping or deduplication

---

## 4. Template Room Conflicts (Mitigation)

Scenario: Two juniors clone the same template.

Future mitigation (Phase 2):
- Forced rename on template creation
- Prompt: "Name your room (templates must be renamed)"
- Default: "{template.title} - {date}"
- Block creation if user does not rename
- Templates are immutable; opening always forces rename and creates a new room (no overwrite)
- Template system is Milestone 6+ (not in Phase 2 Milestones 1-5)

Current state:
- No template system; manual room creation only

---

## 5. Viewer Read Preference

Scenario: Viewer joins a room with stale Companion data.

Target behavior (not yet implemented):
- Compare `lastUpdate` timestamps from both sources
- Pick freshest data; if within 2s confidence window, trust `roomAuthority`

Current state:
- Code respects `roomAuthority` only; no timestamp comparison
- Viewer may see stale Companion data

Impact:
- If Companion is stale (ts: 50) and Firebase is fresh (ts: 100), viewers can show outdated timers until Companion sync completes.

Mitigation:
- Use Firebase during `authority.status === 'syncing'` and apply staleness checks on stale snapshots.

---

## 6. Room Deletion Visibility

Scenario: Room deleted from dashboard while viewers are connected or try to open the link.

Target behavior (not yet implemented):
- Detect null room on Firestore read (doc deleted)
- Block access to the room
- Show a clear message: "This timer has been deleted by the owner"
- Offer "Return to Dashboard" button

Current state:
- Direct-link handling for deleted rooms is TBD

Implementation note:
- Add null-room guard in ViewerPage/ControllerPage useEffect after fetch

---

## 7. Choppy Connection Handling

Scenario: Internet reconnects every 30 seconds.

Target behavior (partially implemented):
- Confidence window prevents frequent authority flips when timestamps are close
- Expand window from 2s to 4s when reconnect frequency is high
- Track reconnect frequency and adjust confidence dynamically

Current state:
- 2s confidence window exists in code (verify in `UnifiedDataContext.tsx`)
- Dynamic expansion (2s → 4s) is target behavior, not implemented

---

## 8. Viewer Sees Stale Companion During Controller Sync

Scenario: Controller switches Cloud → Local; Companion receives an old snapshot; viewer joins before SYNC completes.

Target behavior (not yet implemented):
- During `authority.status === 'syncing'`, viewers fall back to Firebase
- Once `status === 'ready'`, apply timestamp arbitration
- Confidence window prevents premature switch to stale Companion

Current state:
- Viewer respects `roomAuthority` immediately; may show stale Companion data during sync

Mitigation:
- SYNC timeout (5s) forces authority resolution
- Staleness check rejects implausible snapshots
