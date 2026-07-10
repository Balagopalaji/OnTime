import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createRoomCacheAdapter, type RoomCacheStores } from './room-cache.js';

// ---------------------------------------------------------------------------
// Test seams: in-memory fs, single-slot fake debounce timer, controllable clock.
// The adapter has no Electron dependency, so this is a pure unit test — no
// bootstrap stubbing required.
// ---------------------------------------------------------------------------

const CACHE_FILE = '/cache/rooms.json';
const CACHE_DIR = path.dirname(CACHE_FILE);

class FakeENOENT extends Error {
  code = 'ENOENT' as const;
}

function makeFakeFs(initial = new Map<string, string>()) {
  const files = new Map<string, string>(initial);
  let writeCount = 0;
  const fs = {
    async readFile(p: string, _encoding: BufferEncoding) {
      if (!files.has(p)) throw new FakeENOENT();
      return files.get(p)!;
    },
    async writeFile(p: string, data: string, _encoding: BufferEncoding) {
      writeCount++;
      files.set(p, data);
    },
    async mkdir(_p: string, _opts: { recursive: true }) {
      return undefined;
    },
    async copyFile(src: string, dest: string) {
      // Mirror node: throws ENOENT if the source is absent.
      if (!files.has(src)) throw new FakeENOENT();
      files.set(dest, files.get(src)!);
    },
    async readdir(dir: string) {
      const prefix = dir + path.sep;
      const names: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
      }
      return names;
    },
    async unlink(p: string) {
      files.delete(p);
    },
  };
  return { fs, files, writeCount: () => writeCount };
}

function makeFakeTimer() {
  let pending: { handle: number; cb: () => void } | null = null;
  let nextHandle = 1;
  let clears = 0;
  const timer = {
    setTimeout(cb: () => void, _ms: number) {
      const handle = nextHandle++;
      pending = { handle, cb };
      return handle;
    },
    clearTimeout(handle: unknown) {
      if (pending && pending.handle === handle) {
        pending = null;
        clears++;
      }
    },
    fire() {
      const p = pending;
      pending = null;
      if (p) p.cb();
    },
    hasPending: () => pending !== null,
    clears: () => clears,
  };
  return timer;
}

function makeStores(): RoomCacheStores {
  return {
    roomStateStore: new Map(),
    roomTimersStore: new Map(),
    roomCuesStore: new Map(),
    roomControlAuditStore: new Map(),
    roomPinStore: new Map(),
    roomOwnerStore: new Map(),
    roomViewerTokenStore: new Map(),
    roomTombstoneStore: new Map(),
  };
}

type AdapterKit = {
  stores: RoomCacheStores;
  adapter: ReturnType<typeof createRoomCacheAdapter>;
  fs: ReturnType<typeof makeFakeFs>;
  timer: ReturnType<typeof makeFakeTimer>;
  setClock: (ms: number) => void;
  logs: { log: unknown[][]; warn: unknown[][]; error: unknown[][] };
};

function makeKit(initialFiles?: Map<string, string>, startClock = 5_000): AdapterKit {
  let clock = startClock;
  const stores = makeStores();
  const fs = makeFakeFs(initialFiles);
  const timer = makeFakeTimer();
  const logs = { log: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][] };
  const adapter = createRoomCacheAdapter({
    stores,
    getCachePath: () => CACHE_FILE,
    fs: fs.fs,
    path,
    timer,
    now: () => clock,
    log: {
      log: (...a: unknown[]) => void logs.log.push(a),
      warn: (...a: unknown[]) => void logs.warn.push(a),
      error: (...a: unknown[]) => void logs.error.push(a),
    },
  });
  return { stores, adapter, fs, timer, setClock: (ms) => (clock = ms), logs };
}

// Drain pending microtasks/macrotasks so an async write triggered by the fake
// timer's callback resolves before assertions.
const drain = () => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// Obs-3 — serialize -> write -> read -> deserialize round-trip
// ---------------------------------------------------------------------------

test('round-trip: write then load reproduces all persisted stores (Obs-3)', async () => {
  const kit = makeKit();
  const { stores, adapter, fs } = kit;

  // Seed stores. Timers/cues intentionally out of order to also exercise sort.
  stores.roomStateStore.set('r1', {
    activeTimerId: 't2',
    isRunning: true,
    currentTime: 12_000,
    lastUpdate: 1_000,
    showClock: true,
    title: 'Show',
    timezone: 'UTC',
    message: { text: 'hi', visible: true, color: 'blue' },
  });
  stores.roomTimersStore.set('r1', new Map([
    ['t3', { id: 't3', order: 3, duration: 30_000 } as any],
    ['t1', { id: 't1', order: 1, duration: 10_000 } as any],
    ['t2', { id: 't2', order: 2, duration: 20_000 } as any],
  ]));
  stores.roomCuesStore.set('r1', new Map([
    ['c2', { id: 'c2', order: 2 } as any],
    ['c0', { id: 'c0' } as any], // missing order -> treated as 0
    ['c1', { id: 'c1', order: 1 } as any],
  ]));
  stores.roomControlAuditStore.set('r1', [
    { action: 'request', actorId: 'a1', timestamp: 100 } as any,
  ]);
  stores.roomPinStore.set('r1', { pin: '1234', updatedAt: 200, setBy: 'op' });
  stores.roomOwnerStore.set('r1', { ownerId: 'o1', ownerName: 'Op', updatedAt: 201 });
  stores.roomViewerTokenStore.set('r1', new Map([
    ['vt1', { tokenId: 'vt1', roomId: 'r1', role: 'viewer', issuedAt: 1, expiresAt: 9_999 } as any],
  ]));
  stores.roomTombstoneStore.set('r2', { roomId: 'r2', deletedAt: 1, expiresAt: 9_999 });

  kit.adapter.scheduleWrite();
  await adapter.flush();

  // On-disk shape: keys, version, lastWrite, sorted timers/cues.
  const raw = fs.files.get(CACHE_FILE)!;
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed), [
    'version', 'lastWrite', 'rooms', 'timers', 'cues',
    'controlAudit', 'pins', 'owners', 'tombstones', 'viewerTokens',
  ]);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.lastWrite, 5_000);
  assert.deepEqual(parsed.timers.r1.map((t: any) => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(parsed.cues.r1.map((c: any) => c.id), ['c0', 'c1', 'c2']); // c0 order=0 sorts first

  // Deserialize into fresh stores and confirm equivalence.
  const kit2 = makeKit(new Map([[CACHE_FILE, raw]]), 5_000);
  await kit2.adapter.load();

  assert.equal(kit2.stores.roomStateStore.get('r1')?.currentTime, 12_000);
  assert.equal(kit2.stores.roomStateStore.get('r1')?.message?.text, 'hi');
  assert.deepEqual(
    [...kit2.stores.roomTimersStore.get('r1')!.values()].map((t: any) => t.id),
    ['t1', 't2', 't3'],
  );
  assert.deepEqual(
    [...kit2.stores.roomCuesStore.get('r1')!.values()].map((c: any) => c.id),
    ['c0', 'c1', 'c2'],
  );
  assert.equal(kit2.stores.roomControlAuditStore.get('r1')?.length, 1);
  assert.equal(kit2.stores.roomPinStore.get('r1')?.pin, '1234');
  assert.equal(kit2.stores.roomPinStore.get('r1')?.setBy, 'op');
  assert.equal(kit2.stores.roomOwnerStore.get('r1')?.ownerId, 'o1');
  assert.equal(kit2.stores.roomViewerTokenStore.get('r1')?.get('vt1')?.role, 'viewer');
  assert.deepEqual(kit2.stores.roomTombstoneStore.get('r2'), { roomId: 'r2', deletedAt: 1, expiresAt: 9_999 });
});

// ---------------------------------------------------------------------------
// Appendix A — load valid v2 cache populates all persisted stores
// ---------------------------------------------------------------------------

test('load: valid v2 cache populates every persisted store', async () => {
  const cache = {
    version: 2,
    lastWrite: 1234,
    rooms: { r1: { currentTime: 5, lastUpdate: 1, isRunning: false, activeTimerId: null } },
    timers: { r1: [{ id: 't1', order: 1, duration: 1000 }] },
    cues: { r1: [{ id: 'c1', order: 1 }] },
    controlAudit: { r1: [{ action: 'force', actorId: 'a', timestamp: 9 }] },
    pins: { r1: { pin: '9999', updatedAt: 7 } },
    owners: { r1: { ownerId: 'o', updatedAt: 8 } },
    viewerTokens: { r1: [{ tokenId: 'v', roomId: 'r1', role: 'viewer', issuedAt: 1, expiresAt: 9_999 }] },
    tombstones: {},
  };
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify(cache)]]), 5_000);
  await kit.adapter.load();

  assert.equal(kit.stores.roomStateStore.size, 1);
  assert.equal(kit.stores.roomStateStore.get('r1')?.showClock, false); // defaulted
  assert.equal(kit.stores.roomStateStore.get('r1')?.message?.color, 'green'); // defaulted
  assert.equal(kit.stores.roomTimersStore.get('r1')?.get('t1')?.duration, 1000);
  assert.equal(kit.stores.roomCuesStore.get('r1')?.get('c1')?.id, 'c1');
  assert.equal(kit.stores.roomControlAuditStore.get('r1')?.length, 1);
  assert.equal(kit.stores.roomPinStore.get('r1')?.pin, '9999');
  assert.equal(kit.stores.roomOwnerStore.get('r1')?.ownerId, 'o');
  assert.equal(kit.stores.roomViewerTokenStore.get('r1')?.get('v')?.role, 'viewer');
});

// ---------------------------------------------------------------------------
// Appendix A — version mismatch / missing rooms is ignored (fresh start)
// ---------------------------------------------------------------------------

test('load: version mismatch is ignored', async () => {
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify({ version: 1, rooms: {} })]]));
  await kit.adapter.load();
  assert.equal(kit.stores.roomStateStore.size, 0);
  assert.ok(kit.logs.warn.length > 0, 'version mismatch should warn');
});

test('load: missing rooms key is ignored', async () => {
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify({ version: 2 })]]));
  await kit.adapter.load();
  assert.equal(kit.stores.roomStateStore.size, 0);
  assert.ok(kit.logs.warn.length > 0, 'missing rooms should warn');
});

test('load: ENOENT (no cache) starts fresh with no error', async () => {
  const kit = makeKit(); // empty fs
  await kit.adapter.load();
  assert.equal(kit.stores.roomStateStore.size, 0);
  assert.equal(kit.logs.error.length, 0);
  assert.ok(kit.logs.log.some((l) => String(l[0]).includes('No existing cache')));
});

// ---------------------------------------------------------------------------
// Appendix A — expired viewer tokens and expired tombstones are pruned/skipped
// ---------------------------------------------------------------------------

test('load: expired viewer tokens are pruned, valid ones kept', async () => {
  const cache = {
    version: 2,
    rooms: { r1: { currentTime: 0, lastUpdate: 0, isRunning: false, activeTimerId: null } },
    viewerTokens: {
      r1: [
        { tokenId: 'expired', roomId: 'r1', role: 'viewer', issuedAt: 1, expiresAt: 5_000 }, // == now -> expired
        { tokenId: 'valid', roomId: 'r1', role: 'viewer', issuedAt: 1, expiresAt: 9_999 },
      ],
    },
  };
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify(cache)]]), 5_000);
  await kit.adapter.load();
  const tokens = kit.stores.roomViewerTokenStore.get('r1')!;
  assert.equal(tokens.size, 1);
  assert.ok(tokens.has('valid'));
  assert.equal(tokens.has('expired'), false);
});

test('load: expired tombstone is skipped (not stored, room data untouched)', async () => {
  const cache = {
    version: 2,
    rooms: { r1: { currentTime: 0, lastUpdate: 0, isRunning: false, activeTimerId: null } },
    tombstones: { r1: { roomId: 'r1', deletedAt: 1, expiresAt: 5_000 } }, // == now -> expired
  };
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify(cache)]]), 5_000);
  await kit.adapter.load();
  assert.equal(kit.stores.roomTombstoneStore.size, 0, 'expired tombstone must not be stored');
  assert.equal(kit.stores.roomStateStore.has('r1'), true, 'room data survives an expired tombstone');
});

// ---------------------------------------------------------------------------
// Appendix A — active tombstones delete room/timer/cue data
// ---------------------------------------------------------------------------

test('load: active tombstone deletes room/timer/cue data and is stored', async () => {
  const cache = {
    version: 2,
    rooms: { r1: { currentTime: 0, lastUpdate: 0, isRunning: false, activeTimerId: null } },
    timers: { r1: [{ id: 't1', order: 1, duration: 1 }] },
    cues: { r1: [{ id: 'c1', order: 1 }] },
    tombstones: { r1: { roomId: 'r1', deletedAt: 1, expiresAt: 9_999 } }, // active
  };
  const kit = makeKit(new Map([[CACHE_FILE, JSON.stringify(cache)]]), 5_000);
  await kit.adapter.load();
  assert.equal(kit.stores.roomStateStore.has('r1'), false, 'tombstoned room state deleted');
  assert.equal(kit.stores.roomTimersStore.has('r1'), false, 'tombstoned timers deleted');
  assert.equal(kit.stores.roomCuesStore.has('r1'), false, 'tombstoned cues deleted');
  assert.deepEqual(kit.stores.roomTombstoneStore.get('r1'), { roomId: 'r1', deletedAt: 1, expiresAt: 9_999 });
  assert.ok(kit.logs.log.some((l) => String(l[0]).includes('Applied 1 tombstones')));
});

// ---------------------------------------------------------------------------
// Appendix A — corrupted cache is backed up and old backups trimmed to 3
// ---------------------------------------------------------------------------

test('load: corrupted cache is backed up and old backups trimmed to 3', async () => {
  const garbage = '{not valid json';
  const initial = new Map<string, string>([
    [CACHE_FILE, garbage],
    // Four pre-existing backups; after adding the new one (ts 5000) the oldest two are trimmed.
    [`${CACHE_DIR}/rooms.json.backup.1000`, 'old1'],
    [`${CACHE_DIR}/rooms.json.backup.2000`, 'old2'],
    [`${CACHE_DIR}/rooms.json.backup.3000`, 'old3'],
    [`${CACHE_DIR}/rooms.json.backup.4000`, 'old4'],
  ]);
  const kit = makeKit(initial, 5_000);
  await kit.adapter.load();

  const backups = [...kit.fs.files.keys()].filter((k) => k.includes('rooms.json.backup.'));
  assert.equal(backups.length, 3, 'exactly the 3 newest backups survive');
  assert.ok(backups.some((k) => k.endsWith('.5000')), 'new backup created at now()');
  assert.ok(backups.some((k) => k.endsWith('.4000')));
  assert.ok(backups.some((k) => k.endsWith('.3000')));
  assert.equal(backups.some((k) => k.endsWith('.2000')), false, 'older backup trimmed');
  assert.equal(backups.some((k) => k.endsWith('.1000')), false, 'oldest backup trimmed');
  assert.equal(kit.fs.files.get(`${CACHE_DIR}/rooms.json.backup.5000`), garbage, 'backup holds the corrupted bytes');
});

// ---------------------------------------------------------------------------
// Appendix A — write serializes sorted timers/cues
// ---------------------------------------------------------------------------

test('write: timers serialized sorted by order, cues by (order ?? 0)', async () => {
  const kit = makeKit();
  kit.stores.roomTimersStore.set('r1', new Map([
    ['t3', { id: 't3', order: 3 } as any],
    ['t1', { id: 't1', order: 1 } as any],
    ['t2', { id: 't2', order: 2 } as any],
  ]));
  kit.stores.roomCuesStore.set('r1', new Map([
    ['c2', { id: 'c2', order: 2 } as any],
    ['cUndef', { id: 'cUndef' } as any], // order ?? 0
    ['c1', { id: 'c1', order: 1 } as any],
  ]));
  kit.adapter.scheduleWrite();
  await kit.adapter.flush();
  const parsed = JSON.parse(kit.fs.files.get(CACHE_FILE)!);
  assert.deepEqual(parsed.timers.r1.map((t: any) => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(parsed.cues.r1.map((c: any) => c.id), ['cUndef', 'c1', 'c2']);
});

// ---------------------------------------------------------------------------
// Appendix A — debounce coalesces writes; flush clears pending + writes once
// ---------------------------------------------------------------------------

test('scheduleWrite: rapid calls coalesce into one debounced write', async () => {
  const kit = makeKit();
  kit.adapter.scheduleWrite();
  kit.adapter.scheduleWrite();
  kit.adapter.scheduleWrite();
  assert.equal(kit.timer.hasPending(), true);
  assert.ok(kit.timer.clears() >= 2, 'repeated schedules clear the prior pending timer');
  kit.timer.fire();
  await drain();
  assert.equal(kit.fs.writeCount(), 1, 'exactly one write fires after debounce');
  assert.equal(kit.timer.hasPending(), false);
});

test('flush: cancels the pending debounce and writes exactly once', async () => {
  const kit = makeKit();
  kit.adapter.scheduleWrite();
  assert.equal(kit.timer.hasPending(), true);
  await kit.adapter.flush();
  assert.equal(kit.fs.writeCount(), 1, 'flush writes once');
  assert.equal(kit.timer.hasPending(), false, 'pending timer cleared');
  // Firing the (already-cleared) timer must not produce a second write.
  kit.timer.fire();
  await drain();
  assert.equal(kit.fs.writeCount(), 1);
});

test('flush: with no pending write is a no-op', async () => {
  const kit = makeKit();
  await kit.adapter.flush();
  assert.equal(kit.fs.writeCount(), 0);
});
