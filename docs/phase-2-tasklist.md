# Phase 2 Task List (Builder-Focused)

This file translates the Phase 2 plan into granular, implementable steps for builder agents. It assumes Phase 1D is complete and uses the existing unified data provider architecture. Same codebase for all tiers; features are gated via flags/rules, not forks.

## Guardrails & Targets
- **Latency (viewers):** Local viewer (Companion) <150 ms delta from controller; Cloud viewer <700 ms. Measure via stopwatch harness (see QA hooks).
- **Reconnect backoff (Companion clients):** Attempt 1 immediate; attempts 2–5 at 2s; 6+ at 10s; cap at 60s; stop after 20 attempts and surface retry CTA.
- **Authority cache TTL:** Dashboard preview cache keyed by `roomId:companionMode`; TTL 10s or on `HANDSHAKE_ACK` capability change, whichever is sooner.
- **Companion RAM budgets (steady state after 60s idle, average of 3 samples):** Minimal <50 MB, Show Control ≤100 MB, Production ≤150 MB.
- **Feature gating:** Legacy rooms without `features` default to deny Show Control/Production data paths; UI must hide gated features and emit upgrade prompts.
- **File ops security:** Normalize path, require path within user home or OS app data; reject symlinks pointing outside allowed roots; reject UNC/network paths; bind HTTP to 127.0.0.1; token auth required.
- **Tokens:** TTL 30 minutes; frontend refreshes on 401 by refetching token; Companion rotates token on restart.
- **Undo/redo storage:** localStorage key `undo:{uid}:{roomId}`; cap 500 commands or 2 MB per room; on quota errors drop oldest and surface non-blocking warning.

---

## Milestone 1: Transport Hardening & Tier Gating
**Goal:** Reliable Hybrid/Local transport with correct gating and clean reconnection UX.

**Tasks**
- [ ] **State machine:** Document JOIN → HANDSHAKE → SYNC → STEADY → RECONNECT flow; reject overlapping JOIN/HANDSHAKE; only one pending handshake at a time.
- [ ] **Reconnect/backoff:** Implement backoff schedule above; show banner after 5 failed attempts; hard-stop after 20 with "Retry" CTA; log last error code.
- [ ] **Controller lock & takeover:** If `CONTROLLER_TAKEN`, prompt user; takeover sets `takeOver=true`; on success broadcast takeover notice; reject silent auto-takeover.
- [ ] **Authority/cache invalidation:** On `HANDSHAKE_ACK` capability change or tier change, drop cached preview, refetch room config/state, and recompute feature visibility.
- [ ] **UnifiedDataContext authority rules:** When Firebase and Companion conflict, prefer provider with freshest `lastUpdate`; if equal, prefer controller-originated change.
- [ ] **Connection banners:** Frontend surfaces per-provider status; disable UI tied to missing capability (`powerpoint`, `fileOperations`) instead of failing silently.
- [ ] **Firestore rules rollout:** Update rules for tiered subcollections; dry-run in emulator; staging deploy; run simulated requests per tier; prod deploy with canary room; have rollback command ready.
- [ ] **Skipped test fix:** `frontend/src/__tests__/reorderRoom.mock.test.tsx` — fix MockDataContext side effects (ensure teardown closes sockets/timers).

**Success Criteria**
- Reconnect attempts follow schedule and present clear UX on failure.
- No stale preview after mode/tier changes; authority handoff doesn’t serve outdated state.
- Firestore rules block Show Control subcollections for rooms without features; Basic tier UI hides gated elements.
- Test suite passes without hanging (reorderRoom test enabled).

**Risks/Unknowns**
- Race: simultaneous reconnect + controller takeover.
- Firestore rule deployment timing; ensure no window with mismatched client/rules.

---

## Milestone 2: Show Control Core (Live Cues + Dual Header)
**Goal:** End-to-end live cue visibility for Show Control tier with minimal bandwidth.

**Tasks**
- [ ] **Companion events:** Emit `LIVE_CUE_*` and `PRESENTATION_*` per `websocket-protocol.md`; maintain in-memory `liveCues` with timestamps.
- [ ] **Active cue write policy:** Controller is primary writer of `activeLiveCueId`; Companion may write only when controller is offline and includes `source=companion` + `updatedAt`. Conflict: pick newest `updatedAt`; tie-break to controller.
- [ ] **RoomState field:** Add `activeLiveCueId` (reference only). Optional `liveCues` subcollection write-through for cloud viewers (tier-gated).
- [ ] **Unified merge:** Merge Companion live cue reference with Firebase; fall back to Firebase when Companion absent; never emit live cues in Basic tier.
- [ ] **UI:** Dual header (Main Timer + PiP) gated by tier + capability; tech viewer overlay; add upgrade prompts on gated actions.
- [ ] **Latency harness:** Add manual stopwatch script to compare controller vs. local viewer vs. cloud viewer; record results in QA doc.

**Success Criteria**
- Show Control room displays PiP within 150 ms on local viewer, <700 ms on cloud viewer.
- Basic tier never shows live cue UI; FEATURE_UNAVAILABLE shown when attempted from Minimal Companion.
- Conflict resolution picks deterministic writer; no flapping between Companion/Firebase.

**Risks/Unknowns**
- Jitter when both transports update near-simultaneously.
- Subcollection read cost if overused; keep writes to reference + optional cue doc only.

---

## Milestone 3: Presentation Import & File Operations
**Goal:** Operators can ingest PPT metadata and open media via Companion safely.

**Tasks**
- [ ] **HTTP endpoints:** Implement `/api/open`, `/api/file/exists`, `/api/file/metadata`; all require `Authorization: Bearer <token>`; return `FEATURE_UNAVAILABLE` when mode lacks capability.
- [ ] **Path validation:** Normalize (`path.resolve`), ensure under allowed roots (user home or app support dir); reject if outside root after resolving symlinks; reject UNC/remote paths; disallow traversal segments.
- [ ] **Symlinks:** Allow only if target stays within allowed roots; otherwise 403 with `code: "INVALID_PATH"`.
- [ ] **Token lifecycle:** TTL 30m; rotate on Companion restart; frontend refreshes token on 401 once, then surfaces reconnect modal.
- [ ] **ffprobe bundle:** Use bundled LGPL-only ffprobe; if missing, return `{ warning: "FFPROBE_MISSING", metadata: { sizeBytes, mimeGuess } }` and continue (no crash on non-UTF8 filenames).
- [ ] **PowerPoint detection:** Debounce 1.5s; only emit when PPT window is foreground; if multiple instances, pick foreground and include `instanceId`; emit `PRESENTATION_CLEAR` when closed or background for >10s.
- [ ] **Frontend workflow:** Notification "Presentation detected"; manual import; map videos to cues; handle duplicates by filename+slide; allow dismiss.

**Success Criteria**
- File ops reject unsafe paths and network shares; no crashes on odd filenames.
- PPT detection only when active window; emits clear when closed/idle.
- Metadata endpoint degrades gracefully without ffprobe.

**Risks/Unknowns**
- PPT COM API variance across Windows builds.
- ffprobe licensing/packaging on macOS notarization.

---

## Milestone 4: Undo/Redo Command System
**Goal:** Restore undo/redo with stable API and persistence.

**Tasks**
- [ ] **Command interface:** Implement command types for timer CRUD, message, reorder, room delete; include `execute`, `undo`, optional optimistic hooks.
- [ ] **Storage policy:** Per-room stacks; key `undo:{uid}:{roomId}`; cap 500 commands or 2 MB; on quota error, drop oldest until write succeeds and show warning banner.
- [ ] **Integration:** Replace stubs in FirebaseDataContext/MockDataContext; keep public API (`undoLatest`, `redoLatest`, `undoRoomDelete`, `canUndo`, `canRedo`).
- [ ] **Hybrid safety:** Ensure command replay idempotent across Firebase + Companion; do not double-apply on reconnect.
- [ ] **Tests:** Unit tests per command; integration test for sequence with disconnect/reconnect; regression for offline queue replay + undo.

**Success Criteria**
- Undo/redo works across tabs for same room without cross-room leakage.
- Quota handling degrades gracefully; no uncaught errors.
- UI buttons reflect availability accurately after reconnect.

**Risks/Unknowns**
- Storage limits on Safari/iOS; consider noop persistence when unsupported.

---

## Milestone 5: UX Polish & Companion GUI
**Goal:** Production-ready operator and viewer experience within resource budgets.

**Tasks**
- [ ] **Viewer polish:** Fix typography scaling edge cases; wake-lock fallback banner with actionable copy; ensure minimal mode aesthetics cleaned up.
- [ ] **Minimal mode gating UX:** When capability missing, show inline tooltip/banner "Feature unavailable in Minimal Mode — upgrade/restart Companion."
- [ ] **Simple Mode skin:** Light controller variant for Basic tier; ensure gated buttons are hidden/disabled with upgrade badges.
- [ ] **Companion GUI:** Tray + minimal window for mode selection/status; reflects capabilities in `HANDSHAKE_ACK`; idle RAM <50 MB in Minimal mode with GUI.
- [ ] **Messaging copy:** Clear banners for reconnects, authority conflicts, feature gating; avoid technical jargon.

**Success Criteria**
- RAM budgets met in all modes with GUI running.
- Minimal mode never shows show-control UI affordances without clear gating message.
- Viewer wake-lock banner appears only on failure/unsupported cases.

**Risks/Unknowns**
- Electron tray/window differences on Windows vs. macOS; watch for resource spikes.

---

## Cross-Milestone QA & Harness
- [ ] **Multi-tab/controller/viewer:** Authority lock, takeover prompt, consistent state across tabs.
- [ ] **Companion restart:** Auto-reconnect, no duplicate controller sessions.
- [ ] **Mode switching mid-show:** Cloud ↔ Hybrid/Local without timer jumps; validate `SYNC_ROOM_STATE`.
- [ ] **Offline/Hybrid:** Queue, replay, last-write-wins with command stack intact.
- [ ] **Tier gating:** Basic blocks show control; Show Control enables live cues; Production ready for future hooks.
- [ ] **Live cue latency:** Record local vs. cloud viewer deltas; keep within targets.
- [ ] **File ops safety:** Path rejection, token expiry, ffprobe missing warning path.
- [ ] **Undo/redo:** Command persistence across reload; overflow handling.

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