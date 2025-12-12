import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { DataContextValue } from './DataContext'
import { DataProviderBoundary } from './DataContext'
import type { ConnectionStatus, Room, RoomFeatures, RoomState, Timer } from '../types'

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
type QueuedAction = {
  action: 'START' | 'PAUSE' | 'RESET'
  timestamp: number
  roomId: string
  timerId: string
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
})

export const CompanionDataProvider = ({ children }: { children: ReactNode }) => {
  const socketRef = useRef<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('offline')
  const [rooms, setRooms] = useState<Room[]>([])
  const [timers] = useState<Record<string, Timer[]>>({})
  const [pendingRooms] = useState<Set<string>>(new Set())
  const [pendingRoomPlaceholders] = useState<
    Array<{ roomId: string; title: string; expiresAt: number; createdAt: number; order?: number }>
  >([])
  const [pendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const [lastJoinArgs, setLastJoinArgs] = useState<JoinArgs | null>(null)
  const clientIdRef = useRef<string>('')
  if (!clientIdRef.current) {
    const cached = sessionStorage.getItem(SESSION_CLIENT_ID_KEY)
    if (cached) {
      clientIdRef.current = cached
    } else {
      clientIdRef.current = crypto.randomUUID()
      sessionStorage.setItem(SESSION_CLIENT_ID_KEY, clientIdRef.current)
    }
  }
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

    socket.on('connect', () => {
      setConnectionStatus('online')
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

    return () => {
      socket.off('HANDSHAKE_ACK')
      socket.off('ROOM_STATE_SNAPSHOT')
      socket.off('ROOM_STATE_DELTA')
      socket.disconnect()
      socketRef.current = null
      socketCreatedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (connectionStatus === 'online' && lastJoinArgs && socketRef.current) {
      setHandshakeStatus('pending')
      socketRef.current.emit('JOIN_ROOM', {
        type: 'JOIN_ROOM',
        roomId: lastJoinArgs.roomId,
        token: lastJoinArgs.token,
        clientType: lastJoinArgs.clientType ?? 'controller',
        clientId: clientIdRef.current,
      })
    }
  }, [connectionStatus, lastJoinArgs])

  const loadQueue = useCallback((roomId: string): QueuedAction[] => {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(`ontime:queue:${roomId}`)
      if (!raw) return []
      const parsed = JSON.parse(raw) as QueuedAction[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.warn('[companion] Failed to load queue', error)
      return []
    }
  }, [])

  const saveQueue = useCallback((roomId: string, queue: QueuedAction[]) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(`ontime:queue:${roomId}`, JSON.stringify(queue))
      setQueueDepth(queue.length)
    } catch (error) {
      console.warn('[companion] Failed to save queue', error)
    }
  }, [])

  const enqueueAction = useCallback(
    (roomId: string, action: QueuedAction) => {
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

  const replayQueue = useCallback(
    (roomId: string) => {
      if (!socketRef.current) return
      const queue = loadQueue(roomId)
      if (!queue.length) return
      setIsReplayingQueue(true)
      isReplayingRef.current = true
      const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp)
      sorted.forEach((item) => {
        socketRef.current?.emit('TIMER_ACTION', {
          type: 'TIMER_ACTION',
          action: item.action,
          roomId: item.roomId,
          timerId: item.timerId,
          timestamp: item.timestamp,
          clientId: item.clientId,
        })
      })
      saveQueue(roomId, [])
      setQueueWarning(null)
      setIsReplayingQueue(false)
      isReplayingRef.current = false
    },
    [loadQueue, saveQueue],
  )

  useEffect(() => {
    if (connectionStatus === 'online' && handshakeStatus === 'ack' && lastJoinArgs) {
      replayQueue(lastJoinArgs.roomId)
    }
  }, [connectionStatus, handshakeStatus, lastJoinArgs, replayQueue])

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
      setLastJoinArgs({ roomId, token, clientType })
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
        clientId: clientIdRef.current,
      })
    },
    [ensureSocketConnection, loadQueue],
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
      const payload: QueuedAction = {
        action,
        roomId,
        timerId,
        timestamp,
        clientId: clientIdRef.current,
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
          clientId: clientIdRef.current,
        })
      } else {
        console.info('[companion] queue TIMER_ACTION (offline)', payload)
        enqueueAction(roomId, payload)
      }
    },
    [connectionStatus, handshakeStatus, enqueueAction],
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
      createTimer: async () => {
        logStub('createTimer')
        return {
          id: 'companion-timer',
          roomId: 'companion-room',
          title: 'Pending timer',
          duration: 0,
          type: 'countdown',
          order: 0,
        }
      },
      updateTimer: async () => logStub('updateTimer'),
      updateRoomMeta: async () => logStub('updateRoomMeta'),
      moveRoom: async () => logStub('moveRoom'),
      reorderRoom: async () => logStub('reorderRoom'),
      restoreTimer: async () => logStub('restoreTimer'),
      resetTimerProgress: async () => logStub('resetTimerProgress'),
      deleteTimer: async () => logStub('deleteTimer'),
      moveTimer: async () => logStub('moveTimer'),
      reorderTimer: async () => logStub('reorderTimer'),
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
