---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2025-12-29
Scope: Phase 2 task list and prerequisites.
---

# Phase 2 Task List (Builder-Focused, Pass-Scoped)

This file translates the Phase 2 plan into granular, implementable steps for builder agents. Phase 2 starts only after Phase 1D gaps are closed (see checklist below) and the unified data provider architecture is stable. Same codebase for all tiers; features are gated via flags/rules, not forks. Milestones are split into explicit passes to keep each builder run small and verifiable.

## Pre-Phase 2: Verify Phase 1D Completion

**STATUS (2025-12-29):** ✅ Phase 1D Parallel Sync is COMPLETE. All high and medium priority items are implemented.

### ✅ High Priority (Complete)
- [x] Companion participates in Cloud mode (hot standby writes in all modes)
- [x] Timestamp arbitration with 2s confidence window (expandable to 4s)
- [x] Queue merge by change type (keeps latest per target, replays in timestamp order)

### ✅ Medium Priority (Complete)
- [x] Firebase → Companion sync when Firebase is newer (`SYNC_ROOM_STATE`)
- [x] Plausibility-based staleness check (duration-aware cap; authority/variance deferred)

### ⏸️ Low Priority (Deferred to Phase 2)
- [ ] Room lock prompt + heartbeat + `CONTROLLER_TAKEOVER`

### ✅ Cleanup (Complete)
- [x] Mode types use `auto | cloud | local` (no deprecated `hybrid`)

**Verification:**
- [x] Run `npm run test` in `frontend/` - tests pass
- [x] Queue merge implemented and working

## Guardrails & Targets
- **Latency (viewers):** Local viewer (Companion) <150 ms delta from controller; Cloud viewer <700 ms. Measure via stopwatch harness (see QA hooks).
- **Reconnect backoff (Companion clients):** Attempt 1 immediate; attempts 2–5 at 2s; 6+ at 10s; cap at 60s; stop after 20 attempts and surface retry CTA.
- **Preview cache (dashboard):** TTL 10s or on `HANDSHAKE_ACK` capability change, whichever is sooner.
- **Authority confidence window (room reads):** 2s base, expand to 4s on reconnect churn (per local-mode.md Section 3.3).
- **Companion RAM budgets (steady state after 60s idle, average of 3 samples):** Minimal <50 MB, Show Control ≤100 MB, Production ≤150 MB.
- **Feature gating:** Legacy rooms without `features` default to deny Show Control/Production data paths; UI must hide gated features and emit upgrade prompts.
- **File ops security:** Normalize path, require path within user home or OS app data; reject symlinks pointing outside allowed roots; reject UNC/network paths; bind HTTP to 127.0.0.1; token auth required.
- **Tokens:** TTL 30 minutes; frontend refreshes on 401 by refetching token; Companion rotates token on restart.

## Deferred to Phase 3 (Not in Phase 2 scope)
- Undo/redo command system and persistence (see `docs/phase-2-overview.md`).

## Builder Pass Guidance
- Keep each pass focused (single concern); run lint/tests relevant to touched surfaces.
- Respect feature flags: default off until QA signoff; prefer canary room for risky changes.
- After each pass, document acceptance checks (RAM/latency/backoff) and note any deviations.

---

## Milestone 1: Transport Hardening & Tier Gating
**Goal:** Reliable Local/Cloud transport with correct gating and clean reconnection UX.

**Pass A: State Machine & Reconnect**
- [ ] Document and implement JOIN → HANDSHAKE → SYNC → STEADY → RECONNECT flow; reject overlapping JOIN/HANDSHAKE; only one pending handshake at a time.
- [ ] Apply backoff schedule; banner after 5 failed attempts; hard-stop after 20 with "Retry" CTA; log last error code.
- [ ] Controller lock/takeover UX: on `CONTROLLER_TAKEN`, prompt; takeover sets `takeOver=true`; on success broadcast takeover notice; no silent auto-takeover.

**Pass B: Authority & Caching**
- [ ] On `HANDSHAKE_ACK` capability change or tier change, drop cached preview, refetch room config/state, recompute feature visibility.
- [ ] UnifiedDataContext conflict rule: prefer freshest `lastUpdate`; if equal, prefer controller-originated change.
- [ ] Connection banners per provider; disable UI tied to missing capability (`powerpoint`, `fileOperations`) instead of failing silently.

**Pass C: Rules & Test**
- [ ] Firestore rules rollout for tiered subcollections; emulator dry-run → staging deploy → simulated requests per tier → prod with canary; rollback command ready.

**Success Criteria**
- Backoff follows schedule; clear UX on failure/stop.
- No stale preview after mode/tier changes; deterministic authority selection.
- Rules block Show Control subcollections for rooms without features; Basic UI hides gated elements.
- Test suite passes (context unit tests, staleness check, queue merge, timestamp arbitration).
- `reorderRoom.mock.test.tsx` passes and is not skipped.

**Risks/Unknowns**
- Race: simultaneous reconnect + controller takeover.
- Rule deployment timing; ensure no window with mismatched client/rules.

---

## Milestone 2: Show Control Core (Live Cues + Dual Header)
**Goal:** End-to-end live cue visibility for Show Control tier with minimal bandwidth.

**Pass A: Protocol & Plumbing**
- [ ] Companion emits `LIVE_CUE_*` and `PRESENTATION_*` per `interface.md`; maintain in-memory `liveCues` with timestamps.
- [ ] Active cue write policy: controller primary writer of `activeLiveCueId`; Companion writes only when controller offline and includes `source=companion` + `updatedAt`. Conflict: pick newest `updatedAt`; tie-break to controller.
- [ ] Add `activeLiveCueId` to RoomState (reference only). Optional `liveCues` subcollection write-through for cloud viewers (tier-gated).
  - Cost note: each cue change = 1 write + N reads (viewers). For high-frequency shows (>1 cue/sec), batch or use reference-only mode with `activeLiveCueId`.
- [ ] Unified merge: merge Companion reference with Firebase; fall back to Firebase when Companion absent; never emit live cues in Basic tier.

**Pass B: UI & Latency Validation**
- [ ] Dual header (Main Timer + PiP) gated by tier + capability; tech viewer overlay; upgrade prompts on gated actions.
- [ ] Latency harness: manual stopwatch script to compare controller vs. local viewer vs. cloud viewer; record results in QA doc.

**Success Criteria**
- PiP within <150 ms local, <700 ms cloud; Basic never shows live cue UI; FEATURE_UNAVAILABLE shown when attempted from Minimal Companion.
- Conflict resolution deterministic; no flapping Companion/Firebase.

**Risks/Unknowns**
- Jitter when transports update near-simultaneously.
- Subcollection read cost; keep writes to reference + optional cue doc only.

---

## Milestone 3: Presentation Import & File Operations
**Goal:** Operators can ingest PPT metadata and open media via Companion safely.

**Pass A: Companion/Backend**
- [ ] Implement `/api/open`, `/api/file/exists`, `/api/file/metadata`; all require `Authorization: Bearer <token>`; return `FEATURE_UNAVAILABLE` when mode lacks capability.
- [ ] Path validation: normalize (`path.resolve`), ensure under allowed roots (user home or app support dir); reject if outside after resolving symlinks; reject UNC/remote paths; disallow traversal segments; bind HTTP to 127.0.0.1.
- [ ] Token lifecycle: TTL 30m; rotate on Companion restart; frontend refreshes token on 401 once, then surfaces reconnect modal.
- [ ] ffprobe bundle: use bundled LGPL-only ffprobe; if missing, return `{ warning: "FFPROBE_MISSING", metadata: { sizeBytes, mimeGuess } }` and continue (no crash on non-UTF8 filenames).
- [ ] PowerPoint detection: debounce 1.5s; only emit when PPT window foreground; if multiple instances, pick foreground and include `instanceId`; emit `PRESENTATION_CLEAR` when closed or background >10s.
  - instanceId: PowerPoint process PID or window handle for tracking multiple PPT instances.

**Pass B: Frontend Workflow**
- [ ] Notification "Presentation detected"; manual import; map videos to cues; handle duplicates by filename+slide; allow dismiss.
- [ ] Error UX: token expiry prompts, FEATURE_UNAVAILABLE copy for Minimal mode, safe failure on missing ffprobe.

**Success Criteria**
- File ops reject unsafe paths and network shares; no crashes on odd filenames.
- PPT detection only when active window; emits clear on close/idle.
- Metadata endpoint degrades gracefully without ffprobe; frontend handles warnings.

**Risks/Unknowns**
- PPT COM API variance across Windows builds.
- ffprobe licensing/packaging on macOS notarization.

---

## Milestone 4: UX Polish & Companion GUI
**Goal:** Production-ready operator and viewer experience within resource budgets.

**Pass A: Viewer/Controller Polish**
- [ ] Viewer typography scaling edge cases; wake-lock fallback banner with actionable copy.
- [ ] Minimal mode gating UX: when capability missing, show inline tooltip/banner "Feature unavailable in Minimal Mode — upgrade/restart Companion."
- [ ] Simple Mode skin: light controller variant for Basic tier; gated buttons hidden/disabled with upgrade badges.
- [ ] Messaging copy: clear banners for reconnects, authority conflicts, feature gating; avoid technical jargon.

**Pass B: Companion GUI & Resource Checks**
- [ ] Companion tray + minimal window for mode selection/status; reflects capabilities in `HANDSHAKE_ACK`.
- [ ] RAM measurements: Minimal with GUI <50 MB, Show Control ≤100 MB, Production ≤150 MB (3-sample average after 60s idle, macOS+Windows); if cross-platform measurement proves heavy, split into a follow-up pass focused solely on measurement/validation.
- [ ] Ensure GUI does not break headless flow; mode selection persists between launches.

**Success Criteria**
- RAM budgets met in all modes with GUI running.
- Minimal mode never shows show-control UI affordances without clear gating message.
- Viewer wake-lock banner appears only on failure/unsupported cases.

**Risks/Unknowns**
- Electron tray/window differences on Windows vs. macOS; watch for resource spikes.

---

## Cross-Milestone QA & Harness
- [ ] Multi-tab/controller/viewer: authority lock, takeover prompt, consistent state across tabs.
- [ ] Companion restart: auto-reconnect, no duplicate controller sessions.
- [ ] Mode switching mid-show: Cloud ↔ Local without timer jumps; validate `SYNC_ROOM_STATE`.
- [ ] Offline/Local: queue, replay, last-write-wins with command stack intact.
- [ ] Tier gating: Basic blocks show control; Show Control enables live cues; Production ready for future hooks.
- [ ] Live cue latency: record local vs. cloud viewer deltas; keep within targets.
- [ ] File ops safety: path rejection, token expiry, ffprobe missing warning path.
- [ ] Viewer during controller sync: verify Firebase fallback when `authority.status === 'syncing'`.

---

## Rollout & Backout Checklist
- [ ] Feature flags default off in prod until QA signoff.
- [ ] Firestore rules staged, tested, then prod with canary room; keep previous rules snapshot for rollback.
- [ ] Companion builds canaried with internal room; rollback by reverting to previous build + rules snapshot.
- [ ] Document migrations or toggles in release notes for operators (non-technical audience).

---

## Open Follow-Ups (Track & Resolve)
- PPT COM API variance test matrix (Windows builds).
- ffprobe packaging/notarization on macOS; confirm code signing impact.
- LAN exposure (non-loopback) remains deferred; do not open ports beyond 127.0.0.1 without new auth model.
