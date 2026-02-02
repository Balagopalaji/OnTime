---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2026-02-01
Scope: RepoPrompt agent prompt list for Phase 3 implementation passes.
---

# Phase 3 Agent Prompts

**Parallel sync guardrail:** Dual-write always; timestamp arbitration with confidence window; never assume Cloud or Companion is primary.

Use this file to dispatch RepoPrompt builder agents. Each prompt maps to a single pass in
`docs/phase-3-tasklist.md`. Keep each agent run small, scoped, and verifiable.

## Global Guidance (include in every prompt)
- Read `docs/phase-3-tasklist.md` and the relevant pass before coding.
- Also read: `docs/client-prd.md`, `docs/local-server-prd.md`, `docs/cloud-server-prd.md`, `docs/local-offline-lan-plan.md`, `docs/interface.md`, `docs/local-mode.md`, `docs/edge-cases.md`, `docs/phase-3-unified-arbitration-plan.md`, `docs/phase-3-arbitration-agent-guide.md`.
- Respect scope exclusions for the milestone.
- Avoid touching parallel sync logic unless the pass explicitly requires it.
- Default feature flags off until QA signoff.
- Do not modify timer math, elapsed calculations, or `useTimerEngine` unless the pass explicitly requires it.
- Keep changes isolated to the stated files.
- If you discover ambiguity, stop and report it; do not update docs unless the pass explicitly requires it.
- For any code pass, run `npm run lint && npm run test` before marking complete.

---

## 0) Pre-flight (Context Sync)
Prompt:
```
Read `docs/phase-3-tasklist.md`. Summarize the next pass you will implement, list the files you will touch, and confirm the scope exclusions for this milestone. Do not change code.
```

---

## Phase 3A — Show Controller Definition

### Pass A: Workflow + UX Definition
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3A Pass A from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: Documentation and workflow definition only.
Write the pairing UX spec to `docs/phase-3-pairing-ux.md`.
Update `docs/phase-3-decisions.md` with any new locks or open questions.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B: Authority + Data Model Alignment
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3A Pass B.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Validate schema alignment in `docs/interface.md`; propose gaps without changing code.
Clarify role storage mechanism and cue queue implementation, and record decisions in `docs/phase-3-decisions.md`.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass C: PRD + Plan Updates
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3A Pass C.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Update PRDs and Phase 3 docs per `docs/phase-3-tasklist.md`.
Ensure `docs/phase-3-decisions.md` is updated with locked decisions; confirm or adjust timeline targets after Phase 3A PRD updates.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

---

## Phase 3B — LAN Offline Viewer Infrastructure

### Pass A0: Bundle Strategy Note
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass A0.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: design note only (build/serve strategy, cache-busting, versioning).
Write the decision in `docs/phase-3-bundle-strategy.md` and summarize in `docs/phase-3-decisions.md`.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B0: Cert Trust UX Note
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass B0.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: design note only (trust UX, operator guidance, fallback behavior).
Must align with `docs/local-offline-lan-plan.md` and `docs/phase-3-cert-trust-ux.md`.
Write the decision in `docs/phase-3-cert-trust-ux.md` and summarize in `docs/phase-3-decisions.md`.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass A: Viewer Bundle Packaging
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass A.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: Companion-served viewer bundle build/package/version wiring only.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B1: HTTPS/WSS + PNA/CORS (Self-signed)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass B1.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: self-signed SAN cert generation, storage/rotation, PNA/CORS headers, LAN allowlist enforcement, trust guidance UX.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B2: HTTPS/WSS (BYO cert)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass B2.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: BYO cert/key import, validation, and documentation.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass C: Pairing + Tokens
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass C.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: pairing flow, viewer-only tokens, TTL, revocation persistence.
Use the pairing UX spec from Phase 3A.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass D: Role Enforcement + Read-Only Guards
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass D.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: enforce viewer-only actions at socket and HTTP layers.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass E: Offline QA + Recovery
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3B Pass E.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: QA validation and documentation updates only.
Include edge-case QA for IPv6, Docker/VM bridges, and multi-NIC setups.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

---
---

## Phase 3C — Show Controller Build

### Pass A: Data + Rules
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass A.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: Firestore rules + Cloud Function + client types + cue sync + Companion cue queue + tests.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B: Sections + Segments UI
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass B.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: sections/segments CRUD + ordering.
Note: cross-section drag-and-drop for segments/timers is a follow-up (B2.1) item; do not block Pass B unless explicitly asked.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass C: Cues UI
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass C.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: cue CRUD + role enforcement + audit fields + tests.
Note: cross-section drag-and-drop for cues is part of Pass C; confirm ordering semantics before implementing.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass D: Crew Chat
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass D.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: crew chat UI and data flows.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass E: Viewer Panels
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass E.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: viewer cue panels, role filters, live cues separation.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass F: Permissions + Gating
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass F.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: tier gating + role permissions + operator invite flow + Cloud enforcement + tests.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass G: StageState Payload (Future, Additive, Read-Only)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3C Pass G.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: introduce StageState payload + events for viewers; keep controller sync intact and viewer read-only.
Do not alter timer math, cue authority model, or controller write paths.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

---

## Phase 3D — Save/Load Sessions

**Guardrails (do not violate):**
- Restore always creates a **new room** (no overwrite-in-place).
- Never sync sessions as live data; sessions are **static snapshots** only.
- Do not bypass tombstones; block save/restore for tombstoned rooms.
- Use subcollections for snapshots (no single 1MB doc).
- No session auto-download; list metadata only, fetch snapshot on demand.
- After completing a full pass, run `npm run lint` and `npm run test` in `frontend/`.

### Pass A: Data Model + Security Rules
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read `docs/phase-3-save-load-sessions.md` (the full spec for this feature).
Implement Save/Load Sessions Pass A from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass; list any item you cannot complete and why.
Scope: TypeScript types + Firestore security rules + optional Cloud Function for cap enforcement.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B: Save Flow
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read `docs/phase-3-save-load-sessions.md` (the full spec for this feature).
Implement Save/Load Sessions Pass B from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass; list any item you cannot complete and why.
Scope: Dashboard save actions, save logic (strip runtime fields, reset state, write subcollections), size guard, tombstone guard, client cap enforcement.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass C: Sessions Page + Restore Flow
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read `docs/phase-3-save-load-sessions.md` (the full spec for this feature).
Implement Save/Load Sessions Pass C from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass; list any item you cannot complete and why.
Scope: /sessions route, metadata list with pagination, on-demand snapshot fetch, restore as new room, delete flow, filter tabs.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass D: Companion Offline Queue
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read `docs/phase-3-save-load-sessions.md` (the full spec for this feature).
Implement Save/Load Sessions Pass D from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass; list any item you cannot complete and why.
Scope: Companion local session file write, local cap enforcement, frontend reconnect upload + local file cleanup.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass E: Testing + QA
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read `docs/phase-3-save-load-sessions.md` (the full spec for this feature).
Implement Save/Load Sessions Pass E from `docs/phase-3-tasklist.md`.
Complete every item listed under this pass; list any item you cannot complete and why.
Scope: Testing and QA validation only. Verify save/restore round-trip, offline queue, cap enforcement, template locking, cross-device, and security rules.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

---

## Phase 3E — Hardening + Release

### Pass A: Test Coverage
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3E Pass A.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: tests for planner data flows and role scoping.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass B: Performance + Reliability
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3E Pass B.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: performance validation and RAM budget reassessment.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Pass C: Documentation
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Phase 3E Pass C.
Complete every item listed under this pass in `docs/phase-3-tasklist.md`; list any item you cannot complete and why.
Scope: documentation updates only.
Before writing changes:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

---

## Phase 2 Carryover Prompts

### Carryover (Phase 3A/3C)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement the carryover items in `docs/phase-3-tasklist.md` marked for targets 3A/3C.
Complete every item listed under this carryover group; list any item you cannot complete and why.
Scope: tier selection UI and any 3A/3C carryover items.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Carryover (Phase 3B)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement the carryover items in `docs/phase-3-tasklist.md` marked for target 3B.
Complete every item listed under this carryover group; list any item you cannot complete and why.
Scope: viewer-only Electron build target.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Carryover (Phase 3C)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement the carryover items in `docs/phase-3-tasklist.md` marked for target 3C.
Complete every item listed under this carryover group; list any item you cannot complete and why.
Scope: viewer second-display option and VLC preference.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```

### Carryover (Phase 3E)
Prompt:
```
Before any code: open `docs/phase-3-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement the carryover items in `docs/phase-3-tasklist.md` marked for target 3E.
Complete every item listed under this carryover group; list any item you cannot complete and why.
Scope: crash recovery banner, UI polish, auto-update, code signing, RAM targets, macOS version bump.
Before writing code:
1) List the files you will modify
2) Confirm scope exclusions
3) Then proceed
```
