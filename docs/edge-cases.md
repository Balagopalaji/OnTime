---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-02-01
Scope: Edge cases and resolutions for sync, lock, and timer behavior.
---

# OnTime Edge Cases and Resolutions

Last Updated: 2026-02-01
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
- Duration-based staleness cap (3x duration) with 30s fallback when duration is unknown
- Paused-with-progress uses a 24h threshold
- Optional `adjustmentLog` is applied if present, but the app does not populate it yet
- No authority/variance logic

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
- Queue replay merges by change type + target, then replays in timestamp order
- No authority-based filtering of queued events

---

## 4. Fresh Device Offline (Companion Cache Seeding)

Scenario: Operator prepares rooms online, then goes offline on a fresh Companion install.

Current state (implemented):
- After Companion handshake, frontend sends `SEED_COMPANION_CACHE` (bulk rooms + tombstones).
- Companion stores data without JOIN/handshake side effects.
- Seed is overwrite-safe (newer wins) and guarded across tabs.

Mitigation:
- If no seed has occurred, offline dashboard shows only locally cached rooms.

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
- Pick freshest data; if within the confidence window, trust `roomAuthority` (see unified arbitration plan).

Current state:
- Timestamp arbitration implemented (configurable confidence window + mode bias).
- Viewer sync guard uses Firebase while `authority.status === 'syncing'`
- Timer list arbitration still prefers Firebase when available (no timestamp arbitration on timers)

Impact:
- If Companion is stale and Firebase is fresh, viewers should see Firebase data while sync is in progress.

Mitigation:
- Maintain sync guard + staleness checks; consider timer list timestamp arbitration if conflicts appear.

---

## 6. Room Deletion (Tombstones)

Scenario: Room deleted from dashboard while viewers are connected or try to open the link.

Current state (implemented):
- Room deletes write a tombstone to `deleted_rooms/{roomId}` with `expiresAt` TTL.
- Frontend filters tombstoned rooms from both cloud and companion caches.
- Companion purges local cache when tombstone is applied (via socket or seed).
- Local tombstones queue offline deletes and upload on reconnect.

Notes:
- Firestore TTL must be enabled on `deleted_rooms.expiresAt` to auto-clean tombstones.
- UI messaging for “room deleted” is still TBD (viewer/controller UX).

---

## 7. PowerPoint Video Timing (Windows Only)

Scenario: PowerPoint slide contains one or more embedded videos; timing must show even while the controller UI is in the foreground.

Current state:
- Windows uses a dedicated STA helper (`companion/ppt-probe/ppt-probe.exe`) to avoid COM shape enumeration failures in the Electron host.
- Helper emits per-video `videos[]` metadata and a primary timing tuple (`videoDuration`, `videoElapsed`, `videoRemaining`, `videoPlaying`).
- Frontend merges live-cue updates and preserves `videos[]` metadata via `mergeCueVideos` in `frontend/src/context/UnifiedDataContext.tsx` to avoid flicker.

Risks:
- If `videos[]` metadata is overwritten by a newer record with empty `videos`, the UI can flicker “No video on this slide.”
- Helper binaries must be rebuilt when `companion/ppt-probe/Program.cs` changes.

Mitigation:
- Keep `mergeCueVideos` metadata-preserving merge logic intact.
- Rebuild `ppt-probe.exe` and package it via `extraResources` after helper changes.

Current state:
- Direct-link handling for deleted rooms is TBD

Implementation note:
- Add null-room guard in ViewerPage/ControllerPage useEffect after fetch

---

## 8. Choppy Connection Handling

Scenario: Internet reconnects every 30 seconds.

Target behavior (partially implemented):
- Confidence window prevents frequent authority flips when timestamps are close (configurable; expanded on churn).
- Expand window when reconnect frequency is high (see unified arbitration plan).
- Track reconnect frequency and adjust confidence dynamically

Current state:
- Confidence window exists in code (verify in `UnifiedDataContext.tsx`).
- Dynamic expansion (2s → 4s) is target behavior, not implemented

---

## 9. Viewer Sees Stale Companion During Controller Sync

Scenario: Controller switches Cloud → Local; Companion receives an old snapshot; viewer joins before SYNC completes.

Target behavior (not yet implemented):
- During `authority.status === 'syncing'`, viewers fall back to Firebase (see unified arbitration plan for rule order).
- Once `status === 'ready'`, apply timestamp arbitration
- Confidence window prevents premature switch to stale Companion

Current state:
- Viewer sync guard uses Firebase while `authority.status === 'syncing'`
- Staleness checks reject implausible snapshots, but dynamic confidence window expansion is not implemented

Mitigation:
- SYNC timeout (5s) forces authority resolution
- Staleness check rejects implausible snapshots

---

## 10. PowerPoint Embedded Video Timing Unavailable (Windows)

Scenario: PowerPoint slideshow is running with an embedded MP4, but video timing shows as unavailable in the controller.

Current state:
- Companion prefers the native STA helper (`ppt-probe.exe`) for timing on Windows.
- PowerShell fallback can see the slideshow but cannot enumerate Shapes in some environments, so timing is unavailable.

Mitigation:
- The UI displays "Video timing unavailable" and continues without timing metadata.
- See `docs/ppt-video-debug.md` for the debug trail and helper details.