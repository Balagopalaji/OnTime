---
Type: Plan
Status: draft
Owner: KDB
Last updated: 2026-01-28
Scope: Staged execution roadmap and builder prompts for unified arbitration.
---

# Phase 3 Arbitration Roadmap (AI-Driven)

Date: 2026-01-28
Branch: phase-3-arbitration

## Purpose
Provide a staged execution roadmap with granular tasks and builder prompts for an AI‑driven refactor to unified arbitration. This avoids regression by limiting each pass to a small, verifiable scope.

## Source of Truth
- `docs/phase-3-unified-arbitration-plan.md` (arbitration logic)
- `docs/phase-3-arbitration-agent-guide.md` (agent instructions)
- `docs/interface.md` (schema contract)

---

## Pass 0 — Docs Alignment (Done)
**Status:** ✅ complete (docs updated)

---

## Pass 1 — Phase 0.5: Per‑Item updatedAt (Data Integrity)
**Goal:** Ensure timers and cues carry per‑item updatedAt so arbitration can be per‑item.

### Tasks
- Companion: add `updatedAt` to timer/cue payloads and store updates (Companion event handlers).
- Cloud: ensure Firestore timer writes include `updatedAt` on create/update.
- Confirm interface.md already lists `updatedAt` for timers/cues (done).

### Verification
- Create/Update timer in Companion → updatedAt present in payload + stored.
- Create/Update timer in Cloud → updatedAt set in Firestore.
- Cue create/update → updatedAt present in Companion and Cloud.

### Builder Prompt (Pass 1)
```
<task>
Add per-item `updatedAt` to Companion timers and cues, and ensure Cloud timer writes include `updatedAt`. This is Phase 0.5 and a prerequisite for arbitration. Do NOT change timer math or lock semantics.
</task>
<context>
- Update Companion timer/cue create/update handlers to set `updatedAt: Date.now()` and include in outbound payloads.
- Update Firestore timer writes in frontend to include `updatedAt: serverTimestamp()` or Date.now() (existing pattern).
- Files likely: companion/src/main.ts (handleCreateTimer, handleUpdateTimer, handleReorderTimers, cue create/update handlers),
  frontend/src/context/UnifiedDataContext.tsx (createTimer, updateTimer, nudgeTimer, deleteTimer writes).
- Keep scope minimal: timestamps only.
</context>
```

---

## Pass 2 — Phase 1: Arbitration Helper (Logic Core)
**Goal:** Implement unified `arbitrate()` helper with rule order, flags, and lastAccepted tracking. No domain wiring yet.

### Tasks
- Add helper + types (domain, input, decision).
- Implement rule order including hold + skew guard.
- Add ARBITRATION_FLAGS.
- Track lastAccepted source per domain/resourceId.
- Add optional debug logging (`VITE_DEBUG_ARBITRATION`).

### Verification
- Unit checks via console logs: feed synthetic inputs and verify decisions.

### Builder Prompt (Pass 2)
```
<task>
Implement the unified arbitration helper (`arbitrate`) with rule order, skew guard, hold handling, flags, and lastAccepted tracking. Do NOT wire it into room state yet.
</task>
<context>
- Use the rule order from docs/phase-3-unified-arbitration-plan.md.
- Add ARBITRATION_FLAGS (all false by default).
- Add lastAccepted tracking keyed by (domain, resourceId).
- Add debug logging with VITE_DEBUG_ARBITRATION.
- Files: frontend/src/context/UnifiedDataContext.tsx OR frontend/src/lib/arbitration.ts.
</context>
```

---

## Pass 3 — Phase 2: Room State Arbitration
**Goal:** Wire arbitrate() into room state (resolveRoomSource/pickSource/snapshot handlers).

### Tasks
- Replace resolveRoomSource body with arbitrate().
- Make pickSource a thin wrapper.
- Remove direct authoritySource mutations from handleRoomStateSnapshot/Delta.
- Use ARBITRATION_FLAGS.room to gate rollout.

### Verification
1) **Cloud newer test**
   - Start timer via cloud (Firestore write).
   - Disconnect Companion WebSocket.
   - Reconnect Companion.
   - Verify authority stays cloud and room state does not flip.
2) **Companion newer test**
   - Start timer via Companion.
   - Disconnect Firebase (offline or block network).
   - Advance timer 5+ seconds.
   - Reconnect Firebase and wait for confidence window.
   - Verify authority flips to companion and timer state stays consistent.
3) **Mode bias test**
   - Set both sources to same timestamp.
   - Set mode = local → expect companion.
   - Set mode = cloud → expect cloud.

### Builder Prompt (Pass 3)
```
<task>
Wire arbitrate() into room state: resolveRoomSource, pickSource, and handleRoomStateSnapshot/Delta. Gate with ARBITRATION_FLAGS.room.
</task>
<context>
- Keep hold per-room (Option B).
- Remove global hold key usage: `companionHoldUntilRef.current['*']` must be replaced with per-room keys.
- No timer math changes.
- Do not alter lock logic.
- Use getConfidenceWindowMs(reconnectChurn) as confidenceWindowMs.
</context>
```

---

## Pass 4 — Phase 3: Lock Arbitration (High Risk)
**Goal:** Ensure lock source is chosen by arbitrate() and Companion lock events can’t override Cloud when cloud wins.

### Tasks
- Apply helper in handleControllerLockState and cloud lock subscription.
- Use lock-domain preferSource (shouldUseCloudLock).
- Remove global hold and use per-room hold.
- Gate with ARBITRATION_FLAGS.lock.

### Verification
- Companion reconnect does not flip lock if cloud authoritative.
- Cloud takeover works when Companion offline.

### Manual Test Checklist (before enabling ARBITRATION_FLAGS.lock)
1) Companion online + cloud online: lock acquired in cloud -> companion lock event ignored.
2) Companion online + cloud online: lock acquired in companion -> cloud lock update ignored.
3) Companion offline: cloud lock changes still apply.
4) Cloud offline: companion lock changes still apply.
5) Reconnect companion: lock does not flip if cloud lock is newer (hold window still in effect).
6) Force takeover in cloud mode still works and updates lock across both.

### Builder Prompt (Pass 4)
```
<task>
Apply arbitrate() to lock domain. Prevent Companion lock events from overwriting Cloud locks when arbitration chooses cloud. Remove global hold; use per-room hold.
</task>
<context>
- Use preferSource derived from shouldUseCloudLock(roomId).
- Gate with ARBITRATION_FLAGS.lock.
- No changes to lock enforcement semantics.
</context>
```

---

## Pass 4a — Lock Write-Through (Required)
**Goal:** Prevent stale cloud lock fallback by mirroring accepted companion locks to Cloud (same-user only).

### Tasks
- Add a new callable (e.g., `syncLockFromCompanion`) in `functions/src/lock.ts` to mirror locks when `existing.userId === auth.uid` and incoming `lockedAt >= existing.lockedAt`.
- Frontend: when a **companion lock is accepted** and cloud is online + shouldUseCloudLock(roomId) true, fire-and-forget the callable to sync the lock to Cloud.
- Do not modify existing enforcement callables (`acquireLock`, `forceTakeover`, `requestControl`).

### Verification
- With cloud+companion online, a companion lock takeover updates the cloud lock doc.
- When companion drops, UI does not jump to a stale cloud lock.

### Builder Prompt (Pass 4a)
```
<task>
Add a same-user lock write-through callable (syncLockFromCompanion) and a frontend best-effort mirror call when a companion lock is accepted.
</task>
<context>
- functions/src/lock.ts and functions/src/index.ts
- frontend/src/context/UnifiedDataContext.tsx
- This is a data-integrity sync, not a takeover; keep permissions strict (same-user only).
</context>
```

### Known Issue — Reconnect Churn (follow-up)
- Companion reconnect produces 6+ HANDSHAKE_ACK / JOIN_ROOM cycles, causing lock subscription teardown and clearing `controllerLocksRef` (cloudTs=0). This allows stale companion locks to win after the hold window guard loses its cloud reference.
- Investigate JOIN_ROOM / HANDSHAKE_ACK storm and subscription lifecycle stability as a focused task before enabling lock arbitration in production.

---

## Pass 5 — Phase 4: PIN Arbitration (Security‑critical)
**Goal:** Use arbitrate() for PIN freshness while preserving owner‑only checks.

### Tasks
- Remove cloud-preferred short‑circuit in mergeRoomPin.
- Use arbitrate(domain='pin', resourceId=roomId).
- Ensure owner checks remain outside arbitration.
- Add timeout/reset for cloudToCompanionInFlight.
- Gate with ARBITRATION_FLAGS.pin.

### Verification
- PIN updates sync both ways.
- Non‑owner cannot override.

### Builder Prompt (Pass 5)
```
<task>
Apply arbitrate() to PIN merge. Remove cloud-preferred short‑circuit, keep owner checks. Add timeout/reset to cloudToCompanionInFlight. Gate with ARBITRATION_FLAGS.pin.
</task>
<context>
- Arbitration is not authorization.
- No changes to lock semantics.
- Timeout: reset cloudToCompanionInFlight after 30 seconds if no companion echo.
</context>
```

---

## Pass 6 — Phase 5/6: Timers, Cues, Live Cues
**Goal:** Per‑item ID merge using arbitrate(); live cues remain record‑level.

### Tasks
- Timers: union IDs, arbitrate per timer (resourceId = timerId).
- Cues: union IDs, arbitrate per cue.
- Live cues: keep record‑level merge; helper only for ties/write‑through.
- Gate with ARBITRATION_FLAGS.timer/cue/liveCue.

### Verification
- Cloud Timer A + Companion Timer B both appear.
- PPT live cues never disappear if only on Companion.

### Builder Prompt (Pass 6)
```
<task>
Implement ID-based merging for timers and cues using arbitrate(). Keep live cues record-level merge and only use helper for tie/write‑through. Gate with ARBITRATION_FLAGS.timer/cue/liveCue.
</task>
<context>
- Per-item updatedAt must already exist (Phase 0.5).
- Do not suppress Companion PPT live cues.
</context>
```

---

## Pass 7 — Verification & Hardening
- Run the Phase 7 checklist from the plan.
- Add any missing tests or QA scripts.
- Disable legacy paths as flags stabilize.

---

## Notes
- If any phase destabilizes, flip the respective ARBITRATION_FLAGS off to rollback.
- Keep commits per pass.
