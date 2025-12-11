# StageTime Frontend Implementation Tasks (MVP1 + Mock Backend)

## 1. Project & Mock Backend Setup
1.1 Initialize Vite + React 18 + TypeScript project structure (if not already present) and configure Tailwind CSS (dark-first theme tokens, typography, custom colors for timer states).
1.2 Stand up Firebase client scaffolding but replace live calls with a mock data service (`src/mocks/mockFirestore.ts`) that mimics room + timers collections (in-memory and persisted via localStorage).
1.3 Create a context/provider (`MockDataProvider`) exposing room list, individual room sync state, and timer CRUD operations to simulate Firestore listeners (support subscribe/unsubscribe semantics).
1.4 Add utility helpers for server timestamps (`getMockServerTimestamp()`) and deterministic elapsed time math compatible with `useTimerEngine`.

## 2. Routing & Auth Shell
2.1 Implement `AppRouter` with routes `/`, `/dashboard`, `/room/:roomId/control`, `/room/:roomId/view`, wiring React Router DOM v6.
2.2 Build lightweight Auth context that simulates Firebase Auth (mock user object with `uid`, login/logout actions, promise-based initialization).
2.3 Implement `ProtectedRoute` component handling auth gating and owner checks using the mock user + room data.

## 3. Global Layout & Shared Components
3.1 Create application shell layout (header, dark background).
3.2 Build `ConnectionIndicator` component consuming mock connection state (toggle manually in mock provider).
3.3 Implement `FitText` utility component using ResizeObserver + CSS clamp.
3.4 Add `ShareLinkButton`, `CopyButton`, and other utility components referenced by multiple views.

## 4. Landing Page (`/`)
4.1 Layout marketing hero, login/signup CTA buttons, and "Create Room" CTA wired to mock auth flow.
4.2 Hook CTA so unauthenticated users trigger mock login modal, authenticated ones redirect to `/dashboard#create`.

## 5. Dashboard (`/dashboard`)
5.1 Implement Firestore-mock query for rooms owned by current user.
5.2 Build room cards showing title, timezone, created date, and actions (open controller, delete).
5.3 Implement `CreateRoomDialog` modal with form validation; upon submit, call mock backend to create room with default timers/config.
5.4 Add delete confirmation flow with mock API removal and optimistic UI updates.

## 6. Controller View (`/room/:roomId/control`)
6.1 Compose top-level layout (TopBar, RundownPanel, TimerPanel, MessagePanel) using CSS grid responsive rules.
6.2 **Top Bar:** implement room metadata display, viewer link copy, connection indicator, timezone display.
6.3 **RundownPanel:** fetch timers from mock subcollection, render draggable list (use dnd-kit or custom), support reorder/write order values in batch, add CRUD modals.
6.4 **TimerPanel & TransportControls:** implement `useTimerEngine` hook (millisecond contract) using mock room sync fields; wire start/pause/reset/nudge handlers to mock backend updates (ensure batched updates for `activeTimerId` + `startedAt`).
6.5 **MessagePanel:** implement preset buttons, custom text input, color selector, and `visible` toggle writing to mock room `message` map.
6.6 Surface validation/error states (e.g., when user attempts to access room they don’t own).

## 7. Viewer View (`/room/:roomId/view`)
7.1 Subscribe to room sync mock data (read-only) and reuse `useTimerEngine` for countdown display.
7.2 Implement full-screen layout with FitText, message overlay, and color state backgrounds (default/warning/critical/overtime).
7.3 Integrate wake-lock behavior using Screen Wake Lock API polyfill + fallback banner when unavailable.
7.4 Display connection indicator (offline/reconnecting state from mock provider) and standby state when no `activeTimerId`.

## 8. Mock Data Enhancements
8.1 Seed sample room + timers for demo mode (JSON fixtures).
8.2 Add dev-only controls to tweak mock latency, force offline state, and inspect stored documents.
8.3 Ensure mock services expose async APIs to mimic Firestore behavior (Promises with artificial delay).

## 9. Styling & Theming
9.1 Configure Tailwind theme extension for StageTime palette (greens/yellows/reds, slate neutrals).
9.2 Implement global dark theme styles (body background, font).
9.3 Add utility classes for flashing overtime state, message color chips, and accessible focus outlines.

## 10. Documentation & Handoff
10.1 Update README/docs to explain mock backend usage, dev commands, and feature coverage.
10.2 Document `useTimerEngine` API, mock data service contract, and routing structure for future integration with real Firebase backend.