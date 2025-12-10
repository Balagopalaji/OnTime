# Backend Alignment Plan (Viewer/Public Access)

Goal: Align data layer, viewer, and Firestore rules with PRDs — public viewer access, room-scoped subscriptions, owner-only writes, updated docs/tasks — while keeping the data API flexible for future offline/companion transport.

Context Files
- frontend/src/context/FirebaseDataContext.tsx (current Firestore listeners gated by user; getRoom/getTimers)
- frontend/src/context/DataProvider.tsx, DataContext.tsx (provider API), AuthContext.tsx (auth flags), main.tsx (provider wiring)
- frontend/src/routes/ViewerPage.tsx, ProtectedRoute.tsx, AppRouter.tsx (routing/gates)
- frontend/src/hooks/ (no useRoom/useTimers yet)
- firebase/firestore.rules (reads require auth)
- docs/backend-prd.md §6 and docs/frontend-prd.md (public viewer requirement)
- docs/backend-tasks.md (unchecked useRoom/useTimers, rules update note)

Tasks
1) Add room-scoped hooks
- Files: frontend/src/hooks/useRoom.ts, frontend/src/hooks/useTimers.ts (new). Reuse toMillis helper if needed.
- Behavior: onSnapshot /rooms/{roomId} and /rooms/{roomId}/timers (order by order). Map Timestamp -> ms; keep duration in seconds but ensure consumers know to convert to ms for useTimerEngine. Return {data, loading, error, connectionStatus}. No subscription when roomId is falsy. Cleanup on unmount.

2) Allow unauthenticated reads in FirebaseDataContext
- Files: frontend/src/context/FirebaseDataContext.tsx, DataContext.tsx, DataProvider.tsx (maybe main/AuthContext for flag awareness).
- Behavior: split owner mode (auth, full owned list for dashboard/controller) vs viewer mode (no auth, no global list). Viewer mode should not subscribe to all rooms; rely on new hooks or a lightweight proxy per room. Keep writes/undo stacks owner-only and guarded by user; surface errors if called without auth. Ensure connectionStatus updates in unauthenticated read path. Pending placeholders stay owner-only.

3) Wire viewer to hooks
- Files: frontend/src/routes/ViewerPage.tsx, ProtectedRoute.tsx (owner check remains on owned list), AppRouter.tsx (route stays public).
- Replace getRoom/getTimers usage with useRoom/useTimers. Handle loading/empty/error states; pass hook connection status to ConnectionIndicator. Timer selection stays based on hook data. Do not alter wake lock/fullscreen.

4) Update Firestore rules per PRD
- File: firebase/firestore.rules.
- Public read on rooms/timers. Writes owner-only: create requires auth and ownerId == request.auth.uid; updates/deletes only if resource.data.ownerId == request.auth.uid; prevent ownerId changes. Timers writes must check parent room owner via get(/rooms/{roomId}). Consider validating required fields (title, order, duration > 0, etc.).

5) Docs and tasks sync
- Files: docs/backend-tasks.md (mark items after implementation), docs/README.md or project README (env flags, public-read requirement, toggle instructions), optionally docs/frontend-prd.md note about hook usage.
- Call out VITE_USE_MOCK, VITE_FIREBASE_FALLBACK_TO_MOCK, emulator flags; viewer works anonymously when VITE_USE_MOCK=false.

6) Validation
- Commands: cd frontend && npm run lint && npm run test.
- Manual QA with VITE_USE_MOCK=false: anonymous viewer loads /room/:roomId/view and receives live data; authenticated owner can list/control; viewer still works when signed out. Check ConnectionIndicator in unauthenticated mode. Verify rules in emulator/console: public reads succeed, writes blocked for non-owners.

Acceptance Criteria
- Room/timer data readable without auth via new hooks; viewer renders live updates anonymously.
- Owner flows still list/mutate only the signed-in user’s rooms/timers; ProtectedRoute owner check unchanged.
- Firestore rules allow public reads, enforce owner-only writes, and forbid ownerId changes.
- Docs/backend-tasks reflect completed hooks/rules; docs mention public-read requirement and feature flags.
- No regressions to undo stacks, controller actions, or mock provider behavior.
- Data surface remains transport-agnostic so a future LAN companion/local-first path can plug in without refactors (room-scoped subscriptions, clear read-only viewer mode, owner-only write/undo paths).
