# Phase 1D Implementation Guide (Repo Prompt Workflow)

## Overview
Phase 1D turns Local Mode into a **first-class experience in the main app** (Dashboard-first UX) and adds/locks **CI packaging** so Companion installers ship for macOS/Windows/Linux.

**Goal:** Operators can pick **Auto/Cloud/Hybrid/Local** from a global toggle, work from the Dashboard, and run shows reliably with internet flapping (Hybrid preferred).

---

## Decisions (Locked In)
- **Single-controller per room**: unlimited viewers. A 2nd controller is rejected by default; optional takeover (disconnect old controller) is supported via `JOIN_ROOM.takeOver=true`.
- **v2-only going forward**: no legacy/v1 UX. Keep migration/rollback code dormant if already implemented (future use when real users exist).
- **Hybrid recommended** for venues: WS primary + Firestore best-effort when online; keeps show stable when WAN drops.
- **Templates now; full “Saved Shows” later**: ship a small set of defaults; defer full presets library (cloud + export/import) until after Undo/Redo + attachments workflows are settled.
- **No “separate local app”**: `/local` should not be the primary workflow. Use a global header switch + connect panel/modal.

---

## Step 1: Global Mode Model (Auto / Cloud / Hybrid / Local)

### 🎯 Goal
Introduce a durable "App Mode" model used by the entire UI:
- **auto**: choose best mode at runtime
- **cloud**: Firebase only (remote operators possible)
- **hybrid**: Companion primary + Firestore write-through when online
- **local**: Companion primary + Firestore write-through when online (same as hybrid)

**Note:** Local and Hybrid behave identically - both write to Firestore when online. This ensures seamless fallback to Cloud if Companion drops.

**Auto behavior (Phase 1D):**
- If Companion reachable → **hybrid**
- Else → **cloud**
- If offline entirely and Companion reachable → **local**

### 📄 Repo Prompt Files
```
frontend/src/context/AppModeContext.tsx
frontend/src/context/DataProvider.tsx
frontend/src/context/CompanionDataContext.tsx
docs/local-mode-plan.md (lines 1-75)
```

### Execution Checklist
- Add `auto` to the app mode type and persistence key.
- Implement “auto” resolution (Companion reachable + online state) without blocking UI.
- Ensure switching mode never strands the user.

### Failure Modes / How to handle
- Companion not running: Auto resolves to Cloud; UI should show “Companion offline”.
- Internet down: Hybrid behaves like Local (WS only) and skips Firestore writes.

### ✅ Acceptance Criteria
- [ ] Mode persists across reloads
- [ ] Auto resolves deterministically (visible in UI)
- [ ] Cloud/Hybrid/Local map to the correct DataProvider selection

---

## Step 2: Global Header Toggle + Connection Indicators

### 🎯 Goal
Expose mode switching in the **global header**, visible on Dashboard/Controller/Viewer.

### 📄 Repo Prompt Files
```
frontend/src/components/layout/AppShell.tsx
frontend/src/context/AppModeContext.tsx
frontend/src/context/CompanionDataContext.tsx
```

### Execution Checklist
- Add a header switch with: `Auto | Cloud | Hybrid | Local`.
- Add status indicators:
  - Companion: offline/connecting/online + handshake status
  - Internet: online/offline
- Add a “Connect Companion” entry point (opens modal/panel from Step 3).

### Failure Modes / How to handle
- Switching modes mid-session: keep the current route and re-bind provider state; do not hard redirect to `/local`.

### ✅ Acceptance Criteria
- [ ] User can always switch back to Cloud from any page
- [ ] Dashboard remains accessible in any mode

---

## Step 3: Dashboard-First UX (Unified Rooms Across Modes)

### 🎯 Goal
Dashboard remains the home base in every mode:
- Always show Firestore rooms list (when available).
- When Companion is connected, allow opening those same rooms in Hybrid/Local (same `roomId`).

### 📄 Repo Prompt Files
```
frontend/src/routes/DashboardPage.tsx
frontend/src/routes/ControllerPage.tsx
frontend/src/routes/ViewerPage.tsx
frontend/src/context/DataProvider.tsx
frontend/src/context/CompanionDataContext.tsx
```

### Execution Checklist
- Remove “Dashboard unavailable in local mode” gating.
- Add per-room affordances:
  - “Open (Cloud)” (existing)
  - “Open (Hybrid)” if Companion available
  - “Open (Local)” if Companion available
- Make sure Controller/Viewer open paths work under the selected mode.

### Failure Modes / How to handle
- Firestore unreachable (offline): show cached rooms if present; otherwise show empty state with “Connect Companion” + “Enter roomId” fallback.
- Companion unavailable: disable Local/Hybrid buttons and explain why.

### ✅ Acceptance Criteria
- [ ] Operator can build rooms while online and later open the same room in Hybrid/Local
- [ ] When internet drops, Hybrid continues via Companion without breaking the show

---



## Step 3.5: Seamless Switching + Dual Connections (Room Authority) + `SYNC_ROOM_STATE`

> **IMPORTANT: Implementation Status & Refactor Required**
>
> **Part 1/2 (Companion):** ✅ COMPLETE - `SYNC_ROOM_STATE` handler is implemented in `companion/src/main.ts:925-1018`
>
> **Part 2/2 (Frontend):** ⚠️ REQUIRES REFACTOR - The original approach using provider-swapping was found to cause the "heart-attack UX" it was meant to prevent.
>
> **See:** `docs/phase-1d-step3.5-refactor-plan.md` for the corrected implementation approach.
>
> **Key insight:** The spec says "run Firebase + Companion connections in parallel", but the initial implementation swapped providers entirely. The refactor introduces a **Unified Data Provider Architecture** where both connections remain active simultaneously.
>
> **Do not** attempt to implement Part 2/2 using the instructions below. Use the refactor plan instead.

### 🎯 Goal
Eliminate “heart-attack UX” when switching modes mid-show:
- Switching **Cloud ↔ Hybrid/Local** must **not** make timers disappear for the active room.
- When Companion is present, the room can be **Companion-authoritative** for live show state.
- When online, the app continuously **syncs best-effort to Firestore** so a backup device can recover.
- When switching Cloud → Hybrid/Local while a timer is running, the timer should **keep running smoothly** (no reset/pause).

This step introduces a dedicated WS event:
- **`SYNC_ROOM_STATE`**: client → Companion, explicit snapshot to keep continuity during switching and failover.

### 📄 Repo Prompt Files
```
docs/websocket-protocol.md
frontend/src/context/DataProvider.tsx
frontend/src/context/FirebaseDataContext.tsx
frontend/src/context/CompanionDataContext.tsx
frontend/src/routes/ControllerPage.tsx
frontend/src/routes/ViewerPage.tsx
companion/src/main.ts
```

### 🧾 Repo Prompt Token Budget (Important)
Repo Prompt free users typically have a ~30k token limit. This step **must be executed as two smaller prompts**:
- **Part 1/2**: Companion protocol (`SYNC_ROOM_STATE`)
- **Part 2/2**: Frontend seamless switching (uses `SYNC_ROOM_STATE`)

When using Repo Prompt, include **line ranges** and avoid attaching entire large files.

#### Step 3.5 — Part 1/2 (Companion): `SYNC_ROOM_STATE`/main.ts (WS handlers: JOIN_ROOM + timer CRUD + room state store helpers)
```

**Task Description:**
Add a new WS event: **`SYNC_ROOM_STATE`** (explicit continuity/failover snapshot).

**Execution Checklist:**
- Add payload validation for `SYNC_ROOM_STATE`:
  - `roomId: string`
  - `state: { activeTimerId, isRunning, currentTime, lastUpdate }`
  - `timers?: Timer[]` (optional but recommended for continuity)
  - `sourceClientId?: string`, `timestamp?: number`
- Enforce permissions:
  - Only `clientType=controller` may call `SYNC_ROOM_STATE`
  - Respect single-controller lock (no sync from viewers)
- Apply snapshot:
  - Update room state store from `state`
  - Upsert timers into timer store when provided
- Broadcast:
  - Ensure all room clients converge after sync
  - Emit `ROOM_STATE_SNAPSHOT` and/or `ROOM_STATE_DELTA` (implementation choice)
  - Emit `TIMER_CREATED/UPDATED/DELETED/TIMERS_REORDERED` as needed (implementation choice)
- Add error responses using existing `ERROR` / `TIMER_ERROR` patterns.

**Acceptance Criteria:**
- Switching Cloud → Local/Hybrid while a timer is running can be resumed by sending `SYNC_ROOM_STATE`.
- No breaking changes to existing `TIMER_ACTION` + timer CRUD events.

---

#### Step 3.5 — Part 2/2 (Frontend): Seamless switching v1

**Repo Prompt files (use line ranges):**
```
docs/phase-1d-implementation-guide.md (this Step 3.5 section only)
docs/websocket-protocol.md (Section 3.5 only)
frontend/src/context/DataProvider.tsx
frontend/src/context/FirebaseDataContext.tsx
frontend/src/context/CompanionDataContext.tsx
frontend/src/routes/ControllerPage.tsx
frontend/src/routes/ViewerPage.tsx
frontend/src/components/layout/AppShell.tsx
```

**Task Description:**
Use `SYNC_ROOM_STATE` to prevent timers/state from disappearing and to keep running timers continuous during Cloud ↔ Hybrid/Local switching.

**Execution Checklist:**
- When user switches Cloud → Hybrid/Local while in an active room:
  - Send `SYNC_ROOM_STATE` to Companion using the latest Cloud room/timers snapshot.
  - Join room and continue without pausing/resetting.
- UI stability:
  - If room is Companion-authoritative, do not replace the visible state immediately when user selects Cloud.
  - Show a banner: “Syncing to Cloud…” until Cloud has caught up.
- Fallback:
  - If Companion drops and Firestore is reachable, fall back to Cloud quickly and show “Degraded” banner.

**Acceptance Criteria:**
- Switching modes mid-show never makes timers disappear for the active room.
- A running timer continues smoothly when switching Cloud → Hybrid/Local.

### Execution Checklist
- Run Firebase + Companion connections **in parallel** (do not hard-swap the entire app’s source mid-show).
- Add a per-room “authority” state machine:
  - `source: cloud | companion`
  - `status: ready | syncing | degraded`
- If user selects Cloud while room is Companion-authoritative:
  - Keep showing the last Companion state
  - Show a persistent banner: “Syncing to Cloud…” until Cloud catches up
  - Provide a manual “Force Cloud now” escape hatch (for debugging / enterprise)
- Implement `SYNC_ROOM_STATE`:
  - Allows resuming a running timer when switching Cloud → Hybrid/Local
  - Allows a backup device to “push” a known-good snapshot to Companion
- On Companion drop:
  - If Firestore reachable: fallback to Cloud quickly (degraded banner)
  - If Firestore unreachable: freeze view + keep client-side ticking (view-only) until recovery

### ✅ Acceptance Criteria
- [ ] Switching Cloud ↔ Hybrid/Local never visually “drops” timers/state for the active room
- [ ] When online, Hybrid/Auto writes through to Firestore (best-effort) for backup recovery
- [ ] Cloud → Hybrid/Local switching while a timer is running keeps the timer running at correct elapsed time
- [ ] If Companion drops and Firestore is reachable, app falls back to Cloud within seconds

---

## Step 4: Companion Connect Modal/Panel (Not a Separate App)

### 🎯 Goal
Provide a consistent connection UX that matches the main app styling:
- Fetch token from `http://localhost:4001/api/token` (Origin allowlist)
- Paste token fallback
- Show connection/handshake status

This should be reachable from the header and Dashboard (not as a primary `/local` page).

### 📄 Repo Prompt Files
```
frontend/src/components/layout/AppShell.tsx
frontend/src/context/CompanionDataContext.tsx
frontend/src/routes/CompanionTestPage.tsx (as reference)
```

### Execution Checklist
- Build a modal/panel component in `frontend/src/components/core/`.
- Integrate with Companion provider:
  - call `subscribeToRoom(roomId, token, clientType)`
  - show connection + handshake statuses

### ✅ Acceptance Criteria
- [ ] No separate-looking “local app” flow required
- [ ] Operator can connect/disconnect Companion without leaving Dashboard

---

## Step 5: Offline Behavior + Noise Reduction (Hybrid)

### 🎯 Goal
When WAN drops, local ops must continue and the UI must remain calm.

### 📄 Repo Prompt Files
```
frontend/src/context/CompanionDataContext.tsx
docs/local-mode-plan.md (lines 56-70)
```

### Execution Checklist
- When `navigator.onLine === false`, skip Firestore write-through (no retry spam).
- Keep local WS actions immediate; queue only for later cloud sync.

### ✅ Acceptance Criteria
- [ ] Timers still sync via Companion with Wi‑Fi off
- [ ] Firestore retry noise is minimal (no wall of errors)

---

## Step 6: Default Templates (Now)

### 🎯 Goal
Add a small set of templates to quickly create common show setups (v2-only):
- Keynote
- Panel
- Service (example)

### 📄 Repo Prompt Files
```
frontend/src/routes/DashboardPage.tsx
frontend/src/types/index.ts
```

### Execution Checklist
- Add template definitions (timer sets, default thresholds).
- Hook templates into “Create room” flow.

### ✅ Acceptance Criteria
- [ ] Operator can create a new room from a template in 1 click
- [ ] Template-created rooms are v2-only (no legacy)

---

## Step 7: CI Packaging (Installers) + Windows .exe

### 🎯 Goal
Ship installers from CI:
- macOS: `.dmg`
- Windows: NSIS `.exe`
- Linux: `.AppImage`

### 📄 Repo Prompt Files
```
.github/workflows/companion-build.yml
companion/package.json
companion/scripts/fetch-ffprobe.js
docs/local-mode-plan.md (lines 65-70)
```

### Execution Checklist
- Ensure CI uses `npm ci` + `electron-builder --publish never`.
- ffprobe URLs overridable via GitHub repo variables:
  - `FFPROBE_URL_MAC`, `FFPROBE_URL_WIN`, `FFPROBE_URL_LINUX`
- Document validation steps for Windows `.exe` (artifact install + `/api/token` sanity).

### ✅ Acceptance Criteria
- [ ] Workflow artifacts contain `.dmg`, `.exe`, `.AppImage`
- [ ] Operator can download Windows artifact and run Companion (manual QA step)


