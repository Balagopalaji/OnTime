# Phase 2 Overview (OnTime)

Phase 2 builds on the Phase 1D foundation to make OnTime "show-ready": stabilize Companion + hybrid transport, deliver Show Control essentials (live cues, presentation import, dual-header UI), and add production-grade UX (undo/redo, viewer polish, authority/reconnect hardening). Success means Basic tier stays lean (<50 MB Companion in Minimal mode), Show Control gains live cue visibility with low bandwidth, and Production tier has groundwork for media workflows without breaking current users or increasing Firebase costs.

## Goals & Scope
- **Transport stability:** Harden Companion multi-client flows, reconnection/backoff, and authority handling across Hybrid/Local.
- **Tier-correct UX:** End-to-end gating for Basic/Show Control/Production with clear upgrade prompts and capability-aware UI.
- **Show Control core:** Live cue pipeline (Companion → RoomState reference → UI dual-header) with minimal data footprint.
- **Presentation import:** Safe PPT detection + manual import workflow; Companion file ops endpoints hardened.
- **Undo/redo return:** Command-pattern undo/redo with persistence and hybrid safety.
- **UX polish:** Viewer typography/wake-lock fixes, Minimal mode aesthetics, Companion GUI with mode selection.
- **Guardrails:** Local viewer latency <150 ms vs. controller; Cloud viewer <700 ms; Companion RAM budgets: Minimal <50 MB, Show Control ≤100 MB, Production ≤150 MB.

## Scope Breakdown
- **Must-have**
  - Transport hardening (JOIN/HANDSHAKE/SYNC state machine, reconnect backoff, controller lock/takeover UX).
  - Tier gating and Firestore rules for subcollections; capability-aware UI disablement.
  - Live cue reference (`activeLiveCueId`) with conflict resolution and dual-header UI (Show Control+ only).
  - Presentation detection + file ops (`/api/open`, metadata, exists) with secure path validation and token auth.
  - Undo/redo command system with per-room storage and quota handling.
  - Viewer/Minimal mode polish (typography, wake-lock fallback, gating copy).
- **Nice-to-have**
  - Companion GUI/tray for mode selection/status.
  - Auto mode detection refinements and capability surfacing in UI.
  - Upgrade badges/tooltips and Basic "Simple Mode" skin.
- **Deferred (Phase 3+)**
  - External video monitoring integrations beyond stubs.
  - Multi-operator roles/permissions.
  - Smart slide-note parsing/auto cues.
  - LAN exposure beyond loopback without new auth model.
  - Performance/observability suite expansion.

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

4. **Undo/Redo Command System**
   - Command interfaces for timer CRUD/message/reorder/room delete; per-room stacks (`undo:{uid}:{roomId}`) with caps.
   - Hybrid-safe replay (no double-apply); UI hooks updated; tests for disconnect/reconnect and offline replay.
   - Success: Undo/redo works across tabs; quota handled gracefully.

5. **UX Polish & Companion GUI**
   - Viewer typography/wake-lock fallback; Minimal mode gating copy; Basic Simple Mode skin.
   - Companion tray/window for mode selection/status reflecting capabilities; stays within RAM budgets.
   - Success: Resource targets met; clear gating/messaging without technical jargon.

## Cross-Cutting Risks & Mitigations
- **Authority races:** Simultaneous reconnect + takeover; mitigate with single pending handshake and explicit takeover prompts.
- **Rule rollout:** Mismatch between client and Firestore rules; mitigate with staging + canary + rollback snapshot.
- **Latency jitter:** Conflicts between Companion and Firebase updates; use `updatedAt` tie-breaker favoring controller.
- **File ops security:** Path traversal/symlink escape; enforce normalized roots and deny network paths; local-only bind.
- **Storage limits:** Undo stacks on Safari/iOS; degrade gracefully with no-op persistence when unsupported.

## QA Focus Hooks
- Multi-tab/controller/viewer authority locking and takeover prompts.
- Companion restart and reconnect backoff adherence; no duplicate controllers.
- Mode switching Cloud ↔ Hybrid/Local mid-show without timer jumps (`SYNC_ROOM_STATE`).
- Offline/Hybrid queue + last-write-wins with undo/redo persistence intact.
- Tier gating (Basic hides/blocks; Show Control enables live cues; Production ready hooks).
- Live cue latency measurements (local vs. cloud) within targets.
- File ops safety (path rejection, token expiry, ffprobe missing warning).
- Undo/redo persistence and overflow handling.

## Rollout Expectations
- Feature flags default off until QA signoff.
- Rules deployed via emulator → staging → prod with canary room; rollback ready.
- Companion builds canaried; rollback to previous build + rules snapshot if needed.
- Operator-facing release notes: highlight gating, reconnect behavior, and Minimal mode limits.