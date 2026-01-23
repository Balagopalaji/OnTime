const fs = require('node:fs');
const path = require('node:path');
const { describe, it, before, after, beforeEach } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

const projectId = 'ontime-rules-test';
const rules = fs.readFileSync(
  path.join(__dirname, '..', 'firestore.rules'),
  'utf8',
);

let testEnv;

const seedBaseData = async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'rooms/room-1'), {
      ownerId: 'owner-1',
      features: { showControl: true },
    });
    await setDoc(doc(db, 'rooms/room-1/operators/op-1'), {
      odUserId: 'op-1',
      odRole: 'lx',
      approvedAt: 1,
      approvedVia: 'invite_code',
    });
    await setDoc(doc(db, 'rooms/room-1/cues/cue-1'), {
      roomId: 'room-1',
      role: 'lx',
      title: 'Lights',
      triggerType: 'timed',
      createdBy: 'owner-1',
      createdAt: 1,
    });
    await setDoc(doc(db, 'rooms/room-1/cues/cue-2'), {
      roomId: 'room-1',
      role: 'ax',
      title: 'Audio',
      triggerType: 'timed',
      createdBy: 'owner-1',
      createdAt: 1,
    });
  });
};

describe('Firestore rules: cue edits', () => {
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: { rules },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await seedBaseData();
  });

  it('allows operator update when role matches existing cue role', async () => {
    const db = testEnv.authenticatedContext('op-1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'rooms/room-1/cues/cue-1'), { title: 'LX Go' }),
    );
  });

  it('allows operator create when role matches', async () => {
    const db = testEnv.authenticatedContext('op-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'rooms/room-1/cues/cue-3'), {
        roomId: 'room-1',
        role: 'lx',
        title: 'LX Create',
        triggerType: 'timed',
        createdBy: 'op-1',
        createdAt: 2,
      }),
    );
  });

  it('denies operator update when role mismatch', async () => {
    const db = testEnv.authenticatedContext('op-1').firestore();
    await assertFails(
      updateDoc(doc(db, 'rooms/room-1/cues/cue-2'), { title: 'AX Go' }),
    );
  });

  it('denies blocked operator', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'rooms/room-1/blocked/op-1'), {
        odUserId: 'op-1',
        blockedAt: 1,
        blockedBy: 'owner-1',
      });
    });
    const db = testEnv.authenticatedContext('op-1').firestore();
    await assertFails(
      updateDoc(doc(db, 'rooms/room-1/cues/cue-1'), { title: 'LX Blocked' }),
    );
  });

  it('allows owner to update regardless of role', async () => {
    const db = testEnv.authenticatedContext('owner-1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'rooms/room-1/cues/cue-2'), { title: 'Owner Edit' }),
    );
  });

  it('denies unauthenticated cue read', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'rooms/room-1/cues/cue-1')));
  });
});
