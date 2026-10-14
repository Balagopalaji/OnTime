/**
 * Integration of the LAN remote-snapshot hub with the real Companion wiring
 * (ISSUE-002 S9a/S9b): the loopback token route on the viewer HTTP handler,
 * the registered socket events, the existing pairing flow, and JOIN_ROOM.
 * The hub's own behavior is covered in remote-snapshot.test.ts.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const loadMain = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1';
  process.env.HOME = '/tmp/ontime-companion-remote-snapshot-tests';
  return import('./main.js');
};

type Handler = (payload?: unknown) => void;

function makeSocket(address: string, id: string) {
  const handlers = new Map<string, Handler>();
  const emitted: Array<{ event: string; payload: any }> = [];
  const rooms = new Set<string>();
  return {
    id,
    data: {} as Record<string, any>,
    handshake: { address },
    conn: { remoteAddress: address, on: () => {} },
    rooms,
    handlers,
    emitted,
    disconnected: false,
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event: string, payload?: unknown) {
      emitted.push({ event, payload });
      return true;
    },
    join(room: string) {
      rooms.add(room);
    },
    leave(room: string) {
      rooms.delete(room);
    },
    disconnect() {
      this.disconnected = true;
    },
    fire(event: string, payload?: unknown) {
      const handler = handlers.get(event);
      assert.ok(handler, `no handler registered for ${event}`);
      handler(payload);
    },
    events(event: string) {
      return emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
    },
  };
}

type FakeSocket = ReturnType<typeof makeSocket>;

/** Registers the real socket handlers on a fake io server and returns a connector. */
function connector(m: any) {
  let onConnection: ((socket: FakeSocket) => void) | null = null;
  m.registerSocketHandlers({ on: (_event: string, cb: (socket: FakeSocket) => void) => { onConnection = cb; } }, true);
  assert.ok(onConnection);
  return (address: string, id: string): FakeSocket => {
    const socket = makeSocket(address, id);
    onConnection!(socket);
    return socket;
  };
}

function httpCall(handler: (req: any, res: any) => void, options: { url: string; method?: string; address?: string; body?: unknown; headers?: Record<string, string> }) {
  const raw = options.body === undefined ? '' : JSON.stringify(options.body);
  const req = Object.assign(Readable.from(raw ? [Buffer.from(raw)] : []), {
    url: options.url,
    method: options.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    socket: { remoteAddress: options.address ?? '127.0.0.1' },
  });
  return new Promise<{ status: number; json: any }>((resolve) => {
    const res = {
      status: 0,
      writeHead(status: number) {
        res.status = status;
      },
      end(body = '') {
        resolve({ status: res.status, json: body ? JSON.parse(body) : undefined });
      },
    };
    handler(req, res);
  });
}

function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = log;
      console.warn = warn;
    });
}

test('S9a wiring: the token route lives on the viewer HTTP handlers and is loopback-only', async () => {
  const m: any = await loadMain();
  const handler = m.createViewerRequestHandler({ allowLan: true });
  const lan = await httpCall(handler, { url: '/api/remote-snapshot/publisher-token', address: '192.168.1.40', body: { roomId: 'room-1' } });
  assert.equal(lan.status, 403);
  const browser = await httpCall(handler, {
    url: '/api/remote-snapshot/publisher-token',
    body: { roomId: 'room-1' },
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(browser.status, 403);
  const local = await httpCall(handler, { url: '/api/remote-snapshot/publisher-token', body: { roomId: 'room-1' } });
  assert.equal(local.status, 200);
  assert.equal(local.json.roomId, 'room-1');
  assert.ok(local.json.token.length >= 43);
});

test('LAN request listener answers a malformed request target with 400 instead of throwing', async () => {
  const m: any = await loadMain();
  const handler = m.createViewerRequestHandler({ allowLan: true });
  for (const url of ['//', 'http://', '/%E0%A4%A']) {
    const lan = await httpCall(handler, { url, method: 'GET', address: '192.168.1.40' });
    assert.equal(lan.status, 400, url);
  }
});

test('S9a wiring: only a loopback socket with a minted one-time token is admitted as publisher', async () => {
  const m: any = await loadMain();
  const connect = connector(m);
  const handler = m.createViewerRequestHandler({ allowLan: true });
  const { json } = await httpCall(handler, { url: '/api/remote-snapshot/publisher-token', body: { roomId: 'room-w1' } });
  const claim = { type: 'REMOTE_PUBLISHER_ADMIT', roomId: 'room-w1', token: json.token, timestamp: 1 };

  const lan = connect('192.168.1.40', 'lan-sock');
  lan.fire('REMOTE_PUBLISHER_ADMIT', claim);
  assert.equal(lan.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].code, 'NOT_LOOPBACK');

  const local = connect('127.0.0.1', 'local-sock');
  local.fire('REMOTE_PUBLISHER_ADMIT', claim);
  assert.equal(local.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].code, 'TOKEN_REUSED', 'the LAN attempt burned the token');

  const { json: fresh } = await httpCall(handler, { url: '/api/remote-snapshot/publisher-token', body: { roomId: 'room-w1' } });
  const ok = connect('127.0.0.1', 'local-sock-2');
  ok.fire('REMOTE_PUBLISHER_ADMIT', { ...claim, token: fresh.token });
  assert.equal(ok.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].admitted, true);
  assert.equal(ok.data.remotePublisherRoomId, 'room-w1');
});

test('S9a wiring: the publisher token is not a JOIN_ROOM credential and is not on the control path', async () => {
  const m: any = await loadMain();
  const connect = connector(m);
  const handler = m.createViewerRequestHandler({ allowLan: true });
  m.setJwtSecretForTests('remote-snapshot-test-secret');
  const { json } = await httpCall(handler, { url: '/api/remote-snapshot/publisher-token', body: { roomId: 'room-w2' } });
  const intruder = connect('127.0.0.1', 'intruder');
  await quiet(() =>
    intruder.fire('JOIN_ROOM', { type: 'JOIN_ROOM', roomId: 'room-w2', token: json.token, clientType: 'viewer', clientId: 'intruder' }),
  );
  assert.equal(intruder.events('HANDSHAKE_ERROR')[0].code, 'INVALID_TOKEN');
  assert.equal(intruder.disconnected, true);
});

// ---------------------------------------------------------------------------
// S9b: bootstrap, broadcast, unauthorized publish, and the 20-device cap
// ---------------------------------------------------------------------------

const LAN_ADDRESS = '192.168.1.40';
const PUBLISHER_TOKEN_URL = '/api/remote-snapshot/publisher-token';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaMajor: 1,
    sourceKind: 'powerpoint',
    sourceMajor: 1,
    observedAtMs: 1_000_000,
    availability: 'active',
    payload: {
      reason: 'presentation',
      presentationState: 'playing',
      slideNumber: 3,
      slideCount: 12,
      displayTitle: 'Sunday Service',
      headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [
        {
          ordinal: 0,
          label: 'Walk-in loop',
          status: 'playing',
          durationMs: 120_000,
          elapsedMsAtObservation: 30_000,
          remainingMsAtObservation: 90_000,
          isFocus: true,
        },
      ],
    },
    sessionId: 'sess_main',
    epoch: 1,
    sequence: 1,
    observationAgeMs: 10,
    preCommitTransitMs: 0,
    publishedAtMs: 1_000_000,
    heartbeatIntervalMs: 10_000,
    staleAfterMs: 25_000,
    disconnectAfterMs: 60_000,
    ...overrides,
  };
}

/** Pairs a LAN device through the real claim route; returns the HTTP outcome. */
async function claimViewer(m: any, roomId: string, code: string, deviceName: string) {
  const handler = m.createViewerRequestHandler({ allowLan: true });
  return httpCall(handler, {
    url: '/api/pairing/claim',
    address: LAN_ADDRESS,
    body: { roomId, code, deviceName },
  });
}

async function admittedPublisher(m: any, connect: (address: string, id: string) => FakeSocket, roomId: string, id: string) {
  const handler = m.createViewerRequestHandler({ allowLan: true });
  const { json } = await httpCall(handler, { url: PUBLISHER_TOKEN_URL, body: { roomId } });
  const publisher = connect('127.0.0.1', id);
  publisher.fire('REMOTE_PUBLISHER_ADMIT', { type: 'REMOTE_PUBLISHER_ADMIT', roomId, token: json.token, timestamp: 1 });
  assert.equal(publisher.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].admitted, true);
  return publisher;
}

async function joinViewer(m: any, connect: (address: string, id: string) => FakeSocket, roomId: string, socketId: string, clientId: string) {
  const claimed = await claimViewer(m, roomId, m.createPairingCode(roomId).code, `Device ${clientId}`);
  assert.equal(claimed.status, 200);
  const viewer = connect(LAN_ADDRESS, socketId);
  await quiet(() =>
    viewer.fire('JOIN_ROOM', { type: 'JOIN_ROOM', roomId, token: claimed.json.token, clientType: 'viewer', clientId }),
  );
  assert.equal(viewer.events('HANDSHAKE_ACK').length, 1);
  return viewer;
}

test('S9b wiring: a paired LAN viewer is bootstrapped with the cached snapshot and receives later broadcasts', async () => {
  const m: any = await loadMain();
  m.setJwtSecretForTests('remote-snapshot-test-secret');
  const roomId = 'room-s9b-flow';
  const broadcasts: Array<{ roomId: string; event: string; payload: any }> = [];
  m.ioServers.length = 0;
  m.ioServers.push({
    to: (room: string) => ({ emit: (event: string, payload: unknown) => broadcasts.push({ roomId: room, event, payload }) }),
    sockets: { sockets: new Map() },
  });
  const connect = connector(m);
  const publisher = await admittedPublisher(m, connect, roomId, 'pub-flow');

  const first = snapshot({ sequence: 1 });
  publisher.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: first, timestamp: 1 });
  assert.equal(publisher.events('REMOTE_SNAPSHOT_PUBLISH_RESULT')[0].accepted, true);
  const remoteBroadcasts = () => broadcasts.filter((entry) => entry.event === 'REMOTE_SNAPSHOT');
  assert.equal(remoteBroadcasts().length, 1);
  assert.equal(remoteBroadcasts()[0].roomId, roomId);
  assert.deepEqual(remoteBroadcasts()[0].payload.snapshot, first);

  // Pair through the existing flow, then join with the viewer JWT.
  const viewer = await joinViewer(m, connect, roomId, 'lan-viewer', 'lan-viewer-1');
  const bootstrap = viewer.events('REMOTE_SNAPSHOT');
  assert.equal(bootstrap.length, 1);
  assert.deepEqual(bootstrap[0].snapshot, first);
  assert.equal(bootstrap[0].roomId, roomId);
  const ackIndex = viewer.emitted.findIndex((entry) => entry.event === 'HANDSHAKE_ACK');
  const snapIndex = viewer.emitted.findIndex((entry) => entry.event === 'REMOTE_SNAPSHOT');
  assert.ok(snapIndex > ackIndex, 'bootstrap follows the handshake');

  // A later accepted publish is broadcast to the room; a regression is not.
  const second = snapshot({ sequence: 2 });
  publisher.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: second, timestamp: 2 });
  publisher.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: first, timestamp: 3 });
  assert.equal(remoteBroadcasts().length, 2);
  assert.deepEqual(remoteBroadcasts()[1].payload.snapshot, second);
  assert.equal(publisher.events('REMOTE_SNAPSHOT_PUBLISH_RESULT')[2].code, 'REGRESSION');

  // A viewer joining a different room never sees this room's snapshot.
  const outsider = await joinViewer(m, connect, 'room-s9b-other', 'lan-outsider', 'lan-outsider-1');
  assert.equal(outsider.events('REMOTE_SNAPSHOT').length, 0);
});

test('S9b wiring: with nothing published there is nothing to bootstrap, and a viewer cannot feed one', async () => {
  const m: any = await loadMain();
  m.setJwtSecretForTests('remote-snapshot-test-secret');
  const roomId = 'room-s9b-empty';
  const connect = connector(m);
  const viewer = await joinViewer(m, connect, roomId, 'lan-viewer-empty', 'lan-viewer-2');
  assert.equal(viewer.events('REMOTE_SNAPSHOT').length, 0);
  viewer.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: snapshot(), timestamp: 1 });
  assert.equal(viewer.events('REMOTE_SNAPSHOT_PUBLISH_RESULT')[0].code, 'UNAUTHORIZED_ROLE');
  const later = await joinViewer(m, connect, roomId, 'lan-viewer-later', 'lan-viewer-3');
  assert.equal(later.events('REMOTE_SNAPSHOT').length, 0, 'the refused publish cached nothing');
});

test('S9b wiring: LAN viewers cannot publish, end sessions, or claim the publisher role', async () => {
  const m: any = await loadMain();
  m.setJwtSecretForTests('remote-snapshot-test-secret');
  const roomId = 'room-s9b-deny';
  m.ioServers.length = 0;
  const broadcasts: any[] = [];
  m.ioServers.push({ to: () => ({ emit: (_e: string, p: unknown) => broadcasts.push(p) }), sockets: { sockets: new Map() } });
  const connect = connector(m);
  const viewer = await joinViewer(m, connect, roomId, 'lan-deny', 'lan-deny-1');

  viewer.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: snapshot(), timestamp: 1 });
  assert.equal(viewer.events('REMOTE_SNAPSHOT_PUBLISH_RESULT')[0].code, 'UNAUTHORIZED_ROLE');

  // Even holding a freshly minted token (as if leaked), a joined viewer or a LAN socket is refused.
  const handler = m.createViewerRequestHandler({ allowLan: true });
  const { json } = await httpCall(handler, { url: PUBLISHER_TOKEN_URL, body: { roomId } });
  viewer.fire('REMOTE_PUBLISHER_ADMIT', { type: 'REMOTE_PUBLISHER_ADMIT', roomId, token: json.token, timestamp: 1 });
  assert.equal(viewer.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].code, 'ALREADY_JOINED');
  const lanOnly = connect(LAN_ADDRESS, 'lan-deny-2');
  lanOnly.fire('REMOTE_PUBLISHER_ADMIT', { type: 'REMOTE_PUBLISHER_ADMIT', roomId, token: json.token, timestamp: 1 });
  assert.equal(lanOnly.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].code, 'NOT_LOOPBACK');
  lanOnly.fire('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: snapshot(), timestamp: 1 });
  assert.equal(lanOnly.events('REMOTE_SNAPSHOT_PUBLISH_RESULT')[0].code, 'UNAUTHORIZED_ROLE');

  // The LAN attempt spent the token: the local sidecar cannot reuse it either.
  const sidecar = connect('127.0.0.1', 'sidecar-after-leak');
  sidecar.fire('REMOTE_PUBLISHER_ADMIT', { type: 'REMOTE_PUBLISHER_ADMIT', roomId, token: json.token, timestamp: 1 });
  assert.equal(sidecar.events('REMOTE_PUBLISHER_ADMIT_RESULT')[0].code, 'TOKEN_REUSED');
  assert.equal(broadcasts.filter((p) => p?.type === 'REMOTE_SNAPSHOT').length, 0);
});

test('S9b wiring: the existing 20-device cap admits 20 pairings and denies device 21', async () => {
  const m: any = await loadMain();
  m.setJwtSecretForTests('remote-snapshot-test-secret');
  const roomId = 'room-s9b-cap';
  const code = m.createPairingCode(roomId).code;
  for (let device = 1; device <= 20; device += 1) {
    const claimed = await claimViewer(m, roomId, code, `Device ${device}`);
    assert.equal(claimed.status, 200, `device ${device} should pair`);
  }
  const denied = await claimViewer(m, roomId, code, 'Device 21');
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.json, { error: 'DEVICE_LIMIT' });

  // The publisher role neither consumes nor bypasses viewer capacity.
  const connect = connector(m);
  await admittedPublisher(m, connect, roomId, 'pub-cap');
  const stillDenied = await claimViewer(m, roomId, code, 'Device 22');
  assert.equal(stillDenied.status, 403);
  assert.deepEqual(stillDenied.json, { error: 'DEVICE_LIMIT' });
});
