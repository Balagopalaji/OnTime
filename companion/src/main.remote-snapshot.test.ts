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
