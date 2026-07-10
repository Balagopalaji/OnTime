// rebuild-target: app-internal (apps/local-companion)
//
// Disk room-cache persistence adapter, extracted from companion/src/main.ts as
// rebuild unit U7 (see docs/rebuild-plan.md §4 and
// docs/rebuild-companion-coupling.md Appendix A).
//
// This module owns ONLY the room cache read/write/schedule/flush lifecycle plus
// corrupted-cache backup/trim. It does NOT own socket handlers, room mutation
// logic, or `applyRoomTombstone` (a cross-cutting domain op that merely ends in
// a cache write). main.ts passes the persisted stores in as a `RoomCacheStores`
// bag and receives `scheduleWrite` back as the persistence-invalidation callback.
//
// Everything that touches the filesystem, the wall clock, timers, or logging is
// injected so the adapter is testable without the real disk. The on-disk cache
// shape and write triggers are byte-faithful with the pre-carve code: the only
// substitutions are `Date.now()` -> `now`, `console.*` -> `log`, `fs`/`path` ->
// injected, and `setTimeout`/`clearTimeout` -> injected timer. The pre-carve
// in-memory `lastWriteTs` (written but never read anywhere) is intentionally not
// carried forward; the observable on-disk `lastWrite` field is preserved.

import type { CompanionRoomState } from '@ontime/interface-contracts';
import type { ControlAuditEntry } from './control-audit-utils';
import type { Cue, Timer } from '@ontime/shared-types';

type RoomState = CompanionRoomState;

/** Cache format version written into every payload and checked on load. */
export const CACHE_VERSION = 2;
/** Debounce window that coalesces rapid `scheduleWrite` calls into one write. */
export const CACHE_WRITE_DEBOUNCE_MS = 2000;

/** Persisted room state (companion room-state map). */
export type RoomCacheStateStore = Map<string, RoomState>;
/** Persisted timers per room, keyed by timer id within each room. */
export type RoomCacheTimersStore = Map<string, Map<string, Timer>>;
/** Persisted cues per room, keyed by cue id within each room. */
export type RoomCacheCuesStore = Map<string, Map<string, Cue>>;
/** Persisted control-audit log per room (last 50 entries). */
export type RoomCacheControlAuditStore = Map<string, ControlAuditEntry[]>;

/** Persisted room PIN entry. */
export interface RoomCachePinEntry {
  pin: string;
  updatedAt: number;
  setBy?: string;
  setByUserId?: string;
  setByUserName?: string;
}

/** Persisted room owner entry. */
export interface RoomCacheOwnerEntry {
  ownerId: string;
  ownerName?: string;
  updatedAt: number;
  setBy?: string;
}

/** Persisted viewer-token entry. */
export interface RoomCacheViewerTokenEntry {
  tokenId: string;
  roomId: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
  deviceName?: string;
  lastSeen?: number;
}

/** Persisted deletion tombstone (active tombstones prune room data on load). */
export interface RoomCacheTombstoneEntry {
  roomId: string;
  deletedAt: number;
  expiresAt: number;
}

/**
 * The bag of in-memory room stores that the cache serializes/deserializes.
 * main.ts owns these Maps and passes them in; the adapter only reads (on write)
 * and repopulates (on load) them.
 */
export interface RoomCacheStores {
  roomStateStore: RoomCacheStateStore;
  roomTimersStore: RoomCacheTimersStore;
  roomCuesStore: RoomCacheCuesStore;
  roomControlAuditStore: RoomCacheControlAuditStore;
  roomPinStore: Map<string, RoomCachePinEntry>;
  roomOwnerStore: Map<string, RoomCacheOwnerEntry>;
  roomViewerTokenStore: Map<string, Map<string, RoomCacheViewerTokenEntry>>;
  roomTombstoneStore: Map<string, RoomCacheTombstoneEntry>;
}

/** Subset of `node:fs/promises` used by the adapter (injectable for tests). */
export interface RoomCacheFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  copyFile(src: string, dest: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}

/** Subset of `node:path` used by the adapter (injectable for tests). */
export interface RoomCachePath {
  dirname(p: string): string;
  join(...segments: string[]): string;
}

/** Debounce timer API (injectable so tests control when writes fire). */
export interface RoomCacheTimer {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Console-shaped log sink (defaults to the global console in main.ts). */
export interface RoomCacheLog {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Everything the adapter needs from main.ts; all of it is injected. */
export interface RoomCacheAdapterDeps {
  /** Persisted room stores (owned by main.ts). */
  stores: RoomCacheStores;
  /** Resolves the absolute cache file path (platform/path logic stays in main.ts). */
  getCachePath: () => string;
  /** Filesystem API. */
  fs: RoomCacheFs;
  /** Path API. */
  path: RoomCachePath;
  /** Debounce timer API. */
  timer: RoomCacheTimer;
  /** Wall clock (ms). */
  now: () => number;
  /** Log sink. */
  log: RoomCacheLog;
}

/** Public surface of a constructed cache adapter. */
export interface RoomCacheAdapter {
  /** Read the cache file and repopulate the stores; no-op on missing/stale cache. */
  load(): Promise<void>;
  /** Coalesce a write after the debounce window; safe to call rapidly. */
  scheduleWrite(): void;
  /** Cancel any pending debounced write and write once immediately. */
  flush(): Promise<void>;
}

/**
 * Build a room-cache persistence adapter. The returned `load`/`scheduleWrite`/
 * `flush` methods are byte-faithful with the pre-carve `loadRoomCache` /
 * `scheduleRoomCacheWrite` / `flushRoomCache` functions in main.ts; only the
 * fs/path/clock/timer/log seams are injected.
 */
export function createRoomCacheAdapter(deps: RoomCacheAdapterDeps): RoomCacheAdapter {
  const { stores, fs, path, timer, now, log } = deps;

  let cacheWriteTimer: unknown = null;

  async function loadRoomCache(): Promise<void> {
    const cachePath = deps.getCachePath();
    try {
      const data = await fs.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(data) as {
        version: number;
        lastWrite?: number;
        rooms?: Record<string, RoomState>;
        timers?: Record<string, Timer[]>;
        cues?: Record<string, Cue[]>;
        controlAudit?: Record<
          string,
          Array<{
            action: 'request' | 'force' | 'handover' | 'deny';
            actorId: string;
            actorUserId?: string;
            actorUserName?: string;
            targetId?: string;
            timestamp: number;
            deviceName?: string;
            status?: 'accepted' | 'denied';
          }>
        >;
        pins?: Record<string, RoomCachePinEntry>;
        owners?: Record<string, RoomCacheOwnerEntry>;
        viewerTokens?: Record<string, RoomCacheViewerTokenEntry[]>;
        tombstones?: Record<string, RoomCacheTombstoneEntry>;
      };
      if (parsed.version !== CACHE_VERSION || !parsed.rooms) {
        log.warn('[cache] Cache version mismatch or missing rooms; starting fresh');
        return;
      }
      Object.entries(parsed.rooms).forEach(([roomId, state]) => {
        const normalized: RoomState = {
          ...state,
          showClock: state.showClock ?? false,
          message: {
            text: '',
            visible: false,
            color: 'green',
            ...(state.message ?? {}),
          },
          title: state.title,
          timezone: state.timezone,
        };
        stores.roomStateStore.set(roomId, normalized);
      });
      if (parsed.timers) {
        Object.entries(parsed.timers).forEach(([roomId, timers]) => {
          const map = new Map<string, Timer>();
          (timers ?? []).forEach((timer) => {
            if (timer && typeof timer.id === 'string') {
              map.set(timer.id, timer);
            }
          });
          if (map.size) {
            stores.roomTimersStore.set(roomId, map);
          }
        });
      }
      if (parsed.cues) {
        Object.entries(parsed.cues).forEach(([roomId, cues]) => {
          const map = new Map<string, Cue>();
          (cues ?? []).forEach((cue) => {
            if (cue && typeof cue.id === 'string') {
              map.set(cue.id, cue);
            }
          });
          if (map.size) {
            stores.roomCuesStore.set(roomId, map);
          }
        });
      }
      if (parsed.controlAudit) {
        Object.entries(parsed.controlAudit).forEach(([roomId, entries]) => {
          if (Array.isArray(entries)) {
            stores.roomControlAuditStore.set(roomId, entries.slice(-50));
          }
        });
      }
      if (parsed.pins) {
        Object.entries(parsed.pins).forEach(([roomId, entry]) => {
          if (entry && typeof entry.pin === 'string') {
            stores.roomPinStore.set(roomId, {
              pin: entry.pin,
              updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now(),
              setBy: entry.setBy,
              setByUserId: entry.setByUserId,
              setByUserName: entry.setByUserName,
            });
          }
        });
      }
      if (parsed.owners) {
        Object.entries(parsed.owners).forEach(([roomId, entry]) => {
          if (entry && typeof entry.ownerId === 'string') {
            stores.roomOwnerStore.set(roomId, {
              ownerId: entry.ownerId,
              ownerName: entry.ownerName,
              updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now(),
              setBy: entry.setBy,
            });
          }
        });
      }
      if (parsed.viewerTokens) {
        const nowMs = now();
        Object.entries(parsed.viewerTokens).forEach(([roomId, entries]) => {
          if (!Array.isArray(entries)) return;
          const map = new Map<string, RoomCacheViewerTokenEntry>();
          entries.forEach((entry) => {
            if (!entry || typeof entry.tokenId !== 'string') return;
            if (entry.expiresAt <= nowMs) return;
            map.set(entry.tokenId, entry);
          });
          if (map.size) {
            stores.roomViewerTokenStore.set(roomId, map);
          }
        });
      }
      // Load tombstones and prune expired; apply active tombstones to remove deleted rooms
      if (parsed.tombstones) {
        const nowMs = now();
        Object.entries(parsed.tombstones).forEach(([roomId, entry]) => {
          if (entry && entry.expiresAt > nowMs) {
            stores.roomTombstoneStore.set(roomId, entry);
            // Remove room data for any tombstoned room
            stores.roomStateStore.delete(roomId);
            stores.roomTimersStore.delete(roomId);
            stores.roomCuesStore.delete(roomId);
          }
        });
        if (stores.roomTombstoneStore.size > 0) {
          log.log(`[cache] Applied ${stores.roomTombstoneStore.size} tombstones, pruned deleted rooms`);
        }
      }
      log.log(`[cache] Loaded ${stores.roomStateStore.size} rooms from cache`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        log.log('[cache] No existing cache, starting fresh');
        return;
      }
      log.error('[cache] Failed to load cache, attempting backup', error);
      await backupCorruptedCache(cachePath);
    }
  }

  async function backupCorruptedCache(cachePath: string): Promise<void> {
    try {
      const cacheDir = path.dirname(cachePath);
      await fs.mkdir(cacheDir, { recursive: true });
      const timestamp = now();
      const backupPath = path.join(cacheDir, `rooms.json.backup.${timestamp}`);
      await fs.copyFile(cachePath, backupPath);
      log.warn(`[cache] Backed up corrupted cache to ${backupPath}`);
      await trimBackups(cacheDir);
    } catch (err) {
      log.error('[cache] Failed to backup corrupted cache', err);
    }
  }

  async function trimBackups(cacheDir: string): Promise<void> {
    try {
      const files = await fs.readdir(cacheDir);
      const backups = files
        .filter((f) => f.startsWith('rooms.json.backup.'))
        .map((f) => ({ file: f, ts: parseInt(f.split('.').pop() || '0', 10) }))
        .sort((a, b) => b.ts - a.ts);
      if (backups.length <= 3) return;
      const toDelete = backups.slice(3);
      await Promise.all(
        toDelete.map(({ file }) =>
          fs.unlink(path.join(cacheDir, file)).catch((err) => log.warn('[cache] Failed to delete old backup', err)),
        ),
      );
    } catch (err) {
      log.warn('[cache] Failed to trim backups', err);
    }
  }

  function scheduleRoomCacheWrite(): void {
    if (cacheWriteTimer) {
      timer.clearTimeout(cacheWriteTimer);
    }
    cacheWriteTimer = timer.setTimeout(() => {
      cacheWriteTimer = null;
      void writeRoomCache();
    }, CACHE_WRITE_DEBOUNCE_MS);
  }

  async function flushRoomCache(): Promise<void> {
    if (cacheWriteTimer) {
      timer.clearTimeout(cacheWriteTimer);
      cacheWriteTimer = null;
      await writeRoomCache();
    }
  }

  async function writeRoomCache(): Promise<void> {
    try {
      const cachePath = deps.getCachePath();
      const cacheDir = path.dirname(cachePath);
      await fs.mkdir(cacheDir, { recursive: true });
      const payload = {
        version: CACHE_VERSION,
        lastWrite: now(),
        rooms: Object.fromEntries(stores.roomStateStore.entries()),
        timers: Object.fromEntries(
          [...stores.roomTimersStore.entries()].map(([roomId, timerMap]) => [
            roomId,
            [...timerMap.values()].sort((a, b) => a.order - b.order),
          ]),
        ),
        cues: Object.fromEntries(
          [...stores.roomCuesStore.entries()].map(([roomId, cueMap]) => [
            roomId,
            [...cueMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
          ]),
        ),
        controlAudit: Object.fromEntries(stores.roomControlAuditStore.entries()),
        pins: Object.fromEntries(stores.roomPinStore.entries()),
        owners: Object.fromEntries(stores.roomOwnerStore.entries()),
        tombstones: Object.fromEntries(stores.roomTombstoneStore.entries()),
        viewerTokens: Object.fromEntries(
          [...stores.roomViewerTokenStore.entries()].map(([roomId, tokenMap]) => [
            roomId,
            [...tokenMap.values()],
          ]),
        ),
      };
      await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
      log.log(`[cache] Wrote cache with ${stores.roomStateStore.size} rooms`);
    } catch (error) {
      log.error('[cache] Failed to write cache', error);
    }
  }

  return {
    load: loadRoomCache,
    scheduleWrite: scheduleRoomCacheWrite,
    flush: flushRoomCache,
  };
}
