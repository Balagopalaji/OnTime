---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2025-12-31
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
- **Tokens:** TTL 4 hours; frontend refreshes on 401 by refetching token; Companion rotates token on restart.
- **Protocol versioning:** Client includes interface version in JOIN/handshake; if major mismatch, show warning banner and suggest update; if incompatible, fallback to Cloud with clear message.

## Error UX Matrix (Phase 2)
| Error Code | User Message | Auto-Retry | CTA |
| --- | --- | --- | --- |
| CONTROLLER_TAKEN | "This room is controlled elsewhere." | No | Request Control |
| PERMISSION_DENIED | "You don't have access to control this room." | No | Contact owner |
| INVALID_TOKEN | "Session expired. Reconnecting..." | Once | Retry if refresh fails |
| FEATURE_UNAVAILABLE | "Feature unavailable in this Companion mode." | No | Learn more |

## Deferred to Phase 4 (Not in Phase 2 scope)
- Undo/redo command system and persistence (see `docs/phase-2-overview.md`).

## Builder Pass Guidance
- Keep each pass focused (single concern); run lint/tests relevant to touched surfaces.
- Respect feature flags: default off until QA signoff; prefer canary room for risky changes.
- After each pass, document acceptance checks (RAM/latency/backoff) and note any deviations.
- Stop-if-breakage: if a pass causes parallel sync regressions (timer drift, queue replay, authority flapping), stop and report before continuing.
- Rollback scope: if a pass fails, revert only that pass before proceeding.
- Split work by surface: list Companion tasks separately from Frontend tasks to reduce cross-surface regressions.

---

## Milestone 0: Electron Controller Wrapper (Phase 2a)
**Goal:** Controller runs in Electron with stable offline mode; browser is optional.

**STATUS (2026-01-01):** ✅ Complete

**Scope Exclusions (Milestone 0)**  
- No transport hardening or lock/takeover (Milestone 1).  
- No show-control UI (Milestone 2).  

**Pass A: Electron Shell**
**Companion**
- [x] No Companion changes required.
**Frontend/Electron**
- [x] Use `electron-builder` (target Electron 28+ for ESM support); load frontend build output.
- [x] IPC bridge: renderer owns Companion connectivity (existing architecture); main process exposes platform APIs via `contextBridge` (session state, deep links, crash recovery).
- [x] Embed mode selector + connection indicator in Electron header.
- [x] Ensure local persistence for room cache and settings (survive restarts).
- [x] Deep link handler: register `ontime://room/:roomId` to open a room in the controller. Note: protocol registration only works in packaged builds on Windows; dev-mode deep links require manual testing via command line args.
- [x] Crash recovery: on relaunch, restore last room session from cache and show "Recovered session" banner.
- [x] Stable origin for Electron controller so auth persists across restarts (ports 5174–5176; fallback to random only if occupied).
- [ ] Separate build target so a viewer-only Electron app can be added later.
- [x] Acceptance: Controller launches, connects to Companion, and runs without a browser.

**Manual Verification (Pass A)**
- [x] Launch Electron controller offline; verify room cache loads and UI is usable.
- [x] Connect Companion and confirm the app auto-detects and switches to Local when available.
- [x] Quit/relaunch and confirm settings persist.
- [ ] Force-quit and relaunch; confirm "Recovered session" banner appears and state is restored.
- [x] Restart preserves room state; no timer jumps after relaunch.
- [x] Cloud viewer URLs still work while bridge is online.
- [x] Auth session persists across restarts in Electron (no forced re-login offline).
- [ ] No browser trust prompts when running the Electron controller.

**Pass B: Build & Sign**
**Companion**
- [x] No Companion changes required.
**Frontend/Electron**
- [x] Code signing for macOS + Windows (notarization on macOS).
- [x] Auto-update pipeline (electron-updater or equivalent).
- [ ] Test update from canary channel before production release.
- [x] Acceptance: Builds install and update cleanly on macOS + Windows.

**Manual Verification (Pass B)**
- [ ] Install an older build and confirm auto-update to latest.
- [ ] Confirm notarization passes on macOS and no SmartScreen warnings on Windows.

**Definition of Done (Milestone 0)**
- [x] Electron controller runs without browser, persists local cache, and updates cleanly.

---

## Milestone 1: Transport Hardening & Tier Gating
**Goal:** Reliable Local/Cloud transport with correct gating and clean reconnection UX.

**Scope Exclusions (Milestone 1)**  
- No scheduled cues, cue timelines, or Show Planner features.  
- No file operations or presentation status features (Milestone 2/3 only).  

**Pass A: Reconnect State Machine**
**Companion**
- [x] Enforce single pending handshake; reject overlapping JOIN/HANDSHAKE from same clientId.
**Frontend**
- [x] Document and implement JOIN → HANDSHAKE → SYNC → STEADY → RECONNECT flow; only one pending handshake at a time.
- [x] Apply backoff schedule; banner after 5 failed attempts; hard-stop after 20 with "Retry" CTA; log last error code.
- [x] Acceptance: Backoff follows schedule; clear UX on failure/stop; no duplicate sockets after reconnect.
- [ ] Protocol versioning: on major mismatch, show warning and suggest update; on incompatible, fallback to Cloud.
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (socket handlers, JOIN/HANDSHAKE)
- Frontend: `frontend/src/context/CompanionConnectionContext.tsx`
**Test Expectations**
- [x] Unit: backoff timing logic
- [x] Integration: reconnect flow with mocked socket

**Manual Verification (Pass A)**
- [x] Simulate Companion stop/start; controller shows reconnect banner and recovers without duplicate sockets.
- [x] Confirm backoff timings match spec (2s → 10s → cap 60s) and stop after 20 attempts.
- [x] Verify "Retry" CTA works and clears the stopped state.
- [x] Confirm auto-reconnect resumes within ~2s of Companion availability (token probe).

**Pass B: Controller Lock & Takeover**
**Companion**
- [x] Implement controller lock + heartbeat; mark authoritative controller; reject non-authoritative writes at socket layer.
- [x] Non-authoritative controllers receive `PERMISSION_DENIED` on write attempts.
**Companion Socket Events**
- [x] `HEARTBEAT` (client → server, every 30s)
- [x] `CONTROLLER_LOCK_STATE` (server → all clients on change)
- [x] `REQUEST_CONTROL` (client → server)
- [x] `CONTROL_REQUEST_RECEIVED` (server → current controller)
- [x] `FORCE_TAKEOVER` (client → server, requires PIN or timeout)
**Frontend**
- [x] Request control flow with non-blocking notification, countdown, and force takeover rules.
- [x] Handoff flow (current controller selects target device) + reclaim flow.
- [x] Type scaffolding: add `ControllerLock` to `frontend/src/types/index.ts`.
- [x] Acceptance: Only one controller can write; takeover requires explicit action; no silent auto-takeover.
**Reference**
- [x] See `docs/phase-2-overview.md` Phase 2b Flow Diagrams for state models.
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (lock store, heartbeat, permission checks)
- Frontend: `frontend/src/context/UnifiedDataContext.tsx` (authority/lock integration), `frontend/src/routes/*` (UX)
**Test Expectations**
- Unit: lock state transitions
- Integration: two controllers, one authoritative

**Manual Verification (Pass B)**
- [x] Open two controllers; only one can start/stop/nudge timers, other is read-only.
- [x] Request control shows attention banner; "Hand Over" transfers immediately; "Force Takeover" follows PIN/timeout rules.
- [x] Reclaim control works and logs the takeover event.

**Pass B.2: Control Handoff UX + PIN (Phase 2b polish)**
**Companion**
- [x] Validate room PIN for immediate force takeover; keep timeout fallback with confirmation.
- [x] Log takeover attempts in Companion cache (audit trail).
- [x] Include lock state metadata (device/user identity, last heartbeat, active controller id).
- [x] Emit request denial to requester ("Denied by controller") with reason.
**Frontend**
- [x] PIN display (authoritative only): show PIN with hide toggle (default visible), copy button, and "Not set" link.
- [x] Room PIN set flow (owner-only) with local validation and persistence.
- [x] Room-in-use guard: only show when active controller heartbeat <90s; otherwise show "Room appears inactive" messaging.
- [x] Room-in-use guard offers Start new / Copy room / Request control / View only actions.
- [x] Request control UX: waiting state with countdown, immediate "Force Takeover Now" with PIN or re-auth, timeout confirmation with no PIN.
- [x] Attention banner styling: red/amber pulse + optional chime (default on, setting to disable).
- [x] Handoff flow: select target device; confirm copy varies for same user vs. different user.
- [x] Post-takeover notice for displaced controller with "Reclaim Control" action.
- [x] Viewer-only mode toggle (optional) to hide takeover controls for observers.
- [x] Viewer share links + QR always target the cloud web app (`https://<web-app>/view/:roomId`).
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (PIN validation, audit, deny event)
- Frontend: `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/routes/ControllerPage.tsx`, `frontend/src/routes/DashboardPage.tsx`
**Test Expectations**
- Unit: PIN validation, denial flow, lock state metadata
- Integration: request/deny/force path including timeout fallback

**Manual Verification (Pass B.2)**
- [x] Force takeover works immediately with PIN; timeout path works with confirmation.
- [x] Deny returns requester message and clears pending state.
- [x] Room-in-use guard respects stale heartbeat and shows inactive copy.
- [x] Post-takeover notice shows reclaim flow and works.

**Pass C: Authority & Caching**
**Companion**
- [x] Emit capability changes reliably in `HANDSHAKE_ACK`; ensure capability/tier changes are observable by clients.
**Frontend/Bridge**
- [x] Local authoritative, cloud read-only for non-bridge controllers.
**Frontend**
- [x] On `HANDSHAKE_ACK` capability change or tier change, drop cached preview, refetch room config/state, recompute feature visibility.
- [x] Bridge reconnect triggers a fresh snapshot to cloud (`SYNC_ROOM_STATE`).
- [x] Authority confidence window expands to 4s on reconnect churn (per `docs/local-mode.md` §3.3).
- [x] Viewer sync guard: while authority status is `syncing`, viewers fall back to Firebase until ready.
- [x] UnifiedDataContext conflict rule: prefer freshest `lastUpdate`; if equal, prefer controller-originated change.
- [ ] Connection banners per provider; disable UI tied to missing capability (`powerpoint`, `fileOperations`) instead of failing silently.
  - Capability gating currently surfaces via banners; UI disablement will be added alongside feature UI.
- [x] Cross-tab sync: verify mode changes, takeover banners, and token refresh propagate via BroadcastChannel or localStorage events.
- [ ] Acceptance: No stale preview after mode/tier changes; deterministic authority selection.
**Codebase Entry Points**
- Frontend: `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/context/CompanionConnectionContext.tsx`
**Test Expectations**
- Unit: authority selection with equal timestamps
- Integration: capability change refresh

**Manual Verification (Pass C)**
- [ ] Toggle tier/capability and confirm UI updates without stale data.
- [ ] Induce equal timestamps and confirm controller-originated change wins.
- [ ] Missing capability shows a visible gating message, not silent failure.

**Pass D: Rules & Tests**
**Companion**
- [x] No Companion changes required unless lock state also persists in cloud (future).
**Frontend/Cloud**
- [ ] Firestore rules rollout for tiered subcollections; emulator dry-run → staging deploy → simulated requests per tier → prod with canary; rollback command ready. (blocked: no emulator/staging access)
- [x] Ensure `reorderRoom.mock.test.tsx` passes and is not skipped.
- [ ] Acceptance: Rules block Show Control subcollections for rooms without features; Basic UI hides gated elements; test suite passes. (blocked: manual rules verification not run)
- Note: Role-based cue ownership and crew chat permissions are Phase 3; `liveCues` remain controller-auth write and auth-only read in Phase 2.
**Codebase Entry Points**
- Firebase rules: `firebase/firestore.rules`
- Frontend tests: `frontend/src/__tests__`
**Test Expectations**
- Full: `npm run test` + `npm run lint`

**Manual Verification (Pass D)**
- [ ] With Basic tier room, verify Show Control subcollections are denied. (blocked: no emulator/staging access)
- [ ] With Show Control tier room, verify access granted as expected. (blocked: no emulator/staging access)
- [x] Run tests and confirm no skips on reorderRoom.mock.test.tsx.
- [ ] Release notes cover gating changes, reconnect behavior, and Minimal mode limits. (blocked: no release notes file)

**Risks/Unknowns**
- Race: simultaneous reconnect + controller takeover.
- Rule deployment timing; ensure no window with mismatched client/rules.

**Definition of Done (Milestone 1)**
- [ ] All passes complete, QA harness green, no regressions in timer sync.

---

## Milestone 2: Show Control Core (Presentation Status + Dual Header)
**Goal:** Presentation status visibility for Show Control tier with minimal bandwidth (no scheduled cue system in Phase 2).

**Scope Exclusions (Milestone 2)**  
- No scheduled cues, cue timelines, or manual cue acknowledgment (Phase 3 only).  
- No file operations or media import workflows (Milestone 3 only).  

**Pass A: Protocol & Plumbing**
**Companion**
- [x] Emit `LIVE_CUE_*` and `PRESENTATION_*` per `interface.md`; maintain in-memory `liveCues` with timestamps.
**Frontend/Cloud**
- [x] Active cue write policy: controller primary writer of `activeLiveCueId`; Companion writes only when controller offline and includes `writeSource=companion` + `updatedAt`. Conflict: pick newest `updatedAt`; tie-break to controller.
- [x] Write-through policy: controller writes `liveCues` to Firestore; Companion only writes when controller heartbeat is stale for 5s, then yields immediately on controller reconnect.
  - Write metadata uses `updatedAt` + `writeSource: 'companion' | 'controller'` (distinct from cue `source`).
- [x] Skip `liveCues` write-through when cue rate exceeds 1/sec; fall back to `activeLiveCueId` only.
- [x] Add `activeLiveCueId` to RoomState (reference only). Optional `liveCues` subcollection write-through for cloud viewers (tier-gated).
  - Cost note: each cue change = 1 write + N reads (viewers). For high-frequency shows (>1 cue/sec), batch or use reference-only mode with `activeLiveCueId`.
- [x] Unified merge: merge Companion reference with Firebase; fall back to Firebase when Companion absent; never emit live cues in Basic tier.
- [x] Phase 2 explicitly excludes scheduled cues, cue timelines, and manual cue acknowledgment (Phase 3).
**Type Scaffolding**
- [x] Extend `RoomState` with `activeLiveCueId: string | null`.
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (LIVE_CUE/PRESENTATION)
- Frontend: `frontend/src/context/UnifiedDataContext.tsx`
**Test Expectations**
- Integration: liveCues flow from Companion to local viewer

**Manual Verification (Pass A)**
- [ ] With Companion running, verify live cue updates reach local viewer quickly. (blocked: no live-cue UI yet)
- [ ] With Companion stopped, verify Firebase fallback works without flapping. (blocked: no live-cue UI yet)
- [ ] Basic tier room does not show live cues or show-control UI. (blocked: no live-cue UI yet)

**Pass B: UI & Latency Validation**
**Companion**
- [x] No Companion UI changes required (uses existing events/capabilities).
**Frontend**
- [x] Dual header (Main Timer + PiP) gated by tier + capability; tech viewer status panel; upgrade prompts on gated actions.
- [x] Latency harness: manual stopwatch script to compare controller vs. local viewer vs. cloud viewer; record results in QA doc.
**Codebase Entry Points**
- Frontend: `frontend/src/routes/ControllerPage.tsx`, `frontend/src/routes/ViewerPage.tsx`, `frontend/src/components/*`
**Test Expectations**
- Manual: stopwatch harness (record results)

**Manual stopwatch harness (record in QA doc)**
- Open the controller, a local viewer (Companion), and a cloud viewer on separate devices/screens.
- Start/pause a timer and use a physical stopwatch to measure controller vs viewer deltas.
- Capture at least 5 samples per viewer path; note average + max.
- Target: local <150ms, cloud <700ms.

**Manual Verification (Pass B)**
- [x] Confirm PiP/status panel only appears for Show Control tier rooms.
- [x] Record local vs. cloud latency deltas and confirm they meet targets. (Qualitative: appears within targets)
- [x] Verify gated actions show upgrade prompt copy.

**Success Criteria**
- PiP within <150 ms local, <700 ms cloud; Basic never shows show-control UI; FEATURE_UNAVAILABLE shown when attempted from Minimal Companion.
- Conflict resolution deterministic; no flapping Companion/Firebase.

**Risks/Unknowns**
- Jitter when transports update near-simultaneously.
- Subcollection read cost; keep writes to reference + optional cue doc only.

**Definition of Done (Milestone 2)**
- [ ] Presentation status works for Show Control tier; Basic remains clean; latency targets met. (blocked: Companion show-control capability not available in Minimal mode)

---

## Milestone 3: Presentation Import & File Operations
**Goal:** Operators can ingest PPT metadata and open media via Companion safely.

**Scope Exclusions (Milestone 3)**  
- No scheduled cues or Show Planner authoring (Phase 3).  

**Pass A-Win: PPT Detection + File Ops (Windows)**
**Companion**
- [x] Implement `/api/open`, `/api/file/exists`, `/api/file/metadata`; all require `Authorization: Bearer <token>`; return `FEATURE_UNAVAILABLE` when mode lacks capability.
- [x] Path validation: normalize (`path.resolve`), ensure under allowed roots (user home or app support dir); reject if outside after resolving symlinks; reject UNC/remote paths; disallow traversal segments; bind HTTP to 127.0.0.1.
- [x] Token lifecycle: TTL 30m; rotate on Companion restart; frontend refreshes token on 401 once, then surfaces reconnect modal.
- [x] ffprobe bundle: use bundled LGPL-only ffprobe; if missing, return `{ warning: "FFPROBE_MISSING", metadata: { sizeBytes, mimeGuess } }` and continue (no crash on non-UTF8 filenames).
- [x] PowerPoint detection: debounce 1.5s; only emit when PPT window foreground; if multiple instances, pick foreground and include `instanceId`; emit `PRESENTATION_CLEAR` when closed or background >10s.
  - instanceId: PowerPoint process PID or window handle for tracking multiple PPT instances.
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (HTTP + PPT detection)
**Test Expectations**
- Manual: `/api/file/exists` + `/api/open` safety checks

**Pass A-Mac: PPT Slide Tracking (macOS)**
**Companion**
- [x] Implement slide-only tracking via AppleScript; no video timing; emit `PRESENTATION_*` with slide counts only.
- [x] Emit "video timing unavailable on macOS" marker for UI.
**Codebase Entry Points**
- Companion: `companion/src/main.ts` (macOS PPT hooks)
**Test Expectations**
- Manual: slide number updates in UI

**Manual Verification (Pass A)**
- [ ] Attempt `/api/open` with a path outside allowed roots; verify rejection. (blocked: Windows validation pending)
- [ ] Force token expiry and confirm refresh path works once, then shows reconnect prompt. (blocked: Windows validation pending)
- [ ] Rename a file with non-UTF8 characters and ensure metadata endpoint doesn’t crash. (blocked: Windows validation pending)
- [ ] Windows PPT test: run Companion in `show_control`/`production`, open PowerPoint in foreground, confirm `PRESENTATION_LOADED/UPDATE`, then background/close it and confirm `PRESENTATION_CLEAR` after 10s idle. (blocked: Windows validation pending)

**Pass B: Frontend Workflow**
**Frontend**
- [ ] Notification "Presentation detected"; manual import; map videos to cues; handle duplicates by filename+slide; allow dismiss.
- [ ] Error UX: token expiry prompts, FEATURE_UNAVAILABLE copy for Minimal mode, safe failure on missing ffprobe.
**Codebase Entry Points**
- Frontend: `frontend/src/components/*`, `frontend/src/context/UnifiedDataContext.tsx`
**Test Expectations**
- Manual: detection banner + error prompts

**Manual Verification (Pass B)**
- [ ] Presentation detected banner appears and can be dismissed.
- [ ] Missing ffprobe yields warning but no crash; UI still renders.
- [ ] Minimal mode shows FEATURE_UNAVAILABLE messaging.

**Success Criteria**
- File ops reject unsafe paths and network shares; no crashes on odd filenames.
- PPT detection only when active window; emits clear on close/idle.
- Metadata endpoint degrades gracefully without ffprobe; frontend handles warnings.

**Risks/Unknowns**
- PPT COM API variance across Windows builds.
- ffprobe licensing/packaging on macOS notarization.

**Definition of Done (Milestone 3)**
- [ ] File ops are safe, PPT detection stable, and UI handles warnings gracefully.

---

## Milestone 4: UX Polish & Companion GUI
**Goal:** Production-ready operator and viewer experience within resource budgets.

**Scope Exclusions (Milestone 4)**  
- No new transport features; polish only.  

**Pass A: Viewer/Controller Polish**
**Frontend**
- [ ] Viewer typography scaling edge cases; wake-lock fallback banner with actionable copy.
- [ ] Minimal mode gating UX: when capability missing, show inline tooltip/banner "Feature unavailable in Minimal Mode — upgrade/restart Companion."
- [ ] Simple Mode skin: light controller variant for Basic tier; gated buttons hidden/disabled with upgrade badges.
- [ ] Messaging copy: clear banners for reconnects, authority conflicts, feature gating; avoid technical jargon.
**Codebase Entry Points**
- Frontend: `frontend/src/routes/*`, `frontend/src/components/*`, `frontend/src/index.css`
**Test Expectations**
- Manual: multi-device layout check

**Manual Verification (Pass A)**
- [ ] View on phone and desktop; confirm no layout clipping.
- [ ] Trigger wake-lock failure; banner appears and is actionable.
- [ ] Basic tier hides gated controls and shows upgrade badge text.

**Pass B: Companion GUI & Resource Checks**
**Companion**
- [ ] Companion tray + minimal window for mode selection/status; reflects capabilities in `HANDSHAKE_ACK`.
- [ ] RAM measurements: Minimal with GUI <50 MB, Show Control ≤100 MB, Production ≤150 MB (3-sample average after 60s idle, macOS+Windows); if cross-platform measurement proves heavy, split into a follow-up pass focused solely on measurement/validation.
- [ ] Ensure GUI does not break headless flow; mode selection persists between launches.
**Codebase Entry Points**
- Companion: `companion/src/main.ts`
**Test Expectations**
- Manual: RAM sampling + persistence check

**Manual Verification (Pass B)**
- [ ] Switch modes and confirm GUI reflects new capabilities and persists after restart.
- [ ] Measure RAM at 60s idle and record averages for each mode.
- [ ] Confirm headless flow works with GUI disabled.

**Success Criteria**
- RAM budgets met in all modes with GUI running.
- Minimal mode never shows show-control UI affordances without clear gating message.
- Viewer wake-lock banner appears only on failure/unsupported cases.

**Risks/Unknowns**
- Electron tray/window differences on Windows vs. macOS; watch for resource spikes.

**Definition of Done (Milestone 4)**
- [ ] UI polish complete; RAM budgets met with GUI enabled; gating copy is clear.

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
- [ ] Cross-tab sync: verify mode changes, takeover banners, and token refresh propagate across tabs.
- [ ] Error UX matrix: validate user messaging and CTA for CONTROLLER_TAKEN, PERMISSION_DENIED, INVALID_TOKEN.

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
- Electron auth UX: consider skipping `prompt=select_account` in Electron to avoid repeated account picker.
