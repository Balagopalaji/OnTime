/**
 * ISSUE-002 S6c emulator integration: the real compiled ppt-timer publisher
 * sidecar (core + launcher + safeStorage broker + REST cloud client) against
 * the Auth/Functions/Firestore emulators — system-browser approval relay,
 * sealed credential, session create/resume, viewer link, material publish,
 * viewer read, end, and sign-out. Requires `npm run build:main` in apps/ppt-timer.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { MessageChannel } = require('node:worker_threads');
const { signInWithCustomToken, signOut } = require('firebase/auth');
const { doc, getDoc } = require('firebase/firestore');
const { runSuite } = require('./emu-harness');
const { createPresentationHarness } = require('./presentation-harness');

const dist = path.resolve(__dirname, '../../apps/ppt-timer/dist/main/publisher-sidecar');
const { createSidecarCore } = require(`${dist}/sidecar-core.js`);
const { createSidecarLauncher } = require(`${dist}/launcher.js`);
const { createCredentialBroker } = require(`${dist}/credential-store.js`);
const { isAllowedApprovalUrl, parseAuthCallbackUrl } = require(`${dist}/approval.js`);

const WEB_ORIGIN = 'http://localhost:5173';
const CREDENTIAL = '/userData/publisher-credential.bin';
const config = { apiKey: 'demo-key', projectId: process.env.GCLOUD_PROJECT, region: 'us-central1', emulatorHost: '127.0.0.1' };

/** Reversible stand-in for Electron safeStorage; the file still must not contain plaintext. */
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...Buffer.from(text, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (bytes) => Buffer.from([...bytes].map((b) => b ^ 0x5a)).toString('utf8'),
};
function memoryFs() {
  const files = new Map();
  const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    files,
    readFile: async (p) => files.get(p) ?? Promise.reject(missing()),
    writeFile: async (p, data) => void files.set(p, Buffer.from(data)),
    rename: async (from, to) => (files.has(from) ? (files.set(to, files.get(from)), void files.delete(from)) : Promise.reject(missing())),
    rm: async (p) => (files.delete(p) ? undefined : Promise.reject(missing())),
  };
}

/** Spawn factory: the real sidecar core in-process over a MessageChannel (utilityProcess stand-in). */
function inProcessSpawn() {
  const { port1, port2 } = new MessageChannel();
  const listeners = [];
  const wrap = (port) => ({
    postMessage: (m) => port.postMessage(m),
    onMessage: (l) => port.on('message', l),
    close: () => port.close(),
  });
  createSidecarCore({ port: wrap(port2), exit: (code) => listeners.forEach((l) => l(code)), cloud: { config, fetch } });
  return { port: wrap(port1), kill: () => listeners.forEach((l) => l(null)), onExit: (l) => listeners.push(l) };
}

const candidate = (slideNumber, observedAtMs = Date.now()) => ({
  schemaMajor: 1,
  sourceKind: 'powerpoint',
  sourceMajor: 1,
  observedAtMs,
  availability: 'active',
  payload: {
    reason: 'presentation',
    presentationState: 'playing',
    slideNumber,
    slideCount: 12,
    displayTitle: 'Sunday Service',
    headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
    videos: [{ ordinal: 0, label: 'Walk-in loop', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true }],
  },
});

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  const h = await createPresentationHarness('s6c');
  const owner = h.newAccount('owner');
  const fs = memoryFs();
  const broker = createCredentialBroker({ safeStorage, fs, filePath: CREDENTIAL });

  /** Start a sidecar; the "owner in the browser" approves whatever approval URL main is asked to open. */
  async function startSidecar() {
    const connection = await createSidecarLauncher({ spawn: inProcessSpawn, broker }).start();
    const events = [];
    const opened = [];
    connection.onEvent(async (event) => {
      events.push(event);
      if (event.kind !== 'AUTH_REQUIRED') return;
      assert.ok(isAllowedApprovalUrl(event.url, WEB_ORIGIN), `approval URL pinned to the web origin: ${event.url}`);
      opened.push(event.url);
      const challengeId = new URL(event.url).searchParams.get('challenge');
      await h.signInWithAccount(owner);
      const approved = await h.call('approvePresentationPublisherAuth', { challengeId, decision: 'approve' });
      await signOut(h.auth);
      const callback = parseAuthCallbackUrl(approved.callbackUrl, 'downstage-ppt-timer');
      assert.ok(callback, 'callback URI parses');
      assert.deepEqual(await connection.send({ kind: 'AUTH_CALLBACK', ...callback }), { ok: true });
    });
    const status = () => events.filter((e) => e.kind === 'PUBLISH_STATUS').map((e) => e.status);
    const link = () => events.filter((e) => e.kind === 'VIEWER_LINK').map((e) => e.url).at(-1);
    return { connection, events, opened, status, link };
  }

  async function viewerSnapshot(url) {
    const parsed = new URL(url);
    const sessionId = parsed.pathname.split('/')[2];
    const token = parsed.hash.slice('#token='.length);
    await signOut(h.auth);
    const resolved = await h.call('resolvePresentationViewerLink', { sessionId, token });
    await signInWithCustomToken(h.auth, resolved.customToken);
    const snap = await getDoc(doc(h.clientDb, `presentationSessionSnapshots/${sessionId}`));
    return { sessionId, snapshot: snap.exists() ? snap.data().snapshot : null };
  }

  let first;
  let sessionId;
  await runSuite([
    ['first share approves via the system-browser relay, seals the credential, and publishes live', async () => {
      first = await startSidecar();
      assert.deepEqual(await first.connection.send({ kind: 'SHARE_START' }), { ok: true });
      await first.connection.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: candidate(3) });
      await waitFor(() => first.status().includes('live'), 'live');
      assert.deepEqual(first.status(), ['connecting', 'awaiting-approval', 'live']);
      assert.equal(first.opened.length, 1);
      const sealed = fs.files.get(CREDENTIAL);
      assert.equal(sealed.subarray(0, 6).toString('utf8'), 'ODPC1\n');
      assert.ok(!sealed.toString('utf8').includes('ppd_'), 'credential file is not plaintext');
    }],
    ['the viewer link resolves and the viewer reads the published snapshot', async () => {
      const viewer = await viewerSnapshot(first.link());
      sessionId = viewer.sessionId;
      assert.equal(viewer.snapshot.epoch, 1);
      assert.equal(viewer.snapshot.sequence, 1);
      assert.equal(viewer.snapshot.payload.slideNumber, 3);
    }],
    ['a material change publishes the next sequence', async () => {
      await first.connection.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: candidate(4) });
      await waitFor(async () => (await h.adminRead(`presentationSessions/${sessionId}`)).lastSequence === 2, 'sequence 2');
      const viewer = await viewerSnapshot(first.link());
      assert.equal(viewer.snapshot.payload.slideNumber, 4);
    }],
    ['a restarted sidecar restores the sealed session without re-approval and resumes into a new epoch', async () => {
      assert.equal(await first.connection.shutdown(2_000), 'clean');
      const second = await startSidecar();
      await second.connection.send({ kind: 'SHARE_START' });
      await second.connection.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: candidate(5) });
      await waitFor(() => second.status().includes('live'), 'live after restart');
      assert.equal(second.opened.length, 0, 'no second approval');
      const viewer = await viewerSnapshot(second.link());
      assert.equal(viewer.sessionId, sessionId);
      assert.equal(viewer.snapshot.epoch, 2);
      assert.equal(viewer.snapshot.sequence, 1);
      first = second;
    }],
    ['end session: viewers see ended, then sign-out revokes the device and clears the credential', async () => {
      const session = await h.adminRead(`presentationSessions/${sessionId}`);
      await first.connection.send({ kind: 'END_SESSION' });
      await waitFor(() => first.status().includes('ended'), 'ended');
      assert.equal((await h.adminRead(`presentationSessionViewerStates/${sessionId}`)).status, 'ended');
      await first.connection.send({ kind: 'SIGN_OUT' });
      await waitFor(() => first.status().includes('signed-out'), 'signed-out');
      assert.equal((await h.adminRead(`presentationPublisherDevices/${session.publisherDeviceUid}`)).status, 'revoked');
      await waitFor(() => !fs.files.has(CREDENTIAL), 'credential cleared');
      await first.connection.shutdown(2_000);
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
