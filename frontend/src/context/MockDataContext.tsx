import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { delay, randomId } from '../lib/utils'
import { getTimezoneSuggestion } from '../lib/time'
import type { Room, Timer, MessageColor, ConnectionStatus } from '../types'
import {
  DataProviderBoundary,
  useDataContext,
  type DataContextValue,
} from './DataContext'

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
    const progress = { ...(room.state.progress ?? {}) }
    let nextRoom = room

    let progressChanged = false
    timers.forEach((timer) => {
      if (progress[timer.id] === undefined) {
        progress[timer.id] = 0
        progressChanged = true
      }
    })

    if (progressChanged) {
      didChange = true
      nextRoom = {
        ...nextRoom,
        state: {
          ...nextRoom.state,
          progress,
        },
      }
    }

    const hasValidActive =
      !!nextRoom.state.activeTimerId &&
      timers.some((timer) => timer.id === nextRoom.state.activeTimerId)

    if (!hasValidActive && timers.length > 0) {
      didChange = true
      const fallbackTimer = [...timers].sort((a, b) => a.order - b.order)[0]
      nextRoom = {
        ...nextRoom,
        state: {
          ...nextRoom.state,
          activeTimerId: fallbackTimer?.id ?? null,
          isRunning: false,
          startedAt: null,
          elapsedOffset:
            fallbackTimer?.id ? progress[fallbackTimer.id] ?? 0 : 0,
        },
      }
    }

    return nextRoom
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

const captureProgress = (room: Room) => {
  const progress = { ...(room.state.progress ?? {}) }
  const activeId = room.state.activeTimerId
  if (activeId) {
    let elapsed = room.state.elapsedOffset
    if (room.state.isRunning && room.state.startedAt) {
      elapsed += Date.now() - room.state.startedAt
    }
    progress[activeId] = Math.max(0, elapsed)
  }
  return progress
}

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
        progress: timers.reduce<Record<string, number>>((acc, timer) => {
          acc[timer.id] = 0
          return acc
        }, {}),
        showClock: false,
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
      rooms: (parsed.rooms ?? []).map((room) => ({
        ...room,
        state: {
          ...room.state,
          showClock: room.state?.showClock ?? false,
          progress: room.state?.progress ?? {},
        },
      })),
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
    [setState],
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
    [setState],
  )

  const updateRoomMeta = useCallback(
    async (roomId: string, patch: Partial<Pick<Room, 'title' | 'timezone'>>) => {
      updateRoom(roomId, (room) => ({
        ...room,
        ...patch,
      }))
      await delay()
    },
    [updateRoom],
  )

  const restoreTimer = useCallback(
    async (roomId: string, timer: Timer) => {
      updateTimers(roomId, (timers) => {
        const filtered = timers.filter((candidate) => candidate.id !== timer.id)
        return [...filtered, timer].sort((a, b) => a.order - b.order)
      })
      updateRoom(roomId, (room) => ({
        ...room,
        state: {
          ...room.state,
          progress: {
            ...(room.state.progress ?? {}),
            [timer.id]: 0,
          },
        },
      }))
      await delay(80)
    },
    [updateRoom, updateTimers],
  )

  const resetTimerProgress = useCallback(
    async (roomId: string, timerId: string) => {
      updateRoom(roomId, (room) => {
        const progress = { ...(room.state.progress ?? {}), [timerId]: 0 }
        if (room.state.activeTimerId === timerId) {
          return {
            ...room,
            state: {
              ...room.state,
              progress,
              elapsedOffset: 0,
              startedAt: null,
              isRunning: false,
            },
          }
        }
        return {
          ...room,
          state: {
            ...room.state,
            progress,
          },
        }
      })
      await delay(60)
    },
    [updateRoom],
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
          progress: { [defaultTimer.id]: 0 },
          showClock: false,
          message: {
            text: '',
            visible: false,
            color: 'green',
          },
        },
      }

      setState((prev) => ({
        rooms: [...prev.rooms, room],
        timers: {
          ...prev.timers,
          [id]: [defaultTimer],
        },
      }))

      await delay()

      return room
    },
    [setState],
  )

  const deleteRoom = useCallback(async (roomId: string) => {
    setState((prev) => ({
      rooms: prev.rooms.filter((room) => room.id !== roomId),
      timers: Object.fromEntries(
        Object.entries(prev.timers).filter(([id]) => id !== roomId),
      ),
    }))
    await delay(200)
  }, [setState])

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

      updateTimers(roomId, (timers) => {
        const next = [...timers, timer]
        return next
          .sort((a, b) => a.order - b.order)
          .map((item, index) => ({ ...item, order: (index + 1) * 10 }))
      })

      await delay()

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
      if (patch.duration !== undefined) {
        updateRoom(roomId, (room) => {
          if (room.state.activeTimerId !== timerId) return room
          return {
            ...room,
            state: {
              ...room.state,
              elapsedOffset: 0,
                startedAt: room.state.isRunning ? Date.now() : null,
              },
            }
        })
      }
      await delay()
    },
    [updateRoom, updateTimers],
  )

  const deleteTimer = useCallback(
    async (roomId: string, timerId: string) => {
      updateTimers(roomId, (timers) => timers.filter((timer) => timer.id !== timerId))
      updateRoom(roomId, (room) => {
        const progress = { ...(room.state.progress ?? {}) }
        if (progress[timerId] !== undefined) {
          delete progress[timerId]
        }
        if (room.state.activeTimerId !== timerId) {
          return {
            ...room,
            state: {
              ...room.state,
              progress,
            },
          }
        }
        return {
          ...room,
          state: {
            ...room.state,
            activeTimerId: null,
            isRunning: false,
            startedAt: null,
            elapsedOffset: 0,
            progress,
          },
        }
      })
      await delay()
    },
    [updateRoom, updateTimers],
  )

  const moveTimer = useCallback(
    async (roomId: string, timerId: string, direction: 'up' | 'down') => {
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
      await delay()
    },
    [updateTimers],
  )

  const reorderTimer = useCallback(
    async (roomId: string, timerId: string, targetIndex: number) => {
      updateTimers(roomId, (timers) => {
        const ordered = [...timers].sort((a, b) => a.order - b.order)
        const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
        if (fromIndex === -1) return ordered
        const [moved] = ordered.splice(fromIndex, 1)
        let nextIndex = Math.max(0, Math.min(targetIndex, ordered.length))
        if (fromIndex < nextIndex) {
          nextIndex -= 1
        }
        ordered.splice(nextIndex, 0, moved)
        return ordered.map((timer, idx) => ({
          ...timer,
          order: (idx + 1) * 10,
        }))
      })
      await delay()
    },
    [updateTimers],
  )

  const setActiveTimer = useCallback(
    async (roomId: string, timerId: string) => {
      updateRoom(roomId, (room) => {
        const progress = captureProgress(room)
        const nextElapsed = progress[timerId] ?? 0
        return {
          ...room,
          state: {
            ...room.state,
            showClock: false,
            isRunning: false,
            startedAt: null,
            activeTimerId: timerId,
            elapsedOffset: nextElapsed,
            progress,
          },
        }
      })
      await delay(120)
    },
    [updateRoom],
  )

  const startTimer = useCallback(
    async (roomId: string, timerId?: string) => {
      updateRoom(roomId, (room) => {
        const nextActive = timerId ?? room.state.activeTimerId
        if (!nextActive) return room
        const progress = captureProgress(room)
        const nextElapsed = progress[nextActive] ?? 0
        return {
          ...room,
          state: {
            ...room.state,
            showClock: false,
            activeTimerId: nextActive,
            isRunning: true,
            startedAt: Date.now(),
            elapsedOffset: nextElapsed,
            progress,
            message: {
              ...room.state.message,
              visible: false,
            },
          },
        }
      })
      await delay(80)
    },
    [updateRoom],
  )

  const pauseTimer = useCallback(async (roomId: string) => {
    updateRoom(roomId, (room) => {
      const activeId = room.state.activeTimerId
      if (!activeId) {
        return {
          ...room,
          state: {
            ...room.state,
            isRunning: false,
          },
        }
      }
      const progress = captureProgress(room)
      return {
        ...room,
        state: {
          ...room.state,
          isRunning: false,
          startedAt: null,
          elapsedOffset: progress[activeId] ?? 0,
          progress,
        },
      }
    })
    await delay(60)
  }, [updateRoom])

  const resetTimer = useCallback(async (roomId: string) => {
    updateRoom(roomId, (room) => {
      const activeId = room.state.activeTimerId
      const progress = { ...(room.state.progress ?? {}) }
      if (activeId) {
        progress[activeId] = 0
      }
      return {
        ...room,
        state: {
          ...room.state,
          isRunning: false,
          startedAt: null,
          elapsedOffset: 0,
          progress,
        },
      }
    })
    await delay(60)
  }, [updateRoom])

  const nudgeTimer = useCallback(async (roomId: string, deltaMs: number) => {
    setState((prev) => {
      const room = prev.rooms.find((candidate) => candidate.id === roomId)
      if (!room) {
        return prev
      }

      const activeId = room.state.activeTimerId
      if (!activeId) {
        return prev
      }

      const nextElapsed = room.state.elapsedOffset - deltaMs
      const progress = {
        ...(room.state.progress ?? {}),
        [activeId]: nextElapsed,
      }

      return {
        ...prev,
        rooms: prev.rooms.map((candidate) =>
          candidate.id === roomId
            ? {
                ...candidate,
                state: {
                  ...candidate.state,
                  elapsedOffset: nextElapsed,
                  progress,
                },
              }
            : candidate,
        ),
      }
    })
    await delay(60)
  }, [setState])

  const setClockMode = useCallback(
    async (roomId: string, enabled: boolean) => {
      updateRoom(roomId, (room) => ({
        ...room,
        state: {
          ...room.state,
          showClock: enabled,
        },
      }))
      await delay(60)
    },
    [updateRoom],
  )

  const updateMessage = useCallback(
    async (
      roomId: string,
      message: Partial<{ text: string; color: MessageColor; visible: boolean }>,
    ) => {
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
      await delay(80)
    },
    [updateRoom],
  )

  const value = useMemo<DataContextValue>(
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
      updateRoomMeta,
      restoreTimer,
      resetTimerProgress,
      reorderTimer,
      setClockMode,
      deleteTimer,
      moveTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
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
      updateRoomMeta,
      restoreTimer,
      resetTimerProgress,
      reorderTimer,
      deleteTimer,
      moveTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
      updateMessage,
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMockData = () => useDataContext()
