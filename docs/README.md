# StageTime Documentation

Welcome to the StageTime documentation.

## Core Documentation
- [Frontend PRD](frontend-prd.md) - Product Requirements for the Frontend.
- [Backend PRD](backend-prd.md) - Product Requirements for the Backend (Firebase).
- [Backend Tasks](backend-tasks.md) - Checklist of backend integration tasks.

## Guides & Features
- [Offline/Local Mode](offline-local-mode.md) - Planning and guide for offline and local-first capabilities.
- [Drag & Drop Tasklist](drag-drop-tasklist.md) - Details on the drag and drop implementation.
- [Delete/Undo Tasklist](delete-undo-tasklist.md) - Details on delete and undo functionality.

## Task Tracking
- [General Tasks](tasks.md) - General project task tracking.

## Environment & Toggles
- `VITE_USE_MOCK`: set to `false` for Firebase (production path). Keep `true` only for legacy demos/tests with the mock provider.
- `VITE_FIREBASE_FALLBACK_TO_MOCK`: set to `false` in production; `true` only if you want an automatic mock fallback when Firebase config is missing.
- `VITE_USE_FIREBASE_EMULATOR`: `true` to point at local emulators (Auth + Firestore); `false` for real Firebase.
- Required Firebase env vars (in `.env.local`): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.

## Manual QA Checklist (Firebase, no mock)
- Room CRUD/list: sign in, create a room, verify it lists/sorts correctly; delete/undo if available.
- Controller flows: start/pause/resume/reset/nudge timers; switch active timer and confirm progress persists; toggle message text/color/visibility.
- Viewer (unauthenticated): open `/room/:id/view` in a logged-out browser; verify live sync during controller actions and overtime handling; toggle showClock if exposed.
- Drift check: let controller + viewer run for a few minutes; confirm no noticeable drift.
- Auth gating: signed-out users are redirected from `/dashboard` and `/room/:id/control`; viewer stays public.
- Connection/offline: simulate network loss; ensure connection indicator shows offline/reconnect and recovers.
- Rules sanity (if using emulator): public reads succeed; non-owner writes fail; owner writes succeed.
