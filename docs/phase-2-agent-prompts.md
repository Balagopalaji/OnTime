---
Type: Tasklist
Status: planned
Owner: KDB
Last updated: 2025-12-31
Scope: RepoPrompt agent prompt list for Phase 2 implementation passes.
---

# Phase 2 Agent Prompts (RepoPrompt)

Use this file to dispatch RepoPrompt builder agents. Each prompt maps to a single pass in
`docs/phase-2-tasklist.md`. Keep each agent run small, scoped, and verifiable.

## Global Guidance (include in every prompt)
- Read `docs/phase-2-tasklist.md` and the relevant pass before coding.
- Respect scope exclusions for the milestone.
- Avoid touching parallel sync logic unless the pass explicitly requires it.
- Keep changes isolated to the stated files.
- Default feature flags off until QA signoff.
- Do not expand scope without approval.
- Follow the Error UX Matrix in `docs/phase-2-tasklist.md`.
- Include protocol versioning in JOIN/HANDSHAKE when touching that flow.
- Do not modify timer math, elapsed calculations, or `useTimerEngine` unless the pass explicitly requires it.
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
Implement Milestone 0 Pass A from `docs/phase-2-tasklist.md`.
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
Implement Milestone 0 Pass B.
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
Implement Milestone 1 Pass A.
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
Implement Milestone 1 Pass B.
Companion: lock + heartbeat + socket events (HEARTBEAT, CONTROLLER_LOCK_STATE, REQUEST_CONTROL,
CONTROL_REQUEST_RECEIVED, FORCE_TAKEOVER).
Frontend: request flow, handover, reclaim UI.
Reject non-authoritative writes at BOTH Companion socket layer and Firebase write-through.
Types: add `ControllerLock` to `frontend/src/types/index.ts`.
Reference: `docs/phase-2-overview.md` Phase 2b Flow Diagrams.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass C: Authority & Caching
Prompt:
```
Implement Milestone 1 Pass C.
On capability/tier change: drop cached preview, refetch room config/state, recompute feature visibility.
Conflict rule: prefer freshest `lastUpdate`, tie-break to controller-originated change.
Cross-tab sync: mode changes, takeover banners, token refresh propagate via BroadcastChannel/localStorage.
Files: `frontend/src/context/UnifiedDataContext.tsx`, `frontend/src/context/CompanionConnectionContext.tsx`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```

### Pass D: Rules & Tests
Prompt:
```
Implement Milestone 1 Pass D.
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
Implement Milestone 2 Pass A.
Companion emits LIVE_CUE/PRESENTATION events; frontend merges; `activeLiveCueId` in RoomState.
Write-through policy: controller writes liveCues to Firestore; Companion writes only after 5s stale
heartbeat, yields on reconnect; skip write-through when cue rate > 1/sec.
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
Implement Milestone 2 Pass B.
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
Implement Milestone 3 Pass A-Win in Companion.
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
Implement Milestone 3 Pass A-Mac in Companion.
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
Implement Milestone 3 Pass B.
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
Implement Milestone 4 Pass A.
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
Implement Milestone 4 Pass B.
Companion tray + minimal window; persistent mode selection; RAM measurement targets.
Files: `companion/src/main.ts`.

Before writing code:
1. List the files you will create/modify
2. Confirm you understand the scope exclusions
3. Then proceed with implementation
```
