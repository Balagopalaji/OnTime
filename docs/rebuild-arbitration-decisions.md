---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-07-08
Scope: Owner decisions on data arbitration, control-lock authority, conflict UX, and the local/Cloud model — load-bearing for Stage 1b carves (U4/U5/U7) and beyond.
---

# OnTime Rebuild — Arbitration & Control Decisions

Owner decisions/clarifications recorded 2026-07-08. These govern timer/sync/seed/arbitration/takeover behavior (slow-lane work) and must be honored by future carves. Where a decision is already implemented, the implementing PR is cited.

## Contents
- [Already resolved](#already-resolved)
- [1. Data arbitration — read precedence](#1-data-arbitration--read-precedence)
- [2. Data vs control-lock authority — keep them separate](#2-data-vs-control-lock-authority--keep-them-separate)
- [3. Partition / reconnect rules (control)](#3-partition--reconnect-rules-control)
- [4. Terminology — "controller session conflict"](#4-terminology--controller-session-conflict)
- [5. Conflict resolution UX](#5-conflict-resolution-ux)
- [6. Local mode with Cloud backup](#6-local-mode-with-cloud-backup)
- [7. Snapshot freshness (live broadcasts)](#7-snapshot-freshness-live-broadcasts)
- [8. Future show-caller / multi-operator model (back burner)](#8-future-show-caller--multi-operator-model-back-burner)
- [9. Process — fast lane / slow lane](#9-process--fast-lane--slow-lane)

## Already resolved
- **Takeover authorization matrix (M4)** — per-mode (Companion: PIN | 30s timeout; Cloud: PIN | server-verified reauth | stale | timeout). See `docs/interface.md` FORCE_TAKEOVER notes (#96).
- **Next-units ordering (M6)** — canonical source is `docs/rebuild-progress.md` "Next units (canonical)" (#93/#94). Any other doc giving an ordering defers to it.
- **Dual-write scope (m9)** — scoped dual-write: Local-enabled builds dual-write when both channels are available; Cloud-only does not dual-write (#93). See `docs/app-prd.md` / `docs/client-prd.md` Parallel Sync Principles.

## 1. Data arbitration — read precedence
**Decision: no mode is permanently primary in Local-enabled dual-write operation.**

Read precedence:
1. **Freshest trustworthy `lastUpdate` wins.**
2. The **confidence window** handles close-timestamp ambiguity / holds only.
3. **Mode is only a tie-breaker / fallback**, not primary authority.

Mode tie/fallback behavior:
- **Local mode** biases Companion only for ties, confidence-window decisions, or missing-timestamp fallback.
- **Cloud mode** biases Firebase only for ties, confidence-window decisions, or missing-timestamp fallback.
- **Auto mode** follows the unified arbitration helper / effective-mode fallback.

Pre-mortem guardrails (must hold):
- The confidence window must **not** become a stale-data window.
- Mode preference must **not** override a materially newer timestamp outside the confidence window.
- Do **not** feed known-stale snapshots into arbitration as if they are fresh; apply snapshot-staleness checks before arbitration where relevant.
- Cross-source decisions must go through the **shared arbitration logic/module** — do not reintroduce one-off mode-specific arbitration paths.
- Do **not** reuse room authority for other domains. Locks, PINs, timers, cues, and live cues need domain-specific arbitration inputs.
- Timer/cue-list arbitration is **not final** until per-item `updatedAt` exists on both Cloud and Companion; room-level `lastUpdate` is only a temporary proxy. (Long term, timers/cues need per-item `updatedAt`.)

## 2. Data vs control-lock authority — keep them separate
**Decision: data arbitration and control-lock authority must be treated separately.**

Data/state arbitration:
- Timers, room state, cues, and live cues are **data**.
- Different timers/cues/fields can merge.
- Same-item conflict uses the **latest trustworthy item timestamp**.
- If timestamps/source confidence are ambiguous, show a conflict label and let the user choose Cloud or Local (see §5).
- Long term, timers/cues need per-item `updatedAt`; room-level `lastUpdate` is too blunt for final item-level sync.

Control/lock authority:
- Lock ownership is **authorization**, not ordinary data arbitration.
- Do **not** resolve split Cloud/Companion controller locks with generic room-state arbitration.
- One room can have multiple connected clients, but only **one authoritative controller session** should exist per authority domain.
- If Cloud and Companion disagree, treat it as a **controller-session conflict**, not necessarily a multi-owner conflict.
- Full unified control requires the lock state to converge across both domains, or the UI must show partial/degraded/conflict authority.
- A takeover accepted in one domain should be **mirrored to the other** when possible.
- If mirroring is rejected, the UI shows the truth, e.g. "You control Local only; Cloud is controlled by another session. Take over Cloud?"

## 3. Partition / reconnect rules (control)
- If Local/Companion was offline while Cloud granted a newer/server-authorized takeover, **Cloud lock wins for Cloud writes on reconnect**. The stale local lock must not overwrite Cloud automatically.
- If Local took over while Cloud was unavailable and Cloud has no newer server-side lock, local lock may be **mirrored upward** when Cloud returns.
- If both sides claim different controller sessions after a partition, treat it as **split-control / degraded**: prefer server-verified Cloud lock for Cloud writes and require explicit fresh takeover to replace it.
- Taking over Cloud resolves **future** write authority; it does **not** automatically resolve past data conflicts. Data reconciliation still runs separately.

## 4. Terminology — "controller session conflict"
The app does not have a full multi-owner model. In practice "different users" usually means different **controller sessions**: same owner on two devices; assistant/operator with room access; local controller with PIN access; cloud controller under the same login.

Decision:
- Use **"controller session conflict"** rather than "different users" unless the code/docs explicitly mean authenticated user IDs.
- If it is the same authenticated owner/session lineage, the latest verified control session can converge control.
- If authority is ambiguous or split across Cloud/Companion, require **explicit convergence/takeover** rather than silently dual-writing.

## 5. Conflict resolution UX
- Auto-merge non-conflicting data changes.
- For same-item conflicts, use the **latest trustworthy timestamp**.
- If confidence is ambiguous, show a **conflict label**.
- Conflict detail shows source, timestamp, and values: Cloud version · Local version · **Use Cloud** · **Use Local** · **Keep both** only where the domain supports it (e.g. separate cues/timers, not the same timer state).
- Do **not** silently overwrite ambiguous data.

## 6. Local mode with Cloud backup
- **Local mode ≠ "Cloud disabled."** In Local-enabled builds, if internet is available, Cloud continues receiving writes as a redundant backup channel.
- A future user setting may allow Cloud-backup-off / true local-only operation.
- If Cloud backup is off, the product must **honestly communicate** that Cloud redundancy and remote recovery are disabled.

## 7. Snapshot freshness (live broadcasts)
A live room-state broadcast's freshness anchor is the **envelope `timestamp`** (server emit time) whenever `state.lastUpdate` is the sentinel `0` (never-cached room — companion `getRoomState` default). A real `lastUpdate` (>0) always takes precedence. Implemented by `resolveSnapshotTimestamp` in `frontend/src/context/UnifiedDataContext.tsx` (#97; 7th-audit MINOR-1). See also `docs/timer-logic.md`.

## 8. Future show-caller / multi-operator model (back burner)
Not built now, but the current lock model must **not** block it. Future model:
- Room/session owner is final authority (usually director / show caller).
- Operators are delegated editors for scoped domains (e.g. LX operator edits LX cues; A/V/stage operators edit their role-scoped cues).
- Owner/director can override operator-owned cues when needed.
- Operators should **not** need global timer/controller ownership just to update their own cue lane.
- Cue edits are item/role-level collaborative data, **not** blocked by the global timer control lock.
- Session/global control and role-scoped cue editing are **separate permission layers**.

Current Stage 1b stays simpler: one authoritative controller session for timer/global control; Companion takeover = PIN | 30s unanswered request; Cloud takeover = PIN | server-verified auth. Do **not** implement full multi-user show-caller permissions now.

## 9. Process — fast lane / slow lane
Continue the carve in **this repo** — no fresh repo, no real microservices now. Use internal service/module/package boundaries.
- **Fast lane:** type-only moves, pure wiring, docs, dead code, mechanically inert work. Batch larger; Codex self-merge on green CI + spot-check.
- **Slow lane:** timer/sync/seed/arbitration/takeover/presentation behavior. Spec-first, pre-mortem strongly, then build against the correct-behavior contract.
- **Old behavior is evidence, not automatically the spec.** Preserve byte-faithfully only for type-only/proven behavior. For buggy or unfinished areas, write the intended-behavior contract first and build to that.
