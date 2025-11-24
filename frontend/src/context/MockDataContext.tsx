import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { delay, randomId } from '../lib/utils'
import { getTimezoneSuggestion } from '../lib/time'
import type {
  ConnectionStatus,
  Room,
  Timer,
  MessageColor,
} from '../types'

const STORAGE_KEY = 'stagetime.mockState.v1'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

type MockState = {
  rooms: Room[]
  timers: Record<string, Timer[]>
}

const normalizeState = (state: MockState): MockState => {
  let didChange = false
  const normalizedRooms = state.rooms.map((room) => {
    const timers = state.timers[room.id] ?? []
    const hasValidActive =
      !!room.state.activeTimerId &&
      timers.some((timer) => timer.id === room.state.activeTimerId)

    if (hasValidActive || timers.length === 0) {
      return room
    }

    didChange = true
    const fallbackTimer = [...timers].sort((a, b) => a.order - b.order)[0]

    return {
      ...room,
      state: {
        ...room.state,
        activeTimerId: fallbackTimer?.id ?? null,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
      },
    }
  })

  return didChange ? { ...state, rooms: normalizedRooms } : state
}

type CreateRoomInput = {
  title: string
  timezone: string
  ownerId: string
}

type CreateTimerInput = {
  title: string
  duration: number
  speaker?: string
}

type MockDataContextValue = {
  rooms: Room[]
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void
  getRoom: (roomId: string) => Room | undefined
  getTimers: (roomId: string) => Timer[]
  createRoom: (input: CreateRoomInput) => Promise<Room>
  deleteRoom: (roomId: string) => Promise<void>
  createTimer: (roomId: string, input: CreateTimerInput) => Promise<Timer>
  updateTimer: (
    roomId: string,
    timerId: string,
    patch: Partial<Omit<Timer, 'id' | 'roomId'>>,
  ) => Promise<void>
  deleteTimer: (roomId: string, timerId: string) => Promise<void>
  moveTimer: (
    roomId: string,
    timerId: string,
    direction: 'up' | 'down',
  ) => Promise<void>
  setActiveTimer: (roomId: string, timerId: string) => Promise<void>
  startTimer: (roomId: string, timerId?: string) => Promise<void>
  pauseTimer: (roomId: string) => Promise<void>
  resetTimer: (roomId: string) => Promise<void>
  nudgeTimer: (roomId: string, deltaMs: number) => Promise<void>
  updateMessage: (
    roomId: string,
    message: Partial<{ text: string; color: MessageColor; visible: boolean }>,
  ) => Promise<void>
}

const MockDataContext = createContext<MockDataContextValue | undefined>(undefined)

const createSeedState = (): MockState => {
  const ownerId = 'demo-owner'
  const roomId = 'room-main'
  const timers: Timer[] = [
    {
      id: 'timer-intro',
      roomId,
      title: 'Welcome Remarks',
      duration: 300,
      speaker: 'Host',
      type: 'countdown',
      order: 10,
    },
    {
      id: 'timer-keynote',
      roomId,
      title: 'Keynote Presentation',
      duration: 1200,
      speaker: 'CEO',
      type: 'countdown',
      order: 20,
    },
    {
      id: 'timer-qna',
      roomId,
      title: 'Q&A',
      duration: 600,
      speaker: 'Panel',
      type: 'countdown',
      order: 30,
    },
  ]

  const rooms: Room[] = [
    {
      id: roomId,
      ownerId,
      title: 'StageTime Demo Room',
      timezone: getTimezoneSuggestion(),
      createdAt: Date.now() - 1000 * 60 * 60 * 24,
      config: DEFAULT_CONFIG,
      state: {
        activeTimerId: timers[0].id,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
        message: {
          text: 'Welcome to StageTime',
          visible: true,
          color: 'green',
        },
      },
    },
  ]

  return { rooms, timers: { [roomId]: timers } }
}

const loadState = (): MockState => {
  if (typeof window === 'undefined') {
    return createSeedState()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedState()
    const parsed = JSON.parse(raw) as MockState
    return {
      rooms: parsed.rooms ?? [],
      timers: parsed.timers ?? {},
    }
  } catch (error) {
    console.warn('Failed to load mock data from storage', error)
    return createSeedState()
  }
}

export const MockDataProvider = ({ children }: { children: ReactNode }) => {
  const [state, setStateRaw] = useState<MockState>(() => normalizeState(loadState()))
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    'online',
  )

  const setState = useCallback<React.Dispatch<React.SetStateAction<MockState>>>(
    (value) => {
      setStateRaw((prev) => {
        const next =
          typeof value === 'function'
            ? (value as (prevState: MockState) => MockState)(prev)
            : (value as MockState)
        if (next === prev) {
          return prev
        }
        return normalizeState(next)
      })
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const next = JSON.parse(event.newValue) as MockState
        setStateRaw((prev) => {
          const hydrated = normalizeState({
            rooms: next.rooms ?? [],
            timers: next.timers ?? {},
          })
          return JSON.stringify(prev) === JSON.stringify(hydrated) ? prev : hydrated
        })
      } catch (error) {
        console.warn('Failed to hydrate mock data from storage event', error)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])
  const getRoom = useCallback(
    (roomId: string) => state.rooms.find((room) => room.id === roomId),
    [state.rooms],
  )

  const getTimers = useCallback(
    (roomId: string) =>
      [...(state.timers[roomId] ?? [])].sort((a, b) => a.order - b.order),
    [state.timers],
  )

  const updateTimers = useCallback(
    (roomId: string, updater: (timers: Timer[]) => Timer[]) => {
      setState((prev) => ({
        ...prev,
        timers: {
          ...prev.timers,
          [roomId]: updater(prev.timers[roomId] ?? []),
        },
      }))
    },
    [],
  )

  const updateRoom = useCallback(
    (roomId: string, updater: (room: Room) => Room) => {
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === roomId ? updater(room) : room,
        ),
      }))
    },
    [],
  )

  const createRoom = useCallback(
    async ({ title, timezone, ownerId }: CreateRoomInput) => {
      const id = randomId()
      const defaultTimer = {
        id: randomId(),
        roomId: id,
        title: 'Opening Remarks',
        duration: 300,
        speaker: 'Host',
        type: 'countdown' as const,
        order: 10,
      }
      const room: Room = {
        id,
        title,
        timezone,
        ownerId,
        createdAt: Date.now(),
        config: DEFAULT_CONFIG,
        state: {
          activeTimerId: defaultTimer.id,
          isRunning: false,
          startedAt: null,
          elapsedOffset: 0,
          message: {
            text: '',
            visible: false,
            color: 'green',
          },
        },
      }

      await delay()

      setState((prev) => ({
        rooms: [...prev.rooms, room],
        timers: {
          ...prev.timers,
          [id]: [defaultTimer],
        },
      }))

      return room
    },
    [],
  )

  const deleteRoom = useCallback(async (roomId: string) => {
    await delay(200)
    setState((prev) => ({
      rooms: prev.rooms.filter((room) => room.id !== roomId),
      timers: Object.fromEntries(
        Object.entries(prev.timers).filter(([id]) => id !== roomId),
      ),
    }))
  }, [])

  const createTimer = useCallback(
    async (roomId: string, input: CreateTimerInput) => {
      const timer: Timer = {
        id: randomId(),
        roomId,
        title: input.title,
        speaker: input.speaker ?? '',
        duration: input.duration,
        type: 'countdown',
        order: Date.now(),
      }

      await delay()

      updateTimers(roomId, (timers) => {
        const next = [...timers, timer]
        return next
          .sort((a, b) => a.order - b.order)
          .map((item, index) => ({ ...item, order: (index + 1) * 10 }))
      })

      return timer
    },
    [updateTimers],
  )

  const updateTimer = useCallback(
    async (
      roomId: string,
      timerId: string,
      patch: Partial<Omit<Timer, 'id' | 'roomId'>>,
    ) => {
      await delay()
      updateTimers(roomId, (timers) =>
        timers.map((timer) =>
          timer.id === timerId
            ? {
                ...timer,
                ...patch,
              }
            : timer,
        ),
      )
    },
    [updateTimers],
  )

  const deleteTimer = useCallback(
    async (roomId: string, timerId: string) => {
      await delay()
      updateTimers(roomId, (timers) => timers.filter((timer) => timer.id !== timerId))
      updateRoom(roomId, (room) => {
        if (room.state.activeTimerId !== timerId) return room
        return {
          ...room,
          state: {
            ...room.state,
            activeTimerId: null,
            isRunning: false,
            startedAt: null,
            elapsedOffset: 0,
          },
        }
      })
    },
    [updateRoom, updateTimers],
  )

  const moveTimer = useCallback(
    async (roomId: string, timerId: string, direction: 'up' | 'down') => {
      await delay()
      updateTimers(roomId, (timers) => {
        const ordered = [...timers].sort((a, b) => a.order - b.order)
        const index = ordered.findIndex((timer) => timer.id === timerId)
        if (index === -1) return ordered
        const swapIndex = direction === 'up' ? index - 1 : index + 1
        if (swapIndex < 0 || swapIndex >= ordered.length) return ordered
        ;[ordered[index], ordered[swapIndex]] = [
          ordered[swapIndex],
          ordered[index],
        ]
        return ordered.map((timer, idx) => ({
          ...timer,
          order: (idx + 1) * 10,
        }))
      })
    },
    [updateTimers],
  )

  const setActiveTimer = useCallback(
    async (roomId: string, timerId: string) => {
      await delay(120)
      updateRoom(roomId, (room) => ({
        ...room,
        state: {
          ...room.state,
          activeTimerId: timerId,
          isRunning: false,
          startedAt: null,
          elapsedOffset: 0,
        },
      }))
    },
    [updateRoom],
  )

  const startTimer = useCallback(
    async (roomId: string, timerId?: string) => {
      await delay(80)
      updateRoom(roomId, (room) => {
        const nextActive = timerId ?? room.state.activeTimerId
        if (!nextActive) return room
        const isSwitching = timerId && timerId !== room.state.activeTimerId
        return {
          ...room,
          state: {
            ...room.state,
            activeTimerId: nextActive,
            isRunning: true,
            startedAt: Date.now(),
            elapsedOffset: isSwitching ? 0 : room.state.elapsedOffset,
          },
        }
      })
    },
    [updateRoom],
  )

  const pauseTimer = useCallback(async (roomId: string) => {
    await delay(60)
    updateRoom(roomId, (room) => {
      if (!room.state.startedAt) {
        return {
          ...room,
          state: {
            ...room.state,
            isRunning: false,
          },
        }
      }
      const elapsed = Date.now() - room.state.startedAt
      return {
        ...room,
        state: {
          ...room.state,
          isRunning: false,
          startedAt: null,
          elapsedOffset: room.state.elapsedOffset + elapsed,
        },
      }
    })
  }, [updateRoom])

  const resetTimer = useCallback(async (roomId: string) => {
    await delay(60)
    updateRoom(roomId, (room) => ({
      ...room,
      state: {
        ...room.state,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
      },
    }))
  }, [updateRoom])

  const nudgeTimer = useCallback(async (roomId: string, deltaMs: number) => {
    await delay(60)
    setState((prev) => {
      const room = prev.rooms.find((candidate) => candidate.id === roomId)
      if (!room) {
        return prev
      }

      const timers = prev.timers[roomId] ?? []
      const activeTimer = timers.find(
        (timer) => timer.id === room.state.activeTimerId,
      )
      if (!activeTimer) {
        return prev
      }

      const durationMs = activeTimer.duration * 1000
      const maxElapsed = durationMs
      const minElapsed = durationMs * -1
      const nextElapsed = Math.min(
        maxElapsed,
        Math.max(minElapsed, room.state.elapsedOffset - deltaMs),
      )

      return {
        ...prev,
        rooms: prev.rooms.map((candidate) =>
          candidate.id === roomId
            ? {
                ...candidate,
                state: {
                  ...candidate.state,
                  elapsedOffset: nextElapsed,
                },
              }
            : candidate,
        ),
      }
    })
  }, [])

  const updateMessage = useCallback(
    async (
      roomId: string,
      message: Partial<{ text: string; color: MessageColor; visible: boolean }>,
    ) => {
      await delay(80)
      updateRoom(roomId, (room) => ({
        ...room,
        state: {
          ...room.state,
          message: {
            ...room.state.message,
            ...message,
          },
        },
      }))
    },
    [updateRoom],
  )

  const value = useMemo(
    () => ({
      rooms: state.rooms,
      connectionStatus,
      setConnectionStatus,
      getRoom,
      getTimers,
      createRoom,
      deleteRoom,
      createTimer,
      updateTimer,
      deleteTimer,
      moveTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      updateMessage,
    }),
    [
      state.rooms,
      connectionStatus,
      setConnectionStatus,
      getRoom,
      getTimers,
      createRoom,
      deleteRoom,
      createTimer,
      updateTimer,
      deleteTimer,
      moveTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      updateMessage,
    ],
  )

  return (
    <MockDataContext.Provider value={value}>{children}</MockDataContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMockData = () => {
  const ctx = useContext(MockDataContext)
  if (!ctx) {
    throw new Error('useMockData must be used within MockDataProvider')
  }
  return ctx
}
