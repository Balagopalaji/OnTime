# Phase 3 Unified Arbitration Plan

Date: 2026-01-27
Branch: fix/companion-cloud-issues

## Intent
Unify all cross-source arbitration (Cloud + Companion) under a single helper so authority, pin, locks, timers, cues, and live cues follow the same freshness rules. This directly implements the Parallel Sync philosophy: dual write, read by freshness, no hard master.

## Scope & Guardrails
- No timer math changes
- No lock semantic changes (cloud functions / companion enforcement unchanged)
- Minimal risk rollout: phased by domain
- Owner-only and auth checks stay where they are (arbitration is not authorization)
- Arbitration authoritySource is domain-specific; do not reuse room authority for lock/pin/timer/cue/liveCue
- Queue replay must re-check arbitration before applying
- Shared control/delegation: arbitration should accept resourceId and allow multiple concurrent writers

## Conflict Resolution
This document is the source of truth for **arbitration logic**. If it conflicts with `docs/local-mode.md` or other docs, this plan wins.

## Refinements from review (Codex + Claude)
- If **both** sources are offline, keep last known authority (or cached) rather than forcing cloud.
- Mode bias is **tie-breaker** only; if timestamps missing, allow mode bias fallback.
- Locks should not follow room authority; treat lock arbitration separately (lock source integrity).
- Live cues: keep per-record merge; arbitration only gates ties / write-through, not visibility.
- Timers require per-item updatedAt for true parallel sync (Phase 0.5); room-level proxy is temporary only.
- Hold window: prefer per-room hold, not global `'*'`. **Decision:** keep hold for room arbitration (Option B) but make it per-room; treat removal as a behavior change. Update anchors accordingly.

## Unified Arbitration Helper (Phase 1)
Add a shared helper used by all domains, with domain-aware knobs.

### Feature Flags (Safe Rollout)
```ts
const ARBITRATION_FLAGS = {
  room: false,
  lock: false,
  pin: false,
  timer: false,
  cue: false,
  liveCue: false,
}
```

### Rollback Strategy
If arbitration causes issues in production:
1) Set the affected domain flag to `false` and refresh clients.
2) Inspect arbitration logs for the decision path.
3) Fix and re-enable.

For critical issues:
1) Revert arbitration helper to legacy behavior.
2) Clear local cache: `ontime:companionRoomCache.v2`.
3) Hard refresh all clients.

```ts
export type ArbitrationDomain = 'room' | 'lock' | 'pin' | 'timer' | 'cue' | 'liveCue'

export type ArbitrationInput = {
  roomId: string
  domain: ArbitrationDomain
  resourceId?: string // future shared control / per-item arbitration
  cloudTs?: number | null
  companionTs?: number | null
  authoritySource?: 'cloud' | 'companion'
  mode: 'auto' | 'cloud' | 'local'
  effectiveMode: 'cloud' | 'local'
  isCompanionLive: boolean
  cloudOnline: boolean
  confidenceWindowMs: number
  controllerTieBreaker?: 'cloud' | 'companion'
  viewerSyncGuard?: boolean
  holdActive?: boolean
  allowFallbackToMode?: boolean
  preferSource?: 'cloud' | 'companion' // domain-specific override when needed
}

export type ArbitrationDecision = {
  acceptSource: 'cloud' | 'companion'
  reason:
    | 'cloud newer'
    | 'companion newer'
    | 'within window - authority'
    | 'within window - tie breaker'
    | 'mode bias'
    | 'cloud offline'
    | 'companion offline'
    | 'viewer sync guard'
    | 'hold active'
    | 'no data'
}
```

Suggested rule order (refined):
1) If !isCompanionLive and !cloudOnline → return last accepted source per domain (or cached snapshot). If no last-accepted source is tracked, fall back to roomAuthority.source **only for room domain**; otherwise use cached domain data. If no history and effectiveMode is local/auto, default to companion. If both offline, prefer the cache with data (companion cache vs cloud cache) when available. For lock/pin/liveCue there is no cache; fallback is last accepted in memory only.
2) If !isCompanionLive → cloud.
3) If !cloudOnline → companion.
4) Viewer guard (viewerSyncGuard boolean = authority.status === 'syncing' && isViewerClient(roomId)) → cloud.
5) If holdActive and timestamp delta within confidence window → keep authoritySource/preferSource (reason: hold active).
6) If abs(cloudTs - companionTs) > skewThreshold and both sources are online with timestamps → choose cloud (reason: skew guard).
7) If both sides are online but **no data on either side** → return last accepted source or cached (reason: no data - both empty).
8) If one side has no data → accept the other (reason: no data).
9) If cloudTs/companionTs missing → fallback to mode or preferSource.
10) If timestamps equal and controllerTieBreaker → that source.
11) If within confidence window → authoritySource (or preferSource if provided).
12) Else newer wins.
13) Mode bias only as final fallback.

## Phase Plan

### Phase 0.5 — Per-item timestamps (required for true parallel sync)
- **Add `updatedAt` to Companion timers and cues** (companion payloads + store), and ensure Cloud has per-item updatedAt.
- For Cloud timers, ensure Firestore writes include `updatedAt` on timer create/update.
- Without this, Phase 5 would be room-level arbitration only (not acceptable for final state).
- Verify timestamps are propagated in both directions before Phase 5.

### Known limitations / edge cases
- **Clock skew guard (short-term)**: If `abs(companionTs - cloudTs) > 10 minutes`, log warning and prefer server (cloud) timestamps for that decision. Apply to room/timer/cue/pin; lock uses lock-domain preference. Define `skewThreshold` (e.g., 10 minutes) and wire it into rule order.
- **Clock skew (long-term)**: compute client offset vs server time and correct Companion timestamps.
- **Clock skew**: Companion timestamps are client-generated; cloud uses server timestamps. Large skew can bias arbitration.
- **Rapid reconnects**: reconnectChurn expands confidence window; caller must pass `getConfidenceWindowMs(reconnectChurn)`.
- **Simultaneous domain changes**: room state and lock updates are independent; brief inconsistencies are possible.
- **Timer timestamps**: room-level lastUpdate is only a temporary proxy; Phase 5 must not ship without Phase 0.5 per-item updatedAt.
- **No-data definition**: treat presence of data separately from timestamps. If data exists but timestamp missing, do not treat as no-data; use allowFallbackToMode/preferSource.
- **Last accepted source tracking**: track last accepted source per domain (not roomAuthority for non-room domains). Only room state has local cache; lock/pin/liveCue fall back to last accepted in memory. Cues/timers may use cached room snapshots only until per-item timestamps exist. For future shared control, track last accepted by (domain, resourceId).

### Phase 0 — Inventory (done)
Map entry points + timestamps for each domain:
- Room: handleRoomStateSnapshot/Delta, getRoom, pickSource (state.lastUpdate)
- Lock: cloud lock snapshot, handleControllerLockState (lock.lockedAt/heartbeat)
- Pin: mergeRoomPin + pin snapshot (pin.updatedAt)
- Timers: getTimers, handleTimerCreated/Updated (use room lastUpdate for now, until Phase 0.5 lands)
- Cues: getCues (cue.updatedAt)
- Live cues: getLiveCueRecords (record.updatedAt)

### Phase 1 — Helper implementation
Add the helper in `frontend/src/context/UnifiedDataContext.tsx` or `frontend/src/lib/arbitration.ts`.

#### Builder Checklist (Phase 1 + Phase 2)
**Phase 1 — Helper**
- [ ] Create `ArbitrationDomain`, `ArbitrationInput`, `ArbitrationDecision` types.
- [ ] Implement `arbitrate()` with the rule order in this plan.
- [ ] Add optional debug logging gated by `VITE_DEBUG_ARBITRATION` (include resourceId when provided).
- [ ] Add `ARBITRATION_FLAGS` per domain for safe rollout.
- [ ] Track last accepted source per domain (update on each arbitration decision) for both-offline fallback; key by (domain, resourceId) when provided.
- [ ] Include holdActive + skewThreshold in rule order (hold only within confidence window; skew overrides hold).
- [ ] Treat `authoritySource` as per-domain (and per-resourceId where applicable).

**Phase 2 — Room state**
- [ ] Replace `resolveRoomSource` body with `arbitrate()` (domain = `room`).
- [ ] Make `pickSource()` a thin wrapper around `arbitrate()`.
- [ ] Remove direct authority setting in `handleRoomStateSnapshot/Delta` and set `roomAuthority.source` from arbitration decision.
- [ ] Pass `confidenceWindowMs = getConfidenceWindowMs(reconnectChurn)`.
- [ ] If `ARBITRATION_FLAGS.room` is false, keep legacy behavior.

### Phase 2 — Room state
- `handleRoomStateSnapshot/Delta` should use helper decision, not set authority by policy.
- `pickSource()` becomes a thin wrapper around helper.

### Phase 3 — Lock state
- Use helper for **which lock to trust**.
- Do not let companion lock events override cloud lock when helper says cloud.
- Make hold per-room, not `'*'`.
- Pass a **lock-domain preferSource** into helper (e.g., derived from shouldUseCloudLock(roomId)), not room authority.
- Hold scope: keep hold for room arbitration but make it per-room (Option B).

### Phase 4 — PIN
- Remove cloud-preferred short-circuit.
- Use helper with pin.updatedAt; keep owner-only write guards.
- Add timeout/reset for cloudToCompanionInFlight.

### Phase 5 — Timers/Cues
- Replace cloud-preferred logic in `getTimers`/`getCues` with **ID-based list merging** using per-item timestamps:
  - union IDs from cloud + companion
  - for each ID, `arbitrate({ domain, resourceId, cloudTs, companionTs, ... })`
  - build merged list from winners
- **Per-item updatedAt required** (Phase 0.5). Room-level lastUpdate proxy is temporary only and should be removed once per-item updatedAt is in place.
- For cues, verify companion events include `updatedAt`; if not, use payload timestamp or room lastUpdate fallback (temporary only).
- Do not enable `ARBITRATION_FLAGS.timer/cue` until per-item updatedAt exists on both sources.

### Phase 6 — Live cues
- Keep per-record merge; helper **must not** hide companion PPT records based on room-level arbitration.
- Clarify implementation:
  - If companion has a PPT record and cloud does not, keep companion.
  - If both exist, use helper to choose version (or merge videos), but never drop companion PPT solely due to room-level arbitration.
  - For PPT video metadata, record-level merge wins over room-level arbitration (keep richer companion metadata when newer/equal).
- Live cues are record-level arbitration; room-level source should not suppress companion-only records.

### Phase 7 — Verification
Create a unified checklist across reconnect, lock, pin, timers/cues, cross-tab scenarios.

## Risk Notes
- Locks are highest risk (authority flips). Do that after room state helper is proven.
- Timers/cues may need timestamp backfill.
- Lock arbitration should use lock-domain source, not room authority.

## Debug logging
Add optional logging:
```ts
if (import.meta.env.VITE_DEBUG_ARBITRATION === 'true') {
  console.info('[arbitration]', { domain: input.domain, roomId: input.roomId, decision })
}
```

## Implementation anchors (guide only)
- `UnifiedDataContext.tsx: resolveRoomSource`, `pickSource`, `handleRoomStateSnapshot/Delta`
- `UnifiedDataContext.tsx: handleControllerLockState`, lock onSnapshot
- `UnifiedDataContext.tsx: mergeRoomPin`
- `UnifiedDataContext.tsx: getTimers`, `getCues`, `getLiveCueRecords`
- **Hold scope**: update per-room hold usage in room arbitration (Option B) and remove any global `'*'` usage.
- Hold window must be per-room (Option B applies to room arbitration as well).

## Raw reports

See `docs/phase-3-arbitration-research.md` for verbatim research outputs.

