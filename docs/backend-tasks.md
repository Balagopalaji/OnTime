# StageTime Backend Integration Tasks (Firebase)

## 1. Project & SDK Setup
- [x] Create/confirm Firebase project in Console (Firestore in production mode, Authentication enabled, Hosting if used).
- [x] Add web app credentials and capture config values for Vite.
- [x] Add `.env.local` with Vite-prefixed keys: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`.
- [x] Add `src/lib/firebase.ts` initializing Firebase App, Auth, and Firestore using the v9 modular SDK.
- [x] Optionally add Firebase Emulator config for local dev (auth + Firestore) and guard via `VITE_USE_FIREBASE_EMULATOR`.
  - Feature flags: `VITE_USE_MOCK` (default `true`) keeps the mock provider live; set `VITE_USE_MOCK=false` to use Firebase. Optional `VITE_FIREBASE_FALLBACK_TO_MOCK=true` will drop back to the mock provider if Firebase wiring is incomplete.

## 2. Feature Flag Provider Swap
- [x] Introduce `VITE_USE_MOCK` boolean (default `true` until backend is verified) to toggle data providers.
- [x] Implement `useFirebaseProvider` (or `FirebaseProvider` component) mirroring `MockDataProvider` interface for room/timer data and operations.
- [x] Update root composition so provider selection is conditional on `VITE_USE_MOCK`; ensure no runtime breakage when toggling.
- [x] Keep mock provider available for tests/demo; document toggle behavior in README.

## 3. Data Layer Implementation (Hooks & Core Operations)
- [ ] Implement `useRoom(roomId)` hook using Firestore `onSnapshot` on `/rooms/{roomId}`; map `Timestamp` to millis where needed.
- [ ] Implement `useTimers(roomId)` hook using Firestore `onSnapshot` on `/rooms/{roomId}/timers` ordered by `order`.
- [x] Implement create room operation: authenticated user writes `rooms` doc with `ownerId`, `title`, `timezone`, defaults (`config.warningSec`, `config.criticalSec`, sync fields), `createdAt = serverTimestamp()`.
- [x] Implement timer CRUD operations on `/timers` subcollection with batch writes for reorder; enforce unique `order` values (dense or spaced increments).
- [x] Implement start timer flow per PRD §4: batch update `activeTimerId`, `isRunning = true`, `startedAt = serverTimestamp()`, preserve `elapsedOffset`.
- [x] Implement pause flow: compute `elapsedOffset = (Date.now() - startedAt.toMillis()) + elapsedOffset`, write `isRunning = false`, `startedAt = null`, and update `progress[activeTimerId]`.
- [x] Implement resume flow: reuse stored `elapsedOffset`, set `isRunning = true`, `startedAt = serverTimestamp()`.
- [x] Implement reset flow: set `elapsedOffset = 0`, `isRunning = false`, `startedAt = null`, and clear relevant `progress` entry.
- [x] Implement switch timer flow: persist current `elapsedOffset` to `progress[oldTimerId]`, load `progress[newTimerId]` (default 0) into `elapsedOffset`, set `activeTimerId = newTimerId` in the same batch.
- [x] Ensure `useTimerEngine` consumers convert Firestore `duration` (seconds) to milliseconds before calculations; use `startedAt?.toMillis()` in math.

## 4. Auth & Security
- [x] Implement Auth context with Firebase Auth v9 (Google Sign-In + Anonymous auth). Provide `loginWithGoogle`, `loginAnonymously`, `logout`, and auth state listener.
- [ ] Wire `ProtectedRoute` to Firebase Auth state and owner checks using `room.ownerId`.
- [ ] Add `firestore.rules` matching backend PRD (public read, owner-only writes on rooms/timers, auth required for create).
  - *Current status: Read requires auth, needs update to public read.*
- [ ] Add rules deployment step (`firebase deploy --only firestore:rules`) and emulator config for local validation.

## 5. Cleanup & Stabilization
- [ ] Verify end-to-end flows with `VITE_USE_MOCK=false`: dashboard list, create room, controller start/pause/reset, viewer sync, messaging overlay.
- [x] Keep mock provider for tests/demo; ensure test suites target mock by default.
- [ ] Update docs/README with provider toggle instructions and required env vars.
- [ ] Remove or gate any unused mock-only UI controls when running with Firebase provider.

## 6. Validation & QA
- [ ] Manual QA: timer drift check (controller vs viewer) over several minutes; confirm color thresholds and overtime behavior.
- [ ] Auth QA: owner-only access to `/room/:roomId/control`, public access to `/room/:roomId/view`.
- [ ] Offline/connection indicator QA: simulate network loss; verify reconnect messaging.
- [ ] Deploy rules and run Firebase Emulator Suite tests (if configured) to confirm security parity with PRD.

Cross-reference: backend-prd.md (schema, sync algorithm, rules) and frontend-prd.md (consumer expectations, duration conversion, batching requirements).
