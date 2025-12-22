# Parallel Sync & Flawless Fallback – Task List (High Priority)

This task list is the single source of truth for aligning docs and code with the Phase 1D parallel sync architecture. Do **not** overwrite `docs/tasks.md`. Keep this file updated as work progresses.

## Legend
- [ ] = Pending
- [~] = In progress
- [x] = Done

---

## A) Documentation Hygiene (do first)

- [x] Add archive notice: create `docs/archive/README-DEPRECATION-NOTICE.md` stating all archive files are historical only; instruct agents not to use them as source of truth.
- [ ] Update `AGENTS.md`: add "Archive Policy" section forbidding archive files as active context; list current sources of truth.
- [x] Move `docs/prd-alignment-analysis.md` to `docs/archive/prd-alignment-analysis-DEPRECATED.md` with a deprecation banner.
- [ ] Add banners to archive Phase 1 guides (`docs/archive/phase-1/*.md` and `docs/archive/phase-1/prompts/*`) marking them DEPRECATED and pointing to `docs/local-mode-plan.md` once rewritten.
- [ ] Create/Update `docs/README.md` to index current docs: `docs/local-mode-plan.md` (parallel sync), `docs/backend-prd.md`, `docs/frontend-prd.md`, new edge-cases doc (see C).

---

## B) Rewrite `docs/local-mode-plan.md` (source of truth)

- [ ] Add top banner: "Current source of truth for Phase 1D Parallel Sync; supersedes provider-swapping docs."
- [ ] Section 2.1.1: remove "Hybrid" as a distinct mode; define modes as `auto | cloud | local` (all dual-write when available). Explain read preference by mode.
- [ ] Section 3.3: replace with "Parallel Sync & Flawless Fallback":
  - Dual-write in all modes (Companion + Firebase as mutual backups).
  - Read arbitration: freshest by `lastUpdate` with 2s confidence window (expand to 4s on choppy links).
  - Per-change-type merge (state vs timer CRUD vs reorder vs config); last-write-wins per type.
  - Offline queue merge strategy (merge by type, keep latest per target, then replay in timestamp order).
  - Firebase→Companion sync when Firebase newer during Companion authority.
  - Staleness/plausibility check (duration-aware, adjustment-log ready).
  - Room lock prompt (never auto-expire; show device/time; takeover requires confirm).
  - Call out current code gaps explicitly (Companion blocked in Cloud mode; merge/replay missing; staleness naive; locks not implemented).
- [ ] Section 3.6.1: add browser cache keys (`companionRoomCache.v1`, `companionSubs.v1`, `queue:{roomId}`) and staleness/plausibility rules; offline behavior.
- [ ] Add note: "Hybrid term deprecated; Local represents dual-write when online."
- [ ] Append "Open gaps vs code" checklist so builders know what to implement.

---

## C) Add Edge Cases Doc

- [ ] Create `docs/edge-cases.md` covering:
  - Room lock prompt (never auto-expire; device name + last heartbeat; takeover confirmation; CONTROLLER_TAKEOVER planned).
  - Multi-device offline/online interleave (orthogonal changes coexist; merge per change type).
  - Template cloning mitigation (forced rename to avoid shared room IDs).
  - Adjustment-aware plausibility examples (manual time adds/subtracts).
  - Viewer/controller read preference rationale (freshest timestamp with confidence window).

---

## D) Mode Taxonomy & UI (code changes)

- [ ] `AppModeContext.tsx`: remove `hybrid` from type/logic; modes = `auto | cloud | local`; update effectiveMode resolution accordingly.
- [ ] Update any UI labels/help text to match three-mode model; ensure no "Hybrid" string remains.

---

## E) UnifiedDataContext Alignment (code changes)

- [ ] Allow Companion participation in Cloud mode (hot standby writes); remove `effectiveMode === 'cloud'` guard in `shouldUseCompanion`.
- [ ] Implement freshest-by-timestamp read with confidence window (2s base, expandable to 4s for choppy connections); prefer Companion when fresher or per mode bias.
- [ ] Implement per-change-type queue merge before replay (state/timer CRUD/reorder/config), keeping latest per target by timestamp; replay in chronological order.
- [ ] Add Firebase→Companion sync detection: if Firebase `lastUpdate` > Companion `lastUpdate` + grace, emit `SYNC_ROOM_STATE`.
- [ ] Replace `isSnapshotStale` with plausibility logic (duration-aware, adjustment-log ready; 3x duration cap, 10% variance, adjustment sums).
- [ ] Add TODO hooks for room lock prompt/CONTROLLER_TAKEOVER (planned protocol change); don’t ship partial behavior without guarding.
- [ ] Ensure write-through to both destinations in all modes (Cloud included).

---

## F) Companion Protocol (future/Phase 2, document as pending if not implemented now)

- [ ] Define CONTROLLER_TAKEOVER event with deviceName/lastHeartbeat in payload; update docs to mark as pending if not implemented.
- [ ] Room lock structure to include deviceName/lastHeartbeat; prompt-based takeover (never auto-expire).

---

## G) UI Indicators (optional but recommended)

- [ ] Replace banners with subtle LED indicators for Companion/Cloud status; small "Sync" pulse for controllers during active sync; avoid layout shifts.

---

## H) PRD Alignment

- [ ] Decide: add `frontend-prd-v2.md` / `backend-prd-v2.md` or add banners to current PRDs noting Phase 1D parallel sync supersedes Firebase-only MVP; ensure `docs/README.md` points to current sources.

---

## I) Testing & Risks (add to docs/local-mode-plan.md or edge-cases)

- [ ] Enumerate code gaps vs target (Companion in Cloud, merge/replay, plausibility, lock prompt).
- [ ] List regression risks: mode switch continuity, queue replay correctness, staleness acceptance, viewer freshness.

---

## Expected Outputs of This Task List

- New docs: `docs/archive/README-DEPRECATION-NOTICE.md`, updated `docs/local-mode-plan.md`, `docs/edge-cases.md`.
- Updated `AGENTS.md` archive policy.
- Archived `prd-alignment-analysis.md`.
- Clear, honest "code gaps vs target" section so builders know what to implement next.