import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompanionRoomState } from '@ontime/interface-contracts'

// Load the module with bootstrap disabled (same pattern as main.handlers.test.ts).
// IMPORTANT: set the env var BEFORE the first import so the module skips server
// startup when it is cached for all subsequent test cases in this file.
const loadSeedHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-seed-tests'
  return import('./main.js')
}

// ---------------------------------------------------------------------------
// T2 — getRoomState default lastUpdate (F2)
// ---------------------------------------------------------------------------

test('getRoomState() initializes an unseen room with lastUpdate: 0 (F2 default)', async () => {
  const m = await loadSeedHelpers()
  const roomId = 'room-seed-default'
  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  const state = m.getRoomState(roomId)

  // F2: the sentinel default is 0 ("no real state event yet"), NOT Date.now().
  // A Date.now() default would defeat the seed gate (incomingTs > localTs) for
  // every never-cached room, making the seed a no-op — the bug T2 fixes.
  assert.equal(state.lastUpdate, 0)
  assert.equal(state.currentTime, 0)
  assert.equal(state.isRunning, false)
  assert.equal(state.activeTimerId, null)
  // The default is persisted to the store.
  assert.equal(m.roomStateStore.get(roomId)?.lastUpdate, 0)
})

// ---------------------------------------------------------------------------
// T6 — isValidSeedRoomStatePayload validator
// ---------------------------------------------------------------------------

test('T6: rejects {lastUpdate} without {currentTime} (F4 partial-pair rejection)', async () => {
  const m = await loadSeedHelpers()
  const T1 = 1_000
  const payload = { lastUpdate: T1 }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'payload with only lastUpdate should be rejected')
})

test('T6: rejects {currentTime} without {lastUpdate} (F4 partial-pair rejection)', async () => {
  const m = await loadSeedHelpers()
  const E1 = 12_000
  const payload = { currentTime: E1 }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'payload with only currentTime should be rejected')
})

test('T6: accepts when both currentTime and lastUpdate are finite and present', async () => {
  const m = await loadSeedHelpers()
  const E1 = 12_000
  const T1 = 1_000
  const payload = {
    currentTime: E1,
    lastUpdate: T1,
    isRunning: false,
    activeTimerId: null,
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, true, 'valid lean seed payload should be accepted')
})

test('T6: rejects rich cloud fields (startedAt, elapsedOffset, progress, clockMode)', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    startedAt: 500, // Rich field - should reject
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'payload with startedAt (rich field) should be rejected')
})

test('T6: rejects elapsedOffset (rich cloud field)', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    elapsedOffset: 10_000, // Rich field - should reject
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'payload with elapsedOffset (rich field) should be rejected')
})

test('T6: accepts all lean projection fields', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    activeTimerId: 'timer-1',
    isRunning: true,
    currentTime: 12_000,
    lastUpdate: 1_000,
    showClock: true,
    message: { text: 'Test', visible: true, color: 'blue' as const },
    title: 'Room Title',
    timezone: 'America/New_York',
    activeLiveCueId: 'cue-1',
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, true, 'full lean projection should be accepted')
})

test('T6: rejects non-finite currentTime', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: NaN, // Not finite
    lastUpdate: 1_000,
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'non-finite currentTime should be rejected')
})

test('T6: rejects non-finite lastUpdate', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: 12_000,
    lastUpdate: Infinity, // Not finite
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'non-finite lastUpdate should be rejected')
})

test('T6: rejects invalid message shape', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    message: { text: 123 }, // Invalid: text should be string
  } as any
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, false, 'invalid message shape should be rejected')
})

test('T6: accepts optional fields when omitted', async () => {
  const m = await loadSeedHelpers()
  const payload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
  }
  const result = m.isValidSeedRoomStatePayload(payload)
  assert.equal(result, true, 'minimal valid payload should be accepted')
})

// ---------------------------------------------------------------------------
// T1 — handleSeedCompanionCache (real handler) applies a stored anchor pair
// ---------------------------------------------------------------------------

test('handleSeedCompanionCache applies a seed state whose lastUpdate > 0 over the F2 default', async () => {
  const m = await loadSeedHelpers()
  const roomId = 'room-seed-apply'
  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  // Materialize the F2 default (lastUpdate: 0) the way a real JOIN would,
  // so the seed gate compares against the 0 sentinel rather than Date.now().
  m.getRoomState(roomId)

  const E0 = 12_000 // stored elapsed anchor
  const T0 = 1_000  // stored lastUpdate (T0 > 0, so the seed gate beats the 0 default)

  // Drive the REAL handler (exported by T1) with a lean seed carrying only the
  // stored anchor pair. `_socket` is unused by the handler, so null is safe.
  m.handleSeedCompanionCache(null as never, {
    rooms: [
      {
        roomId,
        state: {
          currentTime: E0,
          lastUpdate: T0,
        },
      },
    ],
    timestamp: T0,
  })

  // Before T2 (lastUpdate defaulted to Date.now()), the gate T0 > Date.now()
  // was false and the store kept the default → this assertion failed.
  // After T2 the gate is T0 > 0 → true, so the stored anchor pair wins.
  const stored = m.roomStateStore.get(roomId)
  assert.equal(stored?.lastUpdate, T0)
  assert.equal(stored?.currentTime, E0)
})

// ---------------------------------------------------------------------------
// T4 — handleSeedCompanionCache stores only lean projection (no rich field pollution)
// ---------------------------------------------------------------------------

test('T4: handleSeedCompanionCache validator rejects rich fields (F1)', async () => {
  const m = await loadSeedHelpers()

  // Verify the validator rejects rich cloud fields
  const richPayload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    startedAt: 500, // Rich field
  }
  assert.equal(
    m.isValidSeedRoomStatePayload(richPayload),
    false,
    'validator should reject startedAt'
  )

  const elapsedOffsetPayload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    elapsedOffset: 10_000, // Rich field
  }
  assert.equal(
    m.isValidSeedRoomStatePayload(elapsedOffsetPayload),
    false,
    'validator should reject elapsedOffset'
  )

  const progressPayload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    progress: { timer1: 50 }, // Rich field
  }
  assert.equal(
    m.isValidSeedRoomStatePayload(progressPayload),
    false,
    'validator should reject progress'
  )

  const clockModePayload = {
    currentTime: 12_000,
    lastUpdate: 1_000,
    clockMode: 'count-up' as const, // Rich field
  }
  assert.equal(
    m.isValidSeedRoomStatePayload(clockModePayload),
    false,
    'validator should reject clockMode'
  )
})

test('T4: handleSeedCompanionCache stores only lean projection', async () => {
  const m = await loadSeedHelpers()
  const roomId = 'room-t4-lean-store'
  m.roomStateStore.delete(roomId)
  m.ioServers.length = 0

  // Materialize the F2 default so the seed gate passes.
  m.getRoomState(roomId)

  const E0 = 12_000
  const T0 = 1_000

  // Drive the handler with a payload containing ONLY lean fields.
  m.handleSeedCompanionCache(null as never, {
    rooms: [
      {
        roomId,
        state: {
          currentTime: E0,
          lastUpdate: T0,
          activeTimerId: 'timer-1',
          isRunning: true,
          showClock: true,
          title: 'Test Room',
          timezone: 'America/New_York',
          message: { text: 'Hello', visible: true, color: 'blue' as const },
          activeLiveCueId: 'cue-1',
        },
      },
    ],
    timestamp: T0,
  })

  const stored = m.roomStateStore.get(roomId)

  // Verify all lean fields are stored correctly
  assert.equal(stored?.currentTime, E0, 'lean currentTime should be stored')
  assert.equal(stored?.lastUpdate, T0, 'lean lastUpdate should be stored')
  assert.equal(stored?.activeTimerId, 'timer-1', 'activeTimerId should be stored')
  assert.equal(stored?.isRunning, true, 'isRunning should be stored')
  assert.equal(stored?.showClock, true, 'showClock should be stored')
  assert.equal(stored?.title, 'Test Room', 'title should be stored')
  assert.equal(stored?.timezone, 'America/New_York', 'timezone should be stored')
  assert.equal(stored?.activeLiveCueId, 'cue-1', 'activeLiveCueId should be stored')
  assert.equal(stored?.message?.text, 'Hello', 'message should be stored')

  // Verify rich fields are absent (cast to any to check for non-existent properties)
  const storedAny = stored as any
  assert.equal(
    storedAny?.startedAt,
    undefined,
    'rich field startedAt must NOT be present'
  )
  assert.equal(
    storedAny?.elapsedOffset,
    undefined,
    'rich field elapsedOffset must NOT be present'
  )
  assert.equal(
    storedAny?.progress,
    undefined,
    'rich field progress must NOT be present'
  )
  assert.equal(
    storedAny?.clockMode,
    undefined,
    'rich field clockMode must NOT be present'
  )
})

// ---------------------------------------------------------------------------
// T5 — resolveRoomStatePatchForCompanionClock drops progress fallback
// ---------------------------------------------------------------------------

test('T5: activeTimerId-only PATCH resolves currentTime to 0, not stale progress (F3)', async () => {
  const m = await loadSeedHelpers()
  
  // Existing state with stale seeded progress (the bug F3 exploited)
  const existingState: CompanionRoomState = {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: 1_000,
    // Stale progress that should NOT be read
    progress: { t2: 5000 },
  }
  
  const companionNow = 2_000
  
  // PATCH with only activeTimerId changed (no currentTime)
  const patch = { activeTimerId: 't2' }
  
  // Call the function directly - it's exported as resolveRoomStatePatchForCompanionClock
  const result = m.resolveRoomStatePatchForCompanionClock({
    existingState,
    incomingChanges: patch,
    companionNow,
  })
  
  // After fix: currentTime must be 0, NOT 5000 (stale progress)
  assert.equal(result.nextState.currentTime, 0, 'currentTime must resolve to 0, not stale progress')
  assert.equal(result.nextState.activeTimerId, 't2', 'activeTimerId must be updated')
  assert.equal(result.nextState.lastUpdate, companionNow, 'lastUpdate must be set to companionNow')
})
