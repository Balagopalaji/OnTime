/**
 * Shared ISSUE-002 presentation emulator fixture: client app wired to the
 * auth/functions emulators, privileged Firestore access, and helpers for the
 * owner/device approval flow.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { deleteApp, initializeApp } = require('firebase/app');
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
} = require('firebase/auth');
const { connectFirestoreEmulator, getFirestore } = require('firebase/firestore');
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require('firebase/functions');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { getEmulatorHosts } = require('./emu-harness');

const CALLBACK_SCHEME = 'downstage-ppt-timer';

const pkcePair = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
};
const requestId = () => `req_${crypto.randomBytes(8).toString('hex')}`;
const devicePublicKey = crypto.randomBytes(48).toString('base64url');

const expectCode = async (promise, code, label) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code.includes('/') ? code : `functions/${code}`, `${label}: expected ${code}, got ${error.code} (${error.message})`);
    return true;
  });
};

/** The one-time code reaches only the approving machine, via the app's registered callback. */
function callbackCode(callbackUrl, challengeId) {
  const url = new URL(callbackUrl);
  assert.equal(url.protocol, `${CALLBACK_SCHEME}:`);
  assert.equal(url.searchParams.get('challenge'), challengeId);
  const code = url.searchParams.get('code');
  assert.match(code, /^[A-Za-z0-9_-]{32,64}$/);
  return code;
}

async function createPresentationHarness(name) {
  const hosts = await getEmulatorHosts();
  const app = initializeApp({ projectId: hosts.projectId, apiKey: 'demo-key', authDomain: 'localhost' }, `${name}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${hosts.auth.host}:${hosts.auth.port}`, { disableWarnings: true });
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, hosts.functions.host, hosts.functions.port);
  const clientDb = getFirestore(app);
  connectFirestoreEmulator(clientDb, hosts.firestore.host, hosts.firestore.port);
  const call = (fn, data) => httpsCallable(fns, fn)(data).then((r) => r.data);
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
  const adminUpdate = (path, data) => privileged((db) => db.doc(path).set(data, { merge: true }));

  const accounts = new Map();
  async function signInWithAccount(account) {
    await signOut(auth);
    if (!accounts.has(account.email)) {
      await createUserWithEmailAndPassword(auth, account.email, account.password);
      accounts.set(account.email, auth.currentUser.uid);
      return auth.currentUser.uid;
    }
    await signInWithEmailAndPassword(auth, account.email, account.password);
    return auth.currentUser.uid;
  }

  /** Full approval flow for one device; returns { deviceUid, customToken, serverNowMs }. */
  async function approveDevice(account) {
    await signOut(auth);
    const pkce = pkcePair();
    const begun = await call('beginPresentationPublisherAuth', {
      clientRequestId: requestId(),
      codeChallenge: pkce.challenge,
      callbackScheme: CALLBACK_SCHEME,
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

  async function signInAsDevice(device) {
    await signOut(auth);
    return signInWithCustomToken(auth, device.customToken);
  }

  // A second client app, so a device can act while the primary app stays signed in as a viewer.
  const sideApp = initializeApp({ projectId: hosts.projectId, apiKey: 'demo-key', authDomain: 'localhost' }, `${name}-side-${Date.now()}`);
  const sideAuth = getAuth(sideApp);
  connectAuthEmulator(sideAuth, `http://${hosts.auth.host}:${hosts.auth.port}`, { disableWarnings: true });
  const sideFns = getFunctions(sideApp);
  connectFunctionsEmulator(sideFns, hosts.functions.host, hosts.functions.port);
  async function callAs(customToken, fn, data) {
    await signInWithCustomToken(sideAuth, customToken);
    return httpsCallable(sideFns, fn)(data).then((r) => r.data);
  }

  const newAccount = (label) => ({ email: `${label}-${crypto.randomBytes(4).toString('hex')}@example.com`, password: 'password-123' });

  async function cleanup() {
    await signOut(auth).catch(() => {});
    await signOut(sideAuth).catch(() => {});
    await testEnv.cleanup();
    await deleteApp(app);
    await deleteApp(sideApp);
  }

  return {
    accounts,
    adminDump,
    adminRead,
    adminUpdate,
    approveDevice,
    auth,
    call,
    callAs,
    cleanup,
    clientDb,
    newAccount,
    privileged,
    signInAsDevice,
    signInWithAccount,
  };
}

module.exports = {
  CALLBACK_SCHEME,
  callbackCode,
  createPresentationHarness,
  devicePublicKey,
  expectCode,
  pkcePair,
  requestId,
};
