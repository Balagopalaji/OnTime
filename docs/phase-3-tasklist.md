---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2026-02-01
Scope: Phase 3 task list and implementation passes.
---

# Phase 3 Task List (Builder-Focused, Pass-Scoped)

This file translates the Phase 3 plan into granular, implementable steps. Each pass should be small, scoped, and verifiable. Do not expand scope without explicit approval.

## Guardrails
- Follow `docs/local-offline-lan-plan.md` for LAN viewer constraints and security.
- Follow `docs/interface.md` for Phase 3 schema fields and payloads.
- Do not modify timer math or `useTimerEngine` unless explicitly required; `docs/timer-logic.md` is authoritative.
- Avoid parallel sync changes unless a pass explicitly requires it.
- Default feature flags off until QA signoff.
- Keep changes isolated to stated files.
- Run relevant tests before marking a pass complete; if frontend touched, run `npm run lint && npm run test`.

---

## Phase 3A — Show Controller Definition

**Goal:** Define planner workflows and viewer requirements before building LAN distribution.

### Pass A: Workflow + UX Definition
- [x] Map controller flows for sections, segments, cues, acknowledgments, and crew chat.
- [x] Define role-based viewer panels and filters.
- [x] Produce a brief spec for viewer panels (text-based is fine).
- [x] Define pairing UX flow (QR + manual entry), where it lives (Companion vs. controller UI), and write it to `docs/phase-3-pairing-ux.md`.
- [x] Identify required permissions (owner/operator/viewer).

### Pass B: Authority + Data Model Alignment
- [x] Lock cue authority model (cloud vs. companion) and mode transition behavior.
- [x] Clarify role storage mechanism (room membership schema vs. inferred roles) and document in `docs/interface.md` if needed.
- [x] Confirm cue queue implementation (reuse existing queue vs. new queue) and define max queue size.
- [x] Validate Phase 3 schema fields in `docs/interface.md` against intended flows.
- [x] List any schema gaps and propose updates (do not change code in this pass).

### Pass C: PRD + Plan Updates
- [x] Update `docs/app-prd.md`, `docs/client-prd.md`, `docs/local-server-prd.md`, `docs/cloud-server-prd.md` with Phase 3 requirements.
- [x] Update `docs/phase-3-overview.md` if scope changes.
- [x] Update `docs/phase-3-decisions.md` with locked decisions; confirm or defer timeline targets.

---

## Phase 3B — LAN Offline Viewer Infrastructure

**Goal:** Secure, reliable offline viewer delivery over LAN.

### Pass A0: Bundle Strategy Note
- [x] Define build/serve strategy for the LAN viewer bundle (build target, location in Companion, cache-busting/versioning).
- [x] Write the decision in `docs/phase-3-bundle-strategy.md` and summarize in `docs/phase-3-decisions.md`.

### Pass A: Viewer Bundle Packaging
- [x] Add Companion-served viewer bundle build, packaging, and versioning.
- [x] Ensure viewer assets can be served offline from the Companion origin.
- [x] Ensure Companion cache/versioning/migration is updated for viewer bundle assets.

### Pass B0: Cert Trust UX Note
- [x] Define first-run trust UX, operator guidance, and fallback behavior.
- [x] Must align with `docs/local-offline-lan-plan.md` (HTTPS/WSS required).
- [x] Write the decision in `docs/phase-3-cert-trust-ux.md` and summarize in `docs/phase-3-decisions.md`.

### Pass B1: HTTPS/WSS + PNA/CORS (Self-signed)
- [x] Implement self-signed SAN cert generation, storage, and rotation.
- [x] Add PNA/CORS headers and LAN allowlist enforcement (RFC1918 + IPv4 link-local + IPv6 ULA/link-local).
- [x] Provide first-run trust guidance UX.

### Pass B2: HTTPS/WSS (BYO cert)
- [x] Add BYO cert/key import and validation.
- [x] Document operational guidance for cert renewal.

### Pass C: Pairing + Tokens
- [x] Implement pairing flow (QR/manual) using the Phase 3A pairing UX spec.
- [x] Enforce role-bound tokens, TTL, and revocation persistence.
- [x] Defaults: pairing code TTL 10 min (not persisted across restart), viewer token TTL 8 hours, max 20 devices per room, reusable until expiry unless revoked.

### Pass D: Role Enforcement + Read-Only Guards
- [x] Ensure viewer tokens cannot call control or file APIs.
- [x] Enforce viewer-only paths at socket and HTTP layers.
- [x] Keep token endpoint loopback-only; no LAN `/api/token` exposure.

### Pass E: Offline QA + Recovery
- [x] Validate trust flow, revocation persistence, and cache versioning/migration.
- [x] Verify LAN allowlist and private subnet restriction behavior.
- [ ] Add edge-case QA for IPv6, Docker/VM bridges, and multiple NICs.
- [x] Bridge validation: when internet drops, remote viewers stall; on reconnect, bridge pushes fresh snapshot and remote resumes read-only.

---

## Phase 3C — Show Controller Build

**Goal:** Deliver manual show planning and cueing workflows.

### Pass A: Data + Rules
- [x] **Cloud/Firebase:** Add Firestore rules and validation for sections, segments, cues, crew chat.
- [x] **Cloud/Firebase:** Add Firestore rules for operator access: `config/invite`, `operators`, `blocked` (include blocklist checks).
- [x] **Cloud/Firebase:** Add Cloud Function `joinAsOperator` for invite validation and operator creation.
- [x] **Frontend:** Add client types for Phase 3 entities (including `Operator`, `InviteConfig`, `BlockedUser`).
- [x] **Frontend:** Implement cue sync behavior per the locked authority model.
- [x] **Companion:** Implement dedicated cue queue (cap: 150, key: `ontime:cueQueue:{roomId}`).
- [x] **Tests:** rules/unit coverage for operator access and cue writes.
- [ ] **Acceptance:** operators can join via invite; blocked users cannot write cues; cue queue persists and replays.

### Pass B: Sections + Segments UI
- [ ] **Frontend:** CRUD + ordering for sections and segments; segment-timer linkage and display.
- [ ] **Cloud/Firebase:** update write helpers and rules validation if needed.
- [ ] **Tests:** section/segment CRUD + ordering.
- [ ] **Acceptance:** sections/segments reorder correctly without timer regression.
- **Note (B1):** Sections and segments are cloud-only (Firestore CRUD). No Companion socket events or offline cache support in this pass. Companion offline support for sections/segments is deferred and should be added when Companion socket/cache support is designed.
- [ ] **Follow-up (B2.1):** Enable drag-and-drop of segments across sections (cross-list move, preserving segment timers/cues).
- [ ] **Follow-up (B2.1):** Enable drag-and-drop of timers across segments/sections (cross-list move, preserve segment timing order).

### Pass C: Cues UI
- [ ] **Frontend:** cue creation, editing, ordering, and trigger types.
- [ ] **Frontend:** cue ack states (done/skipped) and status indicators.
- [ ] **Frontend:** role-based cue editing (disable edits when `cue.role != currentUserRole`, unless owner).
- [ ] **Frontend:** include `createdByRole` on create, `editedByRole` on update.
- [ ] **Frontend:** drag-and-drop cues across segments/sections (cross-list move, preserve cue order).
- [ ] **Tests:** cue operations, role enforcement, audit fields.
- [ ] **Acceptance:** cues respect role restrictions and ack state is stable across refresh.

### Pass D: Crew Chat
- [ ] **Frontend:** chat UI, role filtering, audience scoping.
- [ ] **Cloud/Firebase:** rules enforcement for role-scoped messages.
- [ ] **Tests:** chat create/read with role filtering.
- [ ] **Acceptance:** messages are scoped correctly by role/audience.

### Pass E: Viewer Panels
- [ ] **Frontend:** upcoming cues list, role filtering, live cue separation.
- [ ] **Tests:** viewer rendering with mixed live/manual cues.
- [ ] **Acceptance:** live cues never appear in manual cue list and vice versa.

### Pass F: Permissions + Gating
- [ ] **Frontend:** tier gating for planner features (Show Control/Production).
- [ ] **Frontend:** role-based permissions for editing vs. viewing.
- [ ] **Frontend:** operator invite flow UI (owner management + operator join).
- [ ] **Cloud/Firebase:** enforce operator access rules for invite/kick/unblock flows.
- [ ] **Tests:** permission enforcement, kick/unblock flows.
- [ ] **Acceptance:** owner-only TD/Director; operators limited to role-matching cues.

### Pass G: StageState Payload (Future, Additive, Read-Only)
- [ ] Define StageState payload schema + events in `docs/interface.md` (timer display + clock + message + connection flags).
- [ ] Companion emits StageState on join and on relevant changes (timer display/clock/message) for viewers.
- [ ] Viewers use StageState as the single source for the stage card; operator viewers embed StageState and layer role overlays.
- [ ] Keep existing room/timer sync for controllers; no permission changes (viewer remains read-only).

---

## Phase 3D — Save/Load Sessions

**Goal:** Enable cross-device save and restore of room state as sessions or templates.
**Spec:** `docs/phase-3-save-load-sessions.md`

### Pass A: Data Model + Security Rules
- [ ] **Types:** Add `SessionMeta`, `SessionSnapshotRoom`, `SessionSnapshotState`, `SessionSnapshotTimer`, `SessionSnapshotCue`, `Session` types to `frontend/src/types/index.ts`.
- [ ] **Cloud/Firebase:** Add Firestore security rules for `users/{uid}/sessions/{sessionId}` and `snapshot/{doc=**}`.
- [ ] **Cloud Function (optional):** Add session count enforcement on session document create (hard cap 70).

### Pass B: Save Flow
- [ ] **Frontend:** Add "Save Session" and "Save as Template" actions to Dashboard room card menu.
- [ ] **Frontend:** Implement save logic: read room/state/timers/cues, strip runtime fields, reset state, write to Firestore subcollections.
- [ ] **Frontend:** Size estimation + warning at > 700KB.
- [ ] **Frontend:** Guard: block save on tombstoned rooms.
- [ ] **Frontend:** Client-side cap enforcement (disable save at 50 snapshots / 20 templates).

### Pass C: Sessions Page + Restore Flow
- [ ] **Frontend:** Add `/sessions` route with metadata list (paginated, 25 per page).
- [ ] **Frontend:** On-demand snapshot fetch when user selects a session.
- [ ] **Frontend:** Restore as New Room: new roomId, new timer/cue IDs, reset state, navigate to controller.
- [ ] **Frontend:** Delete session (single confirm for snapshots, unlock + confirm for templates).
- [ ] **Frontend:** Filter tabs (All / Snapshots / Templates) and count display.

### Pass D: Companion Offline Queue
- [ ] **Companion:** Write `session-<id>.json` to cache directory when offline.
- [ ] **Companion:** Local cap enforcement (10 files, warn + block).
- [ ] **Frontend:** On reconnect, scan local queue, upload to Firestore, delete local file on success.

### Pass E: Testing + QA
- [ ] Save/restore round-trip (online).
- [ ] Offline save → reconnect upload → verify in cloud.
- [ ] Cap enforcement (client + optional Cloud Function).
- [ ] Template lock/unlock/delete flow.
- [ ] Cross-device: save on device A, restore on device B.
- [ ] Security rules: user can only access own sessions.

---

## Phase 3E — Hardening + Release

**Goal:** Stabilize and document Phase 3 features.

### Pass A: Test Coverage
- [ ] Add tests for planner data flows, cues, and role scoping.

### Pass B: Performance + Reliability
- [ ] Validate LAN viewer latency and stability targets.
- [ ] Reassess RAM budgets with packaged builds.
- [ ] Optional hardening: document Windows cert install path for Edge/Chrome if feasible.

### Pass C: Documentation
- [ ] Update `docs/doc-matrix.md` and `docs/README.md` with final Phase 3 docs.
- [ ] Record QA results and known gaps.

---

## Phase 2 Carryover (Must Be Addressed in Phase 3)
- [ ] Tier selection UI (rooms default to `basic`) — target: 3A/3C.
- [ ] Viewer-only Electron build target (separate app/build config) — target: 3B.
- [ ] Crash recovery banner on force-quit relaunch — target: 3A/3D.
- [ ] Viewer second-display option (fullscreen) — target: 3C.
- [ ] UI polish pass with gating copy clarity — target: 3E.
- [ ] Auto-update pipeline for Electron controller (canary + stable) — target: 3E.
- [ ] Code signing for macOS + Windows; notarization checks — target: 3E.
- [ ] macOS version bump step (optional parity with Windows script) — target: 3E.
- [ ] Reassess RAM budgets using packaged builds; meet Minimal target — target: 3E.
- [ ] Prefer VLC when opening external videos (fallback to default player) — target: 3C.
- [ ] Standalone PowerPoint video timer app (deferred beyond Phase 3 core).
