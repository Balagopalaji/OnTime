# Phase 3 Arbitration Agent Guide

Date: 2026-01-27

## Purpose
Single-page guide for AI agents implementing arbitration logic. Use this as the first reference.

## Source-of-Truth Hierarchy (Arbitration)
1) `docs/phase-3-unified-arbitration-plan.md` (authoritative rule order + phases)
2) `docs/local-mode.md` (architecture/background only; arbitration rules superseded)
3) `docs/interface.md` (schema contract)

If any doc conflicts with the plan, the plan wins.

## Hard Constraints
- **Phase 0.5 must land before Phase 5.** (Per-item `updatedAt` required for timers/cues.)
- **Arbitration is not authorization.** Owner checks must still gate PIN writes, lock updates, and role enforcement.
- **No timer math changes** (see `docs/timer-logic.md`).

## Quick Rules Summary
- Dual-write to cloud + companion when possible.
- Read source determined by unified arbitration helper (freshness > mode).
- Hold window is **per-room** and applies to room arbitration (Option B).
- Skew guard: if `abs(companionTs - cloudTs) > 10 minutes`, choose cloud for that decision.

## Glossary
- **authoritySource**: current winner for a specific domain (not always room authority)
- **preferSource**: domain override (e.g., lock domain uses cloud when shouldUseCloudLock)
- **lastAcceptedSource**: memory of last winner for both-offline fallback
- **resourceId**: per-item arbitration key (e.g., timerId or cueId)
- **viewerSyncGuard**: `authority.status === 'syncing' && isViewerClient(roomId)`

## Implementation Safety
- Use `ARBITRATION_FLAGS` to phase domain rollouts.
- Queue replay must re-check arbitration before applying.
- Log arbitration decisions when `VITE_DEBUG_ARBITRATION === 'true'`.
