import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendControlAudit,
  CONTROL_AUDIT_ENTRY_LIMIT,
  type ControlAuditEntry,
  type ControlAuditStore,
} from './control-audit-utils';

test('appendControlAudit appends an entry and schedules a cache write', () => {
  const store: ControlAuditStore = new Map();
  let writes = 0;
  const entry: ControlAuditEntry = {
    action: 'request',
    actorId: 'requester',
    actorUserId: 'user-1',
    actorUserName: 'Requester User',
    timestamp: 1_000,
    deviceName: 'Requester Device',
  };

  appendControlAudit('room-1', entry, {
    store,
    scheduleWrite: () => {
      writes += 1;
    },
  });

  assert.deepEqual(store.get('room-1'), [entry]);
  assert.equal(writes, 1);
});

test('appendControlAudit keeps only the newest 50 entries', () => {
  const store: ControlAuditStore = new Map();
  let writes = 0;
  store.set(
    'room-1',
    Array.from({ length: CONTROL_AUDIT_ENTRY_LIMIT }, (_, index) => ({
      action: 'request' as const,
      actorId: `seed-${index}`,
      timestamp: index,
    })),
  );

  appendControlAudit(
    'room-1',
    {
      action: 'deny',
      actorId: 'owner',
      targetId: 'requester',
      timestamp: 9_999,
      status: 'denied',
    },
    {
      store,
      scheduleWrite: () => {
        writes += 1;
      },
    },
  );

  const audit = store.get('room-1');
  assert.equal(audit?.length, CONTROL_AUDIT_ENTRY_LIMIT);
  assert.equal(audit?.[0].actorId, 'seed-1');
  assert.equal(audit?.some((entry) => entry.actorId === 'seed-0'), false);
  assert.equal(audit?.at(-1)?.actorId, 'owner');
  assert.equal(writes, 1);
});
