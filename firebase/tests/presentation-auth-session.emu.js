/**
 * ISSUE-002 S3a emulator contract: publisher-device approval (PKCE), device
 * lifecycle, session create/resume, per-owner cap, and durable idempotency.
 * Run via `npm run test:presentation --workspace ontime-firebase-rules`.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { deleteApp, initializeApp } = require('firebase/app');
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithCustomToken,
  signOut,
} = require('firebase/auth');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { getEmulatorHosts, runSuite } = require('./emu-harness');

const pkcePair = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
};
const requestId = () => `req_${crypto.randomBytes(8).toString('hex')}`;
const devicePublicKey = crypto.randomBytes(48).toString('base64url');

const expectCode = async (promise, code, label) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, `functions/${code}`, `${label}: expected ${code}, got ${error.code} (${error.message})`);
    return true;
  });
};

async function main() {
  const hosts = await getEmulatorHosts();
  const app = initializeApp({ projectId: hosts.projectId, apiKey: 'demo-key', authDomain: 'localhost' }, `s3a-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${hosts.auth.host}:${hosts.auth.port}`, { disableWarnings: true });
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, hosts.functions.host, hosts.functions.port);
  const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);
  const testEnv = await initializeTestEnvironment({
    projectId: hosts.projectId,
    firestore: { host: hosts.firestore.host, port: hosts.firestore.port },
  });
  // withSecurityRulesDisabled resolves to void, so results are captured explicitly.
  const privileged = async (fn) => {
    let result;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      result = await fn(ctx.firestore());
    });
    return result;
  };
  const adminRead = (path) =>
    privileged(async (db) => {
      const snap = await db.doc(path).get();
      return snap.exists ? snap.data() : null;
    });
  const adminDump = (collection) =>
    privileged(async (db) => {
      const snap = await db.collection(collection).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

  const owner = { email: `owner-${Date.now()}@example.com`, password: 'password-123' };
  const other = { email: `other-${Date.now()}@example.com`, password: 'password-123' };

  /** Full approval flow for one device; returns { deviceUid, customToken }. */
  async function approveDevice(account) {
    await signOut(auth);
    const pkce = pkcePair();
    const begun = await call('beginPresentationPublisherAuth', {
      clientRequestId: requestId(),
      codeChallenge: pkce.challenge,
      callbackScheme: 'downstage-ppt-timer',
    });
    await signInWithAccount(account);
    const approved = await call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' });
    await signOut(auth);
    return call('completePresentationPublisherAuth', {
      clientRequestId: requestId(),
      challengeId: begun.challengeId,
      authorizationCode: callbackCode(approved.callbackUrl, begun.challengeId),
      codeVerifier: pkce.verifier,
      devicePublicKey,
    });
  }

  /** The one-time code reaches only the approving machine, via the app's registered callback. */
  function callbackCode(callbackUrl, challengeId) {
    const url = new URL(callbackUrl);
    assert.equal(url.protocol, 'downstage-ppt-timer:');
    assert.equal(url.searchParams.get('challenge'), challengeId);
    const code = url.searchParams.get('code');
    assert.match(code, /^[A-Za-z0-9_-]{32,64}$/);
    return code;
  }

  const accounts = new Map();
  async function signInWithAccount(account) {
    if (!accounts.has(account.email)) {
      await createUserWithEmailAndPassword(auth, account.email, account.password);
      accounts.set(account.email, auth.currentUser.uid);
      return;
    }
    const { signInWithEmailAndPassword } = require('firebase/auth');
    await signInWithEmailAndPassword(auth, account.email, account.password);
  }

  await runSuite([
    ['begin rejects an unregistered callback scheme', async () => {
      await expectCode(
        call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'evil-app' }),
        'invalid-argument',
        'bad scheme',
      );
    }],
    ['begin rejects unknown request keys', async () => {
      await expectCode(
        call('beginPresentationPublisherAuth', {
          clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'downstage-ppt-timer', ownerUid: 'x',
        }),
        'invalid-argument',
        'unknown key',
      );
    }],
    ['approval flow mints a dedicated publisher principal', async () => {
      await signOut(auth);
      const pkce = pkcePair();
      const before = Date.now();
      const begun = await call('beginPresentationPublisherAuth', {
        clientRequestId: requestId(), codeChallenge: pkce.challenge, callbackScheme: 'downstage-ppt-timer',
      });
      assert.match(begun.challengeId, /^[A-Za-z0-9_-]{22,64}$/);
      assert.equal(begun.approvalUrl, `http://localhost:5173/publisher/device/approve?challenge=${begun.challengeId}`);
      assert.ok(begun.expiresAtMs >= before + 5 * 60_000 - 5_000 && begun.expiresAtMs <= Date.now() + 5 * 60_000);

      await expectCode(
        call('completePresentationPublisherAuth', {
          clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode: 'x'.repeat(43), codeVerifier: pkce.verifier, devicePublicKey,
        }),
        'failed-precondition',
        'complete before approval',
      );
      await expectCode(call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' }), 'unauthenticated', 'anon approve');

      await signInWithAccount(owner);
      const ownerUid = auth.currentUser.uid;
      const approved = await call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' });
      assert.equal(approved.status, 'approved');
      const authorizationCode = callbackCode(approved.callbackUrl, begun.challengeId);
      await expectCode(call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' }), 'failed-precondition', 'replayed approval');
      await signOut(auth);

      const completeRequest = { clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode, codeVerifier: pkce.verifier, devicePublicKey };
      const completed = await call('completePresentationPublisherAuth', completeRequest);
      assert.match(completed.deviceUid, /^ppd_/);
      assert.equal(typeof completed.customToken, 'string');
      assert.ok(Math.abs(completed.serverNowMs - Date.now()) < 10_000);

      // Lost-response retry returns the same device; a new request after consumption fails.
      const retried = await call('completePresentationPublisherAuth', completeRequest);
      assert.equal(retried.deviceUid, completed.deviceUid);
      await expectCode(
        call('completePresentationPublisherAuth', { ...completeRequest, clientRequestId: requestId() }),
        'failed-precondition',
        'second consumption',
      );

      const credential = await signInWithCustomToken(auth, completed.customToken);
      const claims = (await credential.user.getIdTokenResult()).claims;
      assert.equal(credential.user.uid, completed.deviceUid);
      assert.equal(claims.role, 'presentation-publisher');
      assert.equal(claims.ownerUid, ownerUid);
      assert.equal(claims.deviceUid, completed.deviceUid);

      const device = await adminRead(`presentationPublisherDevices/${completed.deviceUid}`);
      assert.equal(device.ownerUid, ownerUid);
      assert.equal(device.status, 'active');
      const challenge = await adminRead(`presentationPublisherAuthChallenges/${begun.challengeId}`);
      assert.equal(challenge.status, 'consumed');
      assert.equal(challenge.deviceUid, completed.deviceUid);
      await signOut(auth);
    }],
    ['a wrong verifier burns the challenge', async () => {
      await signOut(auth);
      const pkce = pkcePair();
      const begun = await call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkce.challenge, callbackScheme: 'downstage-ppt-timer' });
      await signInWithAccount(owner);
      const approved = await call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' });
      const authorizationCode = callbackCode(approved.callbackUrl, begun.challengeId);
      await signOut(auth);
      await expectCode(
        call('completePresentationPublisherAuth', { clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode, codeVerifier: pkcePair().verifier, devicePublicKey }),
        'permission-denied',
        'wrong verifier',
      );
      await expectCode(
        call('completePresentationPublisherAuth', { clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode, codeVerifier: pkce.verifier, devicePublicKey }),
        'failed-precondition',
        'correct verifier after burn',
      );
    }],
    ['a denied challenge cannot complete', async () => {
      await signOut(auth);
      const pkce = pkcePair();
      const begun = await call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkce.challenge, callbackScheme: 'downstage-ppt-timer' });
      await signInWithAccount(owner);
      assert.deepEqual(await call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'deny' }), { status: 'denied' });
      await signOut(auth);
      await expectCode(
        call('completePresentationPublisherAuth', {
          clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode: 'x'.repeat(43), codeVerifier: pkce.verifier, devicePublicKey,
        }),
        'failed-precondition',
        'denied',
      );
    }],
    ['begin is idempotent per clientRequestId', async () => {
      await signOut(auth);
      const request = { clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'downstage-ppt-timer' };
      const first = await call('beginPresentationPublisherAuth', request);
      assert.deepEqual(await call('beginPresentationPublisherAuth', request), first);
    }],
    ['a phished approval cannot be completed without the callback code', async () => {
      // Attacker starts the flow with their own verifier and lures the owner into approving.
      await signOut(auth);
      const attacker = pkcePair();
      const begun = await call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: attacker.challenge, callbackScheme: 'downstage-ppt-timer' });
      await signInWithAccount(owner);
      await call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' });
      await signOut(auth);
      await expectCode(
        call('completePresentationPublisherAuth', {
          clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode: 'A'.repeat(43), codeVerifier: attacker.verifier, devicePublicKey,
        }),
        'permission-denied',
        'guessed code',
      );
      await expectCode(
        call('completePresentationPublisherAuth', { clientRequestId: requestId(), challengeId: begun.challengeId, codeVerifier: attacker.verifier, devicePublicKey }),
        'invalid-argument',
        'missing code',
      );
    }],
    ['a publisher device token is not an owner', async () => {
      const device = await approveDevice(owner);
      await signOut(auth);
      const begun = await call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkcePair().challenge, callbackScheme: 'downstage-ppt-timer' });
      await signInWithCustomToken(auth, device.customToken);
      await expectCode(call('approvePresentationPublisherAuth', { challengeId: begun.challengeId, decision: 'approve' }), 'permission-denied', 'device approves');
      await signOut(auth);
    }],
    ['sessions: create, idempotent retry, secret separation, cap, and resume', async () => {
      const device = await approveDevice(owner);
      await signInWithCustomToken(auth, device.customToken);

      const createRequest = { clientRequestId: requestId() };
      const created = await call('createPresentationSession', createRequest);
      assert.match(created.sessionId, /^[A-Za-z0-9_-]{20,128}$/);
      assert.equal(created.viewerGeneration, 1);
      assert.equal(created.epoch, 1);
      assert.ok(Math.abs(created.activeWindowExpiresAtMs - (Date.now() + 24 * 3_600_000)) < 15_000);
      const prefix = `http://localhost:5173/session/${created.sessionId}/view#token=`;
      assert.ok(created.viewerUrl.startsWith(prefix), created.viewerUrl);
      const token = created.viewerUrl.slice(prefix.length);
      assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);

      assert.deepEqual(await call('createPresentationSession', createRequest), created, 'lost-response retry');
      await expectCode(call('createPresentationSession', { ...createRequest, roomId: 'room-1' }), 'already-exists', 'mismatched retry');

      const session = await adminRead(`presentationSessions/${created.sessionId}`);
      assert.equal(session.ownerUid, accounts.get(owner.email));
      assert.equal(session.publisherDeviceUid, device.deviceUid);
      assert.equal(session.epoch, 1);
      assert.equal(session.lastSequence, 0);
      assert.equal(session.status, 'active');
      assert.equal(session.sourceKind, 'powerpoint');
      assert.equal(session.viewerGeneration, 1);
      assert.equal(session.activeWindowExpiresAtMs, created.activeWindowExpiresAtMs);
      assert.equal(session.cleanupAfterMs, created.activeWindowExpiresAtMs + 7 * 24 * 3_600_000);
      const state = await adminRead(`presentationSessionViewerStates/${created.sessionId}`);
      assert.deepEqual(
        { status: state.status, sourceKind: state.sourceKind, viewerGeneration: state.viewerGeneration, activeWindowExpiresAtMs: state.activeWindowExpiresAtMs },
        { status: 'active', sourceKind: 'powerpoint', viewerGeneration: 1, activeWindowExpiresAtMs: created.activeWindowExpiresAtMs },
      );
      const links = (await adminDump('presentationViewerLinks')).filter((l) => l.sessionId === created.sessionId);
      assert.equal(links.length, 1);
      assert.match(links[0].id, /^[0-9a-f]{64}$/);
      assert.deepEqual(
        { status: links[0].status, viewerGeneration: links[0].viewerGeneration, expiresAtMs: links[0].expiresAtMs },
        { status: 'active', viewerGeneration: 1, expiresAtMs: created.activeWindowExpiresAtMs },
      );
      // The plaintext token is never stored anywhere.
      for (const collection of ['presentationSessions', 'presentationSessionViewerStates', 'presentationViewerLinks', 'presentationRequestResults']) {
        const dump = JSON.stringify(await adminDump(collection));
        assert.ok(!dump.includes(token), `plaintext token stored in ${collection}`);
      }

      // Per-owner cap of three active sessions.
      await call('createPresentationSession', { clientRequestId: requestId() });
      await call('createPresentationSession', { clientRequestId: requestId() });
      await expectCode(call('createPresentationSession', { clientRequestId: requestId() }), 'resource-exhausted', 'fourth session');

      // Resume increments epoch, resets sequence, extends the window.
      const resumeRequest = { sessionId: created.sessionId, clientRequestId: requestId() };
      const resumed = await call('resumePresentationSession', resumeRequest);
      assert.equal(resumed.epoch, 2);
      assert.equal(resumed.viewerUrl, created.viewerUrl);
      assert.ok(resumed.activeWindowExpiresAtMs >= created.activeWindowExpiresAtMs);
      assert.deepEqual(await call('resumePresentationSession', resumeRequest), resumed, 'resume retry');
      const afterResume = await adminRead(`presentationSessions/${created.sessionId}`);
      assert.equal(afterResume.epoch, 2);
      assert.equal(afterResume.lastSequence, 0);
      await expectCode(call('resumePresentationSession', { sessionId: 'missing_session_id', clientRequestId: requestId() }), 'not-found', 'unknown session');

      // A second publisher (other owner's device) cannot resume this session.
      await signOut(auth);
      const foreign = await approveDevice(other);
      await signInWithCustomToken(auth, foreign.customToken);
      await expectCode(call('resumePresentationSession', { sessionId: created.sessionId, clientRequestId: requestId() }), 'permission-denied', 'foreign device');

      // An ordinary signed-in owner is not a publisher.
      await signOut(auth);
      await signInWithAccount(owner);
      await expectCode(call('createPresentationSession', { clientRequestId: requestId() }), 'permission-denied', 'owner as publisher');

      // Device lifecycle: refresh, owner revoke (idempotent), then the device is blocked.
      await signOut(auth);
      await signInWithCustomToken(auth, device.customToken);
      const refreshed = await call('refreshPresentationPublisherDevice', { clientRequestId: requestId() });
      assert.equal(refreshed.status, 'active');
      await signOut(auth);
      await signInWithAccount(other);
      await expectCode(
        call('revokePresentationPublisherDevice', { deviceUid: device.deviceUid, clientRequestId: requestId() }),
        'permission-denied',
        'foreign owner revoke',
      );
      await signOut(auth);
      await signInWithAccount(owner);
      const revokeRequest = { deviceUid: device.deviceUid, clientRequestId: requestId() };
      assert.deepEqual(await call('revokePresentationPublisherDevice', revokeRequest), { status: 'revoked' });
      assert.deepEqual(await call('revokePresentationPublisherDevice', { ...revokeRequest, clientRequestId: requestId() }), { status: 'revoked' });
      await signOut(auth);
      await signInWithCustomToken(auth, device.customToken);
      await expectCode(call('createPresentationSession', { clientRequestId: requestId() }), 'permission-denied', 'revoked device');
      await expectCode(call('resumePresentationSession', { sessionId: created.sessionId, clientRequestId: requestId() }), 'permission-denied', 'revoked resume');

      // Revocation ends the device's sessions, so viewers see ended and the owner's cap frees up.
      const endedState = await adminRead(`presentationSessionViewerStates/${created.sessionId}`);
      assert.equal(endedState.status, 'ended');
      assert.equal((await adminRead(`presentationSessions/${created.sessionId}`)).status, 'ended');
      await signOut(auth);
      const replacement = await approveDevice(owner);
      await signInWithCustomToken(auth, replacement.customToken);
      const fresh = await call('createPresentationSession', { clientRequestId: requestId() });
      assert.equal(fresh.epoch, 1);
    }],
  ]);

  await signOut(auth).catch(() => {});
  await testEnv.cleanup();
  await deleteApp(app);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
