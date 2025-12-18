/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore'
import type { Room, Timer } from '../types'
import { db } from '../lib/firebase'
import { DataProviderBoundary, useDataContext, type DataContextValue } from './DataContext'
import { FirebaseDataProvider } from './FirebaseDataContext'
import { useAppMode } from './AppModeContext'
import { useCompanionConnection } from './CompanionConnectionContext'

type RoomAuthority = {
  source: 'cloud' | 'companion' | 'pending'
  status: 'ready' | 'syncing' | 'degraded'
  lastSyncAt: number
}

type CompanionRoomState = {
  activeTimerId: string | null
  isRunning: boolean
  currentTime: number
  lastUpdate: number
  activeLiveCueId?: string
}

type UnifiedDataContextValue = DataContextValue & {
  roomAuthority: Record<string, RoomAuthority>
  getRoomAuthority: (roomId: string) => RoomAuthority
  forceCloudAuthority: (roomId: string) => void
  forceCompanionAuthority: (roomId: string) => void
  subscribeToCompanionRoom: (
    roomId: string,
    clientType: 'controller' | 'viewer',
    tokenOverride?: string,
  ) => void
  unsubscribeFromCompanionRoom: (roomId: string) => void
}

type RoomStateSnapshotPayload = {
  type: 'ROOM_STATE_SNAPSHOT'
  roomId: string
  state: CompanionRoomState
  timestamp: number
}

type RoomStateDeltaPayload = {
  type: 'ROOM_STATE_DELTA'
  roomId: string
  changes: Partial<CompanionRoomState>
  clientId?: string
  timestamp: number
}

type TimerCreatedPayload = {
  type: 'TIMER_CREATED'
  roomId: string
  timer: Timer
  clientId?: string
  timestamp: number
}

type TimerUpdatedPayload = {
  type: 'TIMER_UPDATED'
  roomId: string
  timerId: string
  changes: Partial<Timer>
  clientId?: string
  timestamp: number
}

type TimerDeletedPayload = {
  type: 'TIMER_DELETED'
  roomId: string
  timerId: string
  clientId?: string
  timestamp: number
}

type TimersReorderedPayload = {
  type: 'TIMERS_REORDERED'
  roomId: string
  timerIds: string[]
  clientId?: string
  timestamp: number
}

type SyncRoomStatePayload = {
  type: 'SYNC_ROOM_STATE'
  roomId: string
  timers?: Timer[]
  state: {
    activeTimerId: string | null
    isRunning: boolean
    currentTime: number
    lastUpdate: number
  }
  sourceClientId?: string
  timestamp?: number
}

type HandshakeError = {
  type: 'HANDSHAKE_ERROR'
  code?: string
  message?: string
}

type QueuedEvent =
  | {
    type: 'TIMER_ACTION'
    action: 'START' | 'PAUSE' | 'RESET'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
  }
  | {
    type: 'CREATE_TIMER'
    timestamp: number
    roomId: string
    timer: Timer
    clientId: string
  }
  | {
    type: 'UPDATE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    changes: Partial<Omit<Timer, 'id' | 'roomId'>>
    clientId: string
  }
  | {
    type: 'DELETE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
  }
  | {
    type: 'REORDER_TIMERS'
    timestamp: number
    roomId: string
    timerIds: string[]
    clientId: string
  }

const DEFAULT_ROOM_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const DEFAULT_FEATURES = {
  localMode: true,
  showControl: false,
  powerpoint: false,
  externalVideo: false,
}

const DEFAULT_ROOM_STATE: Room['state'] = {
  activeTimerId: null,
  isRunning: false,
  startedAt: null,
  elapsedOffset: 0,
  progress: {},
  showClock: false,
  clockMode: '24h',
  message: {
    text: '',
    visible: false,
    color: 'green',
  },
  currentTime: 0,
  lastUpdate: 0,
}

const DEFAULT_AUTHORITY: RoomAuthority = {
  source: 'cloud',
  status: 'ready',
  lastSyncAt: 0,
}

const ROOM_CACHE_KEY = 'ontime:companionRoomCache.v1'
const SUBS_CACHE_KEY = 'ontime:companionSubs.v1'
const CACHE_LIMIT = 20

type CachedRoomSnapshot = {
  roomId: string
  room: Room
  timers: Timer[]
  updatedAt: number
  source: 'companion' | 'cloud'
}

const readCachedSubscriptions = (): Record<string, { clientType: 'controller' | 'viewer'; token: string }> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SUBS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, { clientType: 'controller' | 'viewer'; token: string }>
    return parsed ?? {}
  } catch {
    return {}
  }
}

const persistSubscriptions = (subs: Record<string, { clientType: 'controller' | 'viewer'; token: string }>) => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SUBS_CACHE_KEY, JSON.stringify(subs))
  } catch {
    // ignore
  }
}

const readRoomCache = (): Record<string, CachedRoomSnapshot> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(ROOM_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, CachedRoomSnapshot>
    return parsed ?? {}
  } catch {
    return {}
  }
}

const persistRoomCache = (entries: Record<string, CachedRoomSnapshot>) => {
  if (typeof localStorage === 'undefined') return
  try {
    const ordered = Object.values(entries)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CACHE_LIMIT)
    const trimmed = ordered.reduce<Record<string, CachedRoomSnapshot>>((acc, entry) => {
      acc[entry.roomId] = entry
      return acc
    }, {})
    localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

const deriveCompanionStateFromRoom = (room: Room): CompanionRoomState => ({
  activeTimerId: room.state.activeTimerId ?? null,
  isRunning: room.state.isRunning ?? false,
  currentTime: room.state.elapsedOffset ?? 0,
  lastUpdate: room.state.startedAt ?? room.createdAt ?? Date.now(),
  activeLiveCueId: room.state.activeLiveCueId,
})

const SESSION_CLIENT_ID_KEY = 'ontime:companionClientId'
const MAX_QUEUE = 100

const translateCompanionStateToFirebase = (
  companion: CompanionRoomState,
  fallbackState?: Room['state'],
): Room['state'] => {
  const base = fallbackState ?? DEFAULT_ROOM_STATE
  // Companion reports currentTime as elapsed-at-lastUpdate; align startedAt with lastUpdate for UI math.
  const startedAt = companion.isRunning ? companion.lastUpdate : null
  return {
    ...base,
    activeTimerId: companion.activeTimerId ?? null,
    isRunning: companion.isRunning,
    startedAt,
    elapsedOffset: companion.currentTime,
    currentTime: companion.currentTime,
    lastUpdate: companion.lastUpdate,
    activeLiveCueId: companion.activeLiveCueId ?? base.activeLiveCueId,
  }
}

export const isSnapshotStale = (
  state: Room['state'],
  snapshotTimestamp: number,
  now: number = Date.now(),
): boolean => {
  const age = now - snapshotTimestamp
  if (state.isRunning) {
    return age > 30_000
  }
  const hasProgress =
    (state.elapsedOffset ?? 0) > 0 || Object.values(state.progress ?? {}).some((val) => (val ?? 0) > 0)
  if (hasProgress) {
    return age > 24 * 60 * 60 * 1000
  }
  return false
}

const buildRoomFromCompanion = (
  roomId: string,
  companionState: CompanionRoomState,
  baseRoom?: Room,
): Room => {
  const base: Room =
    baseRoom ?? {
      id: roomId,
      ownerId: 'local',
      title: 'Local Room',
      timezone: 'UTC',
      createdAt: Date.now(),
      order: 0,
      config: DEFAULT_ROOM_CONFIG,
      state: DEFAULT_ROOM_STATE,
      tier: 'basic',
      features: DEFAULT_FEATURES,
      _version: 1,
    }

  return {
    ...base,
    config: base.config ?? DEFAULT_ROOM_CONFIG,
    features: base.features ?? DEFAULT_FEATURES,
    state: translateCompanionStateToFirebase(companionState, base.state),
  }
}

const buildDefaultCompanionState = (): CompanionRoomState => ({
  activeTimerId: null,
  isRunning: false,
  currentTime: 0,
  lastUpdate: Date.now(),
})

const UnifiedDataResolver = ({ children }: { children: ReactNode }) => {
  const debugCompanion = import.meta.env.VITE_DEBUG_COMPANION === 'true'
  const firebase = useDataContext()
  const { effectiveMode } = useAppMode()
  const { socket, handshakeStatus, token, fetchToken, clearToken } = useCompanionConnection()
  const [roomAuthority, setRoomAuthority] = useState<Record<string, RoomAuthority>>({})
  const [companionRooms, setCompanionRooms] = useState<Record<string, CompanionRoomState>>({})
  const [companionTimers, setCompanionTimers] = useState<Record<string, Timer[]>>({})
  const [subscribedRooms, setSubscribedRooms] = useState<
    Record<string, { clientType: 'controller' | 'viewer'; token: string }>
  >({})
  const [cachedSnapshots, setCachedSnapshots] = useState<Record<string, CachedRoomSnapshot>>({})
  const cachedSnapshotsRef = useRef<Record<string, CachedRoomSnapshot>>({})
  const [clientId] = useState(() => {
    if (typeof sessionStorage === 'undefined') return crypto.randomUUID()
    const cached = sessionStorage.getItem(SESSION_CLIENT_ID_KEY)
    if (cached) return cached
    const next = crypto.randomUUID()
    sessionStorage.setItem(SESSION_CLIENT_ID_KEY, next)
    return next
  })
  const subscribedRoomsRef = useRef(subscribedRooms)
  const pendingSyncRoomsRef = useRef<Set<string>>(new Set())
  const companionRoomsRef = useRef(companionRooms)
  const companionTimersRef = useRef(companionTimers)
  const tokenRefreshInFlightRef = useRef(false)
  const isReplayingRef = useRef(false)
  const firestoreEnabled = typeof navigator === 'undefined' || navigator.onLine
  const isViewerClient = useCallback(
    (roomId: string) => subscribedRoomsRef.current[roomId]?.clientType === 'viewer',
    [],
  )

  useEffect(() => {
    const cached = readRoomCache()
    cachedSnapshotsRef.current = cached
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCachedSnapshots(cached)
    if (Object.keys(cached).length) {
      setCompanionRooms((prev) => {
        const next = { ...prev }
        Object.values(cached).forEach((entry) => {
          const state = deriveCompanionStateFromRoom(entry.room)
          next[entry.roomId] = state
        })
        return next
      })
      setCompanionTimers((prev) => {
        const next = { ...prev }
        Object.values(cached).forEach((entry) => {
          next[entry.roomId] = entry.timers
        })
        return next
      })
      setRoomAuthority((prev) => {
        const next = { ...prev }
        Object.values(cached).forEach((entry) => {
          next[entry.roomId] = {
            source: 'companion',
            status: 'ready',
            lastSyncAt: entry.updatedAt,
          }
        })
        return next
      })
    }
  }, [])

  // Re-emit JOIN_ROOM on socket reconnect to restore subscriptions.
  useEffect(() => {
    if (!socket) return
    const handleReconnect = () => {
      const rooms = subscribedRoomsRef.current
      Object.entries(rooms).forEach(([roomId, sub]) => {
        socket.emit('JOIN_ROOM', {
          type: 'JOIN_ROOM',
          roomId,
          token: sub.token,
          clientType: sub.clientType,
          clientId,
        })
      })
    }
    socket.on('connect', handleReconnect)
    return () => {
      socket.off('connect', handleReconnect)
    }
  }, [clientId, socket])

  useEffect(() => {
    subscribedRoomsRef.current = subscribedRooms
  }, [subscribedRooms])

  useEffect(() => {
    companionRoomsRef.current = companionRooms
  }, [companionRooms])

  useEffect(() => {
    companionTimersRef.current = companionTimers
  }, [companionTimers])

  const addPendingSyncRoom = useCallback((roomId: string) => {
    const current = pendingSyncRoomsRef.current
    if (current.has(roomId)) return
    const next = new Set(current)
    next.add(roomId)
    pendingSyncRoomsRef.current = next
  }, [])

  const removePendingSyncRoom = useCallback((roomId: string) => {
    const current = pendingSyncRoomsRef.current
    if (!current.has(roomId)) return
    const next = new Set(current)
    next.delete(roomId)
    pendingSyncRoomsRef.current = next
  }, [])

  const clearPendingSyncRooms = useCallback(() => {
    pendingSyncRoomsRef.current = new Set()
  }, [])

  const getRoomAuthority = useCallback(
    (roomId: string) => roomAuthority[roomId] ?? DEFAULT_AUTHORITY,
    [roomAuthority],
  )

  const forceCloudAuthority = useCallback((roomId: string) => {
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'cloud',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [])

  const forceCompanionAuthority = useCallback((roomId: string) => {
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'companion',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [])

  const subscribeToCompanionRoom = useCallback(
    (roomId: string, clientType: 'controller' | 'viewer', tokenOverride?: string) => {
      void (async () => {
        const storedToken = (() => {
          try {
            return sessionStorage.getItem('ontime:companionToken') ?? localStorage.getItem('ontime:companionToken')
          } catch {
            return null
          }
        })()
        const joinToken = tokenOverride ?? storedToken ?? token ?? (await fetchToken())
        if (!joinToken) {
          console.warn('[UnifiedDataContext] missing Companion token for room', roomId)
          return
        }

        try {
          window.localStorage.setItem('ontime:companionToken', joinToken)
          sessionStorage.setItem('ontime:companionToken', joinToken)
        } catch {
          // ignore
        }

        setSubscribedRooms((prev) => {
          const next = { ...prev, [roomId]: { clientType, token: joinToken } }
          persistSubscriptions(next)
          return next
        })

        setRoomAuthority((prev) => ({
          ...prev,
          [roomId]: {
            source: 'pending',
            status: 'syncing',
            lastSyncAt: Date.now(),
          },
        }))

        if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
          if (clientType === 'controller') {
            addPendingSyncRoom(roomId)
          }
        }

        if (!socket) return
        if (!socket.connected && !socket.active) {
          socket.connect()
        }
        if (debugCompanion) {
          console.info('[companion] JOIN_ROOM', { roomId, clientType, clientId })
        }
        socket.emit('JOIN_ROOM', {
          type: 'JOIN_ROOM',
          roomId,
          token: joinToken,
          clientType,
          clientId,
        })
      })()
    },
    [addPendingSyncRoom, clientId, debugCompanion, effectiveMode, fetchToken, socket, token],
  )

  useEffect(() => {
    const saved = readCachedSubscriptions()
    if (!Object.keys(saved).length) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubscribedRooms((prev) => {
      const next = { ...prev, ...saved }
      persistSubscriptions(next)
      return next
    })
    Object.entries(saved).forEach(([roomId, sub]) => {
      subscribeToCompanionRoom(roomId, sub.clientType, sub.token)
    })
  }, [subscribeToCompanionRoom])

  const unsubscribeFromCompanionRoom = useCallback((roomId: string) => {
    setSubscribedRooms((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      persistSubscriptions(next)
      return next
    })
    setCompanionRooms((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    setCompanionTimers((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    cachedSnapshotsRef.current = (() => {
      const next = { ...cachedSnapshotsRef.current }
      if (next[roomId]) {
        delete next[roomId]
        persistRoomCache(next)
      }
      return next
    })()
    removePendingSyncRoom(roomId)
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'cloud',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [removePendingSyncRoom])

  const shouldUseCompanion = useCallback(
    (roomId: string) => {
      if (effectiveMode === 'cloud') return false
      return Boolean(subscribedRooms[roomId])
    },
    [effectiveMode, subscribedRooms],
  )

  useEffect(() => {
    const roomIds = new Set<string>([
      ...Object.keys(subscribedRoomsRef.current),
      ...Object.keys(companionRoomsRef.current),
      ...Object.keys(companionTimersRef.current),
      ...Object.keys(roomAuthority),
      ...(firebase.rooms ?? []).map((room) => room.id),
    ])
    const nextCache: Record<string, CachedRoomSnapshot> = {}
    roomIds.forEach((roomId) => {
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const usingCompanion =
        authority.source === 'companion' || authority.source === 'pending' || shouldUseCompanion(roomId)
      const companionState = usingCompanion ? companionRoomsRef.current[roomId] : undefined
      const resolvedRoom = companionState
        ? buildRoomFromCompanion(roomId, companionState, firebase.getRoom(roomId))
        : firebase.getRoom(roomId)
      const timers = usingCompanion
        ? companionTimersRef.current[roomId] ?? firebase.getTimers(roomId)
        : firebase.getTimers(roomId)
      if (!resolvedRoom) return
      nextCache[roomId] = {
        roomId,
        room: resolvedRoom,
        timers: timers ?? [],
        updatedAt: Date.now(),
        source: usingCompanion ? 'companion' : 'cloud',
      }
    })
    cachedSnapshotsRef.current = nextCache
    persistRoomCache(nextCache)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCachedSnapshots(nextCache)
  }, [companionRooms, companionTimers, firebase, roomAuthority, shouldUseCompanion])

  const ensureCompanionRoomState = useCallback((roomId: string) => {
    const existing = companionRoomsRef.current[roomId]
    if (existing) return existing
    const next = buildDefaultCompanionState()
    setCompanionRooms((prev) => ({ ...prev, [roomId]: next }))
    return next
  }, [])

  const computeCurrentTimeMs = useCallback((room: Room): number => {
    const isRunning = room.state.isRunning ?? false
    const startedAt = room.state.startedAt ?? null
    const elapsedOffset = room.state.elapsedOffset ?? 0
    if (isRunning && typeof startedAt === 'number') {
      return Math.max(0, elapsedOffset + (Date.now() - startedAt))
    }
    return Math.max(0, elapsedOffset)
  }, [])

  const computeCurrentTimeWithProgress = useCallback(
    (room: Room): number => {
      const activeId = room.state.activeTimerId
      const progress = room.state.progress ?? {}
      if (activeId && typeof progress[activeId] === 'number') {
        return Math.max(0, progress[activeId] as number)
      }
      return computeCurrentTimeMs(room)
    },
    [computeCurrentTimeMs],
  )

  const computeCompanionElapsed = useCallback((state: CompanionRoomState) => {
    if (state.isRunning) {
      return Math.max(0, state.currentTime + (Date.now() - state.lastUpdate))
    }
    return Math.max(0, state.currentTime)
  }, [])

  const loadQueue = useCallback((roomId: string): QueuedEvent[] => {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(`ontime:queue:${roomId}`)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return null
          const record = entry as Record<string, unknown>
          if (typeof record.type === 'string') return entry as QueuedEvent
          if (
            typeof record.action === 'string' &&
            typeof record.roomId === 'string' &&
            typeof record.timerId === 'string' &&
            typeof record.timestamp === 'number' &&
            typeof record.clientId === 'string'
          ) {
            return {
              type: 'TIMER_ACTION',
              action: record.action as 'START' | 'PAUSE' | 'RESET',
              roomId: record.roomId,
              timerId: record.timerId,
              timestamp: record.timestamp,
              clientId: record.clientId,
            } as QueuedEvent
          }
          return null
        })
        .filter(Boolean) as QueuedEvent[]
    } catch (error) {
      console.warn('[UnifiedDataContext] Failed to load queue', error)
      return []
    }
  }, [])

  const saveQueue = useCallback((roomId: string, queue: QueuedEvent[]) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(`ontime:queue:${roomId}`, JSON.stringify(queue))
    } catch (error) {
      console.warn('[UnifiedDataContext] Failed to save queue', error)
    }
  }, [])

  const enqueueAction = useCallback(
    (roomId: string, action: QueuedEvent) => {
      let queue = loadQueue(roomId)
      queue.push(action)
      if (queue.length > MAX_QUEUE) {
        const dropped = queue.length - MAX_QUEUE
        queue = queue.slice(dropped)
        console.warn('[UnifiedDataContext] Queue full, dropping oldest actions', {
          dropped,
          roomId,
        })
      }
      saveQueue(roomId, queue)
    },
    [loadQueue, saveQueue],
  )

  const replayRoomQueue = useCallback(
    (roomId: string) => {
      if (!socket) return
      const queue = loadQueue(roomId)
      if (!queue.length) return
      isReplayingRef.current = true
      const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp)
      sorted.forEach((item) => socket.emit(item.type, item))
      saveQueue(roomId, [])
      isReplayingRef.current = false
    },
    [loadQueue, saveQueue, socket],
  )

  const emitOrQueue = useCallback(
    (roomId: string, event: QueuedEvent) => {
      const canEmit =
        socket?.connected && handshakeStatus === 'ack' && !isReplayingRef.current

      if (canEmit) {
        socket.emit(event.type, event)
      } else {
        enqueueAction(roomId, event)
      }
    },
    [enqueueAction, handshakeStatus, socket],
  )

  const emitSyncRoomState = useCallback(
    (roomId: string) => {
      if (!socket?.connected) return
      const room = firebase.getRoom(roomId)
      if (!room) return
      const timers = firebase.getTimers(roomId)
      const currentTime = computeCurrentTimeWithProgress(room)
      const payload: SyncRoomStatePayload = {
        type: 'SYNC_ROOM_STATE',
        roomId,
        timers,
        state: {
          activeTimerId: room.state.activeTimerId ?? null,
          isRunning: room.state.isRunning ?? false,
          currentTime,
          lastUpdate: Date.now(),
        },
        sourceClientId: clientId,
        timestamp: Date.now(),
      }
      if (debugCompanion) {
        console.info('[companion] SYNC_ROOM_STATE emit', {
          roomId,
          timersCount: timers.length,
          currentTime,
        })
      }
      socket.emit('SYNC_ROOM_STATE', payload)
    },
    [clientId, computeCurrentTimeWithProgress, debugCompanion, firebase, socket],
  )

  useEffect(() => {
    if (!socket) return

    const handleConnect = () => {
      const rooms = subscribedRoomsRef.current
      Object.entries(rooms).forEach(([roomId, sub]) => {
        socket.emit('JOIN_ROOM', {
          type: 'JOIN_ROOM',
          roomId,
          token: sub.token,
          clientType: sub.clientType,
          clientId,
        })
        if ((effectiveMode === 'local' || effectiveMode === 'hybrid') && sub.clientType === 'controller') {
          addPendingSyncRoom(roomId)
        }
      })
    }

    const handleDisconnect = () => {
      const rooms = subscribedRoomsRef.current
      const usingCompanion = effectiveMode !== 'cloud' && Object.keys(rooms).length > 0
      setRoomAuthority((prev) => {
        const next = { ...prev }
        Object.keys(rooms).forEach((roomId) => {
          next[roomId] = {
            source: usingCompanion ? 'companion' : 'cloud',
            status: 'degraded',
            lastSyncAt: Date.now(),
          }
        })
        return next
      })
      clearPendingSyncRooms()
    }

    const handleHandshakeError = (err: HandshakeError) => {
      if (err?.code !== 'INVALID_TOKEN') return
      clearToken()
      if (tokenRefreshInFlightRef.current) return
      tokenRefreshInFlightRef.current = true
      void (async () => {
        const nextToken = await fetchToken()
        if (!nextToken) {
          tokenRefreshInFlightRef.current = false
          return
        }
        setSubscribedRooms((prev) => {
          const next: typeof prev = {}
          Object.entries(prev).forEach(([roomId, sub]) => {
            next[roomId] = { ...sub, token: nextToken }
          })
          return next
        })
        Object.entries(subscribedRoomsRef.current).forEach(([roomId, sub]) => {
          socket.emit('JOIN_ROOM', {
            type: 'JOIN_ROOM',
            roomId,
            token: nextToken,
            clientType: sub.clientType,
            clientId,
          })
        })
        tokenRefreshInFlightRef.current = false
      })()
    }

    const handleRoomStateSnapshot = (payload: RoomStateSnapshotPayload) => {
      const baseRoom = firebase.getRoom(payload.roomId)
      const translatedState = translateCompanionStateToFirebase(payload.state, baseRoom?.state)
      const snapshotTs = payload.state.lastUpdate ?? payload.timestamp ?? Date.now()
      if (isSnapshotStale(translatedState, snapshotTs)) {
        if (debugCompanion) {
          console.info('[companion] snapshot stale, ignoring', {
            roomId: payload.roomId,
            age: Date.now() - snapshotTs,
            isRunning: translatedState.isRunning,
          })
        }
        removePendingSyncRoom(payload.roomId)
        setRoomAuthority((prev) => ({
          ...prev,
          [payload.roomId]: {
            source: 'cloud',
            status: 'ready',
            lastSyncAt: Date.now(),
          },
        }))
        return
      }

      setCompanionRooms((prev) => ({
        ...prev,
        [payload.roomId]: {
          activeTimerId: payload.state.activeTimerId ?? null,
          isRunning: payload.state.isRunning ?? false,
          currentTime: payload.state.currentTime ?? 0,
          lastUpdate: payload.state.lastUpdate ?? Date.now(),
          activeLiveCueId: payload.state.activeLiveCueId,
        },
      }))

      const subscription = subscribedRoomsRef.current[payload.roomId]
      if (subscription?.clientType === 'controller' && pendingSyncRoomsRef.current.has(payload.roomId)) {
        emitSyncRoomState(payload.roomId)
        removePendingSyncRoom(payload.roomId)
      }

      setRoomAuthority((prev) => ({
        ...prev,
        [payload.roomId]: {
          source: 'companion',
          status: 'ready',
          lastSyncAt: Date.now(),
        },
      }))

      if (debugCompanion) {
        console.info('[companion] ROOM_STATE_SNAPSHOT', {
          roomId: payload.roomId,
          lastUpdate: payload.state.lastUpdate,
        })
      }

      replayRoomQueue(payload.roomId)
    }

    const handleRoomStateDelta = (payload: RoomStateDeltaPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionRooms((prev) => {
        const existing = prev[payload.roomId] ?? buildDefaultCompanionState()
        const next: CompanionRoomState = {
          ...existing,
          ...payload.changes,
          currentTime:
            payload.changes.currentTime ?? existing.currentTime ?? 0,
          lastUpdate:
            payload.changes.lastUpdate ?? existing.lastUpdate ?? Date.now(),
        }
        return { ...prev, [payload.roomId]: next }
      })

      if (pendingSyncRoomsRef.current.has(payload.roomId)) {
        removePendingSyncRoom(payload.roomId)
      }

      setRoomAuthority((prev) => ({
        ...prev,
        [payload.roomId]: {
          source: 'companion',
          status: 'ready',
          lastSyncAt: Date.now(),
        },
      }))

      if (debugCompanion) {
        console.info('[companion] ROOM_STATE_DELTA', {
          roomId: payload.roomId,
          changes: payload.changes,
        })
      }

      replayRoomQueue(payload.roomId)
    }

    const handleTimerCreated = (payload: TimerCreatedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = [...(prev[payload.roomId] ?? [])]
        const filtered = list.filter((timer) => timer.id !== payload.timer.id)
        return {
          ...prev,
          [payload.roomId]: [...filtered, payload.timer].sort((a, b) => a.order - b.order),
        }
      })
    }

    const handleTimerUpdated = (payload: TimerUpdatedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        return {
          ...prev,
          [payload.roomId]: list
            .map((timer) =>
              timer.id === payload.timerId ? { ...timer, ...(payload.changes as Partial<Timer>) } : timer,
            )
            .sort((a, b) => a.order - b.order),
        }
      })
    }

    const handleTimerDeleted = (payload: TimerDeletedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        return { ...prev, [payload.roomId]: list.filter((timer) => timer.id !== payload.timerId) }
      })
    }

    const handleTimersReordered = (payload: TimersReorderedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        const byId = new Map(list.map((timer) => [timer.id, timer] as const))
        const ordered: Timer[] = []
        payload.timerIds.forEach((id, idx) => {
          const timer = byId.get(id)
          if (!timer) return
          ordered.push({ ...timer, order: (idx + 1) * 10 })
          byId.delete(id)
        })
        const remainder = [...byId.values()].sort((a, b) => a.order - b.order)
        return { ...prev, [payload.roomId]: [...ordered, ...remainder] }
      })
    }

    const handleTimerError = (payload: unknown) => {
      console.warn('[UnifiedDataContext] TIMER_ERROR', payload)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('HANDSHAKE_ERROR', handleHandshakeError)
    socket.on('ROOM_STATE_SNAPSHOT', handleRoomStateSnapshot)
    socket.on('ROOM_STATE_DELTA', handleRoomStateDelta)
    socket.on('TIMER_CREATED', handleTimerCreated)
    socket.on('TIMER_UPDATED', handleTimerUpdated)
    socket.on('TIMER_DELETED', handleTimerDeleted)
    socket.on('TIMERS_REORDERED', handleTimersReordered)
    socket.on('TIMER_ERROR', handleTimerError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('HANDSHAKE_ERROR', handleHandshakeError)
      socket.off('ROOM_STATE_SNAPSHOT', handleRoomStateSnapshot)
      socket.off('ROOM_STATE_DELTA', handleRoomStateDelta)
      socket.off('TIMER_CREATED', handleTimerCreated)
      socket.off('TIMER_UPDATED', handleTimerUpdated)
      socket.off('TIMER_DELETED', handleTimerDeleted)
      socket.off('TIMERS_REORDERED', handleTimersReordered)
      socket.off('TIMER_ERROR', handleTimerError)
    }
  }, [
    addPendingSyncRoom,
    clientId,
    clearPendingSyncRooms,
    clearToken,
    debugCompanion,
    effectiveMode,
    emitSyncRoomState,
    fetchToken,
    removePendingSyncRoom,
    replayRoomQueue,
    socket,
    firebase,
  ])

  useEffect(() => {
    if (effectiveMode !== 'local' && effectiveMode !== 'hybrid') return
    Object.entries(subscribedRooms).forEach(([roomId, sub]) => {
      if (sub.clientType !== 'controller') return
      addPendingSyncRoom(roomId)
      setRoomAuthority((prev) => ({
        ...prev,
        [roomId]: {
          source: 'pending',
          status: 'syncing',
          lastSyncAt: Date.now(),
        },
      }))
    })
  }, [addPendingSyncRoom, effectiveMode, subscribedRooms])

  useEffect(() => {
    if (effectiveMode !== 'cloud') return
    clearPendingSyncRooms()
  }, [clearPendingSyncRooms, effectiveMode])

  const getRoom = useCallback(
    (roomId: string) => {
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const cached = cachedSnapshotsRef.current[roomId]
      const offline = typeof navigator !== 'undefined' ? !navigator.onLine : false
      const preferCompanion =
        authority.source === 'companion' ||
        authority.source === 'pending' ||
        shouldUseCompanion(roomId) ||
        offline
      if (preferCompanion) {
        const companionState =
          companionRooms[roomId] ??
          (cached ? deriveCompanionStateFromRoom(cached.room) : undefined)
        if (companionState) {
          const baseRoom = firebase.getRoom(roomId) ?? cached?.room
          return buildRoomFromCompanion(roomId, companionState, baseRoom)
        }
      }
      return firebase.getRoom(roomId) ?? cached?.room
    },
    [companionRooms, firebase, roomAuthority, shouldUseCompanion],
  )

  const getTimers = useCallback(
    (roomId: string) => {
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
      const offline = typeof navigator !== 'undefined' ? !navigator.onLine : false
      const preferCompanion =
        authority.source === 'companion' ||
        authority.source === 'pending' ||
        shouldUseCompanion(roomId) ||
        offline
      if (preferCompanion) {
        const timers = companionTimers[roomId] ?? cached
        if (timers) return [...timers].sort((a, b) => a.order - b.order)
      }
      const timers = firebase.getTimers(roomId)
      return timers.length ? timers : cached
    },
    [companionTimers, firebase, roomAuthority, shouldUseCompanion],
  )

  const createTimer = useCallback<DataContextValue['createTimer']>(
    async (roomId, input) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot create timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.createTimer(roomId, input)
      }

      const state = ensureCompanionRoomState(roomId)
      const title = input.title.trim()
      const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 1
      const timerId = crypto.randomUUID()

      const list = companionTimersRef.current[roomId] ?? []
      const nextOrder = list.length ? Math.max(...list.map((t) => t.order)) + 10 : 10
      const timer: Timer = {
        id: timerId,
        roomId,
        title,
        duration,
        speaker: input.speaker ?? '',
        type: 'countdown',
        order: nextOrder,
      }

      setCompanionTimers((prev) => {
        const nextTimer = { ...timer, order: nextOrder }
        return { ...prev, [roomId]: [...list, nextTimer].sort((a, b) => a.order - b.order) }
      })

      if (!state.activeTimerId) {
        setCompanionRooms((prev) => ({
          ...prev,
          [roomId]: {
            ...state,
            activeTimerId: timerId,
          },
        }))
      }

      emitOrQueue(roomId, {
        type: 'CREATE_TIMER',
        roomId,
        timer,
        timestamp: Date.now(),
        clientId,
      })

      if (firestoreEnabled) {
        const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
        await setDoc(timerRef, { ...timer, version: 1 } as Record<string, unknown>, { merge: true }).catch(
          () => undefined,
        )
      }

      return timer
    },
    [clientId, emitOrQueue, ensureCompanionRoomState, firebase, firestoreEnabled, isViewerClient, shouldUseCompanion],
  )

  const updateTimer = useCallback<DataContextValue['updateTimer']>(
    async (roomId, timerId, patch) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot update timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.updateTimer(roomId, timerId, patch)
      }

      ensureCompanionRoomState(roomId)

      setCompanionTimers((prev) => {
        const list = prev[roomId] ?? []
        return {
          ...prev,
          [roomId]: list
            .map((timer) => (timer.id === timerId ? { ...timer, ...(patch as Partial<Timer>) } : timer))
            .sort((a, b) => a.order - b.order),
        }
      })

      emitOrQueue(roomId, {
        type: 'UPDATE_TIMER',
        roomId,
        timerId,
        changes: patch,
        timestamp: Date.now(),
        clientId,
      })

      if (firestoreEnabled) {
        const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
        await setDoc(timerRef, { ...patch, updatedAt: Date.now() } as Record<string, unknown>, { merge: true }).catch(
          () => undefined,
        )
      }
    },
    [clientId, emitOrQueue, ensureCompanionRoomState, firebase, firestoreEnabled, isViewerClient, shouldUseCompanion],
  )

  const deleteTimer = useCallback<DataContextValue['deleteTimer']>(
    async (roomId, timerId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot delete timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.deleteTimer(roomId, timerId)
      }

      ensureCompanionRoomState(roomId)

      setCompanionTimers((prev) => {
        const list = prev[roomId] ?? []
        return { ...prev, [roomId]: list.filter((timer) => timer.id !== timerId) }
      })

      setCompanionRooms((prev) => {
        const state = prev[roomId] ?? buildDefaultCompanionState()
        if (state.activeTimerId !== timerId) return prev
        const list = companionTimersRef.current[roomId] ?? []
        const remaining = list.filter((timer) => timer.id !== timerId)
        return {
          ...prev,
          [roomId]: {
            ...state,
            activeTimerId: remaining[0]?.id ?? null,
            isRunning: remaining.length ? state.isRunning : false,
            currentTime: remaining.length ? state.currentTime : 0,
            lastUpdate: Date.now(),
          },
        }
      })

      emitOrQueue(roomId, {
        type: 'DELETE_TIMER',
        roomId,
        timerId,
        timestamp: Date.now(),
        clientId,
      })

      if (firestoreEnabled) {
        const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
        await deleteDoc(timerRef).catch(() => undefined)
      }
    },
    [clientId, emitOrQueue, ensureCompanionRoomState, firebase, firestoreEnabled, isViewerClient, shouldUseCompanion],
  )

  const reorderTimer = useCallback<DataContextValue['reorderTimer']>(
    async (roomId, timerId, targetIndex) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot reorder timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.reorderTimer(roomId, timerId, targetIndex)
      }

      ensureCompanionRoomState(roomId)

      const ordered = [...(companionTimersRef.current[roomId] ?? [])].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
      if (fromIndex === -1) return
      const [moved] = ordered.splice(fromIndex, 1)
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
      ordered.splice(clampedIndex, 0, moved)
      const next = ordered.map((timer, idx) => ({ ...timer, order: (idx + 1) * 10 }))

      setCompanionTimers((prev) => ({ ...prev, [roomId]: next }))

      emitOrQueue(roomId, {
        type: 'REORDER_TIMERS',
        roomId,
        timerIds: next.map((timer) => timer.id),
        timestamp: Date.now(),
        clientId,
      })

      if (firestoreEnabled) {
        const batch = writeBatch(db)
        next.forEach((timer) => {
          batch.set(doc(db, 'rooms', roomId, 'timers', timer.id), { order: timer.order } as Record<string, unknown>, {
            merge: true,
          })
        })
        await batch.commit().catch(() => undefined)
      }
    },
    [clientId, emitOrQueue, ensureCompanionRoomState, firebase, firestoreEnabled, isViewerClient, shouldUseCompanion],
  )

  const moveTimer = useCallback(
    async (roomId: string, timerId: string, direction: 'up' | 'down') => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot move timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!firebase.moveTimer) return
        return firebase.moveTimer(roomId, timerId, direction)
      }
      const ordered = [...(companionTimersRef.current[roomId] ?? [])].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
      if (fromIndex === -1) return
      const targetIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
      return reorderTimer(roomId, timerId, targetIndex)
    },
    [firebase, isViewerClient, reorderTimer, shouldUseCompanion],
  )

  const emitTimerAction = useCallback(
    (roomId: string, timerId: string, action: 'START' | 'PAUSE' | 'RESET') => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot control timers', roomId)
        return
      }
      const timestamp = Date.now()
      const payload: QueuedEvent = {
        type: 'TIMER_ACTION',
        action,
        roomId,
        timerId,
        timestamp,
        clientId,
      }
      emitOrQueue(roomId, payload)

      if (firestoreEnabled) {
        const stateRefV2 = doc(db, 'rooms', roomId, 'state', 'current')
        const legacyRef = doc(db, 'rooms', roomId)

        const state = ensureCompanionRoomState(roomId)
        const currentElapsed = computeCompanionElapsed(state)
        const stateUpdate: Record<string, unknown> = {
          activeTimerId: timerId,
          isRunning: action === 'START',
          lastUpdate: timestamp,
        }

        if (action === 'START') {
          stateUpdate.startedAt = timestamp
          stateUpdate.elapsedOffset = currentElapsed
          stateUpdate.currentTime = currentElapsed
        } else if (action === 'PAUSE') {
          stateUpdate.startedAt = null
          stateUpdate.elapsedOffset = currentElapsed
          stateUpdate.currentTime = currentElapsed
        } else if (action === 'RESET') {
          stateUpdate.startedAt = null
          stateUpdate.elapsedOffset = 0
          stateUpdate.currentTime = 0
        }

        void setDoc(stateRefV2, stateUpdate, { merge: true }).catch(() => {
          const legacyPayload: Record<string, unknown> = {}
          if (stateUpdate.activeTimerId !== undefined) legacyPayload['state.activeTimerId'] = stateUpdate.activeTimerId
          if (stateUpdate.isRunning !== undefined) legacyPayload['state.isRunning'] = stateUpdate.isRunning
          if (stateUpdate.lastUpdate !== undefined) legacyPayload['state.lastUpdate'] = stateUpdate.lastUpdate
          if (stateUpdate.currentTime !== undefined) legacyPayload['state.currentTime'] = stateUpdate.currentTime
          if (stateUpdate.startedAt !== undefined) legacyPayload['state.startedAt'] = stateUpdate.startedAt
          if (stateUpdate.elapsedOffset !== undefined) legacyPayload['state.elapsedOffset'] = stateUpdate.elapsedOffset
          return setDoc(legacyRef, legacyPayload, { merge: true }).catch(() => undefined)
        })
      }
    },
    [clientId, computeCompanionElapsed, emitOrQueue, ensureCompanionRoomState, firestoreEnabled, isViewerClient],
  )

  const startTimer = useCallback<DataContextValue['startTimer']>(
    async (roomId, timerId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot start timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.startTimer(roomId, timerId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = timerId ?? state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()
      const elapsed = computeCompanionElapsed(state)
      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: true,
          currentTime: elapsed,
          lastUpdate: now,
        },
      }))
      emitTimerAction(roomId, targetId, 'START')
    },
    [computeCompanionElapsed, emitTimerAction, ensureCompanionRoomState, firebase, isViewerClient, shouldUseCompanion],
  )

  const pauseTimer = useCallback<DataContextValue['pauseTimer']>(
    async (roomId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot pause timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.pauseTimer(roomId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()
      const elapsed = computeCompanionElapsed(state)
      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: false,
          currentTime: elapsed,
          lastUpdate: now,
        },
      }))
      emitTimerAction(roomId, targetId, 'PAUSE')
    },
    [computeCompanionElapsed, emitTimerAction, ensureCompanionRoomState, firebase, isViewerClient, shouldUseCompanion],
  )

  const resetTimer = useCallback<DataContextValue['resetTimer']>(
    async (roomId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot reset timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        return firebase.resetTimer(roomId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()
      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: false,
          currentTime: 0,
          lastUpdate: now,
        },
      }))
      emitTimerAction(roomId, targetId, 'RESET')
    },
    [emitTimerAction, ensureCompanionRoomState, firebase, isViewerClient, shouldUseCompanion],
  )

  const value = useMemo<UnifiedDataContextValue>(
    () => {
      const mergedRoomsMap = new Map<string, Room>()
      ;(firebase.rooms ?? []).forEach((room) => mergedRoomsMap.set(room.id, room))
      Object.values(cachedSnapshots).forEach((entry) => {
        if (!mergedRoomsMap.has(entry.roomId)) {
          mergedRoomsMap.set(entry.roomId, entry.room)
        }
      })
      return {
        ...firebase,
        rooms: [...mergedRoomsMap.values()],
        getRoom,
        getTimers,
        createTimer,
        updateTimer,
        deleteTimer,
        reorderTimer,
        moveTimer,
        startTimer,
        pauseTimer,
        resetTimer,
        roomAuthority,
        getRoomAuthority,
        forceCloudAuthority,
        forceCompanionAuthority,
        subscribeToCompanionRoom,
        unsubscribeFromCompanionRoom,
      }
    },
    [
      cachedSnapshots,
      createTimer,
      deleteTimer,
      firebase,
      forceCloudAuthority,
      forceCompanionAuthority,
      getRoom,
      getRoomAuthority,
      getTimers,
      moveTimer,
      pauseTimer,
      reorderTimer,
      resetTimer,
      roomAuthority,
      startTimer,
      subscribeToCompanionRoom,
      unsubscribeFromCompanionRoom,
      updateTimer,
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}

export const UnifiedDataProvider = ({
  children,
  fallbackToMock = false,
}: {
  children: ReactNode
  fallbackToMock?: boolean
}) => (
  <FirebaseDataProvider fallbackToMock={fallbackToMock}>
    <UnifiedDataResolver>{children}</UnifiedDataResolver>
  </FirebaseDataProvider>
)

export const useUnifiedDataContext = () => useDataContext() as UnifiedDataContextValue
