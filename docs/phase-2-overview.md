---
Type: Plan
Status: planned
Owner: KDB
Last updated: 2025-12-30
Scope: Phase 2 plan and roadmap (transport hardening, Electron controller, show control core).
---

# Phase 2 Overview (OnTime)

Phase 2 builds on the Phase 1D foundation to make OnTime "show-ready": stabilize Companion + parallel transport, deliver Show Control essentials (live cues, presentation import, dual-header UI), and add production-grade UX (viewer polish, authority/reconnect hardening). Success means Basic tier stays lean (<50 MB Companion in Minimal mode), Show Control gains live cue visibility with low bandwidth, and Production tier has groundwork for media workflows without breaking current users or increasing Firebase costs.

**Scope boundary:** Phase 2 focuses on Electron controller + bridge + transport hardening + show control core. LAN offline viewers are explicitly deferred to **Phase 3** (see below).

## Goals & Scope
- **Transport stability:** Harden Companion multi-client flows, reconnection/backoff, and authority handling across Local/Cloud.
- **Tier-correct UX:** End-to-end gating for Basic/Show Control/Production with clear upgrade prompts and capability-aware UI.
- **Show Control core:** Live cue pipeline (Companion → RoomState reference → UI dual-header) with minimal data footprint.
- **Presentation import:** Safe PPT detection + manual import workflow; Companion file ops endpoints hardened.
- **UX polish:** Viewer typography/wake-lock fixes, Minimal mode aesthetics, Companion GUI with mode selection.
- **Guardrails:** Local viewer latency <150 ms vs. controller; Cloud viewer <700 ms; Companion RAM budgets: Minimal <50 MB, Show Control ≤100 MB, Production ≤150 MB.

## Modular Product Principles (Phase 2)
- **Modular by tier:** Basic = timers only; Show Control adds cues/presentation; Production adds integrations.
- **Minimal coupling:** Timer core remains independent; advanced features use optional fields + capability flags.
- **Future modules:** Interfaces should support a dedicated Show Planner module later without rewriting timer logic.
- **Viewer variants:** Role-scoped viewers (display-only vs. tech overlays) must not impact Basic viewers.

## Scope Breakdown
- **Must-have**
  - Transport hardening (JOIN/HANDSHAKE/SYNC state machine, reconnect backoff, controller lock/takeover UX).
  - Tier gating and Firestore rules for subcollections; capability-aware UI disablement.
  - Live cue reference (`activeLiveCueId`) with conflict resolution and dual-header UI (Show Control+ only).
  - Presentation detection + file ops (`/api/open`, metadata, exists) with secure path validation and token auth.
  - Viewer/Minimal mode polish (typography, wake-lock fallback, gating copy).
- **Nice-to-have**
  - Companion GUI/tray for mode selection/status.
  - Auto mode detection refinements and capability surfacing in UI.
  - Upgrade badges/tooltips and Basic "Simple Mode" skin.
  - Standalone “PowerPoint Video Timer” utility (free/cheap acquisition tool).
- **Deferred (Phase 3+)**
  - External video monitoring integrations beyond stubs.
  - Multi-operator roles/permissions.
  - Smart slide-note parsing/auto cues.
  - LAN offline viewers (Companion-served viewer bundle + cert/pairing/trust).
  - Optional Viewer App for desktop LAN stations (Electron, viewer-only).
  - Optional native mobile viewers (iOS/Android) if demand warrants.
  - Performance/observability suite expansion.
  - Undo/redo command system and persistence.

## Phase 2 Plan (Detailed)

### Phase 2a — Electron Controller Delivery
- **Goals:** eliminate browser trust friction for operators; stabilize offline control UX.
- **Key work:**
  - Wrap existing controller UI in Electron (macOS + Windows).
  - Local persistence + crash-safe recovery (reuse Companion + local cache).
  - Mode selector (Cloud/Auto/Local) embedded in the controller UI.
  - Code signing + auto-update pipeline (reused for a future Viewer app).
- **Acceptance:**
  - Controller runs fully offline with Companion; no browser trust prompts.
  - Restart preserves state; no timer jumps.
  - Cloud viewer URLs continue to work when bridge is online.
- **Phase 3 readiness:**
  - Separate build target so a viewer-only Electron app can be added later.

### Phase 2b — Transport Hardening + Bridge Polish
- **Goals:** tighten JOIN/HANDSHAKE/SYNC lifecycle; eliminate reconnection races; clarify authority.
- **Key work:**
  - Reconnect/backoff state machine with user-visible status.
  - Controller lock + takeover UX (heartbeat + explicit confirmation).
  - Bridge model: local authoritative, cloud read-only for non-bridge controllers.
  - QR generation for cloud viewer URLs (web.app).
  - **Control handoff specifics:**
    - Hand Over (current controller selects target device) for fast device switching.
    - Request Control with non-blocking notification to active controller.
    - Force takeover available immediately with re-auth or room PIN.
    - Stale threshold (90s) only affects prompt tone; does not gate force takeover.
  - **Room in use guard:** when a different device is active, present “Start new room / Copy room / Request control” instead of encouraging takeovers.
- **Acceptance:**
  - Stable reconnects; no duplicate controllers.
  - Read-only state is explicit on remote controllers when local is authoritative.
  - Bridge reconnect triggers a fresh snapshot to cloud.
  - Force takeover requires re-auth or room PIN; audit record stored locally.
  - Operators can start a new room or copy an existing room without disrupting an active show.
- **Phase 3 readiness:**
  - Keep role scopes enforced server-side for controller-only actions.

### Phase 2c — Show Control Core
- **Goals:** deliver live cues + presentation workflows with tier gating.
- **Key work:**
  - Companion emits `LIVE_CUE_*`/`PRESENTATION_*`; controller writes `activeLiveCueId`.
  - Dual-header/tech overlay UI with tier/capability gating.
  - File operations hardened (`/api/open`, `/api/file/metadata`); add `/api/file/exists` if required by PPT workflows.
- **Acceptance:**
  - Live cues update within latency targets; Basic tier never sees show-control UI.
  - PowerPoint video elapsed/remaining time updates accurately during playback.
  - File ops are secure (path validation + token auth).
- **Phase 3 readiness:**
  - Viewer-role variants scaffolded (stage manager, lighting, sound) without breaking basic viewer.

## Show Control Architecture (Planned Summary)
This section summarizes the show-control architecture at a high level. Canonical schemas/events live in `docs/interface.md`.

- **Data model**: Room config in `rooms/{roomId}`; real-time timer state in `rooms/{roomId}/state/current`; show-control data in `rooms/{roomId}/liveCues/{cueId}`.
- **Companion role**: Companion detects PPT/video state and emits `LIVE_CUE_*` and `PRESENTATION_*` events to controller clients.
- **Controller role**: Controller consumes live-cue events, updates UI, and writes `activeLiveCueId` to Firestore for cloud viewers.
- **Viewer roles**: Default viewer shows main timer; tech viewer (Show Control tier) overlays live cue info.
**Latency targets** are defined in Goals & Scope (avoid duplicating here).

## Milestones (High-Level)
1. **Transport Hardening & Tier Gating**
   - State machine for JOIN/HANDSHAKE/SYNC/RECONNECT; reconnect backoff with user-visible retries.
   - Authority/cache invalidation on capability/tier changes; per-provider connection banners.
   - Firestore rules rollout for tiered subcollections; fix skipped `reorderRoom.mock.test.tsx`.
   - Success: Stable reconnect UX; gated data blocked by rules; no stale previews.

2. **Show Control Core (Live Cues + Dual Header)**
   - Companion emits `LIVE_CUE_*`/`PRESENTATION_*`; RoomState `activeLiveCueId`; conflict policy (controller wins ties).
   - Unified merge of Companion + Firebase; dual-header/tech overlay gated by tier/capabilities.
   - Success: PiP within <150 ms local, <700 ms cloud; Basic never shows live cue UI.

3. **Presentation Import & File Operations**
   - Secure `/api/open`, `/api/file/exists`, `/api/file/metadata` with token auth, path normalization, symlink/network path rejection.
   - PPT detection debounce/foreground guard; `PRESENTATION_CLEAR` on close/idle; ffprobe fallback warning path.
   - Success: Safe file ops, graceful metadata fallback, accurate PPT detect/clear behavior.

4. **UX Polish & Companion GUI**
   - Viewer typography/wake-lock fallback; Minimal mode gating copy; Basic Simple Mode skin.
   - Companion tray/window for mode selection/status reflecting capabilities; stays within RAM budgets.
   - Success: Resource targets met; clear gating/messaging without technical jargon.

## Phase 3 (Planned) — LAN Offline Viewers
- Companion-served static viewer bundle for LAN-only rooms (HTTPS/WSS + trusted cert).
- Pairing flow + viewer-only tokens; LAN allowlists + PNA/CORS headers as required.
- Optional Viewer App for desktop stations (Electron) to avoid browser trust prompts.
- Optional native mobile viewers (iOS/Android) if LAN demand warrants.
- Manual run-of-show (“Show Planner”): time slots, notes, attachments, cue timeline (Phase 3 scope).

## Cross-Cutting Risks & Mitigations
- **Authority races:** Simultaneous reconnect + takeover; mitigate with single pending handshake and explicit takeover prompts.
- **Rule rollout:** Mismatch between client and Firestore rules; mitigate with staging + canary + rollback snapshot.
- **Latency jitter:** Conflicts between Companion and Firebase updates; use `updatedAt` tie-breaker favoring controller.
- **File ops security:** Path traversal/symlink escape; enforce normalized roots and deny network paths; local-only bind.

## QA Focus Hooks
- Multi-tab/controller/viewer authority locking and takeover prompts.
- Companion restart and reconnect backoff adherence; no duplicate controllers.
- Mode switching Cloud ↔ Local mid-show without timer jumps (`SYNC_ROOM_STATE`).
- Offline/Local queue + last-write-wins behavior stays intact.
- Tier gating (Basic hides/blocks; Show Control enables live cues; Production ready hooks).
- Live cue latency measurements (local vs. cloud) within targets.
- File ops safety (path rejection, token expiry, ffprobe missing warning).

## Rollout Expectations
- Feature flags default off until QA signoff.
- Rules deployed via emulator → staging → prod with canary room; rollback ready.
- Companion builds canaried; rollback to previous build + rules snapshot if needed.
- Operator-facing release notes: highlight gating, reconnect behavior, and Minimal mode limits.
