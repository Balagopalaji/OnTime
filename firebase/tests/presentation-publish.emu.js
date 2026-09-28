/**
 * ISSUE-002 S3c emulator contract: publishPresentationSnapshot transaction
 * (allowlist reconstruction, epoch/sequence, identical vs mismatched retry,
 * server time/transit, heartbeat) and endPresentationSession.
 */
const assert = require('node:assert/strict');
const { signInWithCustomToken, signOut } = require('firebase/auth');
const { doc, getDoc } = require('firebase/firestore');
const { parseRemoteSnapshotV1 } = require('@ontime/remote-viewer-contracts');
const { runSuite } = require('./emu-harness');
const { createPresentationHarness, expectCode, requestId } = require('./presentation-harness');

const row = (overrides = {}) => ({
  ordinal: 0,
  label: 'Walk-in loop',
  status: 'playing',
  durationMs: 120_000,
  elapsedMsAtObservation: 30_000,
  remainingMsAtObservation: 90_000,
  isFocus: true,
  ...overrides,
});
const payload = (overrides = {}) => ({
  reason: 'presentation',
  presentationState: 'playing',
  slideNumber: 3,
  slideCount: 12,
  displayTitle: 'Sunday Service',
  headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
  videos: [row()],
  ...overrides,
});

async function main() {
  const h = await createPresentationHarness('s3c');
  const { adminRead, approveDevice, auth, call, clientDb, signInAsDevice, signInWithAccount } = h;
  const owner = h.newAccount('owner');
  const device = await approveDevice(owner);
  await signInAsDevice(device);
  const session = await call('createPresentationSession', { clientRequestId: requestId() });
  const { sessionId } = session;
  let epoch = 1;

  const request = (sequence, overrides = {}) => ({
    schemaMajor: 1,
    sourceKind: 'powerpoint',
    sourceMajor: 1,
    sessionId,
    epoch,
    sequence,
    observedAtMs: Date.now() - 40,
    observationAgeMs: 40,
    sentAtEstimatedServerMs: Date.now(),
    availability: 'active',
    payload: payload(),
    ...overrides,
  });
  const publish = (body) => call('publishPresentationSnapshot', body);
  /** Rejections carry a machine-readable reason so the sidecar can choose resume/resync/stop. */
  const expectReason = async (promise, reason, label) => {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, 'functions/failed-precondition', `${label}: ${error.code} ${error.message}`);
      assert.equal(error.details && error.details.reason, reason, `${label}: details ${JSON.stringify(error.details)}`);
      return true;
    });
  };
  const storedSnapshot = async () => (await adminRead(`presentationSessionSnapshots/${sessionId}`)).snapshot;

  await runSuite([
    ['first publish commits a server-stamped, parser-valid snapshot', async () => {
      await signInAsDevice(device);
      const body = request(1);
      const before = Date.now();
      const result = await publish(body);
      assert.equal(result.acceptedSequence, 1);
      assert.ok(result.publishedAtMs >= before - 1_000 && result.publishedAtMs <= Date.now() + 1_000);

      const stored = await adminRead(`presentationSessionSnapshots/${sessionId}`);
      assert.equal(stored.cleanupAfterMs, (await adminRead(`presentationSessions/${sessionId}`)).cleanupAfterMs);
      const parsed = parseRemoteSnapshotV1(stored.snapshot);
      assert.ok(parsed.ok, JSON.stringify(parsed));
      const { preCommitTransitMs, ...rest } = parsed.value;
      assert.ok(preCommitTransitMs >= 0 && preCommitTransitMs <= 25_000);
      assert.deepEqual(rest, {
        schemaMajor: 1,
        sourceKind: 'powerpoint',
        sourceMajor: 1,
        sessionId,
        epoch: 1,
        sequence: 1,
        observedAtMs: body.observedAtMs,
        observationAgeMs: 40,
        publishedAtMs: result.publishedAtMs,
        heartbeatIntervalMs: 10_000,
        staleAfterMs: 25_000,
        disconnectAfterMs: 60_000,
        availability: 'active',
        payload: payload(),
      });
      const sessionDoc = await adminRead(`presentationSessions/${sessionId}`);
      assert.equal(sessionDoc.lastSequence, 1);
      assert.deepEqual(sessionDoc.lastPublishResult, result);
      assert.equal(sessionDoc.lastPublishAtMs, result.publishedAtMs);
      assert.equal((await adminRead(`presentationSessionViewerStates/${sessionId}`)).lastPublishAtMs, result.publishedAtMs);

      // A resolved viewer reads the same snapshot through the rules.
      const token = new URL(session.viewerUrl).hash.replace('#token=', '');
      await signOut(auth);
      const resolved = await call('resolvePresentationViewerLink', { sessionId, token });
      await signInWithCustomToken(auth, resolved.customToken);
      const viewed = (await getDoc(doc(clientDb, `presentationSessionSnapshots/${sessionId}`))).data();
      assert.deepEqual(viewed.snapshot, stored.snapshot);
    }],
    ['an identical retry returns the stored result; a mismatched one or a gap fails', async () => {
      await signInAsDevice(device);
      const body = request(2);
      const first = await publish(body);
      assert.deepEqual(await publish(body), first, 'lost-response retry');
      // The sidecar recomputes age and send estimate before every call, including retries.
      assert.deepEqual(
        await publish({ ...body, observationAgeMs: 900, sentAtEstimatedServerMs: Date.now() }),
        first,
        'retry with recomputed timing',
      );
      await expectReason(publish({ ...body, payload: payload({ slideNumber: 4 }) }), 'sequence-conflict', 'mismatched duplicate');
      await assert.rejects(publish({ ...body, payload: payload({ slideNumber: 4 }) }), (e) => e.details.acceptedSequence === 2);
      await expectReason(publish(request(4)), 'sequence-gap', 'sequence gap');
      await expectReason(publish(request(1)), 'sequence-gap', 'sequence regression');
      assert.equal((await storedSnapshot()).sequence, 2);
    }],
    ['a heartbeat republishes with a newer server time', async () => {
      await signInAsDevice(device);
      const previous = (await storedSnapshot()).publishedAtMs;
      await new Promise((r) => setTimeout(r, 20));
      const result = await publish(request(3));
      assert.equal(result.acceptedSequence, 3);
      assert.ok(result.publishedAtMs > previous);
    }],
    ['the server sanitizes titles and rejects forbidden or server-owned fields', async () => {
      await signInAsDevice(device);
      const sanitized = await publish(request(4, { payload: payload({ displayTitle: 'C:\\\\Shows\\\\Deck.pptx' }) }));
      assert.equal(sanitized.acceptedSequence, 4);
      assert.equal((await storedSnapshot()).payload.displayTitle, 'Deck');
      await expectCode(publish(request(5, { payload: { ...payload(), filenameBasename: 'deck.pptx' } })), 'invalid-argument', 'forbidden payload field');
      await expectCode(publish(request(5, { publishedAtMs: 1 })), 'invalid-argument', 'server-owned field');
      await expectCode(publish(request(5, { instanceId: 4 })), 'invalid-argument', 'forbidden envelope field');
      await expectCode(publish(request(5, { sessionId: 'other_session' })), 'not-found', 'unknown session');
      assert.equal((await storedSnapshot()).sequence, 4);
    }],
    ['send-estimate handling: null means zero transit; a future estimate is rejected', async () => {
      await signInAsDevice(device);
      await publish(request(5, { sentAtEstimatedServerMs: null }));
      assert.equal((await storedSnapshot()).preCommitTransitMs, 0);
      await assert.rejects(publish(request(6, { sentAtEstimatedServerMs: Date.now() + 60_000 })), (error) => {
        assert.equal(error.details.reason, 'clock-future');
        assert.ok(Math.abs(error.details.serverNowMs - Date.now()) < 10_000, 'serverNowMs lets the sidecar resync');
        return true;
      });
    }],
    ['unavailable sources publish without timing', async () => {
      await signInAsDevice(device);
      await publish(request(6, { availability: 'source-unavailable', payload: { reason: 'helper-unavailable' } }));
      const stored = await storedSnapshot();
      assert.equal(stored.availability, 'source-unavailable');
      assert.deepEqual(stored.payload, { reason: 'helper-unavailable' });
    }],
    ['only the owning active device may publish', async () => {
      const foreign = await approveDevice(h.newAccount('foreign'));
      await signInAsDevice(foreign);
      await expectCode(publish(request(7)), 'permission-denied', 'foreign device');
      await signInWithAccount(owner);
      await expectCode(publish(request(7)), 'permission-denied', 'owner user');
    }],
    ['resume starts a new epoch at sequence one and rejects the old epoch', async () => {
      await signInAsDevice(device);
      const resumed = await call('resumePresentationSession', { sessionId, clientRequestId: requestId() });
      assert.equal(resumed.epoch, 2);
      await expectReason(publish(request(7)), 'epoch-mismatch', 'old epoch continues');
      epoch = 2;
      await expectReason(publish(request(2)), 'sequence-gap', 'new epoch must start at one');
      assert.equal((await publish(request(1))).acceptedSequence, 1);
      const stored = await storedSnapshot();
      assert.deepEqual([stored.epoch, stored.sequence], [2, 1]);
    }],
    ['ending the session stops publication and snapshot reads but keeps the ended state readable', async () => {
      const token = new URL(session.viewerUrl).hash.replace('#token=', '');
      await signOut(auth);
      const viewer = await call('resolvePresentationViewerLink', { sessionId, token });
      await signInWithAccount(owner);
      const endRequest = { sessionId, clientRequestId: requestId() };
      assert.deepEqual(await call('endPresentationSession', endRequest), { ended: true });
      assert.deepEqual(await call('endPresentationSession', endRequest), { ended: true }, 'end retry');
      await signInAsDevice(device);
      assert.deepEqual(await call('endPresentationSession', { sessionId, clientRequestId: requestId() }), { ended: true }, 'already ended');
      await expectReason(publish(request(2)), 'session-ended', 'publish after end');
      assert.equal(await adminRead(`presentationSessionSnapshots/${sessionId}`), null, 'ended session retains no snapshot');
      await signOut(auth);
      await signInWithCustomToken(auth, viewer.customToken);
      assert.equal((await getDoc(doc(clientDb, `presentationSessionViewerStates/${sessionId}`))).data().status, 'ended');
      await assert.rejects(getDoc(doc(clientDb, `presentationSessionSnapshots/${sessionId}`)), (e) => e.code === 'permission-denied');
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
