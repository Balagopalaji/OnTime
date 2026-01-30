---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-28
Scope: Agent instructions for arbitration work.
---

# Phase 3 Arbitration Agent Guide

Date: 2026-01-28

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
- **Lock write-through required (Pass 4a):** accepted companion locks must mirror to cloud for correct fallback.

## Quick Rules Summary
- Dual-write to cloud + companion when possible.
- Read source determined by unified arbitration helper (freshness > mode).
- Hold window is **per-room** and applies to room arbitration (Option B).
- Skew guard: if `abs(companionTs - cloudTs) > 10 minutes`, choose cloud for that decision.
- Viewer sync guard: viewers prefer cloud while `authority.status === 'syncing'`.
- No-data: if one source has data and the other doesn’t, use the source with data.
- Within confidence window (2–4s): prefer current authority source.
- Outside confidence window: newer timestamp wins.

## Pass-to-Phase Mapping
Roadmap uses “Pass N” for execution steps; the plan uses “Phase N” for logical stages.
- Pass 1 = Phase 0.5
- Pass 2 = Phase 1
- Pass 3 = Phase 2
- Pass 4 = Phase 3
- Pass 5 = Phase 4
- Pass 6 = Phase 5/6
- Pass 7 = Phase 7

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
