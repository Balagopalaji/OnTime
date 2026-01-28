# Phase 3 Troubleshooting Log

## Scope
This log captures observed issues, evidence, and hypotheses during Phase 3C troubleshooting.

## Environment
- Controller URL used during issues: `http://localhost:5173/room/<roomId>/control`
- Companion endpoints observed:
  - ws: `ws://127.0.0.1:4000`
  - http token: `http://127.0.0.1:4001/api/token`
  - https token: `https://127.0.0.1:4441/api/token`
- Companion mode: Production / Show Control (via Companion UI)
- Cloud available in some cases, Wi-Fi disabled in others

## Problem 1: Companion token expiry + refresh failure
### Symptoms
- Companion logs show repeated `TokenExpiredError: jwt expired` with `expiredAt` timestamps.
- Controller continues to attempt reconnects but does not refresh token.
- Frontend eventually builds invalid WS URL (`ws://localhost:undefined?...`) when token fetch fails.

### Evidence
- Companion log: `TokenExpiredError: jwt expired` in `verifyTokenPayload` with repeated invalid token disconnects.
- Frontend console: repeated `Failed to load resource ... /api/token` with `ERR_CONNECTION_REFUSED` or `ERR_INTERNET_DISCONNECTED` when Companion endpoint unavailable.

### Hypotheses
- Token refresh is not triggered on expiry in local/auto modes.
- Token fetch is blocked/failed (endpoint unreachable or UI not retrying).
- UI state remains "connected" even when Companion auth fails.

### Ruled out
- Companion not listening: headers confirm endpoints are listening on 127.0.0.1.

## Problem 2: Force takeover / reclaim fails when Companion + Cloud both available
### Symptoms
- Force takeover emits `FORCE_TAKEOVER` but returns `PERMISSION_DENIED` with message "Room controller is active on another device."
- Companion logs show no takeover event when the error occurs.

### Evidence
- DevTools WS messages show `FORCE_TAKEOVER` followed by `ERROR: PERMISSION_DENIED`.
- Companion logs show only `JOIN_ROOM` and `ROOM_STATE_SNAPSHOT`, no takeover handler logs.
- When Companion is turned off (cloud-only), takeover works.

### Hypotheses
- Takeover request is routed to Cloud while Companion holds lock.
- Local/auto arbitration does not align with lock authority.
- UI remains connected to Companion socket but control requests go to Cloud after token expiry.

## Problem 3: Companion mode fails to load when Wi-Fi off
### Symptoms
- Controller shows "Loading room..." with Wi-Fi off in local/auto modes.
- Console shows Cloud Firestore errors (`ERR_INTERNET_DISCONNECTED`) alongside Companion WS connection errors.

### Evidence
- Console indicates Firestore listen channel errors and socket connection failures.
- In some runs, opening `http://127.0.0.1:4001/api/token` succeeded while UI still stalled.

### Hypotheses
- UI still waits on Cloud state even when local is selected.
- Companion WS connection retries fail due to stale token or refresh path.

## Problem 4: Cloud Online indicator stays on with Wi-Fi off
### Symptoms
- Cloud Online badge stays on after Wi-Fi disabled.
- Cloud Firestore requests log `ERR_INTERNET_DISCONNECTED`.

### Hypotheses
- UI uses `navigator.onLine` or cached auth state instead of Firestore connection status.
- Cloud status not updated on refresh when network drops.

## Supporting observations
- Companion socket observed at `ws://localhost:4000/socket.io/?EIO=4&transport=websocket`.
- Companion logs show multiple `JOIN_ROOM` accepted in quick succession.
- Companion token expires after ~30 minutes (`exp` claim in JWT).

## Next investigation targets
- `frontend/src/context/CompanionConnectionContext.tsx` for token refresh + connected state logic.
- `frontend/src/context/UnifiedDataContext.tsx` for authority routing between Companion/Cloud.
- Companion takeover handlers in `companion/src/main.ts` for auth gating and lock ownership logic.

## Fixes applied (branch: troubleshooting)
### Companion takeover
- Split controller checks so `REQUEST_CONTROL`/`FORCE_TAKEOVER` only require a controller client; lock ownership is enforced elsewhere.
- Result: takeover no longer blocked by "Room controller is active on another device" when using PIN/reauth/timeout.

### Companion token expiry loop
- Preserve `INVALID_TOKEN`/`TOKEN_MISSING` across disconnects.
- Trigger token refresh on invalid token handshake.
- Result: UI now prompts to refresh token and reconnects cleanly after expiry.

### Cloud Online indicator
- Use Firestore `snapshot.metadata.fromCache` to drive online/offline status.
- Result: Cloud indicator reflects offline state when Firestore serves cached data.

## Verification
- Frontend lint/test: `npm --prefix frontend run lint` + `npm --prefix frontend run test` (pass).
- Manual smoke: takeover works in local/auto; token expiry shows refresh banner; cloud indicator updates when offline.

## Additional issues observed (not yet resolved)
- Force takeover still returns `PERMISSION_DENIED` when Companion is off; likely PIN not synced to Firestore or policy requires owner-only PIN writes. (Refs: `docs/interface.md`, `docs/client-prd.md`, `docs/local-server-prd.md`)
- Handover list empties after a few minutes when other tabs are backgrounded; presence heartbeats stop when tabs are hidden, and TTL filters remove clients. (Refs: `docs/phase-2-tasklist.md`, `docs/local-mode.md`)
- Controllers sometimes lose authoritative state after mode changes (cloud/local/auto transitions). (Refs: `docs/local-mode.md`, `docs/edge-cases.md`)
- Control buttons sometimes require multiple clicks after takeover (possible lock/authority sync lag). (Refs: `docs/local-mode.md`, `docs/edge-cases.md`)
- Clicking a timer control does not select that segment; selection only updates on background click. (Refs: `docs/client-prd.md`)
- Brief “cloud reconnecting” banner when switching apps/tabs (visibility resubscribe flicker). (Refs: `docs/local-mode.md`, `docs/edge-cases.md`)
- Companion does not always recognize show_control rooms. (Refs: `docs/local-server-prd.md`, `docs/client-prd.md`)
- Mixed cloud/companion list shows odd source mapping (e.g., Brave shown as cloud, Chrome as companion) despite parallel sync. (Refs: `docs/local-mode.md`, `docs/phase-2-tasklist.md`)

## Phase 2 / Spec Context (for handover + takeover)
- Phase 2 Milestone 5 is documented as complete (cloud lock enforcement + PIN + takeover UX).
- Milestone 5 follow-up lists cloud presence (`rooms/{roomId}/clients/*`) + heartbeat + UI handover targets as implemented.
- Room PIN policy: `rooms/{roomId}/config/pin`, owner-only writes; required for immediate cloud force takeover unless stale (>90s).
- Parallel sync requires dual-write: if Companion has a newer PIN and cloud is reachable, it should write to cloud; if cloud newer, Companion should adopt it.
- References: `docs/phase-2-tasklist.md`, `docs/interface.md`, `docs/local-mode.md`, `docs/local-server-prd.md`, `docs/client-prd.md`, `docs/local-offline-lan-plan.md`, `docs/edge-cases.md`.

## Recent manual tests & outcomes (Jan 2026)
### Cloud/Companion status + banners
- With Wi-Fi off: Cloud badge switches to offline; banner shows “Cloud sync is down… Companion is not connected.”
- With Wi-Fi restored: Cloud badge sometimes stuck on “reconnecting” until a control action is taken.
- Change applied: periodic resubscribe when cloud status is reconnecting; still observed “double-jump” reconnect behavior.
  (Refs: `docs/local-mode.md`, `docs/edge-cases.md`)

### Token expiry
- Companion token expiry still causes repeated `TokenExpiredError` in logs.
- Auto-refresh added (refresh 60s before exp), but intermittent disconnect loops still observed around expiry.
  (Refs: `docs/local-mode.md`, `docs/phase-2-tasklist.md`)

### Handover list (clients)
- List shows only Companion clients when Companion is on; only cloud clients when Companion is off.
- Clients disappear after a short time unless refreshed (likely heartbeat stops when tab backgrounded).
- List does not show both sources simultaneously, despite spec indicating cloud presence + companion presence should coexist.
  (Refs: `docs/phase-2-tasklist.md`, `docs/local-mode.md`)

### Force takeover (cloud)
- When Companion is off, force takeover via cloud returns `PERMISSION_DENIED`.
- Network shows successful POST to `forceTakeover` but response `{ success: false, error: "PERMISSION_DENIED" }`.
- Likely cause: cloud PIN missing (owner-only writes) or lock policy mismatch; not yet verified.
  (Refs: `docs/interface.md`, `docs/client-prd.md`, `docs/local-server-prd.md`)

### Handover button behavior
- Handover UI returns “No other controllers connected” after a short period unless other controllers refresh.
- Older behavior: list stayed populated; regression suspected.
  (Refs: `docs/phase-2-tasklist.md`)

### Authority loss after mode changes
- Controllers sometimes lose authoritative state after switching auto/local/cloud.
- Requires multiple clicks on controls after takeover; segment selection does not update when pressing control buttons.
  (Refs: `docs/local-mode.md`, `docs/edge-cases.md`, `docs/client-prd.md`)

## Recent code changes applied in troubleshooting branch (summary)
### Companion
- Added `lastHeartbeat` to room client entries and emit `ROOM_CLIENTS_STATE` on heartbeat (throttled).

### Frontend
- Added token refresh scheduling before expiry; preserve INVALID_TOKEN/TOKEN_MISSING across disconnects.
- Adjusted cloud status: fromCache + navigator.onLine, emit `ontime:cloud-status`.
- Auto mode fallback now requires cloudStatus === `online`.
- Added skeleton room for local+companion to break “Loading room…” deadlock.
- Handover button always visible; added source label in list (Companion vs Cloud).
- Presence list now uses idle + maxAge (cloud 5m/15m, companion 5m/15m).
- Handover list merges cloud+companion rows and filters to controllers only.
- Selection now follows control actions for non-active timers.

## Open investigations (next actions)
- Add PIN sync on connect: if owner + cloud online + cloud PIN missing + local/companion PIN exists, write once.
- Verify cloud presence heartbeat writer; ensure background tabs are marked idle (no background heartbeat).
- Confirm force takeover uses PIN/reauth correctly in cloud mode after PIN sync.
- Add token refresh on `visibilitychange` to prevent post-idle reconnect churn.
  (Refs: `docs/phase-2-tasklist.md`, `docs/interface.md`, `docs/local-mode.md`, `docs/local-server-prd.md`)

## Execution Checklist With Find-And-Edit Anchors (Implementation-only)
### 0) Verification Before Code Changes (Mandatory)
- [ ] Firestore PIN exists:
  - [ ] Check `rooms/{roomId}/config/pin` exists and has `value` set.
- [ ] Frontend payload sends PIN:
  - [ ] Use DevTools Network > `forceTakeover` request body includes `{ pin }` or `{ reauthenticated: true }`.

### 1) PIN Sync + Cloud Takeover (Blocking)
**Files**
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- [ ] `/Users/radhabalagopala/Dev/OnTime/functions/src/index.ts`
- [ ] `/Users/radhabalagopala/Dev/OnTime/functions/src/operators.ts` (if helpers live here)

**Guardrails**
- [ ] Owner-only writes to `rooms/{roomId}/config/pin` (no lock routing changes).
- [ ] Only attempt cloud sync when `firebase.connectionStatus === 'online'`.
- [ ] Do not overwrite existing cloud PIN.
- [ ] No timer math or lock semantics changes.

**Find-and-edit anchors**
- [x] `const setRoomPin = useCallback(`
  - [x] Confirm owner-only PIN writes go to `rooms/{roomId}/config/pin`.
  - [x] Ensure companion + cloud dual-write path writes to Firestore only when owner and cloud reachable.
- [ ] Add on-connect PIN sync (owner + cloud online + pin missing in cloud + local pin exists).
  - [ ] Anchor (room pin subscription effect): `useEffect(() => {` near `roomPinSubscriptionsRef.current` usage.
  - [ ] Anchor (room/client state refs): `const roomPins = useState<Record<string, string | null>>({})`
  - [ ] Anchor (firebase status): `firebase.connectionStatus`
  - [ ] Read once: `getDoc(doc(firestore, 'rooms', roomId, 'config', 'pin'))`
  - [ ] Write once: `setDoc(doc(firestore, 'rooms', roomId, 'config', 'pin'), { value, updatedAt, updatedBy }, { merge: true })`
  - [ ] Track per-room sync attempt (in-memory `Set` or `Ref`) to retry once after reconnect.
- [ ] `const forceTakeover = useCallback(`
  - [ ] Verify cloud call includes `{ pin, reauthenticated }`.
- [ ] In functions: `forceTakeover` handler in `functions/src/index.ts`
  - [ ] Verify it accepts `{ pin, reauthenticated }` and checks PIN against `rooms/{roomId}/config/pin`.

**Verification before code changes**
- [ ] Firestore: confirm `rooms/{roomId}/config/pin` exists and includes `value`.
- [ ] Network: confirm `forceTakeover` payload includes `{ pin }` or `{ reauthenticated: true }`.
- [ ] Ownership: confirm `room.ownerId === user.uid` when attempting cloud PIN sync.

**Outcome check**
- [ ] Cloud PIN appears after reconnect when local PIN exists.
- [ ] Cloud takeover succeeds when PIN exists and is provided.

### 2) Presence List Reliability — Idle Label + MaxAge (No Background Heartbeat)
**Files**
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/ControllerPage.tsx`
- [ ] `/Users/radhabalagopala/Dev/OnTime/companion/src/main.ts` (only if payload fields need alignment)

**Find-and-edit anchors**
- [x] `const ROOM_CLIENT_STALE_MS = 90_000`
  - [x] Replaced with TTL + maxAge strategy and per-source thresholds.
- [x] `const mergeControllerClients = (`
  - [x] Keep clients through maxAge instead of dropping at TTL.
- [x] `const activeRoomClients = useMemo(() => {`
  - [x] Filter uses maxAge and presence state (Idle label in UI).
- [ ] `sendPresence` in cloud presence effect:
  - [ ] Confirm `lastHeartbeat: serverTimestamp()` is used.

**Outcome check**
- [ ] Backgrounded tabs show clients as Idle instead of disappearing until maxAge.

### 3) Mixed Cloud + Companion Client Merge Strategy (Single Row When Same Device)
**Files**
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/context/UnifiedDataContext.tsx`
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/ControllerPage.tsx`

**Find-and-edit anchors**
- [x] `const normalizeClientWithSource = (`
  - [x] Ensure `source` preserved for both cloud and companion.
- [x] `const mergeControllerClients = (`
  - [x] Keep uniqueness by `clientId + source` in data layer.
- [x] `const roomClientList = useMemo(() => {`
  - [x] UI grouping by `userId` -> `deviceName` -> `clientId`.
  - [x] Render single row with label "Cloud+Companion" when both sources exist.

**Outcome check**
- [ ] Same device shows once with combined source label.

### 4) UX Polish (Optional)
**Files**
- [x] `/Users/radhabalagopala/Dev/OnTime/frontend/src/routes/ControllerPage.tsx`
- [ ] `/Users/radhabalagopala/Dev/OnTime/frontend/src/components/controller/RundownPanel.tsx`

**Find-and-edit anchors**
- [x] `const startControlTimer = () => {`
  - [x] Control action selects timer when acting on non-active timer.
- [x] `const pauseControlTimer = () => {`
  - [x] Same selection alignment as above.
- [x] `const resetControlTimer = () => {`
  - [x] Same selection alignment as above.
- [ ] `onStart={(timerId) => {` in `RundownPanel` usage
  - [ ] Verify selection and scope update already handled.

**Outcome check**
- [ ] Clicking control actions updates selection state to the target timer.

### 5) Regression Notes (Non-code)
- [ ] `docs/phase-2-tasklist.md` marks cloud presence follow-up as complete.
  - [ ] Treat missing heartbeat writer as regression, not new feature.
