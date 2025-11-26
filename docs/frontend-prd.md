# StageTime Frontend PRD (MVP1)

## 1. Scope & Goals
StageTime MVP1 delivers a real-time event timer platform with a controller interface and public viewer display. This document governs the React 18 + Vite + TypeScript + Tailwind CSS frontend, using React Router DOM v6+, date-fns/date-fns-tz for time logic, and lucide-react for icons. Objectives:
- Enable owners to manage rooms, timers, and messaging.
- Provide public viewer URLs with zero auth friction.
- Maintain deterministic time displays via the backend `startedAt`/`elapsedOffset` semantics.
- Default to dark mode and include wake-lock + offline indicators for control rooms.

## 2. Personas & Journeys
- **Visitor (Unauthenticated):** Lands on `/`, sees marketing copy and CTA buttons. Selecting "Create Room" or login routes to Firebase Auth UI. Viewer links remain accessible.
- **Owner / Controller (Authenticated):** After login, redirected to `/dashboard` where they can create/delete rooms and open the controller (`/room/:roomId/control`). Requires `ownerId` match to proceed.
- **Public Viewer:** Accesses `/room/:roomId/view` without auth. Viewer page subscribes to the same `rooms/{roomId}` document for sync state and renders the active timer plus optional message overlay.

## 3. Routes & Views
### `/` (Landing / Marketing)
- Public page promoting StageTime; includes login/signup buttons (Firebase Auth UI) and "Create Room" CTA that redirects unauthenticated users to auth flow.
- Minimal data dependencies; only needs Firebase Auth context for CTA logic.

### `/dashboard` (Protected)
- Guarded by Firebase Auth. Lists rooms owned by the user (Firestore query `rooms` where `ownerId == uid`).
- UI includes "Create Room" button (modal or inline form), room cards with delete action, and navigation to controller.
- Error handling: if auth revokes mid-session, redirect to login.

### `/room/:roomId/control` (Protected Owner View)
- Requires authentication and ownership check. Layout:
  - **Top Bar:** Room title, timezone, shareable viewer link copy button, connection indicator (Firestore listener state), and quick auth menu.
  - **Left Panel — Rundown:** Draggable list of timer segments pulled from `/rooms/{roomId}/timers` ordered by `order`. Supports reorder, create, edit, delete.
  - **Center Panel — Active Timer:** Large countdown with `FitText`, transport controls (Start/Pause/Reset), duration adjustments (+/- 1m) using `useTimerEngine`, and color states (green/yellow/red/flashing).
  - **Right Panel — Messaging:** Preset message buttons, custom text field, visibility toggle ("Flash"), and color selector.
- Writes to room document fields (`activeTimerId`, `isRunning`, `startedAt`, `elapsedOffset`, `progress`, `showClock`, `message.*`).

### `/room/:roomId/view` (Public Viewer)
- No auth required (confirmed decision). Full-screen minimalist display defaulting to dark theme.
- Subscribes to `/rooms/{roomId}` for sync fields; uses `useTimerEngine` to compute remaining time locally.
- Implements wake-lock (Screen Wake Lock API or fallback library) to prevent sleep. Includes connection indicator and overlay message display when `message.visible` true.
- Auto scales typography to occupy 80–90% of viewport using `<FitText />`.

## 4. Component & Hook Inventory
| Component / Hook | Responsibility | Key Props / Inputs | Outputs / Notes |
| --- | --- | --- | --- |
| `AppRouter` | Defines routes and guards | Firebase auth user, loading state | Redirects unauthenticated users from protected paths |
| `ProtectedRoute` | Wrapper enforcing auth & owner check | `requiredOwnerId?: string` | Redirect path or renders children |
| `TopBar` | Displays room metadata, share link, indicators | `title`, `roomId`, `timezone`, `isOnline` | Emits `onShareLink()` |
| `ConnectionIndicator` | Shows Firestore connection health | `status: 'online' \| 'offline' \| 'reconnecting'` | Visual cues; used in controller + viewer |
| `RundownPanel` | Lists timers, handles CRUD & drag-sort | `roomId`, `timers`, `activeTimerId` | `onSelect(timerId)`, `onReorder(nextOrder)` |
| `TimerSegmentItem` | Single timer row | `timer`, `isActive` | `onEdit`, `onDelete` |
| `TimerPanel` | Active timer display + controls | `timer`, `timerEngineState` | `onStart`, `onPause`, `onReset`, `onNudge(deltaMs)` |
| `TransportControls` | Start/Stop/Reset & nudge buttons | `isRunning`, handlers | Disables buttons per state |
| `MessagePanel` | Quick message presets & custom text | `message`, `colorOptions` | `onSubmit(text,color,visible)` |
| `PresetMessageButton` | Reusable preset chip | `label`, `color` | `onApply()` |
| `FitText` | Scales child text to viewport width | `maxWidthRatio` (default 0.9) | Uses ResizeObserver/window resize |
| `ViewerDisplay` | Viewer layout | Active timer data, message, status | Overlays color state background |
| `CreateRoomDialog` | Modal form for new room | `isOpen`, `onCreate(payload)` | Validates title/timezone |
| `useTimerEngine` | Calculates remaining time deterministically | `startedAt: number \| null`, `elapsedOffset: number`, `isRunning: boolean`, `durationSec: number` | `{ remainingMs, status: 'default' \| 'warning' \| 'critical' \| 'overtime' }` computed via backend timestamps |

## 5. State Management & Data Flow
- **Firestore Subscriptions:** Controller subscribes to `rooms/{roomId}` (sync fields) and `/rooms/{roomId}/timers` (ordered by `order`). Viewer subscribes to room doc only.
- **Pause Flow:** Controller computes current elapsed, writes `elapsedOffset = currentElapsed`, `isRunning = false`, `startedAt = null`. It must also update the `progress` map for the active timer to persist state when switching.
- **Hook Contract:** `useTimerEngine` always accepts and outputs millisecond values; any Firestore durations stored in seconds must be multiplied by 1000 prior to invoking the hook to avoid accelerated countdowns.
- **Drag & Drop Rundown:** On reorder, update each timer doc `order` atomically (batch write). Maintain either dense integer order (1,2,3) or spaced increments (10,20,30) so new segments can insert without full reindexing. UI should optimistically reorder but handle conflicts.
- **Messaging:** `message` map updates (text, color, visible). Viewer listens and overlays accordingly.
- **Auth State:** Use Firebase Auth SDK listener. Until resolved, show loading spinner to avoid flicker.

## 6. Styling & UX
- **Dark Mode Default:** Tailwind config uses dark palette (e.g., `bg-slate-950`, `text-slate-100`). Provide accessible contrasts.
- **Color States:**
  - Default (Green): Remaining time > `config.warningSec`.
  - Warning (Yellow): `remainingSec <= config.warningSec` (default 120s).
  - Critical (Red): `remainingSec <= config.criticalSec` (default 30s).
  - Overtime: `remainingMs < 0`, flashing red background and negative time display.
- **Typography Scaling:** `FitText` ensures timer digits occupy 80–90% of width; fallback to CSS clamp.
- **Responsive Layout:** Controller uses 3-column grid on ≥1024px; collapses to stacked panels on mobile while preserving functionality.
- **Iconography:** lucide-react icons for buttons (play/pause/reset/share).
- **Wake Lock:** Viewer requests screen wake lock on mount; if unsupported or rejected, display an inline banner advising the operator to disable auto-lock manually (include actionable copy).
- **No-Sleep & Focus:** Keep animations minimal to reduce distraction in control rooms.

## 7. Routing & Auth Guards
- React Router DOM v6 with nested layout.
- `ProtectedRoute` checks `user` from Firebase Auth context. If missing, redirect to login page (Firebase UI or custom). For controller route, additionally verify `room.ownerId === user.uid`; otherwise show "Access denied" and redirect to `/dashboard`.
- Landing CTA "Create Room" triggers `if user ? navigate('/dashboard#create') : authUI.open()`.

## 8. Performance & Resilience
- `useTimerEngine` uses `requestAnimationFrame` to update UI every frame while `isRunning`; falls back to `setInterval` ≥16ms if RAF unavailable.
- `ConnectionIndicator` listens to Firestore snapshot errors and `navigator.onLine` to display "Offline - Reconnecting..." state.
- Avoid unnecessary re-renders by memoizing Firestore data transforms.
- Ensure viewer gracefully handles missing `activeTimerId` (display "Standby" message).

## 9. Cross-References
- Backend PRD §2 (Data Model) defines Firestore fields consumed here.
- Backend PRD §4 (Timer Synchronization Algorithm) underpins `useTimerEngine`.
- Security behavior described in Backend PRD §6 informs auth guard logic.

## 10. Open Questions & Assumptions
- **Public Viewer:** Remains unrestricted; any user with link can access `/room/:roomId/view`.
- **Room Limits:** TBD maximum rooms per user (assume limited by UI only for MVP).
- **Preset Messages:** Initial set (e.g., "Wrap Up", "Applause", "Standby") to be finalized with stakeholders.
- **Timer Types:** UI currently focuses on countdown; countup/time-of-day support will follow same schema but may need specialized controls.

This PRD should be reviewed alongside `docs/backend-prd.md` to ensure end-to-end consistency across the StageTime MVP1 stack.