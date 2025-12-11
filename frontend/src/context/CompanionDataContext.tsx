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
  const [companionMode, setCompanionMode] = useState<string>('minimal')
  const [capabilities, setCapabilities] = useState<HandshakeAck['capabilities']>({
    powerpoint: false,
    externalVideo: false,
    fileOperations: true,
  })

  useEffect(() => {
    const socket = io('http://localhost:4000', {
      transports: ['websocket'],
      autoConnect: false,
    })
    socketRef.current = socket

    socket.on('connect', () => setConnectionStatus('online'))
    socket.on('disconnect', () => setConnectionStatus('offline'))
    socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'))

    socket.on('HANDSHAKE_ACK', (data: HandshakeAck) => {
      setCompanionMode(data.companionMode)
      setCapabilities(data.capabilities)
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

    socket.connect()

    return () => {
      socket.off('HANDSHAKE_ACK')
      socket.off('ROOM_STATE_SNAPSHOT')
      socket.off('ROOM_STATE_DELTA')
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (connectionStatus === 'online' && lastJoinArgs && socketRef.current) {
      socketRef.current.emit('JOIN_ROOM', {
        type: 'JOIN_ROOM',
        roomId: lastJoinArgs.roomId,
        token: lastJoinArgs.token,
        clientType: lastJoinArgs.clientType ?? 'controller',
      })
    }
  }, [connectionStatus, lastJoinArgs])

  const getRoom = useCallback(
    (roomId: string) => rooms.find((room) => room.id === roomId),
    [rooms],
  )

  const getTimers = useCallback(
    (roomId: string) => timers[roomId] ?? [],
    [timers],
  )

  const subscribeToRoom = useCallback((roomId: string, token: string, clientType: 'controller' | 'viewer' = 'controller') => {
    setLastJoinArgs({ roomId, token, clientType })
    if (!socketRef.current) return
    socketRef.current.emit('JOIN_ROOM', {
      type: 'JOIN_ROOM',
      roomId,
      token,
      clientType,
    })
  }, [])

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
      socketRef.current?.emit('TIMER_ACTION', {
        type: 'TIMER_ACTION',
        action,
        roomId,
        timerId,
        timestamp,
      })
    },
    [],
  )

  const value: DataContextValue & {
    companionMode: string
    capabilities: HandshakeAck['capabilities']
    subscribeToRoom: typeof subscribeToRoom
    getRoomState: typeof getRoomState
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
        const targetId = timerId ?? room?.state.activeTimerId
        if (!room || !targetId) return
        applyRoomState(roomId, {
          activeTimerId: targetId,
          isRunning: true,
          lastUpdate: Date.now(),
        })
        emitTimerAction(roomId, targetId, 'START')
      },
      pauseTimer: async (roomId: string) => {
        const room = getRoom(roomId)
        const targetId = room?.state.activeTimerId
        if (!room || !targetId) return
        applyRoomState(roomId, {
          isRunning: false,
          lastUpdate: Date.now(),
        })
        emitTimerAction(roomId, targetId, 'PAUSE')
      },
      resetTimer: async (roomId: string, timerId?: string) => {
        const room = getRoom(roomId)
        const targetId = timerId ?? room?.state.activeTimerId
        if (!room || !targetId) return
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
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
