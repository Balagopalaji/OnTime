---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2026-01-19
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
- [ ] Map controller flows for sections, segments, cues, acknowledgments, and crew chat.
- [ ] Define role-based viewer panels and filters.
- [ ] Produce a brief spec for viewer panels (text-based is fine).
- [ ] Define pairing UX flow (QR + manual entry), where it lives (Companion vs. controller UI), and write it to `docs/phase-3-pairing-ux.md`.
- [ ] Identify required permissions (owner/operator/viewer).

### Pass B: Authority + Data Model Alignment
- [ ] Lock cue authority model (cloud vs. companion) and mode transition behavior.
- [ ] Clarify role storage mechanism (room membership schema vs. inferred roles) and document in `docs/interface.md` if needed.
- [ ] Confirm cue queue implementation (reuse existing queue vs. new queue) and define max queue size.
- [ ] Validate Phase 3 schema fields in `docs/interface.md` against intended flows.
- [ ] List any schema gaps and propose updates (do not change code in this pass).

### Pass C: PRD + Plan Updates
- [ ] Update `docs/app-prd.md`, `docs/client-prd.md`, `docs/local-server-prd.md`, `docs/cloud-server-prd.md` with Phase 3 requirements.
- [ ] Update `docs/phase-3-overview.md` if scope changes.
- [ ] Update `docs/phase-3-decisions.md` with locked decisions; confirm or adjust timeline targets.

---

## Phase 3B — LAN Offline Viewer Infrastructure

**Goal:** Secure, reliable offline viewer delivery over LAN.

### Pass A0: Bundle Strategy Note
- [ ] Define build/serve strategy for the LAN viewer bundle (build target, location in Companion, cache-busting/versioning).
- [ ] Write the decision in `docs/phase-3-bundle-strategy.md` and summarize in `docs/phase-3-decisions.md`.

### Pass A: Viewer Bundle Packaging
- [ ] Add Companion-served viewer bundle build, packaging, and versioning.
- [ ] Ensure viewer assets can be served offline from the Companion origin.
- [ ] Ensure Companion cache/versioning/migration is updated for viewer bundle assets.

### Pass B0: Cert Trust UX Note
- [ ] Define first-run trust UX, operator guidance, and fallback behavior.
- [ ] Must align with `docs/local-offline-lan-plan.md` (HTTPS/WSS required).
- [ ] Write the decision in `docs/phase-3-cert-trust-ux.md` and summarize in `docs/phase-3-decisions.md`.

### Pass B1: HTTPS/WSS + PNA/CORS (Self-signed)
- [ ] Implement self-signed SAN cert generation, storage, and rotation.
- [ ] Add PNA/CORS headers and LAN allowlist enforcement (RFC1918 + IPv4 link-local + IPv6 ULA/link-local).
- [ ] Provide first-run trust guidance UX.

### Pass B2: HTTPS/WSS (BYO cert)
- [ ] Add BYO cert/key import and validation.
- [ ] Document operational guidance for cert renewal.

### Pass C: Pairing + Tokens
- [ ] Implement pairing flow (QR/manual) using the Phase 3A pairing UX spec.
- [ ] Enforce role-bound tokens, TTL, and revocation persistence.
- [ ] Defaults: pairing code TTL 10 min (not persisted across restart), viewer token TTL 8 hours, max 20 devices per room, reusable until expiry unless revoked.

### Pass D: Role Enforcement + Read-Only Guards
- [ ] Ensure viewer tokens cannot call control or file APIs.
- [ ] Enforce viewer-only paths at socket and HTTP layers.
- [ ] Keep token endpoint loopback-only; no LAN `/api/token` exposure.

### Pass E: Offline QA + Recovery
- [ ] Validate trust flow, revocation persistence, and cache versioning/migration.
- [ ] Verify LAN allowlist and private subnet restriction behavior.
- [ ] Add edge-case QA for IPv6, Docker/VM bridges, and multiple NICs.
- [ ] Bridge validation: when internet drops, remote viewers stall; on reconnect, bridge pushes fresh snapshot and remote resumes read-only.

---

## Phase 3C — Show Controller Build

**Goal:** Deliver manual show planning and cueing workflows.

### Pass A: Data + Rules
- [ ] **Cloud/Firebase:** Add Firestore rules and validation for sections, segments, cues, crew chat.
- [ ] **Cloud/Firebase:** Add Firestore rules for operator access: `config/invite`, `operators`, `blocked` (include blocklist checks).
- [ ] **Cloud/Firebase:** Add Cloud Function `joinAsOperator` for invite validation and operator creation.
- [ ] **Frontend:** Add client types for Phase 3 entities (including `Operator`, `InviteConfig`, `BlockedUser`).
- [ ] **Frontend:** Implement cue sync behavior per the locked authority model.
- [ ] **Companion:** Implement dedicated cue queue (cap: 150, key: `ontime:cueQueue:{roomId}`).
- [ ] **Tests:** rules/unit coverage for operator access and cue writes.
- [ ] **Acceptance:** operators can join via invite; blocked users cannot write cues; cue queue persists and replays.

### Pass B: Sections + Segments UI
- [ ] **Frontend:** CRUD + ordering for sections and segments; segment-timer linkage and display.
- [ ] **Cloud/Firebase:** update write helpers and rules validation if needed.
- [ ] **Tests:** section/segment CRUD + ordering.
- [ ] **Acceptance:** sections/segments reorder correctly without timer regression.

### Pass C: Cues UI
- [ ] **Frontend:** cue creation, editing, ordering, and trigger types.
- [ ] **Frontend:** cue ack states (done/skipped) and status indicators.
- [ ] **Frontend:** role-based cue editing (disable edits when `cue.role != currentUserRole`, unless owner).
- [ ] **Frontend:** include `createdByRole` on create, `editedByRole` on update.
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

---

## Phase 3D — Hardening + Release

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
- [ ] UI polish pass with gating copy clarity — target: 3D.
- [ ] Auto-update pipeline for Electron controller (canary + stable) — target: 3D.
- [ ] Code signing for macOS + Windows; notarization checks — target: 3D.
- [ ] macOS version bump step (optional parity with Windows script) — target: 3D.
- [ ] Reassess RAM budgets using packaged builds; meet Minimal target — target: 3D.
- [ ] Prefer VLC when opening external videos (fallback to default player) — target: 3C.
- [ ] Standalone PowerPoint video timer app (deferred beyond Phase 3 core).
