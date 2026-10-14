import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { RemotePublisherAdmitResult, RemotePublisherTokenResponse } from '@ontime/interface-contracts';
import { createRemoteSnapshotHub, type RemoteSnapshotDeps } from './remote-snapshot';

// ---------------------------------------------------------------------------
// Fakes. `isLoopback` mirrors main.ts verbatim (the shared auth helpers stay
// in main.ts; the hub only receives them through the deps bag).
// ---------------------------------------------------------------------------

function isLoopback(remoteAddress?: string | null): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

type Emitted = { roomId: string; event: string; payload: any };

function makeHarness(overrides: Partial<RemoteSnapshotDeps> = {}) {
  let now = 1_000_000;
  let counter = 0;
  const roomEmits: Emitted[] = [];
  const hub = createRemoteSnapshotHub({
    now: () => now,
    isLoopback,
    emitToRoom: (roomId, event, payload) => roomEmits.push({ roomId, event, payload }),
    generateToken: () => `pub-token-${++counter}`,
    ...overrides,
  });
  return { hub, roomEmits, advance: (ms: number) => { now += ms; }, now: () => now };
}

type FakeSocket = ReturnType<typeof makeSocket>;

function makeSocket(address: string | undefined = '127.0.0.1', data: Record<string, unknown> = {}) {
  const emitted: Array<{ event: string; payload: any }> = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    id: `sock-${Math.random().toString(36).slice(2, 8)}`,
    data,
    handshake: { address },
    emitted,
    handlers,
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return true;
    },
    on(event: string, handler: (payload: unknown) => void) {
      handlers.set(event, handler);
      return this;
    },
    last(event: string) {
      return [...emitted].reverse().find((entry) => entry.event === event)?.payload;
    },
  };
}

function makeReq(overrides: { url?: string; method?: string; headers?: Record<string, string>; remoteAddress?: string | null; body?: unknown } = {}) {
  const raw = overrides.body === undefined ? '' : typeof overrides.body === 'string' ? overrides.body : JSON.stringify(overrides.body);
  return Object.assign(Readable.from(raw ? [Buffer.from(raw)] : []), {
    url: overrides.url ?? '/api/remote-snapshot/publisher-token',
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
    socket: { remoteAddress: overrides.remoteAddress === undefined ? '127.0.0.1' : overrides.remoteAddress },
  }) as any;
}

function makeRes() {
  const res = {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    done: Promise.resolve(),
    writeHead(status: number, headers: Record<string, string> = {}) {
      res.status = status;
      res.headers = headers;
    },
    end(body = '') {
      res.body = body;
      resolve();
    },
  };
  let resolve: () => void = () => {};
  res.done = new Promise<void>((r) => {
    resolve = r;
  });
  return res;
}

async function call(hub: ReturnType<typeof makeHarness>['hub'], reqOverrides: Parameters<typeof makeReq>[0] = {}) {
  const req = makeReq(reqOverrides);
  const res = makeRes();
  const handled = hub.handleHttp(req, res);
  if (handled) await res.done;
  return { handled, res, json: res.body ? JSON.parse(res.body) : undefined };
}

async function mint(hub: ReturnType<typeof makeHarness>['hub'], roomId = 'room-1'): Promise<RemotePublisherTokenResponse> {
  const result = await call(hub, { body: { roomId } });
  assert.equal(result.res.status, 200);
  return result.json;
}

function admitPayload(token: string, roomId = 'room-1') {
  return { type: 'REMOTE_PUBLISHER_ADMIT', roomId, token, timestamp: 1 };
}

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
    sessionId: 'sess_A',
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

function publishPayload(snap: unknown = snapshot(), roomId = 'room-1') {
  return { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId, snapshot: snap, timestamp: 1 };
}

async function admittedPublisher(h: ReturnType<typeof makeHarness>, roomId = 'room-1'): Promise<FakeSocket> {
  const { token } = await mint(h.hub, roomId);
  const socket = makeSocket();
  const result = h.hub.admitPublisher(socket, admitPayload(token, roomId));
  assert.equal(result.admitted, true);
  return socket;
}

// ---------------------------------------------------------------------------
// Token minting (loopback HTTP)
// ---------------------------------------------------------------------------

test('S9a mint: loopback POST without a browser origin returns a short-lived opaque token', async () => {
  const h = makeHarness();
  const { handled, res, json } = await call(h.hub, { body: { roomId: ' room-1 ' } });
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(json, { roomId: 'room-1', token: 'pub-token-1', expiresAt: h.now() + 60_000 });
});

test('S9a mint: ignores unrelated paths so main.ts falls through', async () => {
  const h = makeHarness();
  const { handled } = await call(h.hub, { url: '/api/pairing/claim' });
  assert.equal(handled, false);
});

test('S9a mint: default token generator is long and unique', async () => {
  const hub = createRemoteSnapshotHub({ now: () => 5, isLoopback, emitToRoom: () => {} });
  const a = await mint(hub);
  const b = await mint(hub);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
});

test('S9a mint: refuses non-loopback callers and mints nothing', async () => {
  const h = makeHarness();
  for (const remoteAddress of ['192.168.1.20', '10.0.0.4', 'fe80::1', null]) {
    const { res, json } = await call(h.hub, { remoteAddress, body: { roomId: 'room-1' } });
    assert.equal(res.status, 403, String(remoteAddress));
    assert.deepEqual(json, { error: 'Forbidden' });
  }
  // The only token generated afterwards is #1: nothing was minted for the LAN callers.
  assert.equal((await mint(h.hub)).token, 'pub-token-1');
});

test('S9a mint: refuses browser requests (Origin or Sec-Fetch-Site) and CORS preflight', async () => {
  const h = makeHarness();
  const origin = await call(h.hub, { headers: { origin: 'https://evil.example' }, body: { roomId: 'room-1' } });
  assert.equal(origin.res.status, 403);
  const localOrigin = await call(h.hub, { headers: { origin: 'http://localhost:5173' }, body: { roomId: 'room-1' } });
  assert.equal(localOrigin.res.status, 403);
  const fetchSite = await call(h.hub, { headers: { 'sec-fetch-site': 'same-site' }, body: { roomId: 'room-1' } });
  assert.equal(fetchSite.res.status, 403);
  const preflight = await call(h.hub, { method: 'OPTIONS' });
  assert.equal(preflight.res.status, 403);
  assert.equal(preflight.res.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal((await mint(h.hub)).token, 'pub-token-1');
});

test('S9a mint: validates method and body', async () => {
  const h = makeHarness();
  assert.equal((await call(h.hub, { method: 'GET' })).res.status, 405);
  assert.equal((await call(h.hub, { body: '{not json' })).res.status, 400);
  assert.equal((await call(h.hub, { body: { roomId: '' } })).res.status, 400);
  assert.equal((await call(h.hub, { body: { roomId: 7 } })).res.status, 400);
  assert.equal((await call(h.hub, { body: { roomId: 'x'.repeat(129) } })).res.status, 400);
  assert.equal((await call(h.hub, { body: JSON.stringify({ roomId: 'room-1', pad: 'x'.repeat(4096) }) })).res.status, 413);
});

// ---------------------------------------------------------------------------
// Socket admission
// ---------------------------------------------------------------------------

test('S9a admit: a loopback socket with a fresh token becomes the room publisher', async () => {
  const h = makeHarness();
  const { token } = await mint(h.hub);
  const socket = makeSocket('::ffff:127.0.0.1');
  const result = h.hub.admitPublisher(socket, admitPayload(token));
  assert.equal(result.admitted, true);
  assert.equal(socket.data.remotePublisherRoomId, 'room-1');
  assert.deepEqual(socket.last('REMOTE_PUBLISHER_ADMIT_RESULT'), {
    type: 'REMOTE_PUBLISHER_ADMIT_RESULT',
    roomId: 'room-1',
    admitted: true,
    timestamp: h.now(),
  } satisfies RemotePublisherAdmitResult);
});

test('S9a admit: a token is one-time (a second claim, even from loopback, is TOKEN_REUSED)', async () => {
  const h = makeHarness();
  const { token } = await mint(h.hub);
  const first = makeSocket();
  const second = makeSocket();
  assert.equal(h.hub.admitPublisher(first, admitPayload(token)).admitted, true);
  const denied = h.hub.admitPublisher(second, admitPayload(token));
  assert.deepEqual(denied.admitted === false && denied.code, 'TOKEN_REUSED');
  assert.equal(second.data.remotePublisherRoomId, undefined);
});

test('S9a admit: a non-loopback socket is refused and burns the token', async () => {
  const h = makeHarness();
  const { token } = await mint(h.hub);
  const lan = makeSocket('192.168.1.50');
  const denied = h.hub.admitPublisher(lan, admitPayload(token));
  assert.deepEqual(denied.admitted === false && denied.code, 'NOT_LOOPBACK');
  assert.equal(lan.data.remotePublisherRoomId, undefined);
  const retry = h.hub.admitPublisher(makeSocket(), admitPayload(token));
  assert.deepEqual(retry.admitted === false && retry.code, 'TOKEN_REUSED');
});

test('S9a admit: unknown, expired, wrong-room and malformed claims are refused', async () => {
  const h = makeHarness();
  const code = (socket: FakeSocket, payload: unknown) => {
    const result = h.hub.admitPublisher(socket, payload);
    return result.admitted ? 'admitted' : result.code;
  };
  assert.equal(code(makeSocket(), admitPayload('nope')), 'TOKEN_INVALID');
  // A viewer-style JWT is not a publisher token.
  assert.equal(code(makeSocket(), admitPayload('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aWV3ZXIifQ.sig')), 'TOKEN_INVALID');

  const expiring = await mint(h.hub);
  h.advance(60_001);
  assert.equal(code(makeSocket(), admitPayload(expiring.token)), 'TOKEN_EXPIRED');

  const other = await mint(h.hub, 'room-2');
  assert.equal(code(makeSocket(), admitPayload(other.token, 'room-1')), 'ROOM_MISMATCH');
  assert.equal(code(makeSocket(), admitPayload(other.token, 'room-2')), 'TOKEN_REUSED');

  assert.equal(code(makeSocket(), null), 'INVALID_PAYLOAD');
  assert.equal(code(makeSocket(), { type: 'REMOTE_PUBLISHER_ADMIT', roomId: 'room-1' }), 'INVALID_PAYLOAD');
  assert.equal(code(makeSocket(), { ...admitPayload('x'), type: 'JOIN_ROOM' }), 'INVALID_PAYLOAD');
  assert.equal(code(makeSocket(), admitPayload('x'.repeat(300))), 'INVALID_PAYLOAD');
});

test('S9a admit: a socket that already joined a room as a client cannot become the publisher', async () => {
  const h = makeHarness();
  const { token } = await mint(h.hub);
  const viewer = makeSocket('127.0.0.1', { clientId: 'viewer-1', clientType: 'viewer', viewerRole: 'all' });
  const denied = h.hub.admitPublisher(viewer, admitPayload(token));
  assert.deepEqual(denied.admitted === false && denied.code, 'ALREADY_JOINED');
  // The token survives a refused socket that never held it.
  assert.equal(h.hub.admitPublisher(makeSocket(), admitPayload(token)).admitted, true);
});

test('S9a admit: outstanding tokens are bounded', async () => {
  const h = makeHarness();
  const first = await mint(h.hub);
  for (let i = 0; i < 20; i += 1) await mint(h.hub);
  const evicted = h.hub.admitPublisher(makeSocket(), admitPayload(first.token));
  assert.deepEqual(evicted.admitted === false && evicted.code, 'TOKEN_INVALID');
});

// ---------------------------------------------------------------------------
// Publish authorization (role gate; caching is covered by the S9b tests)
// ---------------------------------------------------------------------------

test('S9a publish authorization: only an admitted loopback publisher with a strict snapshot passes', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  const decision = h.hub.authorizePublish(publisher, publishPayload());
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.roomId, 'room-1');
  assert.equal(decision.ok && decision.snapshot.sessionId, 'sess_A');
});

test('S9a publish authorization: LAN viewers and unadmitted sockets are UNAUTHORIZED_ROLE', async () => {
  const h = makeHarness();
  const viewer = makeSocket('192.168.1.50', { clientId: 'v', clientType: 'viewer', viewerRole: 'all', roomId: 'room-1' });
  const loopbackViewer = makeSocket('127.0.0.1', { clientId: 'v2', clientType: 'viewer', viewerRole: 'all', roomId: 'room-1' });
  const controller = makeSocket('127.0.0.1', { clientId: 'c', clientType: 'controller', roomId: 'room-1' });
  const anonymous = makeSocket();
  for (const socket of [viewer, loopbackViewer, controller, anonymous]) {
    const decision = h.hub.authorizePublish(socket, publishPayload());
    assert.deepEqual(decision.ok === false && decision.code, 'UNAUTHORIZED_ROLE');
  }
  // A forged data flag on a LAN socket still fails the loopback re-check.
  const forged = makeSocket('192.168.1.50', { remotePublisherRoomId: 'room-1' });
  const forgedDecision = h.hub.authorizePublish(forged, publishPayload());
  assert.deepEqual(forgedDecision.ok === false && forgedDecision.code, 'NOT_LOOPBACK');
});

test('S9a publish authorization: wrong room and invalid snapshots are rejected', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  const code = (payload: unknown) => {
    const decision = h.hub.authorizePublish(publisher, payload);
    return decision.ok ? 'ok' : decision.code;
  };
  assert.equal(code(publishPayload(snapshot(), 'room-2')), 'ROOM_MISMATCH');
  assert.equal(code(null), 'INVALID_PAYLOAD');
  assert.equal(code({ type: 'REMOTE_SNAPSHOT', roomId: 'room-1', snapshot: snapshot() }), 'INVALID_PAYLOAD');
  assert.equal(code({ type: 'REMOTE_SNAPSHOT_PUBLISH', snapshot: snapshot() }), 'INVALID_PAYLOAD');
  assert.equal(code(publishPayload(null)), 'INVALID_SNAPSHOT');
  assert.equal(code(publishPayload(snapshot({ fullName: 'C:\\Shows\\a.pptx' }))), 'INVALID_SNAPSHOT');
  assert.equal(code(publishPayload(snapshot({ schemaMajor: 2 }))), 'INVALID_SNAPSHOT');
  assert.equal(code(publishPayload({ snapshot: snapshot() })), 'INVALID_SNAPSHOT');
});

// ---------------------------------------------------------------------------
// S9b: validate, order, cache, bootstrap, broadcast
// ---------------------------------------------------------------------------

function publish(h: ReturnType<typeof makeHarness>, socket: FakeSocket, snap: unknown, roomId = 'room-1') {
  h.hub.publish(socket, publishPayload(snap, roomId));
  return socket.last('REMOTE_SNAPSHOT_PUBLISH_RESULT');
}

test('S9b publish: an accepted full snapshot is acked, cached verbatim, and broadcast to the room', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  const snap = snapshot({ sequence: 4 });
  const result = publish(h, publisher, snap);
  assert.deepEqual(result, {
    type: 'REMOTE_SNAPSHOT_PUBLISH_RESULT',
    roomId: 'room-1',
    sessionId: 'sess_A',
    accepted: true,
    order: 'apply',
    epoch: 1,
    sequence: 4,
    timestamp: h.now(),
  });
  assert.equal(h.roomEmits.length, 1);
  assert.equal(h.roomEmits[0].roomId, 'room-1');
  assert.equal(h.roomEmits[0].event, 'REMOTE_SNAPSHOT');
  assert.deepEqual(h.roomEmits[0].payload, { type: 'REMOTE_SNAPSHOT', roomId: 'room-1', snapshot: snap, timestamp: h.now() });
});

test('S9b ordering: duplicates and regressions are rejected without a broadcast; higher epochs reset', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  const outcome = (snap: unknown) => {
    const result = publish(h, publisher, snap);
    return result.accepted ? `accepted:${result.order}` : `${result.code}@${result.lastEpoch}.${result.lastSequence}`;
  };
  assert.equal(outcome(snapshot({ epoch: 2, sequence: 5 })), 'accepted:apply');
  assert.equal(outcome(snapshot({ epoch: 2, sequence: 5 })), 'DUPLICATE@2.5');
  assert.equal(outcome(snapshot({ epoch: 2, sequence: 3 })), 'REGRESSION@2.5');
  assert.equal(outcome(snapshot({ epoch: 1, sequence: 99 })), 'REGRESSION@2.5');
  assert.equal(outcome(snapshot({ epoch: 2, sequence: 9 })), 'accepted:apply', 'gaps are allowed');
  assert.equal(outcome(snapshot({ epoch: 3, sequence: 1 })), 'accepted:reset');
  assert.equal(outcome(snapshot({ epoch: 2, sequence: 100 })), 'REGRESSION@3.1');
  assert.deepEqual(h.roomEmits.map((entry) => entry.payload.snapshot.sequence), [5, 9, 1]);
});

test('S9b publish: invalid, wrong-room and unauthorized publishes are rejected, never cached or broadcast', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  const lanViewer = makeSocket('192.168.1.60', { clientId: 'v', clientType: 'viewer', viewerRole: 'all', roomId: 'room-1' });
  const anonymous = makeSocket();
  assert.equal(publish(h, publisher, snapshot({ fullName: 'C:\\x.pptx' })).code, 'INVALID_SNAPSHOT');
  assert.equal(publish(h, publisher, snapshot(), 'room-2').code, 'ROOM_MISMATCH');
  assert.equal(publish(h, lanViewer, snapshot()).code, 'UNAUTHORIZED_ROLE');
  assert.equal(publish(h, anonymous, snapshot()).code, 'UNAUTHORIZED_ROLE');
  h.hub.publish(publisher, 'garbage');
  assert.equal(publisher.last('REMOTE_SNAPSHOT_PUBLISH_RESULT').code, 'INVALID_PAYLOAD');
  assert.equal(h.roomEmits.length, 0);
  const viewer = makeSocket();
  h.hub.bootstrapViewer(viewer, 'room-1');
  assert.equal(viewer.emitted.length, 0);
});

test('S9b publish: a reused token cannot create a second publisher', async () => {
  const h = makeHarness();
  const { token } = await mint(h.hub);
  const first = makeSocket();
  const second = makeSocket();
  assert.equal(h.hub.admitPublisher(first, admitPayload(token)).admitted, true);
  assert.equal(h.hub.admitPublisher(second, admitPayload(token)).admitted, false);
  assert.equal(publish(h, second, snapshot()).code, 'UNAUTHORIZED_ROLE');
  assert.equal(publish(h, first, snapshot()).accepted, true);
});

test('S9b bootstrap: a newly admitted viewer receives the latest cached full snapshot first', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  publish(h, publisher, snapshot({ sequence: 1 }));
  const latest = snapshot({ sequence: 2, observedAtMs: 1_000_500 });
  publish(h, publisher, latest);
  h.advance(5_000);
  const late = makeSocket('192.168.1.70');
  h.hub.bootstrapViewer(late, 'room-1');
  assert.deepEqual(late.emitted, [
    { event: 'REMOTE_SNAPSHOT', payload: { type: 'REMOTE_SNAPSHOT', roomId: 'room-1', snapshot: latest, timestamp: h.now() } },
  ]);
});

test('S9b bootstrap: rooms are isolated and a room without a session bootstraps nothing', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h, 'room-1');
  publish(h, publisher, snapshot());
  const other = makeSocket();
  h.hub.bootstrapViewer(other, 'room-2');
  assert.equal(other.emitted.length, 0);
  h.hub.bootstrapViewer(other, 'room-1');
  assert.equal(other.emitted.length, 1);
});

test('S9b session binding: a session id stays bound to the room that first published it', async () => {
  const h = makeHarness();
  const first = await admittedPublisher(h, 'room-1');
  const second = await admittedPublisher(h, 'room-2');
  publish(h, first, snapshot());
  assert.equal(publish(h, second, snapshot({ sequence: 2 }), 'room-2').code, 'SESSION_BOUND_TO_OTHER_ROOM');
  const viewer = makeSocket();
  h.hub.bootstrapViewer(viewer, 'room-2');
  assert.equal(viewer.emitted.length, 0);
});

test('S9b end: stopping drops the cache, notifies viewers, and refuses a resurrecting publish', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  publish(h, publisher, snapshot());
  h.roomEmits.length = 0;
  h.hub.endSession(publisher, { type: 'REMOTE_SNAPSHOT_END', roomId: 'room-1', sessionId: 'sess_A', timestamp: 1 });
  assert.deepEqual(h.roomEmits, [
    { roomId: 'room-1', event: 'REMOTE_SNAPSHOT_ENDED', payload: { type: 'REMOTE_SNAPSHOT_ENDED', roomId: 'room-1', sessionId: 'sess_A', timestamp: h.now() } },
  ]);
  const viewer = makeSocket();
  h.hub.bootstrapViewer(viewer, 'room-1');
  assert.equal(viewer.emitted.length, 0);
  assert.equal(publish(h, publisher, snapshot({ epoch: 9, sequence: 1 })).code, 'SESSION_ENDED');
  assert.equal(h.roomEmits.length, 1);
});

test('S9b end: only the admitted publisher of the owning room can end a session', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h, 'room-1');
  const stranger = await admittedPublisher(h, 'room-2');
  const lanViewer = makeSocket('192.168.1.60', { clientId: 'v', clientType: 'viewer', viewerRole: 'all' });
  publish(h, publisher, snapshot());
  h.roomEmits.length = 0;
  const end = { type: 'REMOTE_SNAPSHOT_END', roomId: 'room-1', sessionId: 'sess_A', timestamp: 1 };
  h.hub.endSession(lanViewer, end);
  h.hub.endSession(stranger, { ...end, roomId: 'room-2' });
  h.hub.endSession(stranger, end);
  h.hub.endSession(publisher, { ...end, sessionId: 'sess_unknown' });
  h.hub.endSession(publisher, null);
  assert.equal(h.roomEmits.length, 0);
  assert.equal(publish(h, publisher, snapshot({ sequence: 2 })).accepted, true);
});

test('S9b clearRoom: drops cached sessions and pending tokens for a deleted room', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  publish(h, publisher, snapshot());
  const pending = await mint(h.hub);
  h.hub.clearRoom('room-1');
  const viewer = makeSocket();
  h.hub.bootstrapViewer(viewer, 'room-1');
  assert.equal(viewer.emitted.length, 0);
  assert.deepEqual(h.hub.admitPublisher(makeSocket(), admitPayload(pending.token)).admitted, false);
});

test('S9b bounds: a room keeps at most four sessions (oldest evicted)', async () => {
  const h = makeHarness();
  const publisher = await admittedPublisher(h);
  for (let i = 0; i < 5; i += 1) {
    h.advance(10);
    assert.equal(publish(h, publisher, snapshot({ sessionId: `sess_${i}` })).accepted, true);
  }
  const viewer = makeSocket();
  h.hub.bootstrapViewer(viewer, 'room-1');
  assert.deepEqual(viewer.emitted.map((entry) => entry.payload.snapshot.sessionId), ['sess_1', 'sess_2', 'sess_3', 'sess_4']);
});

test('S9b registration: publisher events are wired next to admission', async () => {
  const h = makeHarness();
  const socket = makeSocket();
  h.hub.registerSocket(socket);
  assert.deepEqual([...socket.handlers.keys()].sort(), ['REMOTE_PUBLISHER_ADMIT', 'REMOTE_SNAPSHOT_END', 'REMOTE_SNAPSHOT_PUBLISH']);
  const { token } = await mint(h.hub);
  socket.handlers.get('REMOTE_PUBLISHER_ADMIT')!(admitPayload(token));
  socket.handlers.get('REMOTE_SNAPSHOT_PUBLISH')!(publishPayload());
  assert.equal(socket.last('REMOTE_SNAPSHOT_PUBLISH_RESULT').accepted, true);
});

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

test('S9a boundary: the module imports no cloud, Electron, socket server, or main.ts code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'remote-snapshot.ts'), 'utf8');
  const specifiers = [...source.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert.doesNotMatch(specifier, /firebase|electron|socket\.io|\.\/main|cloud|local-sync/i, specifier);
  }
});
