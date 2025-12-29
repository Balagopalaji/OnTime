---
Type: Reference
Status: planned
Owner: KDB
Last updated: 2025-12-29
Scope: Phase 2 overview and goals.
---

# Phase 2 Overview (OnTime)

Phase 2 builds on the Phase 1D foundation to make OnTime "show-ready": stabilize Companion + parallel transport, deliver Show Control essentials (live cues, presentation import, dual-header UI), and add production-grade UX (undo/redo, viewer polish, authority/reconnect hardening). Success means Basic tier stays lean (<50 MB Companion in Minimal mode), Show Control gains live cue visibility with low bandwidth, and Production tier has groundwork for media workflows without breaking current users or increasing Firebase costs.

## Goals & Scope
- **Transport stability:** Harden Companion multi-client flows, reconnection/backoff, and authority handling across Local/Cloud.
- **Tier-correct UX:** End-to-end gating for Basic/Show Control/Production with clear upgrade prompts and capability-aware UI.
- **Show Control core:** Live cue pipeline (Companion → RoomState reference → UI dual-header) with minimal data footprint.
- **Presentation import:** Safe PPT detection + manual import workflow; Companion file ops endpoints hardened.
- **UX polish:** Viewer typography/wake-lock fixes, Minimal mode aesthetics, Companion GUI with mode selection.
- **Guardrails:** Local viewer latency <150 ms vs. controller; Cloud viewer <700 ms; Companion RAM budgets: Minimal <50 MB, Show Control ≤100 MB, Production ≤150 MB.

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
- **Deferred (Phase 3+)**
  - External video monitoring integrations beyond stubs.
  - Multi-operator roles/permissions.
  - Smart slide-note parsing/auto cues.
  - LAN exposure beyond loopback without new auth model.
  - Performance/observability suite expansion.
  - Undo/redo command system and persistence.

## Show Control Architecture (Planned Summary)
This section summarizes the show-control architecture at a high level. Canonical schemas/events live in `docs/interface.md`.

- **Data model**: Room config in `rooms/{roomId}`; real-time timer state in `rooms/{roomId}/state/current`; show-control data in `rooms/{roomId}/liveCues/{cueId}`.
- **Companion role**: Companion detects PPT/video state and emits `LIVE_CUE_*` and `PRESENTATION_*` events to controller clients.
- **Controller role**: Controller consumes live-cue events, updates UI, and writes `activeLiveCueId` to Firestore for cloud viewers.
- **Viewer roles**: Default viewer shows main timer; tech viewer (Show Control tier) overlays live cue info.
- **Latency targets**: Local viewers <150 ms; cloud viewers <700 ms.

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
