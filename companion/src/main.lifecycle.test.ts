import assert from 'node:assert/strict'
import test from 'node:test'

const loadLifecycleHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  return import('./main.js')
}

test('queued pending request is cleared as superseded when another requester arrives', async () => {
  const { getPendingControlReplacementReason } = await loadLifecycleHelpers()
  const reason = getPendingControlReplacementReason(
    {
      requesterId: 'requester-a',
      requestedAt: 1_000,
    },
    'requester-b',
    5_000,
  )

  assert.equal(reason, 'superseded')
})

test('queued pending request is cleared as timeout when stale', async () => {
  const {
    getPendingControlReplacementReason,
    shouldClearPendingControlByTimeout,
  } = await loadLifecycleHelpers()
  const reason = getPendingControlReplacementReason(
    {
      requesterId: 'requester-a',
      requestedAt: 1_000,
    },
    'requester-a',
    40_000,
    30_000,
  )

  assert.equal(reason, 'timeout')
  assert.equal(
    shouldClearPendingControlByTimeout(
      {
        requesterId: 'requester-a',
        requestedAt: 1_000,
      },
      40_000,
      30_000,
    ),
    true,
  )
})

test('deny/disconnect clear actions only target the queued requester', async () => {
  const { shouldClearPendingControlForRequester } = await loadLifecycleHelpers()
  const pending = {
    requesterId: 'requester-a',
    requestedAt: 1_000,
  }

  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-a'), true)
  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-b'), false)
})

test('fresh re-request by same requester does not emit superseded clear', async () => {
  const { getPendingControlReplacementReason } = await loadLifecycleHelpers()
  const reason = getPendingControlReplacementReason(
    {
      requesterId: 'requester-a',
      requestedAt: 10_000,
    },
    'requester-a',
    20_000,
    30_000,
  )

  assert.equal(reason, null)
})

test('legacy trust flags without a fingerprint do not count as current', async () => {
  const { isTrustFlagCurrent } = await loadLifecycleHelpers()
  assert.equal(
    isTrustFlagCurrent(
      'trusted-system at 2026-01-21T11:54:14.613Z for /tmp/localhost-cert.pem',
      'AA:BB:CC',
    ),
    false,
  )
})

test('trust flags are tied to the current certificate fingerprint', async () => {
  const { buildTrustFlagContents, isTrustFlagCurrent } = await loadLifecycleHelpers()
  const trustFlag = buildTrustFlagContents(
    'trusted-system',
    '/tmp/localhost-cert.pem',
    'AA:BB:CC',
    '2026-03-24T06:00:00.000Z',
  )

  assert.equal(isTrustFlagCurrent(trustFlag, 'AA:BB:CC'), true)
  assert.equal(isTrustFlagCurrent(trustFlag, 'DD:EE:FF'), false)
})

test('timer action clock classifies client timestamps but keeps companion time authoritative', async () => {
  const { resolveTimerActionClock } = await loadLifecycleHelpers()
  const now = 1_000_000

  assert.deepEqual(resolveTimerActionClock(undefined, now), {
    now,
    clientTimestampIssue: 'missing',
  })
  assert.deepEqual(resolveTimerActionClock('1000', now), {
    now,
    clientTimestampIssue: 'non_number',
  })
  assert.deepEqual(resolveTimerActionClock(Number.NaN, now), {
    now,
    clientTimestampIssue: 'non_finite',
  })
  assert.deepEqual(resolveTimerActionClock(0, now), {
    now,
    clientTimestampIssue: 'zero_or_negative',
  })
  assert.deepEqual(resolveTimerActionClock(now - 300_001, now), {
    now,
    clientTimestampIssue: 'stale',
  })
  assert.deepEqual(resolveTimerActionClock(now + 30_001, now), {
    now,
    clientTimestampIssue: 'future_skew',
  })
  assert.deepEqual(resolveTimerActionClock(now - 1_000, now), {
    now,
    clientTimestampIssue: 'valid_ignored',
  })
})

test('pause timer action uses companion clock for elapsed delta', async () => {
  const { resolveTimerActionChanges } = await loadLifecycleHelpers()
  const changes = resolveTimerActionChanges({
    action: 'PAUSE',
    timerId: 'timer-a',
    state: {
      activeTimerId: 'timer-a',
      isRunning: true,
      currentTime: 5_000,
      lastUpdate: 100_000,
    },
    companionNow: 103_000,
  })

  assert.equal(changes.isRunning, false)
  assert.equal(changes.currentTime, 8_000)
  assert.equal(changes.lastUpdate, 103_000)
})

test('pause timer action does not propagate invalid stored lastUpdate anchors', async () => {
  const { resolveTimerActionChanges } = await loadLifecycleHelpers()
  const invalidAnchors = [Number.NaN, Number.POSITIVE_INFINITY, 0, 104_000]

  for (const lastUpdate of invalidAnchors) {
    const changes = resolveTimerActionChanges({
      action: 'PAUSE',
      timerId: 'timer-a',
      state: {
        activeTimerId: 'timer-a',
        isRunning: true,
        currentTime: 5_000,
        lastUpdate,
      },
      companionNow: 103_000,
    })

    assert.equal(changes.isRunning, false)
    assert.equal(changes.currentTime, 5_000)
    assert.equal(changes.lastUpdate, 103_000)
    assert.equal(Number.isFinite(changes.currentTime), true)
  }
})

test('start and reset timer actions anchor lastUpdate on companion clock', async () => {
  const { resolveTimerActionChanges } = await loadLifecycleHelpers()
  const state = {
    activeTimerId: 'timer-a',
    isRunning: false,
    currentTime: 5_000,
    lastUpdate: 100_000,
  }

  const startChanges = resolveTimerActionChanges({
    action: 'START',
    timerId: 'timer-a',
    state,
    companionNow: 103_000,
    currentTime: 7_000,
  })
  const resetChanges = resolveTimerActionChanges({
    action: 'RESET',
    timerId: 'timer-b',
    state,
    companionNow: 104_000,
  })

  assert.equal(startChanges.currentTime, 7_000)
  assert.equal(startChanges.lastUpdate, 103_000)
  assert.equal(resetChanges.currentTime, 0)
  assert.equal(resetChanges.lastUpdate, 104_000)
})
