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
