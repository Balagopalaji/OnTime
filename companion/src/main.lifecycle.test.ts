import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPendingControlReplacementReason,
  shouldClearPendingControlByTimeout,
  shouldClearPendingControlForRequester,
} from './main'

test('queued pending request is cleared as superseded when another requester arrives', () => {
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

test('queued pending request is cleared as timeout when stale', () => {
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

test('deny/disconnect clear actions only target the queued requester', () => {
  const pending = {
    requesterId: 'requester-a',
    requestedAt: 1_000,
  }

  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-a'), true)
  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-b'), false)
})

test('fresh re-request by same requester does not emit superseded clear', () => {
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
