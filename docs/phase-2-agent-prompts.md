---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2026-01-10
Scope: RepoPrompt agent prompt list for Phase 2 implementation passes.
---

# Phase 2 Agent Prompts (RepoPrompt)

Use this file to dispatch RepoPrompt builder agents. Each prompt maps to a single pass in
`docs/phase-2-tasklist.md`. Keep each agent run small, scoped, and verifiable.

## Global Guidance (include in every prompt)
- Read `docs/phase-2-tasklist.md` and the relevant pass before coding.
- Also read: `docs/client-prd.md`, `docs/local-server-prd.md`, `docs/local-mode.md`, `docs/edge-cases.md`, `docs/interface.md`.
- Respect scope exclusions for the milestone.
- Avoid touching parallel sync logic unless the pass explicitly requires it.
- Keep changes isolated to the stated files.
- Default feature flags off until QA signoff.
- Do not expand scope without approval.
- Follow the Error UX Matrix in `docs/phase-2-tasklist.md`.
- Include protocol versioning in JOIN/HANDSHAKE when touching that flow.
- Do not modify timer math, elapsed calculations, or `useTimerEngine` unless the pass explicitly requires it.
- Respect preview cache TTL (10s or on `HANDSHAKE_ACK` capability change).
- Feature gating: missing capabilities must show visible UI messaging; no silent failures.
- Stop and report immediately if parallel sync regresses (timer drift, queue replay, authority flapping).
- Run relevant tests before marking the pass complete; if frontend touched, run `npm run lint && npm run test`.

---

## 0) Pre-flight (Context Sync)
Prompt:
```
Read `docs/phase-2-tasklist.md`. Summarize the next pass you will implement, list the files you will touch, and confirm the scope exclusions for this milestone. Do not change code.
```

---

## Milestone 0 (Phase 2a) - Electron Controller Wrapper

### Pass A: Electron Shell
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 0 Pass A from `docs/phase-2-tasklist.md`.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Scope: Electron shell only (no transport changes).
Targets: Electron shell, contextBridge IPC, load frontend build output, deep link handler, crash recovery banner, local cache persistence.
Keep Companion socket ownership in the renderer; do not move sockets into the main process.
Do not modify `UnifiedDataContext` or socket logic.
Acceptance: Electron launches controller, connects to Companion, local cache persists, crash recovery banner appears.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass B: Build & Sign
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 0 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Add code signing + auto-update pipeline (electron-builder/electron-updater).
Test canary update path. No UI changes.
Acceptance: Builds install and update cleanly on macOS + Windows.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

---

## Milestone 1 - Transport Hardening & Tier Gating

### Pass A: Reconnect State Machine
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 1 Pass A.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Companion: enforce single pending handshake.
Frontend: reconnection state machine + backoff + Retry CTA.
Files: `companion/src/main.ts`, `frontend/src/context/CompanionConnectionContext.tsx`.
Add unit test for backoff timing if feasible.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass B: Controller Lock & Takeover
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 1 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Companion: lock + heartbeat + socket events (HEARTBEAT, CONTROLLER_LOCK_STATE, REQUEST_CONTROL,
CONTROL_REQUEST_RECEIVED, FORCE_TAKEOVER).
Frontend: request flow, handover, reclaim UI.
Reject non-authoritative writes at BOTH Companion socket layer and Firebase write-through.
Types: add `ControllerLock` to `frontend/src/types/index.ts`.
Reference: `docs/phase-2-overview.md` Phase 2b Flow Diagrams.
Also consult `docs/client-prd.md` + `docs/local-server-prd.md` for control handoff, PIN, and room-in-use details.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass C: Authority & Caching
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 1 Pass C.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
On capability/tier change: drop cached preview, refetch room config/state, recompute feature visibility.
Conflict rule: prefer freshest `lastUpdate`, tie-break to controller-originated change.
Authority confidence window: 2s base, expand to 4s on reconnect churn (per `docs/local-mode.md`).
Viewer sync guard: avoid applying local writes when viewer-only / non-authoritative.
Cross-tab sync: mode changes, takeover banners, token refresh propagate via BroadcastChannel/localStorage.
Drop cached preview on `HANDSHAKE_ACK` capability/tier change and respect the 10s TTL.
Files: `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/context/CompanionConnectionContext.tsx`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass D: Rules & Tests
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 1 Pass D.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Firestore rules rollout for tiered subcollections; ensure `reorderRoom.mock.test.tsx` passes.
Run `npm run test` + `npm run lint` and report results.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

---

## Milestone 2 - Show Control Core (Presentation Status + Dual Header)

### Pass A: Protocol & Plumbing
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 2 Pass A.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Companion emits LIVE_CUE/PRESENTATION events; frontend merges; `activeLiveCueId` in RoomState.
Write-through policy: controller writes liveCues to Firestore; Companion writes only after 5s stale
heartbeat, yields on reconnect; skip write-through when cue rate > 1/sec.
Write metadata uses `updatedAt` + `writeSource: 'companion' | 'controller'` (distinct from cue `source`).
Types: extend RoomState with `activeLiveCueId: string | null` in `frontend/src/types/index.ts`.
Files: `companion/src/main.ts`, `frontend/src/context/UnifiedDataContext.tsx`.
Scope exclusions: no scheduled cues, no cue timeline, no manual acknowledgment.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass B: UI & Latency Validation
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 2 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Dual header + tech viewer status panel gated by tier/capability.
Add latency harness instructions; record local vs cloud deltas.
Files: `frontend/src/routes/ControllerPage.tsx`, `frontend/src/routes/ViewerPage.tsx`, `frontend/src/components/*`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

---

## Milestone 3 - Presentation Import & File Operations

### Pass A-Win: PPT Detection + File Ops (Windows)
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 3 Pass A-Win in Companion.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Add /api/open, /api/file/exists, /api/file/metadata with strict path validation.
PPT detection via COM API; debounce 1.5s; foreground-only; emit PRESENTATION_CLEAR on close/idle.
Files: `companion/src/main.ts`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass A-Mac: PPT Slide Tracking (macOS)
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 3 Pass A-Mac in Companion.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Slide tracking via AppleScript; no video timing; emit "video timing unavailable on macOS".
Files: `companion/src/main.ts`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass B: Frontend Workflow
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 3 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Presentation detected notification, manual import flow, error UX for token expiry and ffprobe missing.
Files: `frontend/src/components/*`, `frontend/src/context/UnifiedDataContext.tsx`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

---

## Milestone 4 - UX Polish & Companion GUI

### Pass A: Viewer/Controller Polish
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 4 Pass A.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Typography scaling fixes, wake-lock fallback banner, Minimal mode gating UX, basic tier skin, banner copy cleanup.
Files: `frontend/src/routes/*`, `frontend/src/components/*`, `frontend/src/index.css`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass B: Companion GUI & Resource Checks
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 4 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.
Companion tray + minimal window; persistent mode selection; RAM measurement targets.
Files: `companion/src/main.ts`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

---

## Milestone 5 - Cloud Controller Lock Enforcement

**Design Document:** `docs/cloud-lock-design.md` (read this first!)

### Pass A: Lock Schema & Cloud Functions
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read: `docs/cloud-lock-design.md` (the full design document for this feature).
Implement Milestone 5 Pass A.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.

Scope:
- Add `rooms/{roomId}/lock/current` document schema to Firestore.
- Add `rooms/{roomId}/config/pin` (room PIN) and `rooms/{roomId}/controlRequest/current` schemas.
- Implement Cloud Functions: `acquireLock`, `releaseLock`, `forceTakeover`, `updateHeartbeat`, plus request/deny control helpers to manage `controlRequest`.
- Use Firestore transactions for atomic lock acquisition.
- All staleness logic (90s threshold) in Cloud Functions only; no stale checks in rules.
- Update Firestore security rules: lock holder check by `userId`, owner-only writes for `config/pin`, service account bypass for liveCues.
- Ensure public read access unchanged (viewers work without auth).

Key design decisions (from design doc):
- Rules enforce by `userId` (Firebase Auth UID), not per-tab `clientId`.
- Cloud Functions validate `clientId` for lock ownership.
- Lock document managed by Cloud Functions only (rules deny direct writes).
- `controlRequest` uses server timestamps; client-provided timestamps are not trusted.
- Companion service account claims are required for `liveCues` bypass (see `docs/interface.md`).

Files: `firebase/firestore.rules`, new Firebase Cloud Functions directory.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions (no shared control, no roles, no audit logging)
3. Then proceed with implementation
```

### Pass B: Frontend Integration
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read: `docs/cloud-lock-design.md` (the full design document for this feature).
Implement Milestone 5 Pass B.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.

Scope:
- Persist `clientId` in `sessionStorage` (survives refresh, not new tabs).
- Add heartbeat loop (30s interval) for cloud mode controllers only.
- Subscribe to `rooms/{roomId}/lock/current` document in `UnifiedDataContext`.
- Map cloud lock state to existing `resolveControllerLockState()` (authoritative/read-only/requesting/displaced).
- Implement `visibilitychange` handler: stop heartbeat when tab hidden, resume when visible.
- Add queue flush validation: check lock before flushing offline writes; discard if lock lost.
- UI must block writes when `controllerLockState !== 'authoritative'`.

Authority resolution (from design doc):
- `roomAuthority.source === 'companion'` → use Companion lock (existing Socket.IO)
- `roomAuthority.source === 'cloud'` → use Firestore lock (new)
- No mixing; one lock source per room.

Files: `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/types/index.ts`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass C: Request/Force Takeover UX (Cloud)
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Also read: `docs/cloud-lock-design.md` (the full design document for this feature).
Implement Milestone 5 Pass C.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.

Scope:
- Request control flow works in cloud mode (calls `forceTakeover` Cloud Function).
- Force takeover with PIN works in cloud mode.
- Force takeover after timeout (30s since request) works in cloud mode.
- Displaced controller notification works in cloud mode.
- Ensure UX parity with Companion takeover flow.

Reference: `docs/client-prd.md` "Cloud Controller Lock Enforcement" section for UX requirements.

Files: `frontend/src/routes/ControllerPage.tsx`, `frontend/src/components/*`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass D: Documentation & Cleanup
Prompt:
```
Before any code: open `docs/phase-2-agent-prompts.md`, read the Global Guidance section, and run the Pre-flight (Context Sync) prompt in section 0.
Implement Milestone 5 Pass D.
Complete every item listed under this pass in `docs/phase-2-tasklist.md`; list any item you cannot complete and why.

Scope:
- Verify all documentation is up to date (interface.md, client-prd.md, local-mode.md, app-prd.md already updated).
- Remove any TODO comments related to cloud lock.
- Verify no regressions in Companion lock flow.
- Run full test suite: `npm run lint && npm run test`.

Files: `docs/*`, any files with cloud lock TODOs.

Before writing code:
1. List the files you will review/modify
2. Confirm the documentation matches the implementation
3. Then proceed with cleanup
```
