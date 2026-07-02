import assert from 'node:assert/strict'
import test from 'node:test'

// Load the module with bootstrap disabled (same pattern as main.lifecycle.test.ts).
// IMPORTANT: set the env var BEFORE the first import so the module skips server
// startup when it is cached for all subsequent test cases in this file.
const loadHandlerHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-handler-tests'
  return import('./main.js')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake Socket.IO socket that satisfies every field the two handlers
 *  (and the enforceControllerAccess / verifyControllerClient guards) touch.
 *  Cast to `any` at the call site so TypeScript doesn't complain about the
 *  70+ members of the full Socket class we don't need. */
function makeFakeSocket(roomId?: string) {
  const rooms = new Set<string>()
  if (roomId) rooms.add(roomId)
  return {
    rooms,
    join(r: string) { this.rooms.add(r) },
    data: {
      clientId: 'client-x',
      clientType: 'controller' as const,
      deviceName: undefined as string | undefined,
      userId: undefined as string | undefined,
      userName: undefined as string | undefined,
    },
    id: 'sock-1',
    // Capture any ERROR emits; we don't assert on them but the handlers call this.
    emitted: [] as Array<{ event: string; payload: unknown }>,
    emit(event: string, payload: unknown) { this.emitted.push({ event, payload }) },
  } as any
}

/** Build a valid SyncRoomStatePayload. */
function makeSyncPayload(roomId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'SYNC_ROOM_STATE',
    roomId,
    state: {
      activeTimerId: 'timer-a',
      isRunning: true,
      currentTime: 5_000,
      lastUpdate: 100,          // client clock — should be replaced by companion clock
      showClock: false,
    },
    ...overrides,
  }
}

/** Build a valid RoomStatePatchPayload. */
function makePatchPayload(roomId: string, changes: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    type: 'ROOM_STATE_PATCH',
    roomId,
    changes,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Test 1: SYNC valid — lastUpdate is re-anchored on companion clock, not client
// ---------------------------------------------------------------------------
test('SYNC valid: lastUpdate re-anchored on companion clock, delta emitted', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-sync-valid'

  // Reset stores for this room.
  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const emitted: Array<{ roomId: string; event: string; payload: unknown }> = []
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ roomId: r, event, payload }) }),
  } as any)

  // Seed the store with a state whose lastUpdate is in the past.
  const seedLastUpdate = 50_000
  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-a',
    isRunning: true,
    currentTime: 3_000,
    lastUpdate: seedLastUpdate,
    showClock: false,
    message: { text: '', visible: false, color: 'green' },
  } as any)

  const socket = makeFakeSocket(roomId)
  const clientSuppliedLastUpdate = 100   // deliberately small / old client clock value

  const before = Date.now()
  m.handleSyncRoomState(socket, makeSyncPayload(roomId, {
    state: {
      activeTimerId: 'timer-a',
      isRunning: true,
      currentTime: 5_000,
      lastUpdate: clientSuppliedLastUpdate,
      showClock: false,
    },
  }))
  const after = Date.now()

  const stored = m.getRoomState(roomId)

  // currentTime is preserved from the payload.
  assert.equal(stored.currentTime, 5_000, 'stored currentTime should match payload')

  // lastUpdate must NOT be the client-supplied value (100); it must be companion now.
  assert.notEqual(stored.lastUpdate, clientSuppliedLastUpdate,
    'lastUpdate must NOT be the client-supplied value — this would fail if handler used client clock')
  assert.notEqual(stored.lastUpdate, seedLastUpdate,
    'lastUpdate must NOT be the old seeded value — re-anchoring did not fire')
  assert.ok(stored.lastUpdate >= before && stored.lastUpdate <= after,
    `lastUpdate (${stored.lastUpdate}) should be within [${before}, ${after}]`)

  // Exactly one ROOM_STATE_DELTA should have been emitted for this room.
  const deltas = emitted.filter(e => e.event === 'ROOM_STATE_DELTA' && e.roomId === roomId)
  assert.equal(deltas.length, 1, 'should emit exactly one ROOM_STATE_DELTA')

  const deltaPayload = deltas[0].payload as any
  assert.equal(deltaPayload.changes.currentTime, 5_000, 'delta changes.currentTime should match')
  assert.ok(deltaPayload.changes.lastUpdate >= before && deltaPayload.changes.lastUpdate <= after,
    'delta changes.lastUpdate should be companion clock')
})

// ---------------------------------------------------------------------------
// Test 2: SYNC invalid payload — store unchanged, no delta emitted
// ---------------------------------------------------------------------------
test('SYNC invalid payload: store unchanged, no delta emitted', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-sync-invalid'

  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const emitted: Array<{ roomId: string; event: string; payload: unknown }> = []
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ roomId: r, event, payload }) }),
  } as any)

  const seedLastUpdate = 50_000
  m.roomStateStore.set(roomId, {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: seedLastUpdate,
    showClock: false,
    message: { text: '', visible: false, color: 'green' },
  } as any)

  const socket = makeFakeSocket(roomId)

  // Payload missing required `state` field.
  m.handleSyncRoomState(socket, {
    type: 'SYNC_ROOM_STATE',
    roomId,
    // state intentionally omitted
  })

  const stored = m.getRoomState(roomId)
  assert.equal(stored.lastUpdate, seedLastUpdate, 'store must be unchanged on invalid payload')
  assert.equal(stored.currentTime, 0, 'store currentTime must be unchanged')

  const deltas = emitted.filter(e => e.event === 'ROOM_STATE_DELTA')
  assert.equal(deltas.length, 0, 'no ROOM_STATE_DELTA should be emitted for invalid payload')
})

// ---------------------------------------------------------------------------
// Test 3: PATCH metadata-only — timer lastUpdate unchanged, delta has no lastUpdate
// ---------------------------------------------------------------------------
test('PATCH metadata-only: timer lastUpdate unchanged, delta.changes.lastUpdate is undefined', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-patch-meta'

  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const emitted: Array<{ roomId: string; event: string; payload: unknown }> = []
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ roomId: r, event, payload }) }),
  } as any)

  const seedLastUpdate = 77_000
  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-a',
    isRunning: true,
    currentTime: 8_000,
    lastUpdate: seedLastUpdate,
    showClock: false,
    message: { text: 'Hello', visible: true, color: 'green' },
  } as any)

  const socket = makeFakeSocket(roomId)

  // Patch that only updates message — no timer keys (activeTimerId, isRunning, currentTime).
  m.handleRoomStatePatch(socket, makePatchPayload(roomId, {
    message: { text: 'Updated message' },
  }))

  const stored = m.getRoomState(roomId)

  // Timer lastUpdate should be unchanged (metadata-only patch does not re-anchor).
  assert.equal(stored.lastUpdate, seedLastUpdate,
    'metadata-only patch must not change lastUpdate')
  assert.equal(stored.message!.text, 'Updated message', 'message text should be updated')

  const deltas = emitted.filter(e => e.event === 'ROOM_STATE_DELTA' && e.roomId === roomId)
  assert.equal(deltas.length, 1, 'should emit exactly one ROOM_STATE_DELTA')

  const deltaPayload = deltas[0].payload as any
  assert.equal(deltaPayload.changes.lastUpdate, undefined,
    'delta.changes.lastUpdate must be undefined for metadata-only patch')
})

// ---------------------------------------------------------------------------
// Test 4: PATCH timer-affecting — currentTime preserved (negative ok), lastUpdate re-anchored
// ---------------------------------------------------------------------------
test('PATCH timer-affecting: negative currentTime preserved, lastUpdate re-anchored on companion clock', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-patch-timer'

  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const emitted: Array<{ roomId: string; event: string; payload: unknown }> = []
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ roomId: r, event, payload }) }),
  } as any)

  const seedLastUpdate = 88_000
  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-b',
    isRunning: true,
    currentTime: 3_000,
    lastUpdate: seedLastUpdate,
    showClock: false,
    message: { text: '', visible: false, color: 'green' },
  } as any)

  const socket = makeFakeSocket(roomId)
  const clientSuppliedLastUpdate = 999_999  // deliberately wrong / client clock

  const before = Date.now()
  m.handleRoomStatePatch(socket, makePatchPayload(roomId, {
    currentTime: -1_000,          // negative = bonus time; must be preserved
    lastUpdate: clientSuppliedLastUpdate,
  }))
  const after = Date.now()

  const stored = m.getRoomState(roomId)

  // Negative currentTime must be stored exactly as supplied.
  assert.equal(stored.currentTime, -1_000,
    'negative currentTime (bonus time) must be preserved')

  // lastUpdate must NOT be the client-supplied value; must be companion clock.
  assert.notEqual(stored.lastUpdate, clientSuppliedLastUpdate,
    'lastUpdate must NOT be the client-supplied value — would fail if handler used client clock')
  assert.notEqual(stored.lastUpdate, seedLastUpdate,
    'lastUpdate must differ from seed — re-anchoring must have fired')
  assert.ok(stored.lastUpdate >= before && stored.lastUpdate <= after,
    `lastUpdate (${stored.lastUpdate}) should be within companion clock range [${before}, ${after}]`)

  const deltas = emitted.filter(e => e.event === 'ROOM_STATE_DELTA' && e.roomId === roomId)
  assert.equal(deltas.length, 1, 'should emit exactly one ROOM_STATE_DELTA')

  const deltaPayload = deltas[0].payload as any
  assert.equal(deltaPayload.changes.currentTime, -1_000,
    'delta.changes.currentTime must be -1000')
  assert.ok(deltaPayload.changes.lastUpdate >= before && deltaPayload.changes.lastUpdate <= after,
    'delta.changes.lastUpdate must be companion clock')
})

// ---------------------------------------------------------------------------
// Test 5: PATCH invalid — disallowed key, store unchanged, no delta emitted
// ---------------------------------------------------------------------------
test('PATCH invalid: disallowed key, store unchanged, no delta emitted', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-patch-invalid'

  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const emitted: Array<{ roomId: string; event: string; payload: unknown }> = []
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: unknown) => emitted.push({ roomId: r, event, payload }) }),
  } as any)

  const seedLastUpdate = 55_000
  m.roomStateStore.set(roomId, {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: seedLastUpdate,
    showClock: false,
    message: { text: '', visible: false, color: 'green' },
  } as any)

  const socket = makeFakeSocket(roomId)

  // 'elapsedOffset' is not in the allowed key set.
  m.handleRoomStatePatch(socket, {
    type: 'ROOM_STATE_PATCH',
    roomId,
    changes: {
      elapsedOffset: 12_000,
    },
  })

  const stored = m.getRoomState(roomId)
  assert.equal(stored.lastUpdate, seedLastUpdate, 'store must be unchanged on invalid patch')
  assert.equal(stored.currentTime, 0, 'currentTime must be unchanged')

  const deltas = emitted.filter(e => e.event === 'ROOM_STATE_DELTA')
  assert.equal(deltas.length, 0, 'no ROOM_STATE_DELTA should be emitted for invalid patch payload')
})

// ---------------------------------------------------------------------------
// Control-arbitration handler characterization
// ---------------------------------------------------------------------------

function makeControlSocket(clientId: string, roomId: string, overrides: Record<string, unknown> = {}) {
  const rooms = new Set<string>([roomId])
  return {
    rooms,
    join(r: string) { this.rooms.add(r) },
    data: {
      roomId,
      clientId,
      clientType: 'controller' as const,
      deviceName: `${clientId}-device`,
      userId: `${clientId}-user`,
      userName: `${clientId} user`,
      ...overrides,
    },
    id: `${clientId}-socket`,
    emitted: [] as Array<{ event: string; payload: any }>,
    emit(event: string, payload: unknown) { this.emitted.push({ event, payload }) },
  } as any
}

function makeDisconnectSocket(clientId: string, roomId: string, socketId = `${clientId}-socket`) {
  return {
    id: socketId,
    data: {
      roomId,
      clientId,
    },
  } as any
}

function pushFakeIoServer(m: any, activeSocketIds: string[] = []) {
  const emitted: Array<{ target: string; event: string; payload: any }> = []
  m.ioServers.push({
    sockets: { sockets: new Map(activeSocketIds.map((id) => [id, {}])) },
    to: (target: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ target, event, payload }),
    }),
  } as any)
  return emitted
}

function resetControlRoom(m: any, roomId: string) {
  const timeout = m.pendingControlTimeouts.get(roomId)
  if (timeout) clearTimeout(timeout)
  m.pendingControlTimeouts.delete(roomId)
  m.pendingControlRequests.delete(roomId)
  m.roomControllerStore.delete(roomId)
  m.roomClientStore.delete(roomId)
  m.roomPinStore.delete(roomId)
  m.roomOwnerStore.delete(roomId)
  m.roomControlAuditStore.delete(roomId)
  m.ioServers.length = 0
}

function seedControllerLock(m: any, roomId: string, clientId = 'owner') {
  m.roomControllerStore.set(roomId, {
    clientId,
    socketId: `${clientId}-socket`,
    connectedAt: 1_000,
    lastHeartbeat: 1_000,
    deviceName: `${clientId}-device`,
    userId: `${clientId}-user`,
    userName: `${clientId} user`,
  })
}

function seedRoomClient(m: any, roomId: string, clientId: string, clientType: 'controller' | 'viewer' = 'controller') {
  if (!m.roomClientStore.has(roomId)) m.roomClientStore.set(roomId, new Map())
  m.roomClientStore.get(roomId).set(clientId, {
    socketId: `${clientId}-socket`,
    deviceName: `${clientId}-device`,
    userId: `${clientId}-user`,
    userName: `${clientId} user`,
    clientType,
    lastHeartbeat: Date.now(),
  })
}

test('REQUEST_CONTROL rejects mismatched client id and queues pending request for active owner', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-control-request'
  resetControlRoom(m, roomId)

  const mismatchSocket = makeControlSocket('requester', roomId)
  m.handleRequestControl(mismatchSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'other-client',
    timestamp: Date.now(),
  })
  assert.equal(mismatchSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(mismatchSocket.emitted.at(-1)?.payload.code, 'INVALID_PAYLOAD')
  assert.equal(m.pendingControlRequests.has(roomId), false)

  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  m.handleRequestControl(requesterSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'requester',
    deviceName: ' Requester Device ',
    userId: ' requester-user ',
    userName: ' Requester User ',
    timestamp: Date.now(),
  })

  const pending = m.pendingControlRequests.get(roomId)
  assert.equal(pending?.requesterId, 'requester')
  assert.equal(pending?.requesterName, 'Requester Device')
  assert.equal(requesterSocket.emitted.at(-1)?.event, 'CONTROL_REQUEST_STATUS')
  assert.equal(requesterSocket.emitted.at(-1)?.payload.status, 'queued')
  assert.equal(requesterSocket.emitted.at(-1)?.payload.requesterId, 'requester')
  const received = ioEmits.find((emit) => emit.target === 'owner-socket' && emit.event === 'CONTROL_REQUEST_RECEIVED')
  assert.equal(received?.payload.requesterId, 'requester')

  resetControlRoom(m, roomId)
})

test('FORCE_TAKEOVER denies without PIN or timeout and accepts matching PIN or elapsed pending timeout', async () => {
  const m = await loadHandlerHelpers()

  const deniedRoomId = 'room-force-denied'
  resetControlRoom(m, deniedRoomId)
  seedControllerLock(m, deniedRoomId, 'owner')
  const deniedSocket = makeControlSocket('requester', deniedRoomId)
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleForceTakeover(deniedSocket, {
    type: 'FORCE_TAKEOVER',
    roomId: deniedRoomId,
    clientId: 'requester',
    timestamp: Date.now(),
  })

  assert.equal(deniedSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(deniedSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  assert.equal(m.roomControllerStore.get(deniedRoomId)?.clientId, 'owner')
  resetControlRoom(m, deniedRoomId)

  const pinRoomId = 'room-force-pin'
  resetControlRoom(m, pinRoomId)
  seedControllerLock(m, pinRoomId, 'owner')
  m.roomPinStore.set(pinRoomId, { pin: '1234', updatedAt: Date.now(), setBy: 'owner' })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleForceTakeover(makeControlSocket('requester', pinRoomId), {
    type: 'FORCE_TAKEOVER',
    roomId: pinRoomId,
    clientId: 'requester',
    pin: '12 34',
    timestamp: Date.now(),
  })

  assert.equal(m.roomControllerStore.get(pinRoomId)?.clientId, 'requester')
  resetControlRoom(m, pinRoomId)

  const timeoutRoomId = 'room-force-timeout'
  resetControlRoom(m, timeoutRoomId)
  seedControllerLock(m, timeoutRoomId, 'owner')
  const requestedAt = Date.now() - 31_000
  m.pendingControlRequests.set(timeoutRoomId, { requesterId: 'requester', requestedAt })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleForceTakeover(makeControlSocket('requester', timeoutRoomId), {
    type: 'FORCE_TAKEOVER',
    roomId: timeoutRoomId,
    clientId: 'requester',
    timestamp: Date.now(),
  })

  assert.equal(m.roomControllerStore.get(timeoutRoomId)?.clientId, 'requester')
  assert.equal(m.pendingControlRequests.has(timeoutRoomId), false)
  resetControlRoom(m, timeoutRoomId)
})

test('FORCE_TAKEOVER denies a wrong PIN and does not transfer the controller lock', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-force-wrong-pin'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  m.roomPinStore.set(roomId, { pin: '1234', updatedAt: Date.now(), setBy: 'owner' })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  m.handleForceTakeover(requesterSocket, {
    type: 'FORCE_TAKEOVER',
    roomId,
    clientId: 'requester',
    pin: '9999',
    timestamp: Date.now(),
  })

  // Lock must still belong to the original controller — no takeover on a wrong PIN.
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(requesterSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(requesterSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  resetControlRoom(m, roomId)
})

test('FORCE_TAKEOVER denies a fresh (sub-timeout) pending request from the same requester', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-force-fresh-pending'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  // Pending request from the same requester, but well under the 30s timeout.
  const requestedAt = Date.now() - 1_000
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  m.handleForceTakeover(requesterSocket, {
    type: 'FORCE_TAKEOVER',
    roomId,
    clientId: 'requester',
    timestamp: Date.now(),
  })

  // No PIN and no elapsed timeout — takeover must be denied and the pending
  // request left untouched (it is not the immediate-takeover path).
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(requesterSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(requesterSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  assert.equal(m.pendingControlRequests.get(roomId)?.requesterId, 'requester')
  resetControlRoom(m, roomId)
})

test('FORCE_TAKEOVER denies an elapsed pending request that belongs to a different requester', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-force-other-pending'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  // Pending request is old enough to clear the timeout bar, but it was made
  // by a different client than the one calling FORCE_TAKEOVER.
  const requestedAt = Date.now() - 31_000
  m.pendingControlRequests.set(roomId, { requesterId: 'other-requester', requestedAt })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  m.handleForceTakeover(requesterSocket, {
    type: 'FORCE_TAKEOVER',
    roomId,
    clientId: 'requester',
    timestamp: Date.now(),
  })

  // allowByTimeout requires pending.requesterId === payload.clientId, so an
  // elapsed pending request from someone else must not grant the takeover.
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(requesterSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(requesterSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  assert.equal(m.pendingControlRequests.get(roomId)?.requesterId, 'other-requester')
  resetControlRoom(m, roomId)
})

test('HAND_OVER lets current controller hand over to active controller and rejects invalid target/non-controller', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-handover'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'target')
  seedRoomClient(m, roomId, 'viewer-target', 'viewer')
  pushFakeIoServer(m, ['owner-socket', 'target-socket', 'viewer-target-socket'])
  const ownerSocket = makeControlSocket('owner', roomId)

  m.handleHandOver(ownerSocket, {
    type: 'HAND_OVER',
    roomId,
    targetClientId: 'missing-target',
    timestamp: Date.now(),
  })
  assert.equal(ownerSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(ownerSocket.emitted.at(-1)?.payload.code, 'NOT_FOUND')
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')

  m.handleHandOver(ownerSocket, {
    type: 'HAND_OVER',
    roomId,
    targetClientId: 'viewer-target',
    timestamp: Date.now(),
  })
  assert.equal(ownerSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')

  m.handleHandOver(ownerSocket, {
    type: 'HAND_OVER',
    roomId,
    targetClientId: 'target',
    timestamp: Date.now(),
  })
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'target')

  resetControlRoom(m, roomId)
})

test('DENY_CONTROL current controller clears matching pending request and emits denial/status', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-deny-control'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  const requestedAt = Date.now()
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleDenyControl(makeControlSocket('owner', roomId), {
    type: 'DENY_CONTROL',
    roomId,
    requesterId: 'requester',
    timestamp: Date.now(),
  })

  assert.equal(m.pendingControlRequests.has(roomId), false)
  const cleared = ioEmits.find((emit) => emit.target === 'requester-socket' && emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(cleared?.payload.status, 'cleared')
  assert.equal(cleared?.payload.reason, 'request_denied')
  const denied = ioEmits.find((emit) => emit.target === 'requester-socket' && emit.event === 'CONTROL_REQUEST_DENIED')
  assert.equal(denied?.payload.reason, 'denied_by_controller')

  resetControlRoom(m, roomId)
})

test('disconnect cleanup clears lock and pending request as lock_changed when lock holder has no controller replacement', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-disconnect-lock-clear'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester', 'viewer')
  const requestedAt = Date.now()
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  const timeout = setTimeout(() => {}, 30_000)
  m.pendingControlTimeouts.set(roomId, timeout)
  const ioEmits = pushFakeIoServer(m, ['requester-socket'])

  m.handleSocketDisconnectCleanup(makeDisconnectSocket('owner', roomId), 'transport close')

  assert.equal(m.roomControllerStore.has(roomId), false)
  assert.equal(m.pendingControlRequests.has(roomId), false)
  assert.equal(m.pendingControlTimeouts.has(roomId), false)
  const lockState = ioEmits.find((emit) => emit.target === roomId && emit.event === 'CONTROLLER_LOCK_STATE')
  assert.equal(lockState?.payload.lock, null)
  const cleared = ioEmits.find((emit) => emit.target === 'requester-socket' && emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(cleared?.payload.status, 'cleared')
  assert.equal(cleared?.payload.reason, 'lock_changed')
  assert.equal(m.roomClientStore.get(roomId)?.has('owner'), false)

  resetControlRoom(m, roomId)
})

test('disconnect cleanup clears pending request as requester_disconnected without dropping active controller lock', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-disconnect-requester'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  const requestedAt = Date.now()
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  const timeout = setTimeout(() => {}, 30_000)
  m.pendingControlTimeouts.set(roomId, timeout)
  const ioEmits = pushFakeIoServer(m, ['owner-socket'])

  m.handleSocketDisconnectCleanup(makeDisconnectSocket('requester', roomId), 'client namespace disconnect')

  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(m.pendingControlRequests.has(roomId), false)
  assert.equal(m.pendingControlTimeouts.has(roomId), false)
  assert.equal(m.roomClientStore.get(roomId)?.has('requester'), false)
  const cleared = ioEmits.find((emit) => emit.target === 'owner-socket' && emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(cleared?.payload.status, 'cleared')
  assert.equal(cleared?.payload.reason, 'requester_disconnected')
  assert.equal(ioEmits.some((emit) => emit.event === 'CONTROLLER_LOCK_STATE'), false)

  resetControlRoom(m, roomId)
})

test('disconnect cleanup for non-controller removes only matching client entry and preserves unrelated lock/pending state', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-disconnect-viewer'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'viewer', 'viewer')
  const requestedAt = Date.now()
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  const timeout = setTimeout(() => {}, 30_000)
  m.pendingControlTimeouts.set(roomId, timeout)
  const ioEmits = pushFakeIoServer(m, ['owner-socket'])

  m.handleSocketDisconnectCleanup(makeDisconnectSocket('viewer', roomId), 'transport close')

  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(m.pendingControlRequests.get(roomId)?.requesterId, 'requester')
  assert.equal(m.pendingControlTimeouts.has(roomId), true)
  assert.equal(m.roomClientStore.get(roomId)?.has('viewer'), false)
  const clientsState = ioEmits.find((emit) => emit.target === 'owner-socket' && emit.event === 'ROOM_CLIENTS_STATE')
  assert.equal(clientsState?.payload.clients.some((client: any) => client.clientId === 'viewer'), false)
  assert.equal(ioEmits.some((emit) => emit.event === 'CONTROL_REQUEST_STATUS'), false)
  assert.equal(ioEmits.some((emit) => emit.event === 'CONTROLLER_LOCK_STATE'), false)

  resetControlRoom(m, roomId)
})

test('disconnect cleanup preserves newer client entry when stale socket disconnects', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-disconnect-stale-socket'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'viewer', 'viewer')
  const viewerEntry = m.roomClientStore.get(roomId)?.get('viewer')
  assert.ok(viewerEntry)
  viewerEntry.socketId = 'viewer-new-socket'
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'viewer-new-socket'])

  m.handleSocketDisconnectCleanup(makeDisconnectSocket('viewer', roomId, 'viewer-old-socket'), 'transport close')

  assert.equal(m.roomClientStore.get(roomId)?.get('viewer')?.socketId, 'viewer-new-socket')
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  const clientsState = ioEmits.find((emit) => emit.target === 'owner-socket' && emit.event === 'ROOM_CLIENTS_STATE')
  assert.equal(clientsState?.payload.clients.some((client: any) => client.clientId === 'viewer'), true)

  resetControlRoom(m, roomId)
})

test('disconnect cleanup transfers lock to active pending requester and clears pending as lock_changed', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-disconnect-transfer-pending'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  const requestedAt = Date.now()
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt })
  const ioEmits = pushFakeIoServer(m, ['requester-socket'])

  m.handleSocketDisconnectCleanup(makeDisconnectSocket('owner', roomId), 'transport close')

  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'requester')
  assert.equal(m.pendingControlRequests.has(roomId), false)
  const cleared = ioEmits.find((emit) => emit.target === 'requester-socket' && emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(cleared?.payload.status, 'cleared')
  assert.equal(cleared?.payload.reason, 'lock_changed')
  const lockState = ioEmits.find((emit) => emit.target === roomId && emit.event === 'CONTROLLER_LOCK_STATE')
  assert.equal(lockState?.payload.lock.clientId, 'requester')

  resetControlRoom(m, roomId)
})

test('SET_ROOM_PIN owner/current controller sets and clears valid PIN and rejects invalid/non-owner attempts', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-pin'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  const ioEmits = pushFakeIoServer(m, ['owner-socket'])
  const ownerSocket = makeControlSocket('owner', roomId)

  m.handleSetRoomPin(ownerSocket, {
    type: 'SET_ROOM_PIN',
    roomId,
    pin: ' 123-456 ',
    timestamp: Date.now(),
  })
  assert.equal(m.roomOwnerStore.get(roomId)?.ownerId, 'owner-user')
  assert.equal(m.roomPinStore.get(roomId)?.pin, '123456')
  assert.ok(ioEmits.some((emit) => emit.target === 'owner-socket' && emit.event === 'ROOM_PIN_STATE' && emit.payload.pin === '123456'))

  m.handleSetRoomPin(ownerSocket, {
    type: 'SET_ROOM_PIN',
    roomId,
    pin: '12',
    timestamp: Date.now(),
  })
  assert.equal(ownerSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(ownerSocket.emitted.at(-1)?.payload.code, 'INVALID_PAYLOAD')
  assert.equal(m.roomPinStore.get(roomId)?.pin, '123456')

  m.handleSetRoomPin(ownerSocket, {
    type: 'SET_ROOM_PIN',
    roomId,
    pin: '',
    timestamp: Date.now(),
  })
  assert.equal(m.roomPinStore.has(roomId), false)

  const nonOwnerSocket = makeControlSocket('owner', roomId, { userId: 'not-owner-user' })
  m.handleSetRoomPin(nonOwnerSocket, {
    type: 'SET_ROOM_PIN',
    roomId,
    pin: '9999',
    timestamp: Date.now(),
  })
  assert.equal(nonOwnerSocket.emitted.at(-1)?.event, 'ERROR')
  assert.equal(nonOwnerSocket.emitted.at(-1)?.payload.code, 'PERMISSION_DENIED')
  assert.equal(m.roomPinStore.has(roomId), false)

  resetControlRoom(m, roomId)
})
