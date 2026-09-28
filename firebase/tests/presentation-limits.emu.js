/**
 * ISSUE-002 S3d emulator contract, run WITHOUT the emulator rate-limit
 * multiplier: production default limits (begin 10/min/IP, resolve 30/min/IP,
 * publish 5/s/session) and the scheduled cleanup sweep.
 */
const assert = require('node:assert/strict');
const { signOut } = require('firebase/auth');
const { runSuite } = require('./emu-harness');
const { createPresentationHarness, pkcePair, requestId } = require('./presentation-harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for the next fixed-window boundary so a burst starts in an unused bucket. */
async function alignToNextWindow(windowMs) {
  await sleep(windowMs - (Date.now() % windowMs) + 5);
}

async function main() {
  assert.equal(process.env.PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER, undefined, 'limits suite must run unscaled');
  const h = await createPresentationHarness('s3d');
  const { adminDump, adminRead, adminUpdate, approveDevice, auth, call, signInAsDevice } = h;
  const owner = h.newAccount('owner');
  const device = await approveDevice(owner);
  await signInAsDevice(device);
  const session = await call('createPresentationSession', { clientRequestId: requestId() });
  const token = new URL(session.viewerUrl).hash.replace('#token=', '');

  const exhausted = (promise, label) =>
    assert.rejects(promise, (error) => {
      assert.equal(error.code, 'functions/resource-exhausted', `${label}: ${error.code} ${error.message}`);
      assert.ok(error.details.retryAfterMs > 0 && error.details.retryAfterMs <= 60_000, `${label}: retryAfterMs`);
      return true;
    });

  await runSuite([
    ['publish is limited to 5 per second per session', async () => {
      await signInAsDevice(device);
      const body = (sequence) => ({
        schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: session.sessionId, epoch: 1, sequence,
        observedAtMs: Date.now(), observationAgeMs: 0, sentAtEstimatedServerMs: null, availability: 'connecting', payload: null,
      });
      await alignToNextWindow(1_000);
      for (let sequence = 1; sequence <= 5; sequence += 1) await call('publishPresentationSnapshot', body(sequence));
      await exhausted(call('publishPresentationSnapshot', body(6)), 'sixth publish');
    }],
    ['begin and resolve are limited per IP per minute (10 and 30)', async () => {
      await signOut(auth);
      await alignToNextWindow(60_000);
      for (let i = 0; i < 10; i += 1) {
        await call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'downstage-ppt-timer' });
      }
      await exhausted(
        call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'downstage-ppt-timer' }),
        'eleventh begin',
      );
      for (let i = 0; i < 30; i += 1) await call('resolvePresentationViewerLink', { sessionId: session.sessionId, token });
      await exhausted(call('resolvePresentationViewerLink', { sessionId: session.sessionId, token }), 'thirty-first resolve');
      const buckets = await adminDump('presentationRateLimits');
      assert.ok(buckets.length > 0);
      for (const bucket of buckets) {
        assert.match(bucket.id, /^[0-9a-f]{64}$/);
        assert.ok(!JSON.stringify(bucket).includes('127.0.0.1'), 'raw IP stored');
        assert.equal(bucket.cleanupAfterMs, bucket.windowStartMs + bucket.windowMs + 3_600_000);
      }
    }],
    ['denied calls by a stranger cannot exhaust the owner revoke budget', async () => {
      const stranger = h.newAccount('stranger');
      await h.signInWithAccount(stranger);
      for (let i = 0; i < 11; i += 1) {
        await assert.rejects(
          call('revokePresentationViewerLink', { sessionId: session.sessionId, clientRequestId: requestId() }),
          (e) => ['functions/permission-denied', 'functions/resource-exhausted'].includes(e.code),
        );
      }
      await h.signInWithAccount(owner);
      const revoked = await call('revokePresentationViewerLink', { sessionId: session.sessionId, clientRequestId: requestId() });
      assert.equal(revoked.revoked, true);
    }],
    ['cleanup deletes an expired session with its dependants and viewer principal, and nothing live', async () => {
      const { runPresentationCleanup } = require('../../functions/lib/presentation/cleanup.js');
      const { getAuth } = require('firebase-admin/auth');
      const now = Date.now();
      const expiredId = 'expired_session_1';
      const liveId = session.sessionId;
      await adminUpdate(`presentationSessions/${expiredId}`, { ownerUid: 'o', status: 'ended', viewerGeneration: 2, cleanupAfterMs: now - 1 });
      await adminUpdate(`presentationSessionSnapshots/${expiredId}`, { snapshot: {}, cleanupAfterMs: now + 999_999 });
      await adminUpdate(`presentationSessionViewerStates/${expiredId}`, { status: 'ended', cleanupAfterMs: now + 999_999 });
      await adminUpdate('presentationViewerLinks/linkA', { sessionId: expiredId, cleanupAfterMs: now + 999_999 });
      await adminUpdate('presentationViewerLinks/linkB', { sessionId: expiredId, cleanupAfterMs: now + 999_999 });
      await adminUpdate('presentationRequestResults/resultOld', { cleanupAfterMs: now - 1 });
      await adminUpdate('presentationPublisherAuthChallenges/challengeOld', { cleanupAfterMs: now - 1 });
      await adminUpdate('presentationPublisherDevices/ppd_revokedOldDevice01', { status: 'revoked', cleanupAfterMs: now - 1 });
      await getAuth().createUser({ uid: 'ppd_revokedOldDevice01' });
      const { presentationViewerUid } = require('../../functions/lib/presentation/crypto.js');
      await getAuth().createUser({ uid: presentationViewerUid(expiredId, 1) });
      await getAuth().createUser({ uid: presentationViewerUid(expiredId, 2) });

      const metrics = await runPresentationCleanup(now, 200);
      assert.equal(metrics.sessions, 1);
      assert.equal(metrics.authUsersProcessed, 3, 'two viewer principals and one revoked device principal');
      assert.equal(metrics.backlog, false);
      for (const path of [
        `presentationSessions/${expiredId}`, `presentationSessionSnapshots/${expiredId}`, `presentationSessionViewerStates/${expiredId}`,
        'presentationViewerLinks/linkA', 'presentationViewerLinks/linkB', 'presentationRequestResults/resultOld',
        'presentationPublisherAuthChallenges/challengeOld', 'presentationPublisherDevices/ppd_revokedOldDevice01',
      ]) {
        assert.equal(await adminRead(path), null, `${path} should be deleted`);
      }
      await assert.rejects(getAuth().getUser(presentationViewerUid(expiredId, 1)), (e) => e.code === 'auth/user-not-found');
      await assert.rejects(getAuth().getUser('ppd_revokedOldDevice01'), (e) => e.code === 'auth/user-not-found');
      // Live session, its link, and the active device (no cleanupAfterMs) remain.
      assert.equal((await adminRead(`presentationSessions/${liveId}`)).status, 'active');
      assert.equal((await adminDump('presentationViewerLinks')).filter((l) => l.sessionId === liveId).length, 1);
      assert.equal((await adminRead(`presentationPublisherDevices/${device.deviceUid}`)).status, 'active');
    }],
    ['cleanup reports a backlog when a batch fills and leaves rate buckets to TTL', async () => {
      const { runPresentationCleanup } = require('../../functions/lib/presentation/cleanup.js');
      const now = Date.now();
      for (let i = 0; i < 3; i += 1) await adminUpdate(`presentationRequestResults/backlog${i}`, { cleanupAfterMs: now - 1 });
      await adminUpdate('presentationRateLimits/bucketOld', { count: 1, cleanupAfterMs: now - 1 });
      const metrics = await runPresentationCleanup(now, 2);
      assert.equal(metrics.backlog, true);
      assert.equal(metrics.swept.presentationRequestResults, 2);
      assert.equal(metrics.swept.presentationRateLimits, undefined);
      assert.equal((await adminRead('presentationRateLimits/bucketOld')).count, 1);
    }],
    ['cleanup resumes a large session\'s Auth deletion across runs from a persisted cursor', async () => {
      const { runPresentationCleanup } = require('../../functions/lib/presentation/cleanup.js');
      const { getAuth } = require('firebase-admin/auth');
      const now = Date.now();
      const id = 'expired_many_generations';
      await adminUpdate(`presentationSessions/${id}`, { status: 'ended', viewerGeneration: 1_500, cleanupAfterMs: now - 1 });
      const oneChunkPerRun = { deleteUsers: (uids) => getAuth().deleteUsers(uids), sleep: async () => {}, maxChunks: 1 };
      const first = await runPresentationCleanup(now, 200, oneChunkPerRun);
      assert.equal(first.backlog, true);
      assert.equal(first.sessions, 0);
      assert.equal((await adminRead(`presentationSessions/${id}`)).viewerAuthCleanedThrough, 1_000);
      const second = await runPresentationCleanup(now, 200, oneChunkPerRun);
      assert.equal(second.sessions, 1);
      assert.equal(second.authUsersProcessed, 500);
      assert.equal(await adminRead(`presentationSessions/${id}`), null);
    }],
    ['cleanup handles a session with more links than one write batch', async () => {
      const { runPresentationCleanup } = require('../../functions/lib/presentation/cleanup.js');
      const now = Date.now();
      const id = 'expired_many_links';
      await adminUpdate(`presentationSessions/${id}`, { status: 'ended', viewerGeneration: 1, cleanupAfterMs: now - 1 });
      await h.privileged(async (db) => {
        for (let chunk = 0; chunk < 2; chunk += 1) {
          const batch = db.batch();
          for (let i = 0; i < 260; i += 1) batch.set(db.doc(`presentationViewerLinks/many_${chunk}_${i}`), { sessionId: id, cleanupAfterMs: now + 999_999 });
          await batch.commit();
        }
      });
      const metrics = await runPresentationCleanup(now, 200);
      assert.equal(metrics.sessions, 1);
      assert.equal(metrics.failedSessions, 0);
      assert.equal((await adminDump('presentationViewerLinks')).filter((l) => l.sessionId === id).length, 0);
      assert.equal(await adminRead(`presentationSessions/${id}`), null);
    }],
  ]);

  await h.cleanup();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
