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

test('REQUEST_CONTROL grants lock immediately when room has no active controller', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-control-request-no-lock'
  resetControlRoom(m, roomId)
  seedRoomClient(m, roomId, 'requester')
  const ioEmits = pushFakeIoServer(m, ['requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  m.handleRequestControl(requesterSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'requester',
    deviceName: '  Requester Device  ',
    userId: '  requester-user  ',
    userName: '  Requester User  ',
    timestamp: Date.now(),
  })

  const lock = m.roomControllerStore.get(roomId)
  assert.equal(lock?.clientId, 'requester')
  assert.equal(lock?.socketId, 'requester-socket')
  assert.equal(lock?.deviceName, 'Requester Device')
  assert.equal(lock?.userId, 'requester-user')
  assert.equal(lock?.userName, 'Requester User')
  assert.equal(m.pendingControlRequests.has(roomId), false)
  assert.equal(
    requesterSocket.emitted.some((emit: any) => emit.event === 'CONTROL_REQUEST_STATUS'),
    false,
    'immediate grant must not queue a control request',
  )
  const lockState = ioEmits.find((emit) => emit.target === roomId && emit.event === 'CONTROLLER_LOCK_STATE')
  assert.equal(lockState?.payload.lock.clientId, 'requester')

  resetControlRoom(m, roomId)
})

test('REQUEST_CONTROL from current controller is a no-op and preserves existing pending request', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-control-request-current-controller'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  const requestedAt = Date.now() - 5_000
  m.pendingControlRequests.set(roomId, {
    requesterId: 'other-requester',
    requesterName: 'Other Device',
    requestedAt,
  })
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'other-requester-socket'])
  const ownerSocket = makeControlSocket('owner', roomId)

  m.handleRequestControl(ownerSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'owner',
    timestamp: Date.now(),
  })

  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')
  assert.equal(m.roomControllerStore.get(roomId)?.connectedAt, 1_000)
  assert.deepEqual(m.pendingControlRequests.get(roomId), {
    requesterId: 'other-requester',
    requesterName: 'Other Device',
    requestedAt,
  })
  assert.equal(
    ownerSocket.emitted.some((emit: any) => emit.event === 'CONTROL_REQUEST_STATUS'),
    false,
    'current controller re-request must not queue itself',
  )
  assert.equal(ioEmits.some((emit) => emit.event === 'CONTROL_REQUEST_STATUS'), false)
  assert.equal(ioEmits.some((emit) => emit.event === 'CONTROL_REQUEST_RECEIVED'), false)
  assert.equal(m.roomControlAuditStore.has(roomId), false)

  resetControlRoom(m, roomId)
})

test('REQUEST_CONTROL from another requester supersedes existing pending request and queues the new requester', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-control-request-supersede'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'first-requester')
  seedRoomClient(m, roomId, 'second-requester')
  const firstRequestedAt = Date.now() - 1_000
  m.pendingControlRequests.set(roomId, {
    requesterId: 'first-requester',
    requesterName: 'First Device',
    requestedAt: firstRequestedAt,
  })
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'first-requester-socket', 'second-requester-socket'])
  const secondSocket = makeControlSocket('second-requester', roomId)

  m.handleRequestControl(secondSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'second-requester',
    deviceName: 'Second Device',
    timestamp: Date.now(),
  })

  const firstRequesterCleared = ioEmits.find((emit) =>
    emit.target === 'first-requester-socket' &&
    emit.event === 'CONTROL_REQUEST_STATUS' &&
    emit.payload.requesterId === 'first-requester'
  )
  assert.equal(firstRequesterCleared?.payload.status, 'cleared')
  assert.equal(firstRequesterCleared?.payload.reason, 'superseded')
  assert.equal(firstRequesterCleared?.payload.requestedAt, firstRequestedAt)

  const controllerCleared = ioEmits.find((emit) =>
    emit.target === 'owner-socket' &&
    emit.event === 'CONTROL_REQUEST_STATUS' &&
    emit.payload.requesterId === 'first-requester'
  )
  assert.equal(controllerCleared?.payload.status, 'cleared')
  assert.equal(controllerCleared?.payload.reason, 'superseded')

  const pending = m.pendingControlRequests.get(roomId)
  assert.equal(pending?.requesterId, 'second-requester')
  assert.equal(pending?.requesterName, 'Second Device')
  assert.equal(typeof pending?.requestedAt, 'number')

  const queued = secondSocket.emitted.find((emit: any) => emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(queued?.payload.status, 'queued')
  assert.equal(queued?.payload.requesterId, 'second-requester')
  assert.equal(queued?.payload.requestedAt, pending?.requestedAt)

  const received = ioEmits.find((emit) =>
    emit.target === 'owner-socket' &&
    emit.event === 'CONTROL_REQUEST_RECEIVED' &&
    emit.payload.requesterId === 'second-requester'
  )
  assert.equal(received?.payload.requesterName, 'Second Device')

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

// ---------------------------------------------------------------------------
// appendControlAudit characterization: pin the exact audit-store entry each
// of the 5 control paths writes, so a future carve of appendControlAudit /
// its call sites can't silently change action/status/actor/target shape.
// ---------------------------------------------------------------------------

test('audit: REQUEST_CONTROL with an active controller pushes a request entry with no status', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-request'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleRequestControl(makeControlSocket('requester', roomId), {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'requester',
    deviceName: 'Requester Device',
    userId: 'requester-user',
    userName: 'Requester User',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 1, 'exactly one audit entry should be recorded')
  const entry = audit![0]
  assert.equal(entry.action, 'request')
  assert.equal(entry.actorId, 'requester')
  assert.equal(entry.actorUserId, 'requester-user')
  assert.equal(entry.actorUserName, 'Requester User')
  assert.equal(entry.deviceName, 'Requester Device')
  assert.equal('targetId' in entry, false, 'request entries must not carry targetId')
  assert.equal(entry.status, undefined, 'request entries must not carry a status')

  resetControlRoom(m, roomId)
})

test('audit: FORCE_TAKEOVER denied (no PIN, no timeout) pushes a force entry with status denied', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-force-denied'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleForceTakeover(makeControlSocket('requester', roomId), {
    type: 'FORCE_TAKEOVER',
    roomId,
    clientId: 'requester',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 1, 'exactly one audit entry should be recorded')
  const entry = audit![0]
  assert.equal(entry.action, 'force')
  assert.equal(entry.status, 'denied')
  assert.equal(entry.actorId, 'requester')
  assert.equal(entry.actorUserId, 'requester-user')
  assert.equal(entry.actorUserName, 'requester user')
  // Controller lock must be unchanged — this is the denied path, not a takeover.
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'owner')

  resetControlRoom(m, roomId)
})

test('audit: FORCE_TAKEOVER accepted (valid PIN) pushes a force entry with status accepted and sets the lock', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-force-accepted'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  m.roomPinStore.set(roomId, { pin: '1234', updatedAt: Date.now(), setBy: 'owner' })
  pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleForceTakeover(makeControlSocket('requester', roomId), {
    type: 'FORCE_TAKEOVER',
    roomId,
    clientId: 'requester',
    pin: '1234',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 1, 'exactly one audit entry should be recorded')
  const entry = audit![0]
  assert.equal(entry.action, 'force')
  assert.equal(entry.status, 'accepted')
  assert.equal(entry.actorId, 'requester')
  assert.equal(entry.actorUserId, 'requester-user')
  assert.equal(entry.actorUserName, 'requester user')
  // Accepted takeover must actually move the controller lock.
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'requester')

  resetControlRoom(m, roomId)
})

test('audit: controller HAND_OVER pushes a handover entry with target and no status', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-handover'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'target')
  pushFakeIoServer(m, ['owner-socket', 'target-socket'])

  m.handleHandOver(makeControlSocket('owner', roomId), {
    type: 'HAND_OVER',
    roomId,
    targetClientId: 'target',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 1, 'exactly one audit entry should be recorded')
  const entry = audit![0]
  assert.equal(entry.action, 'handover')
  assert.equal(entry.actorId, 'owner')
  assert.equal(entry.actorUserId, 'owner-user')
  assert.equal(entry.actorUserName, 'owner user')
  assert.equal(entry.targetId, 'target')
  assert.equal(entry.deviceName, 'target-device', 'handover entry.deviceName is the TARGET device, not the actor device')
  assert.equal(entry.status, undefined, 'handover entries must not carry a status')
  assert.equal(m.roomControllerStore.get(roomId)?.clientId, 'target')

  resetControlRoom(m, roomId)
})

test('audit: controller DENY_CONTROL pushes a deny entry with target and status denied, clears pending as request_denied', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-deny'
  resetControlRoom(m, roomId)
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  m.pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt: Date.now() })
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'requester-socket'])

  m.handleDenyControl(makeControlSocket('owner', roomId), {
    type: 'DENY_CONTROL',
    roomId,
    requesterId: 'requester',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 1, 'exactly one audit entry should be recorded')
  const entry = audit![0]
  assert.equal(entry.action, 'deny')
  assert.equal(entry.status, 'denied')
  assert.equal(entry.actorId, 'owner')
  assert.equal(entry.actorUserId, 'owner-user')
  assert.equal(entry.actorUserName, 'owner user')
  assert.equal(entry.targetId, 'requester')
  assert.equal(m.pendingControlRequests.has(roomId), false, 'pending request must be cleared')
  const cleared = ioEmits.find((emit) => emit.target === 'requester-socket' && emit.event === 'CONTROL_REQUEST_STATUS')
  assert.equal(cleared?.payload.reason, 'request_denied')

  resetControlRoom(m, roomId)
})

// ---------------------------------------------------------------------------
// appendControlAudit cap: the store keeps only the most recent 50 entries
// per room (oldest dropped first). Exercised by calling appendControlAudit's
// call path directly (REQUEST_CONTROL from a fresh, distinct requester each
// time so the handler doesn't short-circuit as a no-op) rather than
// simulating 51 full request/grant/supersede cycles, which the harness
// cannot drive without also modeling the 30s pending-timeout scheduler.
// ---------------------------------------------------------------------------

test('audit: room audit list caps at 50 entries, dropping the oldest and retaining the newest', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-audit-cap'
  resetControlRoom(m, roomId)

  // Seed 50 pre-existing entries directly into the store (entries 0..49),
  // each with a distinguishing actorId so we can identify exactly which
  // ones survive the trim.
  const seeded = Array.from({ length: 50 }, (_, i) => ({
    action: 'request' as const,
    actorId: `seed-${i}`,
    timestamp: 1_000 + i,
  }))
  m.roomControlAuditStore.set(roomId, seeded)

  // Drive one real handler call through the production appendControlAudit
  // call path (REQUEST_CONTROL queuing against an active controller) to
  // push the 51st entry and trigger the cap.
  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester-51')
  pushFakeIoServer(m, ['owner-socket', 'requester-51-socket'])

  m.handleRequestControl(makeControlSocket('requester-51', roomId), {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'requester-51',
    deviceName: 'Requester 51 Device',
    timestamp: Date.now(),
  })

  const audit = m.roomControlAuditStore.get(roomId)
  assert.equal(audit?.length, 50, 'audit list must be capped at 50 entries')
  assert.equal(audit![0].actorId, 'seed-1', 'oldest entry (seed-0) must have been dropped')
  assert.equal(
    audit!.some((e) => e.actorId === 'seed-0'),
    false,
    'seed-0 must not survive the trim',
  )
  assert.equal(audit![49].actorId, 'requester-51', 'newest entry must be retained at the tail')

  resetControlRoom(m, roomId)
})

// ---------------------------------------------------------------------------
// Pending control-request 30s timeout EXPIRY (schedulePendingControlRequestTimeout)
// Existing tests only cover the timeout handle being CLEARED by other paths; the
// scheduled expiry firing on its own is characterized here with fake timers so a
// future carve of the timeout scheduler cannot silently change it.
// ---------------------------------------------------------------------------
test('pending control request auto-clears at the 30s timeout, emitting a timeout clear to requester and controller', async (t) => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-pending-timeout-expiry'
  resetControlRoom(m, roomId)

  seedControllerLock(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'owner')
  seedRoomClient(m, roomId, 'requester')
  const ioEmits = pushFakeIoServer(m, ['owner-socket', 'requester-socket'])
  const requesterSocket = makeControlSocket('requester', roomId)

  // Fake setTimeout + Date so requestedAt is fixed and delay is exactly the
  // 30s window (no boundary flakiness), and the internal setTimeout is virtual.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 })
  t.after(() => {
    t.mock.timers.reset()
    resetControlRoom(m, roomId)
  })

  m.handleRequestControl(requesterSocket, {
    type: 'REQUEST_CONTROL',
    roomId,
    clientId: 'requester',
    deviceName: 'Requester Device',
    timestamp: Date.now(),
  })

  // Queued, with a scheduled timeout handle; nothing cleared yet.
  assert.equal(m.pendingControlRequests.get(roomId)?.requesterId, 'requester')
  assert.equal(m.pendingControlTimeouts.has(roomId), true, 'a timeout must be scheduled')

  // One ms before the boundary: still pending, still scheduled.
  t.mock.timers.tick(m.CONTROL_REQUEST_TIMEOUT_MS - 1)
  assert.equal(m.pendingControlRequests.has(roomId), true, 'must NOT clear before the 30s boundary')
  assert.equal(m.pendingControlTimeouts.has(roomId), true)

  // Crossing the boundary fires the scheduled clear.
  t.mock.timers.tick(1)
  assert.equal(m.pendingControlRequests.has(roomId), false, 'pending must be cleared exactly at 30s')
  assert.equal(m.pendingControlTimeouts.has(roomId), false, 'the timeout handle must be removed')

  // A 'cleared'/'timeout' CONTROL_REQUEST_STATUS is sent to BOTH the requester and the controller.
  const reqCleared = ioEmits.find(
    (e) => e.target === 'requester-socket' && e.event === 'CONTROL_REQUEST_STATUS' && e.payload.status === 'cleared',
  )
  const ownerCleared = ioEmits.find(
    (e) => e.target === 'owner-socket' && e.event === 'CONTROL_REQUEST_STATUS' && e.payload.status === 'cleared',
  )
  assert.equal(reqCleared?.payload.reason, 'timeout', 'requester must be told the clear reason was timeout')
  assert.equal(ownerCleared?.payload.reason, 'timeout', 'controller must be told the clear reason was timeout')
})

// ---------------------------------------------------------------------------
// U1 domain-types adoption: shared-types Timer is a SUPERSET (adds optional
// sectionId/segmentId/segmentOrder/adjustmentLog). Those extra fields MUST NOT
// become writable over UPDATE_TIMER — ALLOWED_TIMER_PATCH_KEYS is the runtime
// contract. This test fails if the allowlist is ever widened to leak them.
// ---------------------------------------------------------------------------
test('UPDATE_TIMER with an unsupported shared Timer field (sectionId) is rejected INVALID_FIELDS and does not mutate the timer', async () => {
  const m = await loadHandlerHelpers()
  const roomId = 'room-update-timer-sectionid'

  m.roomControllerStore.delete(roomId)
  const timers = m.getRoomTimers(roomId)
  timers.clear()
  timers.set('timer-1', {
    id: 'timer-1',
    roomId,
    title: 'Opening',
    duration: 300,
    type: 'countdown',
    order: 0,
  } as any)

  const socket = makeFakeSocket(roomId)

  m.handleUpdateTimer(socket, {
    type: 'UPDATE_TIMER',
    roomId,
    timerId: 'timer-1',
    changes: { sectionId: 'section-9' },
  })

  const err = socket.emitted.find((e: { event: string }) => e.event === 'TIMER_ERROR')
  assert.ok(err, 'a TIMER_ERROR must be emitted for the unsupported key')
  assert.equal((err!.payload as any).code, 'INVALID_FIELDS',
    'unsupported shared field must be rejected as INVALID_FIELDS, not silently accepted')

  const stored = m.getRoomTimers(roomId).get('timer-1') as any
  assert.equal(stored.sectionId, undefined, 'sectionId must NOT be written onto the stored timer')
  assert.equal(stored.title, 'Opening', 'the timer must be otherwise unchanged')
})
