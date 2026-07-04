import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_REQUEST_TIMEOUT_MS } from './control-lock-utils';
import {
  schedulePendingControlRequestTimeout,
  type SchedulePendingControlRequestTimeoutDeps,
} from './pending-control-timeout-utils';

type FakeTimeout = {
  callback: () => void;
  cleared: boolean;
  delay: number;
  id: string;
};

function createDeps(now = 100_000) {
  const pendingControlTimeouts = new Map<string, NodeJS.Timeout>();
  const pendingControlRequests = new Map<string, { requesterId: string; requestedAt: number }>();
  const timers: FakeTimeout[] = [];
  const cleared: NodeJS.Timeout[] = [];
  const clearCalls: Array<{ roomId: string; reason: 'timeout' }> = [];
  const deps: SchedulePendingControlRequestTimeoutDeps = {
    pendingControlTimeouts,
    pendingControlRequests,
    clearPendingControlRequest: (roomId, reason) => {
      clearCalls.push({ roomId, reason });
    },
    now: () => now,
    setTimeoutFn: (callback: () => void, delay: number) => {
      const timer: FakeTimeout = {
        callback: callback as () => void,
        cleared: false,
        delay: Number(delay),
        id: `timer-${timers.length + 1}`,
      };
      timers.push(timer);
      return timer as unknown as NodeJS.Timeout;
    },
    clearTimeoutFn: (timeout) => {
      cleared.push(timeout);
      (timeout as unknown as FakeTimeout).cleared = true;
    },
  };
  return {
    clearCalls,
    cleared,
    deps,
    pendingControlRequests,
    pendingControlTimeouts,
    timers,
  };
}

test('schedulePendingControlRequestTimeout replaces existing timeout and stores the new remaining-delay timer', () => {
  const roomId = 'room-replace-timeout';
  const { cleared, deps, pendingControlTimeouts, timers } = createDeps(105_000);
  const existing = { callback: () => {}, cleared: false, delay: 1, id: 'existing' };
  pendingControlTimeouts.set(roomId, existing as unknown as NodeJS.Timeout);

  schedulePendingControlRequestTimeout(roomId, 100_000, deps);

  assert.deepEqual(cleared, [existing]);
  assert.equal(existing.cleared, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.delay, CONTROL_REQUEST_TIMEOUT_MS - 5_000);
  assert.equal(pendingControlTimeouts.get(roomId), timers[0]);
});

test('schedulePendingControlRequestTimeout clears matching pending request as timeout when the timer fires', () => {
  const roomId = 'room-matching-timeout';
  const { clearCalls, deps, pendingControlRequests, pendingControlTimeouts, timers } = createDeps();
  pendingControlRequests.set(roomId, { requesterId: 'requester', requestedAt: 100_000 });

  schedulePendingControlRequestTimeout(roomId, 100_000, deps);
  timers[0]?.callback();

  assert.equal(pendingControlTimeouts.has(roomId), false);
  assert.deepEqual(clearCalls, [{ roomId, reason: 'timeout' }]);
});

test('schedulePendingControlRequestTimeout does not clear missing or newer pending requests', () => {
  const missing = createDeps();
  schedulePendingControlRequestTimeout('room-missing', 100_000, missing.deps);
  missing.timers[0]?.callback();
  assert.deepEqual(missing.clearCalls, []);
  assert.equal(missing.pendingControlTimeouts.has('room-missing'), false);

  const newer = createDeps();
  newer.pendingControlRequests.set('room-newer', {
    requesterId: 'requester',
    requestedAt: 100_001,
  });
  schedulePendingControlRequestTimeout('room-newer', 100_000, newer.deps);
  newer.timers[0]?.callback();
  assert.deepEqual(newer.clearCalls, []);
  assert.equal(newer.pendingControlTimeouts.has('room-newer'), false);
});

test('schedulePendingControlRequestTimeout uses zero delay for already-expired requests', () => {
  const { deps, timers } = createDeps(200_000);

  schedulePendingControlRequestTimeout('room-expired', 100_000, deps);

  assert.equal(timers[0]?.delay, 0);
});
