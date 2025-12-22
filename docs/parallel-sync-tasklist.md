# Parallel Sync & Flawless Fallback – Task List (High Priority)

This task list is the single source of truth for aligning docs and code with the Phase 1D parallel sync architecture. Do **not** overwrite `docs/tasks.md`. Keep this file updated as work progresses.

**Current scope:** Documentation alignment complete. Code-change sections (D–G) completed; F remains pending.

## Legend
- [ ] = Pending
- [~] = In progress
- [x] = Done

---

## A) Documentation Hygiene (do first)

- [x] Add archive notice: create `docs/archive/README-DEPRECATION-NOTICE.md` stating all archive files are historical only; instruct agents not to use them as source of truth.
- [x] Update `AGENTS.md`: add "Archive Policy" section forbidding archive files as active context; list current sources of truth.
- [x] Move `docs/prd-alignment-analysis.md` to `docs/archive/prd-alignment-analysis-DEPRECATED.md` with a deprecation banner.
- [x] Add banners to archive Phase 1 guides (`docs/archive/phase-1/*.md` and `docs/archive/phase-1/prompts/*`) marking them DEPRECATED and pointing to `docs/local-mode-plan.md` once rewritten.
- [x] Create/Update `docs/README.md` to index current docs: `docs/local-mode-plan.md` (parallel sync), `docs/backend-prd.md`, `docs/frontend-prd.md`, new edge-cases doc (see C).

---

## B) Rewrite `docs/local-mode-plan.md` (source of truth)

- [x] Add top banner: "Current source of truth for Phase 1D Parallel Sync; supersedes prior single-provider docs."
- [x] Section 2.1.1: remove deprecated mode as a distinct option; define modes as `auto | cloud | local` (all dual-write when available). Explain read preference by mode.
- [x] Section 3.3: replace with "Parallel Sync & Flawless Fallback":
  - Dual-write in all modes (Companion + Firebase as mutual backups).
  - Read arbitration: freshest by `lastUpdate` with 2s confidence window (expand to 4s on choppy links).
  - Define authority rule for confidence-window tie (Auto mode: last controller write source; default to Firebase).
  - Per-change-type merge (state vs timer CRUD vs reorder vs config); last-write-wins per type.
  - Offline queue merge strategy (merge by type, keep latest per target, then replay in timestamp order).
  - Firebase→Companion sync when Firebase newer during Companion authority (not mode-gated).
  - Staleness/plausibility check (duration-aware, adjustment-log ready).
  - Room lock prompt (never auto-expire; show device/time; takeover requires confirm).
  - Call out current code gaps explicitly (Companion blocked in Cloud mode; merge/replay missing; staleness naive; locks not implemented).
- [x] Section 3.6.1: add browser cache keys (`companionRoomCache.v1`, `companionSubs.v1`, `queue:{roomId}`) and staleness/plausibility rules; offline behavior.
- [x] Add note: deprecated mode term removed; Local represents dual-write when online.
- [x] Add Section 9 "Code Gaps vs Target Architecture" with explicit markers:
  - ❌ Companion blocked in Cloud mode (`shouldUseCompanion` guard)
  - ❌ No timestamp arbitration (respects authority only)
  - ❌ Queue replay is FIFO only (no per-change-type merge)
  - ⚠️ Firebase→Companion sync missing
  - ⚠️ Naive staleness check (30s/24h fixed)
  - ⏸️ Room lock + heartbeat not implemented
  - ⏸️ Deprecated mode type still in code
- [x] Append "Open gaps vs code" checklist so builders know what to implement.

---

## C) Add Edge Cases Doc

- [x] Create `docs/edge-cases.md` covering:
  - Room lock prompt (never auto-expire; device name + last heartbeat; takeover confirmation; CONTROLLER_TAKEOVER planned) **[TARGET - not implemented]**.
  - Multi-device offline/online interleave (orthogonal changes coexist; merge per change type) **[TARGET - not implemented]**.
  - Template cloning mitigation (forced rename to avoid shared room IDs) **[FUTURE/PHASE 2]**.
  - Adjustment-aware plausibility examples (manual time adds/subtracts) **[TARGET - not implemented]**.
  - Viewer/controller read preference rationale (freshest timestamp with confidence window) **[TARGET - not implemented]**.
  - Choppy connection handling (2s→4s confidence window expansion) **[PARTIALLY IMPLEMENTED]**.

---

## D) Mode Taxonomy & UI (code changes)

- [x] `AppModeContext.tsx`: remove `hybrid` from type/logic; modes = `auto | cloud | local`; update effectiveMode resolution accordingly.
- [x] Update any UI labels/help text to match three-mode model; ensure no deprecated mode term remains.

---

## E) UnifiedDataContext Alignment (code changes)

- [x] **[HIGH]** Allow Companion participation in Cloud mode (hot standby writes); remove `effectiveMode === 'cloud'` guard in `shouldUseCompanion`.
- [x] **[HIGH]** Implement freshest-by-timestamp read with confidence window (2s base, expandable to 4s for choppy connections); prefer Companion when fresher or per mode bias.
- [x] **[HIGH]** Implement per-change-type queue merge before replay (state/timer CRUD/reorder/config), keeping latest per target by timestamp; replay in chronological order.
- [x] **[MEDIUM]** Add Firebase→Companion sync detection: if Firebase `lastUpdate` > Companion `lastUpdate` + grace, emit `SYNC_ROOM_STATE`.
- [x] **[MEDIUM]** Replace `isSnapshotStale` with plausibility logic (duration-aware, adjustment-log ready; 3x duration cap, 10% variance, adjustment sums).
- [x] **[LOW]** Add TODO hooks for room lock prompt/CONTROLLER_TAKEOVER (planned protocol change); don't ship partial behavior without guarding.
- [x] **[HIGH]** Ensure write-through to both destinations in all modes (Cloud included).

---

## F) Companion Protocol (future/Phase 2, document as pending if not implemented now)

- [x] Define CONTROLLER_TAKEOVER event with deviceName/lastHeartbeat in payload; update docs to mark as pending if not implemented.
- [x] Room lock structure to include deviceName/lastHeartbeat; prompt-based takeover (never auto-expire).

---

## G) UI Indicators (optional but recommended)

- [x] Replace banners with subtle LED indicators for Companion/Cloud status; small "Sync" pulse for controllers during active sync; avoid layout shifts.
- [x] Show queue-capacity warning when >80% full; keep discreet and minimalist.
- [x] Sync mode changes across tabs via `BroadcastChannel`.

---

## H) PRD Alignment

- [x] Add deprecation banners to `docs/frontend-prd.md` and `docs/backend-prd.md`:
  - Top banner: "⚠️ MVP SPECIFICATION - PARTIALLY SUPERSEDED"
  - Pointer to `docs/local-mode-plan.md` for dual-sync behavior
  - Note what Phase 1D changes aren't reflected (dual-connection, timestamp arbitration, queue merging, room lock)

---

## I) Testing & Risks (add to docs/local-mode-plan.md or edge-cases)

- [x] Enumerate code gaps vs target (Companion in Cloud, merge/replay, plausibility, lock prompt).
- [x] List regression risks: mode switch continuity, queue replay correctness, staleness acceptance, viewer freshness.

---

## J) Terminology Cleanup (docs-wide)

- [x] Search all docs for deprecated mode term; add deprecation footnotes or replace with "Local (dual-write)".
- [x] Define "mutual backups" explicitly in `local-mode-plan.md` Section 3.3:
  - "When both are available, always write to both; reads pick freshest by timestamp with a 2s confidence window."
- [x] Ensure prior single-provider terminology is absent from current docs (archive only).

---

## K) Validation Checklist (After All Tasks Complete)

- [x] Run full-text search for deprecated mode term in `docs/` (excluding archive) → should only appear in deprecation notes.
- [x] Verify `AGENTS.md` blacklists archive folder → agents won't use stale docs.
- [x] Verify `docs/README.md` indexes only current docs → clear navigation.
- [x] Verify `docs/local-mode-plan.md` Section 9 lists all code gaps → builders know what to implement.
- [x] Verify `docs/edge-cases.md` marks target vs implemented → no false assumptions.
- [x] Test documentation with fresh agent: provide only `docs/local-mode-plan.md` + `docs/edge-cases.md` → can agent understand architecture without archive?

---

## Expected Outputs of This Task List

- New docs: `docs/archive/README-DEPRECATION-NOTICE.md`, updated `docs/local-mode-plan.md`, `docs/edge-cases.md`.
- Updated `AGENTS.md` archive policy.
- Archived `prd-alignment-analysis.md`.
- Clear, honest "code gaps vs target" section so builders know what to implement next.
- All terminology aligned (no deprecated mode term leakage, "mutual backups" defined).
- Validation confirms docs are agent-proof (archive ignored, current docs clear).
