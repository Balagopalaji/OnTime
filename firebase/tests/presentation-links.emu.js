/**
 * ISSUE-002 S3b emulator contract: viewer-link issue/rotate/revoke/resolve,
 * viewer custom-token claims, and Firestore rules for presentation data
 * (read-only viewers, generation/status/window checks, no role escalation).
 */
const assert = require('node:assert/strict');
const { signInWithCustomToken, signOut } = require('firebase/auth');
const { doc, getDoc, onSnapshot, setDoc } = require('firebase/firestore');
const { runSuite } = require('./emu-harness');
const { createPresentationHarness, expectCode, requestId } = require('./presentation-harness');

const tokenOf = (viewerUrl) => {
  const token = new URL(viewerUrl).hash.replace(/^#token=/, '');
  assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);
  return token;
};

async function main() {
  const h = await createPresentationHarness('s3b');
  const { adminRead, adminUpdate, approveDevice, auth, call, clientDb, signInAsDevice, signInWithAccount } = h;
  const owner = h.newAccount('owner');
  const stranger = h.newAccount('stranger');
  const read = (path) => getDoc(doc(clientDb, path)).then((snap) => (snap.exists() ? snap.data() : null));
  const callDenied = (promise, label) => expectCode(promise, 'permission-denied', label);
  const rulesDenied = (promise, label) =>
    assert.rejects(promise, (error) => {
      assert.equal(error.code, 'permission-denied', `${label}: got ${error.code}`);
      return true;
    });

  const device = await approveDevice(owner);
  const ownerUid = h.accounts.get(owner.email);
  await signInAsDevice(device);
  const session = await call('createPresentationSession', { clientRequestId: requestId() });
  const { sessionId } = session;
  const snapshotPath = `presentationSessionSnapshots/${sessionId}`;
  const statePath = `presentationSessionViewerStates/${sessionId}`;
  await adminUpdate(snapshotPath, { schemaMajor: 1, sequence: 1, cleanupAfterMs: Date.now() + 60_000 });

  async function resolveAndSignIn(token) {
    await signOut(auth);
    const resolved = await call('resolvePresentationViewerLink', { sessionId, token });
    const credential = await signInWithCustomToken(auth, resolved.customToken);
    return { resolved, claims: (await credential.user.getIdTokenResult()).claims };
  }

  let viewerUrl = session.viewerUrl;

  await runSuite([
    ['resolve mints a read-only viewer principal for the current generation', async () => {
      const before = Date.now();
      const { resolved, claims } = await resolveAndSignIn(tokenOf(viewerUrl));
      assert.ok(resolved.serverNowMs >= before - 5_000 && resolved.serverNowMs <= Date.now() + 5_000);
      assert.equal(resolved.activeWindowExpiresAtMs, session.activeWindowExpiresAtMs);
      assert.equal(claims.role, 'presentation-viewer');
      assert.equal(claims.sessionId, sessionId);
      assert.equal(claims.viewerGeneration, 1);
      assert.equal((await read(statePath)).status, 'active');
      assert.equal((await read(snapshotPath)).sequence, 1);
    }],
    ['a viewer cannot write, read private data, or act as a signed-in user (RPV-010)', async () => {
      await resolveAndSignIn(tokenOf(viewerUrl));
      await rulesDenied(setDoc(doc(clientDb, snapshotPath), { sequence: 99 }), 'snapshot write');
      await rulesDenied(setDoc(doc(clientDb, statePath), { status: 'ended' }), 'state write');
      await rulesDenied(read(`presentationSessions/${sessionId}`), 'session read');
      await rulesDenied(read(`presentationPublisherDevices/${device.deviceUid}`), 'device read');
      await rulesDenied(read('presentationSessionSnapshots/other_session'), 'other session snapshot');
      await rulesDenied(setDoc(doc(clientDb, 'rooms/viewer-room'), { ownerId: auth.currentUser.uid }), 'room create');
      await expectCode(call('createPresentationSession', { clientRequestId: requestId() }), 'permission-denied', 'viewer publishes');
      await expectCode(
        call('rotatePresentationViewerLink', { sessionId, clientRequestId: requestId() }),
        'permission-denied',
        'viewer rotates',
      );
    }],
    ['presentation principals cannot call existing room/lock callables (RPV-010)', async () => {
      await resolveAndSignIn(tokenOf(viewerUrl));
      await callDenied(call('joinAsOperator', { roomId: 'room-1', inviteCode: 'ABC123', odRole: 'lx' }), 'viewer joins as operator');
      await callDenied(call('acquireLock', { roomId: 'room-1', clientId: 'client-1' }), 'viewer acquires lock');
      await signInAsDevice(device);
      await callDenied(call('joinAsOperator', { roomId: 'room-1', inviteCode: 'ABC123', odRole: 'lx' }), 'device joins as operator');
      await callDenied(call('acquireLock', { roomId: 'room-1', clientId: 'client-1' }), 'device acquires lock');
    }],
    ['publisher and unauthenticated principals cannot read viewer data', async () => {
      await signInAsDevice(device);
      await rulesDenied(read(snapshotPath), 'publisher snapshot read');
      await signOut(auth);
      await rulesDenied(read(snapshotPath), 'anonymous snapshot read');
      await rulesDenied(read(statePath), 'anonymous state read');
    }],
    ['resolve rejects wrong tokens, sessions, and malformed input', async () => {
      await signOut(auth);
      await callDenied(call('resolvePresentationViewerLink', { sessionId, token: 'A'.repeat(43) }), 'wrong token');
      await callDenied(call('resolvePresentationViewerLink', { sessionId: 'other_session', token: tokenOf(viewerUrl) }), 'wrong session');
      await expectCode(call('resolvePresentationViewerLink', { sessionId, token: 'short' }), 'invalid-argument', 'malformed');
      await expectCode(
        call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl), viewerGeneration: 9 }),
        'invalid-argument',
        'unknown key',
      );
    }],
    ['issue returns the current link while it is active', async () => {
      await signInAsDevice(device);
      const issued = await call('issuePresentationViewerLink', { sessionId, clientRequestId: requestId() });
      assert.deepEqual(issued, { viewerUrl, viewerGeneration: 1, expiresAtMs: session.activeWindowExpiresAtMs });
    }],
    ['rotate revokes old links and already-signed-in old-generation viewers', async () => {
      const oldViewer = await resolveAndSignIn(tokenOf(viewerUrl));
      const oldToken = oldViewer.resolved.customToken;
      await signInAsDevice(device);
      const rotateRequest = { sessionId, clientRequestId: requestId() };
      const rotated = await call('rotatePresentationViewerLink', rotateRequest);
      assert.equal(rotated.viewerGeneration, 2);
      assert.notEqual(rotated.viewerUrl, viewerUrl);
      assert.equal(rotated.expiresAtMs, session.activeWindowExpiresAtMs);
      assert.deepEqual(await call('rotatePresentationViewerLink', rotateRequest), rotated, 'rotate retry');

      await signOut(auth);
      await callDenied(call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl) }), 'old token');
      await signInWithCustomToken(auth, oldToken);
      await rulesDenied(read(snapshotPath), 'old generation snapshot');
      await rulesDenied(read(statePath), 'old generation state');

      viewerUrl = rotated.viewerUrl;
      const { claims } = await resolveAndSignIn(tokenOf(viewerUrl));
      assert.equal(claims.viewerGeneration, 2);
      assert.equal((await read(snapshotPath)).sequence, 1);
      assert.equal((await adminRead(statePath)).viewerGeneration, 2);
    }],
    ['a foreign device or stranger cannot manage the link', async () => {
      const foreign = await approveDevice(h.newAccount('foreign'));
      await signInAsDevice(foreign);
      await callDenied(call('rotatePresentationViewerLink', { sessionId, clientRequestId: requestId() }), 'foreign rotate');
      await callDenied(call('issuePresentationViewerLink', { sessionId, clientRequestId: requestId() }), 'foreign issue');
      await signInWithAccount(stranger);
      await callDenied(call('revokePresentationViewerLink', { sessionId, clientRequestId: requestId() }), 'stranger revoke');
    }],
    ['owner revoke ends link access; a newly issued link restores it', async () => {
      const current = await resolveAndSignIn(tokenOf(viewerUrl));
      await signInWithAccount(owner);
      assert.equal(h.accounts.get(owner.email), ownerUid);
      const revokeRequest = { sessionId, clientRequestId: requestId() };
      const revoked = await call('revokePresentationViewerLink', revokeRequest);
      assert.deepEqual(revoked, { revoked: true, viewerGeneration: 3 });
      assert.deepEqual(await call('revokePresentationViewerLink', revokeRequest), revoked, 'revoke retry');

      await signInWithCustomToken(auth, current.resolved.customToken);
      await rulesDenied(read(snapshotPath), 'revoked generation snapshot');
      await rulesDenied(read(statePath), 'revoked generation state');
      await signOut(auth);
      await callDenied(call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl) }), 'revoked token');

      await signInAsDevice(device);
      const issued = await call('issuePresentationViewerLink', { sessionId, clientRequestId: requestId() });
      assert.equal(issued.viewerGeneration, 3);
      assert.notEqual(issued.viewerUrl, viewerUrl);
      viewerUrl = issued.viewerUrl;
      const { claims } = await resolveAndSignIn(tokenOf(viewerUrl));
      assert.equal(claims.viewerGeneration, 3);
      assert.equal((await read(snapshotPath)).sequence, 1);
    }],
    ['attached listeners lose access on rotate: state at once, snapshot on the next write', async () => {
      const viewer = await resolveAndSignIn(tokenOf(viewerUrl));
      const listen = (path) => {
        let stop = () => {};
        const settled = new Promise((resolve) => {
          stop = onSnapshot(doc(clientDb, path), () => {}, (error) => resolve(error.code));
          setTimeout(() => resolve('no-error'), 6_000);
        });
        return settled.finally(() => stop());
      };
      const stateError = listen(statePath);
      const snapshotError = listen(snapshotPath);
      await new Promise((r) => setTimeout(r, 750));
      const rotated = await h.callAs(device.customToken, 'rotatePresentationViewerLink', { sessionId, clientRequestId: requestId() });
      await new Promise((r) => setTimeout(r, 750));
      await adminUpdate(snapshotPath, { sequence: 2 });
      assert.equal(await stateError, 'permission-denied', 'state listener');
      assert.equal(await snapshotError, 'permission-denied', 'snapshot listener after next write');
      assert.equal(rotated.viewerGeneration, viewer.claims.viewerGeneration + 1);
      viewerUrl = rotated.viewerUrl;
      await adminUpdate(snapshotPath, { sequence: 1 });
    }],
    ['an expired window denies resolve and snapshot reads', async () => {
      const viewer = await resolveAndSignIn(tokenOf(viewerUrl));
      const window = (await adminRead(`presentationSessions/${sessionId}`)).activeWindowExpiresAtMs;
      await adminUpdate(`presentationSessions/${sessionId}`, { activeWindowExpiresAtMs: Date.now() - 1_000 });
      await rulesDenied(read(snapshotPath), 'expired snapshot');
      await signOut(auth);
      await callDenied(call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl) }), 'expired resolve');
      await signInAsDevice(device);
      await expectCode(call('issuePresentationViewerLink', { sessionId, clientRequestId: requestId() }), 'failed-precondition', 'expired issue');
      await expectCode(call('rotatePresentationViewerLink', { sessionId, clientRequestId: requestId() }), 'failed-precondition', 'expired rotate');
      await adminUpdate(`presentationSessions/${sessionId}`, { activeWindowExpiresAtMs: window });
      await signInWithCustomToken(auth, viewer.resolved.customToken);
      assert.equal((await read(snapshotPath)).sequence, 1);
    }],
    ['an ended session keeps its safe ended state readable but not the snapshot', async () => {
      const viewer = await resolveAndSignIn(tokenOf(viewerUrl));
      await adminUpdate(`presentationSessions/${sessionId}`, { status: 'ended' });
      await adminUpdate(statePath, { status: 'ended' });
      await signInWithCustomToken(auth, viewer.resolved.customToken);
      assert.equal((await read(statePath)).status, 'ended');
      await rulesDenied(read(snapshotPath), 'ended snapshot');
      await signOut(auth);
      // The current link's holder learns why (session ended), so the viewer shows Session ended.
      await assert.rejects(call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl) }), (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        assert.deepEqual(error.details, { reason: 'session-ended' });
        return true;
      });
      // After the owner revokes the ended session's link, even the old current token learns nothing.
      await signInWithAccount(owner);
      await call('revokePresentationViewerLink', { sessionId, clientRequestId: requestId() });
      await signOut(auth);
      await assert.rejects(call('resolvePresentationViewerLink', { sessionId, token: tokenOf(viewerUrl) }), (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        assert.equal(error.details, undefined);
        return true;
      });
      // A wrong token learns nothing.
      await assert.rejects(call('resolvePresentationViewerLink', { sessionId, token: 'B'.repeat(43) }), (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        assert.equal(error.details, undefined);
        return true;
      });
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
