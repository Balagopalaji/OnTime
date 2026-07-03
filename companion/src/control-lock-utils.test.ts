import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  getPendingControlReplacementReason,
  normalizeRoomPin,
  shouldClearPendingControlByTimeout,
  shouldClearPendingControlForRequester,
} from './control-lock-utils';

test('normalizeRoomPin keeps 4-8 digits and strips formatting', () => {
  assert.equal(normalizeRoomPin(' 123-456 '), '123456');
  assert.equal(normalizeRoomPin('1234'), '1234');
  assert.equal(normalizeRoomPin('12345678'), '12345678');
});

test('normalizeRoomPin rejects empty, short, and long values', () => {
  assert.equal(normalizeRoomPin(), null);
  assert.equal(normalizeRoomPin(null), null);
  assert.equal(normalizeRoomPin(''), null);
  assert.equal(normalizeRoomPin('----'), null);
  assert.equal(normalizeRoomPin('12'), null);
  assert.equal(normalizeRoomPin('123456789'), null);
});

test('getPendingControlReplacementReason preserves current pending replacement semantics', () => {
  assert.equal(
    getPendingControlReplacementReason(undefined, 'requester-a', 10_000),
    null,
  );
  assert.equal(
    getPendingControlReplacementReason(
      { requesterId: 'requester-a', requestedAt: 10_000 },
      'requester-a',
      10_000 + CONTROL_REQUEST_TIMEOUT_MS - 1,
    ),
    null,
  );
  assert.equal(
    getPendingControlReplacementReason(
      { requesterId: 'requester-a', requestedAt: 10_000 },
      'requester-b',
      10_000 + CONTROL_REQUEST_TIMEOUT_MS - 1,
    ),
    'superseded',
  );
  assert.equal(
    getPendingControlReplacementReason(
      { requesterId: 'requester-a', requestedAt: 10_000 },
      'requester-a',
      10_000 + CONTROL_REQUEST_TIMEOUT_MS,
    ),
    'timeout',
  );
});

test('shouldClearPendingControlByTimeout clears at the 30s boundary only', () => {
  const pending = { requesterId: 'requester-a', requestedAt: 10_000 };

  assert.equal(
    shouldClearPendingControlByTimeout(
      pending,
      10_000 + CONTROL_REQUEST_TIMEOUT_MS - 1,
    ),
    false,
  );
  assert.equal(
    shouldClearPendingControlByTimeout(
      pending,
      10_000 + CONTROL_REQUEST_TIMEOUT_MS,
    ),
    true,
  );
});

test('shouldClearPendingControlForRequester only clears the queued requester', () => {
  const pending = { requesterId: 'requester-a', requestedAt: 10_000 };

  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-a'), true);
  assert.equal(shouldClearPendingControlForRequester(pending, 'requester-b'), false);
  assert.equal(shouldClearPendingControlForRequester(undefined, 'requester-a'), false);
});
