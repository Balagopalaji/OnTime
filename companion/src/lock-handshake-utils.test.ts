import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveLockOnDisconnect,
  resolvePendingHandshakeConflict,
  shouldDeleteClientEntryOnDisconnect,
  type PendingHandshakeEntry,
} from './lock-handshake-utils';

test('resolvePendingHandshakeConflict allows idempotent same-socket join and clears stale pending', () => {
  const pending: PendingHandshakeEntry = {
    socketId: 'socket-a',
    startedAt: 1000,
  };

  const result = resolvePendingHandshakeConflict({
    pending,
    now: 1100,
    ttlMs: 5000,
    pendingSocketConnected: true,
    incomingSocketId: 'socket-a',
    idempotentSameSocketJoin: true,
  });

  assert.deepEqual(result, { reject: false, clearExisting: true });
});

test('resolvePendingHandshakeConflict rejects active duplicate from another socket', () => {
  const pending: PendingHandshakeEntry = {
    socketId: 'socket-a',
    startedAt: 1000,
  };

  const result = resolvePendingHandshakeConflict({
    pending,
    now: 1200,
    ttlMs: 5000,
    pendingSocketConnected: true,
    incomingSocketId: 'socket-b',
    idempotentSameSocketJoin: false,
  });

  assert.deepEqual(result, { reject: true, clearExisting: false });
});

test('resolveLockOnDisconnect transfers lock to same client reconnect socket', () => {
  const result = resolveLockOnDisconnect({
    lock: { clientId: 'client-1', socketId: 'socket-old' },
    disconnectSocketId: 'socket-old',
    pendingRequesterId: undefined,
    clients: [
      {
        clientId: 'client-1',
        socketId: 'socket-new',
        clientType: 'controller',
        deviceName: 'Desk',
      },
    ],
    isSocketActive: (socketId) => socketId === 'socket-new',
  });

  assert.equal(result.action, 'transfer');
  if (result.action !== 'transfer') {
    assert.fail('expected transfer');
  }
  assert.equal(result.target.clientId, 'client-1');
  assert.equal(result.target.socketId, 'socket-new');
  assert.equal(result.clearPending, true);
});

test('resolveLockOnDisconnect clears lock when holder disconnects and no valid transfer target exists', () => {
  const result = resolveLockOnDisconnect({
    lock: { clientId: 'controller-a', socketId: 'socket-a' },
    disconnectSocketId: 'socket-a',
    pendingRequesterId: 'controller-b',
    clients: [
      {
        clientId: 'controller-b',
        socketId: 'socket-b',
        clientType: 'controller',
      },
    ],
    isSocketActive: () => false,
  });

  assert.deepEqual(result, { action: 'clear', clearPending: true });
});

test('shouldDeleteClientEntryOnDisconnect only deletes when socket ids match', () => {
  assert.equal(shouldDeleteClientEntryOnDisconnect('socket-a', 'socket-a'), true);
  assert.equal(shouldDeleteClientEntryOnDisconnect('socket-b', 'socket-a'), false);
  assert.equal(shouldDeleteClientEntryOnDisconnect(undefined, 'socket-a'), false);
});
