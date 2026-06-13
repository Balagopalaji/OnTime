import assert from 'node:assert/strict'
import test from 'node:test'

// Load the module with bootstrap disabled (same pattern as main.lifecycle.test.ts).
// IMPORTANT: set the env var BEFORE the first import so the module skips server
// startup when it is cached for all subsequent test cases in this file.
const loadHandlerHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
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
