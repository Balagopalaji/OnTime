import type { Room, Timer } from '@ontime/shared-types'

// localStorage persistence cluster carved byte-faithful from
// frontend/src/context/UnifiedDataContext.tsx (Stage 1b Lane A slice LS-2)
// behind an injected storage adapter. Bodies are verbatim except the DI
// substitutions: localStorage -> deps.getStorage(), Date.now() -> deps.now(),
// navigator.onLine -> deps.isOnline().

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LocalPersistenceDeps = {
  getStorage: () => StorageLike | undefined
  now: () => number
  isOnline: () => boolean
}

export const ROOM_CACHE_KEY = 'ontime:companionRoomCache.v2'
export const SUBS_CACHE_KEY = 'ontime:companionSubs.v2'
export const TOMBSTONE_CACHE_KEY = 'ontime:deletedRoomTombstones'
export const CACHE_LIMIT = 20
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const PREVIEW_CACHE_TTL_MS = 10_000

export type CachedRoomSnapshot = {
  roomId: string
  room: Room
  timers: Timer[]
  dataTs: number
  cachedAt: number
  source: 'companion' | 'cloud'
}

export type CompanionSubscription = {
  clientType: 'controller' | 'viewer'
  token: string
  tokenSource: 'controller' | 'viewer'
}

export type LocalTombstone = {
  roomId: string
  deletedAt: number
  expiresAt: number
}

export const createLocalPersistence = (deps: LocalPersistenceDeps) => {
  const readCachedSubscriptions = (): Record<string, CompanionSubscription> => {
    const storage = deps.getStorage()
    if (!storage) return {}
    try {
      const raw = storage.getItem(SUBS_CACHE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, CompanionSubscription>
      return Object.entries(parsed ?? {}).reduce<Record<string, CompanionSubscription>>((acc, [roomId, entry]) => {
        if (!entry) return acc
        acc[roomId] = {
          clientType: entry.clientType === 'controller' ? 'controller' : 'viewer',
          token: entry.token,
          tokenSource: entry.tokenSource === 'viewer' ? 'viewer' : 'controller',
        }
        return acc
      }, {})
    } catch {
      return {}
    }
  }

  const persistSubscriptions = (subs: Record<string, CompanionSubscription>) => {
    const storage = deps.getStorage()
    if (!storage) return
    try {
      storage.setItem(SUBS_CACHE_KEY, JSON.stringify(subs))
    } catch {
      // ignore
    }
  }

  const readRoomCache = (): Record<string, CachedRoomSnapshot> => {
    const storage = deps.getStorage()
    if (!storage) return {}
    try {
      const now = deps.now()
      const isOnline = deps.isOnline()
      const raw = storage.getItem(ROOM_CACHE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<
        string,
        CachedRoomSnapshot & { updatedAt?: number; cachedAt?: number; dataTs?: number }
      >
      return Object.entries(parsed ?? {}).reduce<Record<string, CachedRoomSnapshot>>((acc, [roomId, entry]) => {
        if (!entry || typeof entry !== 'object') return acc
        const legacyUpdatedAt = (entry as { updatedAt?: number }).updatedAt
        const cachedAt =
          typeof entry.cachedAt === 'number'
            ? entry.cachedAt
            : typeof legacyUpdatedAt === 'number'
              ? legacyUpdatedAt
              : deps.now()
        const dataTs =
          typeof entry.dataTs === 'number'
            ? entry.dataTs
            : entry.room?.state?.lastUpdate ?? (typeof legacyUpdatedAt === 'number' ? legacyUpdatedAt : 0)
        if (isOnline && now - cachedAt > PREVIEW_CACHE_TTL_MS) {
          return acc
        }
        acc[roomId] = {
          roomId: entry.roomId ?? roomId,
          room: entry.room,
          timers: entry.timers ?? [],
          dataTs,
          cachedAt,
          source: entry.source === 'companion' ? 'companion' : 'cloud',
        }
        return acc
      }, {})
    } catch {
      return {}
    }
  }

  const persistRoomCache = (entries: Record<string, CachedRoomSnapshot>) => {
    const storage = deps.getStorage()
    if (!storage) return
    try {
      const ordered = Object.values(entries)
        .sort((a, b) => b.cachedAt - a.cachedAt)
        .slice(0, CACHE_LIMIT)
      const trimmed = ordered.reduce<Record<string, CachedRoomSnapshot>>((acc, entry) => {
        acc[entry.roomId] = entry
        return acc
      }, {})
      storage.setItem(ROOM_CACHE_KEY, JSON.stringify(trimmed))
    } catch {
      // ignore
    }
  }

  const readLocalTombstones = (): Record<string, LocalTombstone> => {
    const storage = deps.getStorage()
    if (!storage) return {}
    try {
      const raw = storage.getItem(TOMBSTONE_CACHE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, LocalTombstone>
      const now = deps.now()
      // Prune expired local tombstones on read
      const active: Record<string, LocalTombstone> = {}
      Object.entries(parsed).forEach(([roomId, entry]) => {
        if (entry && entry.expiresAt > now) {
          active[roomId] = entry
        }
      })
      return active
    } catch {
      return {}
    }
  }

  const persistLocalTombstones = (tombstones: Record<string, LocalTombstone>) => {
    const storage = deps.getStorage()
    if (!storage) return
    try {
      storage.setItem(TOMBSTONE_CACHE_KEY, JSON.stringify(tombstones))
    } catch {
      // ignore
    }
  }

  return {
    readCachedSubscriptions,
    persistSubscriptions,
    readRoomCache,
    persistRoomCache,
    readLocalTombstones,
    persistLocalTombstones,
  }
}
