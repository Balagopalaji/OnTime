import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { DataContextValue } from './DataContext'
import { DataProviderBoundary } from './DataContext'
import type { ConnectionStatus, Room, RoomFeatures, RoomState, Timer } from '../types'
import { db } from '../lib/firebase'
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore'

type HandshakeAck = {
  type: 'HANDSHAKE_ACK'
  success: boolean
  companionMode: string
  companionVersion: string
  capabilities: {
    powerpoint: boolean
    externalVideo: boolean
    fileOperations: boolean
  }
  systemInfo: {
    platform: string
    hostname: string
  }
}

type SnapshotPayload = {
  type: 'ROOM_STATE_SNAPSHOT'
  roomId: string
  state: {
    activeTimerId: string | null
    isRunning: boolean
    currentTime: number
    lastUpdate: number
    activeLiveCueId?: string
  }
  timestamp: number
}

type DeltaPayload = {
  type: 'ROOM_STATE_DELTA'
  roomId: string
  changes: Partial<RoomState>
  clientId?: string
  timestamp: number
}

type JoinArgs = {
  roomId: string
  token: string
  clientType?: 'controller' | 'viewer'
}

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const SESSION_TOKEN_KEY = 'ontime:companionToken'
const SESSION_CLIENT_ID_KEY = 'ontime:companionClientId'
type HandshakeStatus = 'idle' | 'pending' | 'ack' | 'error'
type QueueWarning = 'full' | null

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
const MAX_QUEUE = 100

const defaultRoomFeatures: RoomFeatures = {
  localMode: true,
  showControl: false,
  powerpoint: false,
  externalVideo: false,
}

const logStub = (method: string) => {
  console.warn(`[companion] ${method} not yet implemented`)
}

const buildRoomState = (payloadState?: SnapshotPayload['state'] | Partial<RoomState>): RoomState => ({
  activeTimerId: payloadState?.activeTimerId ?? null,
  isRunning: payloadState?.isRunning ?? false,
  startedAt: null,
  elapsedOffset: 0,
  progress: {},
  showClock: false,
  clockMode: '24h',
  message: { text: '', visible: false, color: 'green' },
  currentTime: payloadState?.currentTime ?? 0,
  lastUpdate: payloadState?.lastUpdate ?? Date.now(),
  activeLiveCueId: payloadState?.activeLiveCueId,
})

const buildRoom = (roomId: string, state: RoomState): Room => ({
  id: roomId,
  ownerId: 'local',
  title: 'Local Room',
  timezone: 'UTC',
  createdAt: Date.now(),
  order: 0,
  config: DEFAULT_CONFIG,
  state,
  tier: 'basic',
  features: defaultRoomFeatures,
  // Future version detection could flow from server; default legacy
  _version: 1,
})

export const CompanionDataProvider = ({ children }: { children: ReactNode }) => {
  const socketRef = useRef<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('offline')
  const [rooms, setRooms] = useState<Room[]>([])
  const [timers, setTimers] = useState<Record<string, Timer[]>>({})
  const [pendingRooms] = useState<Set<string>>(new Set())
  const [pendingRoomPlaceholders] = useState<
    Array<{ roomId: string; title: string; expiresAt: number; createdAt: number; order?: number }>
  >([])
  const [pendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const lastJoinArgsRef = useRef<JoinArgs | null>(null)
  const [clientId] = useState(() => {
    const cached = sessionStorage.getItem(SESSION_CLIENT_ID_KEY)
    if (cached) return cached
    const next = crypto.randomUUID()
    sessionStorage.setItem(SESSION_CLIENT_ID_KEY, next)
    return next
  })
  const [companionMode, setCompanionMode] = useState<string>('minimal')
  const [capabilities, setCapabilities] = useState<HandshakeAck['capabilities']>({
    powerpoint: false,
    externalVideo: false,
    fileOperations: true,
  })
  const [handshakeStatus, setHandshakeStatus] = useState<HandshakeStatus>('idle')
  const socketCreatedRef = useRef(false)
  const [queueWarning, setQueueWarning] = useState<QueueWarning>(null)
  const [queueDepth, setQueueDepth] = useState(0)
  const [isReplayingQueue, setIsReplayingQueue] = useState(false)
  const isReplayingRef = useRef(false)

  useEffect(() => {
    if (socketCreatedRef.current) return
    socketCreatedRef.current = true

    const socket = io('http://localhost:4000', {
      transports: ['websocket'],
      autoConnect: false,
    })
    socketRef.current = socket

    const loadQueueFromStorage = (roomId: string): QueuedEvent[] => {
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
        console.warn('[companion] Failed to load queue', error)
        return []
      }
    }

    const saveQueueToStorage = (roomId: string, queue: QueuedEvent[]) => {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(`ontime:queue:${roomId}`, JSON.stringify(queue))
        setQueueDepth(queue.length)
      } catch (error) {
        console.warn('[companion] Failed to save queue', error)
      }
    }

    const replayRoomQueue = (roomId: string) => {
      const queue = loadQueueFromStorage(roomId)
      if (!queue.length) return
      setIsReplayingQueue(true)
      isReplayingRef.current = true
      const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp)
      sorted.forEach((item) => socket.emit(item.type, item))
      saveQueueToStorage(roomId, [])
      setQueueWarning(null)
      setIsReplayingQueue(false)
      isReplayingRef.current = false
    }

    socket.on('connect', () => {
      setConnectionStatus('online')
      const joinArgs = lastJoinArgsRef.current
      if (joinArgs) {
        setHandshakeStatus('pending')
        socket.emit('JOIN_ROOM', {
          type: 'JOIN_ROOM',
          roomId: joinArgs.roomId,
          token: joinArgs.token,
          clientType: joinArgs.clientType ?? 'controller',
          clientId,
        })
      }
    })
    socket.on('disconnect', () => {
      setConnectionStatus('offline')
      setHandshakeStatus('idle')
    })
    socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'))
    socket.io.on('error', (err) => {
      console.warn('[companion] socket.io error', err)
      setHandshakeStatus('error')
    })
    socket.on('connect_error', (err) => {
      console.warn('[companion] connect_error', err)
      setHandshakeStatus('error')
    })

    socket.on('HANDSHAKE_ACK', (data: HandshakeAck) => {
      setCompanionMode(data.companionMode)
      setCapabilities(data.capabilities)
      setHandshakeStatus('ack')
      console.info('[companion] HANDSHAKE_ACK', data)
      const joinArgs = lastJoinArgsRef.current
      if (joinArgs) {
        replayRoomQueue(joinArgs.roomId)
      }
    })
    socket.on('HANDSHAKE_ERROR', (err) => {
      setConnectionStatus('offline')
      setHandshakeStatus('error')
      console.warn('[companion] HANDSHAKE_ERROR', err)
    })

    socket.on('ROOM_STATE_SNAPSHOT', (payload: SnapshotPayload) => {
      setRooms((prev) => {
        const state = buildRoomState(payload.state)
        const nextRoom = buildRoom(payload.roomId, state)
        const other = prev.filter((room) => room.id !== payload.roomId)
        return [...other, nextRoom]
      })
    })

    socket.on('ROOM_STATE_DELTA', (payload: DeltaPayload) => {
      console.info('[companion] ROOM_STATE_DELTA', payload)
      setRooms((prev) =>
        prev.map((room) => {
          if (room.id !== payload.roomId) return room
          if (payload.clientId && payload.clientId === clientId) return room
          const nextState: RoomState = {
            ...room.state,
            ...payload.changes,
            currentTime: payload.changes.currentTime ?? room.state.currentTime,
            lastUpdate: payload.changes.lastUpdate ?? room.state.lastUpdate,
          }
          return { ...room, state: nextState }
        }),
      )
    })

    socket.on('TIMER_CREATED', (payload: { roomId: string; timer: Timer; clientId?: string }) => {
      if (payload.clientId && payload.clientId === clientId) return
      setTimers((prev) => {
        const list = [...(prev[payload.roomId] ?? [])]
        const filtered = list.filter((timer) => timer.id !== payload.timer.id)
        return { ...prev, [payload.roomId]: [...filtered, payload.timer].sort((a, b) => a.order - b.order) }
      })
    })

    socket.on(
      'TIMER_UPDATED',
      (payload: { roomId: string; timerId: string; changes: Partial<Timer>; clientId?: string }) => {
        if (payload.clientId && payload.clientId === clientId) return
        setTimers((prev) => {
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
      },
    )

    socket.on('TIMER_DELETED', (payload: { roomId: string; timerId: string; clientId?: string }) => {
      if (payload.clientId && payload.clientId === clientId) return
      setTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        return { ...prev, [payload.roomId]: list.filter((timer) => timer.id !== payload.timerId) }
      })
    })

    socket.on('TIMERS_REORDERED', (payload: { roomId: string; timerIds: string[]; clientId?: string }) => {
      if (payload.clientId && payload.clientId === clientId) return
      setTimers((prev) => {
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
    })

    socket.on('TIMER_ERROR', (payload) => {
      console.warn('[companion] TIMER_ERROR', payload)
    })

    return () => {
      socket.off('HANDSHAKE_ACK')
      socket.off('ROOM_STATE_SNAPSHOT')
      socket.off('ROOM_STATE_DELTA')
      socket.off('TIMER_CREATED')
      socket.off('TIMER_UPDATED')
      socket.off('TIMER_DELETED')
      socket.off('TIMERS_REORDERED')
      socket.off('TIMER_ERROR')
      socket.disconnect()
      socketRef.current = null
      socketCreatedRef.current = false
    }
  }, [clientId])

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
      console.warn('[companion] Failed to load queue', error)
      return []
    }
  }, [])

  const saveQueue = useCallback((roomId: string, queue: QueuedEvent[]) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(`ontime:queue:${roomId}`, JSON.stringify(queue))
      setQueueDepth(queue.length)
    } catch (error) {
      console.warn('[companion] Failed to save queue', error)
    }
  }, [])

  const enqueueAction = useCallback(
    (roomId: string, action: QueuedEvent) => {
      let queue = loadQueue(roomId)
      queue.push(action)
      if (queue.length > MAX_QUEUE) {
        const dropped = queue.length - MAX_QUEUE
        queue = queue.slice(dropped)
        setQueueWarning('full')
        console.warn('[companion] Queue full, dropping oldest actions', { dropped, roomId })
      } else {
        setQueueWarning(null)
      }
      console.info('[companion] Queue depth', { roomId, depth: queue.length })
      saveQueue(roomId, queue)
    },
    [loadQueue, saveQueue],
  )

  const getRoom = useCallback(
    (roomId: string) => rooms.find((room) => room.id === roomId),
    [rooms],
  )

  const getTimers = useCallback(
    (roomId: string) => timers[roomId] ?? [],
    [timers],
  )

  const ensureSocketConnection = useCallback(() => {
    if (!socketRef.current) return
    if (socketRef.current.connected || socketRef.current.active) return
    socketRef.current.connect()
  }, [])

  const subscribeToRoom = useCallback(
    (roomId: string, token: string, clientType: 'controller' | 'viewer' = 'controller') => {
      const joinArgs = { roomId, token, clientType }
      lastJoinArgsRef.current = joinArgs
      sessionStorage.setItem(SESSION_TOKEN_KEY, token)
      setQueueDepth(loadQueue(roomId).length)
      if (!socketRef.current) return
      ensureSocketConnection()
      setHandshakeStatus('pending')
      socketRef.current.emit('JOIN_ROOM', {
        type: 'JOIN_ROOM',
        roomId,
        token,
        clientType,
        clientId,
      })
    },
    [clientId, ensureSocketConnection, loadQueue],
  )

  const getRoomState = useCallback(
    (roomId: string) => getRoom(roomId)?.state,
    [getRoom],
  )

  const applyRoomState = useCallback(
    (roomId: string, changes: Partial<RoomState>) => {
      setRooms((prev) =>
        prev.map((room) => {
          if (room.id !== roomId) return room
          const nextState: RoomState = {
            ...room.state,
            ...changes,
            currentTime: changes.currentTime ?? room.state.currentTime,
            lastUpdate: changes.lastUpdate ?? Date.now(),
          }
          return { ...room, state: nextState }
        }),
      )
    },
    [],
  )

  const emitTimerAction = useCallback(
    (roomId: string, timerId: string, action: 'START' | 'PAUSE' | 'RESET') => {
      const timestamp = Date.now()
      const payload: QueuedEvent = {
        type: 'TIMER_ACTION',
        action,
        roomId,
        timerId,
        timestamp,
        clientId,
      }
      const canEmit =
        connectionStatus === 'online' &&
        handshakeStatus === 'ack' &&
        socketRef.current?.connected &&
        !isReplayingRef.current

      if (canEmit) {
        console.info('[companion] emit TIMER_ACTION', { roomId, timerId, action, timestamp })
        socketRef.current?.emit('TIMER_ACTION', {
          type: 'TIMER_ACTION',
          action,
          roomId,
          timerId,
          timestamp,
          clientId,
        })
      } else {
        console.info('[companion] queue TIMER_ACTION (offline)', payload)
        enqueueAction(roomId, payload)
      }

      // Firestore write-through (best effort) to new path; fallback to legacy on error
      const stateRefV2 = doc(db, 'rooms', roomId, 'state', 'current')
      const legacyRef = doc(db, 'rooms', roomId)
      const stateUpdate: Record<string, unknown> = {
        activeTimerId: timerId,
        isRunning: action === 'START',
        lastUpdate: timestamp,
      }
      if (action === 'RESET') {
        stateUpdate.currentTime = 0
      }
      void setDoc(stateRefV2, stateUpdate, { merge: true })
        .then(() => console.info('[companion] Firestore v2 state write ok', { roomId, stateUpdate }))
        .catch((err) => {
          console.warn('[companion] Firestore v2 state write failed, falling back to legacy', err)
          const legacyPayload: Record<string, unknown> = {}
          if (stateUpdate.activeTimerId !== undefined) legacyPayload['state.activeTimerId'] = stateUpdate.activeTimerId
          if (stateUpdate.isRunning !== undefined) legacyPayload['state.isRunning'] = stateUpdate.isRunning
          if (stateUpdate.lastUpdate !== undefined) legacyPayload['state.lastUpdate'] = stateUpdate.lastUpdate
          if (stateUpdate.currentTime !== undefined) legacyPayload['state.currentTime'] = stateUpdate.currentTime
          return setDoc(legacyRef, legacyPayload, { merge: true })
            .then(() => console.info('[companion] Firestore legacy state write ok', { roomId, legacyPayload }))
            .catch((errLegacy) => console.warn('[companion] Firestore legacy state write failed', errLegacy))
        })
    },
    [clientId, connectionStatus, handshakeStatus, enqueueAction],
  )

  const emitOrQueue = useCallback(
    (roomId: string, event: QueuedEvent) => {
      const canEmit =
        connectionStatus === 'online' &&
        handshakeStatus === 'ack' &&
        socketRef.current?.connected &&
        !isReplayingRef.current

      if (canEmit) {
        socketRef.current?.emit(event.type, event)
      } else {
        enqueueAction(roomId, event)
      }
    },
    [connectionStatus, enqueueAction, handshakeStatus],
  )

  const ensureRoom = useCallback((roomId: string) => {
    setRooms((prev) => {
      if (prev.some((room) => room.id === roomId)) return prev
      return [...prev, buildRoom(roomId, buildRoomState())]
    })
  }, [])

  const createTimer: DataContextValue['createTimer'] = useCallback(
    async (roomId, input) => {
      ensureRoom(roomId)

      const title = input.title.trim()
      const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 1
      const timerId = crypto.randomUUID()

      const timer: Timer = {
        id: timerId,
        roomId,
        title,
        duration,
        speaker: input.speaker ?? '',
        type: 'countdown',
        order: 10,
      }

      setTimers((prev) => {
        const list = prev[roomId] ?? []
        const nextOrder = list.length ? Math.max(...list.map((t) => t.order)) + 10 : 10
        const nextTimer = { ...timer, order: nextOrder }
        return { ...prev, [roomId]: [...list, nextTimer].sort((a, b) => a.order - b.order) }
      })

      setRooms((prev) =>
        prev.map((room) => {
          if (room.id !== roomId) return room
          const progress = { ...(room.state.progress ?? {}) }
          progress[timerId] = 0
          const activeTimerId = room.state.activeTimerId ?? timerId
          return { ...room, state: { ...room.state, activeTimerId, progress } }
        }),
      )

      emitOrQueue(roomId, {
        type: 'CREATE_TIMER',
        roomId,
        timer,
        timestamp: Date.now(),
        clientId,
      })

      const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
      await setDoc(timerRef, { ...timer, version: 1 } as Record<string, unknown>, { merge: true }).catch(
        (err) => console.warn('[companion] Firestore createTimer failed', err),
      )

      return timer
    },
    [clientId, emitOrQueue, ensureRoom],
  )

  const updateTimer: DataContextValue['updateTimer'] = useCallback(
    async (roomId, timerId, patch) => {
      ensureRoom(roomId)

      setTimers((prev) => {
        const list = prev[roomId] ?? []
        return {
          ...prev,
          [roomId]: list
            .map((timer) =>
              timer.id === timerId ? { ...timer, ...(patch as Partial<Timer>) } : timer,
            )
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

      const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
      await setDoc(timerRef, { ...patch, updatedAt: Date.now() } as Record<string, unknown>, { merge: true }).catch(
        (err) => console.warn('[companion] Firestore updateTimer failed', err),
      )
    },
    [clientId, emitOrQueue, ensureRoom],
  )

  const deleteTimer: DataContextValue['deleteTimer'] = useCallback(
    async (roomId, timerId) => {
      ensureRoom(roomId)

      setTimers((prev) => {
        const list = prev[roomId] ?? []
        return { ...prev, [roomId]: list.filter((timer) => timer.id !== timerId) }
      })

      setRooms((prev) =>
        prev.map((room) => {
          if (room.id !== roomId) return room
          const progress = { ...(room.state.progress ?? {}) }
          delete progress[timerId]
          return { ...room, state: { ...room.state, progress } }
        }),
      )

      emitOrQueue(roomId, {
        type: 'DELETE_TIMER',
        roomId,
        timerId,
        timestamp: Date.now(),
        clientId,
      })

      const timerRef = doc(db, 'rooms', roomId, 'timers', timerId)
      await deleteDoc(timerRef).catch((err) => console.warn('[companion] Firestore deleteTimer failed', err))
    },
    [clientId, emitOrQueue, ensureRoom],
  )

  const reorderTimer: DataContextValue['reorderTimer'] = useCallback(
    async (roomId, timerId, targetIndex) => {
      ensureRoom(roomId)

      const ordered = [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
      if (fromIndex === -1) return
      const [moved] = ordered.splice(fromIndex, 1)
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
      ordered.splice(clampedIndex, 0, moved)
      const next = ordered.map((timer, idx) => ({ ...timer, order: (idx + 1) * 10 }))

      setTimers((prev) => ({ ...prev, [roomId]: next }))

      emitOrQueue(roomId, {
        type: 'REORDER_TIMERS',
        roomId,
        timerIds: next.map((timer) => timer.id),
        timestamp: Date.now(),
        clientId,
      })

      const batch = writeBatch(db)
      next.forEach((timer) => {
        batch.set(doc(db, 'rooms', roomId, 'timers', timer.id), { order: timer.order } as Record<string, unknown>, {
          merge: true,
        })
      })
      await batch.commit().catch((err) => console.warn('[companion] Firestore reorderTimer failed', err))
    },
    [clientId, emitOrQueue, ensureRoom, timers],
  )

  const value: DataContextValue & {
    companionMode: string
    capabilities: HandshakeAck['capabilities']
    subscribeToRoom: typeof subscribeToRoom
    getRoomState: typeof getRoomState
    handshakeStatus: HandshakeStatus
    ensureSocketConnection: typeof ensureSocketConnection
    queueDepth: number
    queueWarning: QueueWarning
    isReplayingQueue: boolean
  } = useMemo(
    () => ({
      rooms,
      connectionStatus,
      setConnectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      undoRoomDelete: async () => logStub('undoRoomDelete'),
      redoRoomDelete: async () => logStub('redoRoomDelete'),
      undoTimerDelete: async () => logStub('undoTimerDelete'),
      redoTimerDelete: async () => logStub('redoTimerDelete'),
      undoLatest: async () => logStub('undoLatest'),
      redoLatest: async () => logStub('redoLatest'),
      clearUndoStacks: async () => logStub('clearUndoStacks'),
      getRoom,
      getTimers,
      createRoom: async () => {
        logStub('createRoom')
        return buildRoom('companion-room', buildRoomState())
      },
      deleteRoom: async () => logStub('deleteRoom'),
      createTimer,
      updateTimer,
      updateRoomMeta: async () => logStub('updateRoomMeta'),
      moveRoom: async () => logStub('moveRoom'),
      reorderRoom: async () => logStub('reorderRoom'),
      restoreTimer: async () => logStub('restoreTimer'),
      resetTimerProgress: async () => logStub('resetTimerProgress'),
      deleteTimer,
      moveTimer: async () => logStub('moveTimer'),
      reorderTimer,
      setActiveTimer: async () => logStub('setActiveTimer'),
      startTimer: async (roomId: string, timerId?: string) => {
        const room = getRoom(roomId)
        const targetId = timerId ?? room?.state.activeTimerId ?? 'default-timer'
        if (!room) return
        applyRoomState(roomId, {
          activeTimerId: targetId,
          isRunning: true,
          lastUpdate: Date.now(),
        })
        emitTimerAction(roomId, targetId, 'START')
      },
      pauseTimer: async (roomId: string, timerId?: string) => {
        const room = getRoom(roomId)
        const targetId = timerId ?? room?.state.activeTimerId ?? 'default-timer'
        if (!room) return
        applyRoomState(roomId, {
          activeTimerId: targetId,
          isRunning: false,
          lastUpdate: Date.now(),
        })
        emitTimerAction(roomId, targetId, 'PAUSE')
      },
      resetTimer: async (roomId: string, timerId?: string) => {
        const room = getRoom(roomId)
        const targetId = timerId ?? room?.state.activeTimerId ?? 'default-timer'
        if (!room) return
        applyRoomState(roomId, {
          activeTimerId: targetId,
          isRunning: false,
          currentTime: 0,
          lastUpdate: Date.now(),
        })
        emitTimerAction(roomId, targetId, 'RESET')
      },
      nudgeTimer: async () => logStub('nudgeTimer'),
      setClockMode: async () => logStub('setClockMode'),
      setClockFormat: async () => logStub('setClockFormat'),
      updateMessage: async () => logStub('updateMessage'),
      migrateRoomToV2: async () => logStub('migrateRoomToV2'),
      rollbackRoomMigration: async () => logStub('rollbackRoomMigration'),
      companionMode,
      capabilities,
      subscribeToRoom,
      getRoomState,
      applyRoomState,
      emitTimerAction,
      handshakeStatus,
      ensureSocketConnection,
      queueDepth,
      queueWarning,
      isReplayingQueue,
    }),
    [
      rooms,
      connectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      getRoom,
      getTimers,
      createTimer,
      updateTimer,
      deleteTimer,
      reorderTimer,
      companionMode,
      capabilities,
      subscribeToRoom,
      getRoomState,
      applyRoomState,
      emitTimerAction,
      handshakeStatus,
      ensureSocketConnection,
      queueDepth,
      queueWarning,
      isReplayingQueue,
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
