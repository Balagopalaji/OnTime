/**
 * Regression tests for FIX-100: updateRoomActiveLiveCueId must re-anchor a
 * RUNNING timer's currentTime BEFORE bumping lastUpdate. Without the re-anchor,
 * the running-elapsed formula `currentTime + (now - lastUpdate)` collapses to
 * `currentTime + (now - now)` after the bump and discards the delta accrued
 * since the last anchor — so the active timer visibly jumps backward whenever a
 * live cue is created, changed, or ended.
 *
 * Scenarios S1–S4 mirror the FIX-100 spec (inline orchestrated brief).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const loadHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-livecue-elapsed-tests'
  return import('./main.js')
}

/** Capture ROOM_STATE_DELTA emits by pushing a fake io server. Resets the
 *  server list first so each test starts clean. Returns the emit log. */
function attachEmitterCapture(m: any) {
  const emitted: Array<{ roomId: string; event: string; payload: any }> = []
  m.ioServers.length = 0
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: any) => emitted.push({ roomId: r, event, payload }) }),
  })
  return emitted
}

/** Stub Date.now to `fixed` for the duration of `fn`; always restore. */
async function withFixedNow<T>(fixed: number, fn: () => Promise<T> | T): Promise<T> {
  const realNow = Date.now
  Date.now = () => fixed
  try {
    return await fn()
  } finally {
    Date.now = realNow
  }
}

const NOW = 100_000 // wall-clock at which the live-cue mutation happens
const ANCHOR = 97_000 // 3s before NOW — the pre-existing lastUpdate

// ---------------------------------------------------------------------------
// S1 — running timer: re-anchor folds the accrued delta (no backward jump)
// ---------------------------------------------------------------------------
test('S1 running: activeLiveCueId change re-anchors currentTime + lastUpdate (no backward jump)', async () => {
  const m = await loadHelpers()
  const roomId = 'room-s1'
  m.roomStateStore.delete(roomId)
  const emitted = attachEmitterCapture(m)

  // Seed a RUNNING timer with 3s of elapsed accrued since the anchor.
  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-a',
    isRunning: true,
    currentTime: 5_000,
    lastUpdate: ANCHOR,
    activeLiveCueId: undefined,
    showClock: false,
  })

  // Elapsed the running timer was showing at the instant of the mutation.
  const before = m.resolveCompanionElapsedForState(m.roomStateStore.get(roomId)!, NOW)
  assert.equal(before, 8_000) // 5_000 + (100_000 - 97_000)

  await withFixedNow(NOW, () => m.updateRoomActiveLiveCueId(roomId, 'cue-1'))

  const stored = m.roomStateStore.get(roomId)!
  assert.equal(stored.activeLiveCueId, 'cue-1')
  assert.equal(stored.lastUpdate, NOW)
  // Re-anchor folds the 3s delta into currentTime (FAILS on main: stays 5_000).
  assert.equal(stored.currentTime, 8_000)

  // Continuity: at the same instant NOW, elapsed must not jump backward.
  assert.equal(m.resolveCompanionElapsedForState(stored, NOW), before)

  // Monotonic forward read 3s later — no stall, no backward jump.
  assert.equal(m.resolveCompanionElapsedForState(stored, NOW + 3_000), 11_000)

  // Wire == store: delta carries the re-anchored timer fields.
  const deltaEmit = emitted.find((e) => e.event === 'ROOM_STATE_DELTA')
  assert.ok(deltaEmit, 'expected a ROOM_STATE_DELTA emit')
  assert.deepEqual(deltaEmit!.payload.changes, {
    activeLiveCueId: 'cue-1',
    currentTime: 8_000,
    lastUpdate: NOW,
  })
  assert.equal(deltaEmit!.payload.timestamp, NOW)
})

// ---------------------------------------------------------------------------
// S2 — paused timer: currentTime unchanged, lastUpdate bumped
// ---------------------------------------------------------------------------
test('S2 paused: activeLiveCueId change leaves currentTime unchanged, bumps lastUpdate', async () => {
  const m = await loadHelpers()
  const roomId = 'room-s2'
  m.roomStateStore.delete(roomId)
  attachEmitterCapture(m)

  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-a',
    isRunning: false,
    currentTime: 5_000,
    lastUpdate: ANCHOR,
    activeLiveCueId: undefined,
    showClock: false,
  })

  await withFixedNow(NOW, () => m.updateRoomActiveLiveCueId(roomId, 'cue-2'))

  const stored = m.roomStateStore.get(roomId)!
  assert.equal(stored.activeLiveCueId, 'cue-2')
  assert.equal(stored.currentTime, 5_000) // nothing to fold when paused
  assert.equal(stored.lastUpdate, NOW)
})

// ---------------------------------------------------------------------------
// S3 — same activeLiveCueId: early return, no mutation, no delta
// ---------------------------------------------------------------------------
test('S3 no-op: unchanged activeLiveCueId triggers no state mutation and no delta', async () => {
  const m = await loadHelpers()
  const roomId = 'room-s3'
  m.roomStateStore.delete(roomId)
  const emitted = attachEmitterCapture(m)

  m.roomStateStore.set(roomId, {
    activeTimerId: 'timer-a',
    isRunning: true,
    currentTime: 5_000,
    lastUpdate: ANCHOR,
    activeLiveCueId: 'cue-3',
    showClock: false,
  })

  // Same value → guard short-circuits before any mutation.
  await withFixedNow(NOW, () => m.updateRoomActiveLiveCueId(roomId, 'cue-3'))

  const stored = m.roomStateStore.get(roomId)!
  assert.equal(stored.currentTime, 5_000) // untouched
  assert.equal(stored.lastUpdate, ANCHOR) // NOT bumped (early return)
  assert.equal(stored.activeLiveCueId, 'cue-3')

  assert.equal(emitted.length, 0, 'no delta should be emitted for a no-op')
})

// ---------------------------------------------------------------------------
// S4 — hardening: non-finite / <=0 inputs must not persist non-finite currentTime
// ---------------------------------------------------------------------------
test('S4 hardening: bad lastUpdate/currentTime on a running timer stays finite after re-anchor', async () => {
  const m = await loadHelpers()

  const cases: Array<{ name: string; state: any; expectedCurrent: number }> = [
    // lastUpdate <= 0 → resolver treats as companionNow → no delta → currentTime unchanged
    { name: 'lastUpdate-0', state: { isRunning: true, currentTime: 5_000, lastUpdate: 0 }, expectedCurrent: 5_000 },
    // non-finite currentTime → base 0, running, valid lastUpdate → 0 + (100_000 - 97_000)
    { name: 'currentTime-NaN', state: { isRunning: true, currentTime: NaN, lastUpdate: ANCHOR }, expectedCurrent: 3_000 },
    // non-finite lastUpdate AND currentTime → base 0, lastUpdate treated as now → 0 + 0
    { name: 'both-NaN', state: { isRunning: true, currentTime: NaN, lastUpdate: NaN }, expectedCurrent: 0 },
  ]

  for (const c of cases) {
    const roomId = `room-s4-${c.name}`
    m.roomStateStore.delete(roomId)
    m.ioServers.length = 0

    m.roomStateStore.set(roomId, {
      activeTimerId: 'timer-a',
      isRunning: c.state.isRunning,
      currentTime: c.state.currentTime,
      lastUpdate: c.state.lastUpdate,
      activeLiveCueId: undefined,
      showClock: false,
    })

    await withFixedNow(NOW, () => m.updateRoomActiveLiveCueId(roomId, 'cue-4'))

    const stored = m.roomStateStore.get(roomId)!
    assert.ok(Number.isFinite(stored.currentTime), `${c.name}: currentTime must be finite, got ${stored.currentTime}`)
    assert.equal(stored.currentTime, c.expectedCurrent, `${c.name}: re-anchored currentTime`)
    assert.equal(stored.lastUpdate, NOW, `${c.name}: lastUpdate bumped`)
  }
})
