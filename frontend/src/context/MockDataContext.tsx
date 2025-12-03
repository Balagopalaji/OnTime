import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { delay, randomId } from '../lib/utils'
import { getTimezoneSuggestion } from '../lib/time'
import type { Room, Timer, MessageColor, ConnectionStatus } from '../types'
import {
  clearStack,
  loadStack,
  persistStack,
  popRedo,
  popUndo,
  pushRedo,
  pushWithCap,
  type RoomUpdatePatch,
  type TimerUpdatePatch,
  type UndoEntry,
  type UndoStack,
} from '../lib/undoStack'
import { roomStackKey, timerStackKey } from '../lib/undoKeys'
import {
  DataProviderBoundary,
  useDataContext,
  type DataContextValue,
} from './DataContext'
import { useAuth } from './AuthContext'

const STORAGE_KEY = 'stagetime.mockState.v1'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const STACK_CAP = 10
const PLACEHOLDER_TTL = 10_000
const createEmptyStack = (): UndoStack => ({ undo: [], redo: [] })

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

const derivePendingTimers = (stacks: Record<string, UndoStack>) => {
  const next: Record<string, Set<string>> = {}
  Object.entries(stacks).forEach(([roomId, stack]) => {
    const pending = new Set(
      stack.undo
        .filter((entry) => entry.kind === 'timer' && entry.action === 'delete')
        .map((entry) => entry.snapshot.timer.id),
    )
    if (pending.size) {
      next[roomId] = pending
    }
  })
  return next
}

const buildRoomSnapshot = (room: Room, timers: Timer[]): UndoEntry & { kind: 'room' }['snapshot'] => ({
  id: room.id,
  ownerId: room.ownerId,
  title: room.title,
  timezone: room.timezone,
  createdAt: room.createdAt,
  config: { ...room.config },
  state: {
    ...room.state,
    progress: captureProgress(room),
  },
  timers: timers.map((timer) => ({ ...timer })),
})

const buildTimerSnapshot = (room: Room, timer: Timer): UndoEntry & { kind: 'timer' }['snapshot'] => ({
  roomId: room.id,
  timer: { ...timer },
  progress: captureProgress(room)[timer.id] ?? 0,
})

const loadTimerStacksForUser = (userId: string): Record<string, UndoStack> => {
  if (typeof window === 'undefined') return {}
  const next: Record<string, UndoStack> = {}
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    const prefix = `stagetime.undo.timers.${userId}.`
    if (key && key.startsWith(prefix)) {
      const roomId = key.slice(prefix.length)
      next[roomId] = loadStack(key)
    }
  }
  return next
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
  const [pendingRooms, setPendingRooms] = useState<Set<string>>(new Set())
  const [pendingRoomPlaceholders, setPendingRoomPlaceholders] = useState<
    Array<{ roomId: string; title: string; expiresAt: number }>
  >([])
  const [pendingTimers, setPendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders, setPendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const roomStackRef = useRef<UndoStack>(createEmptyStack())
  const timerStacksRef = useRef<Record<string, UndoStack>>({})
  const lastUserIdRef = useRef<string | null>(null)
  const { user } = useAuth()
  const roomStackKeyForUser = user ? roomStackKey(user.uid) : null

  const syncPendingState = useCallback(() => {
    const roomEntries = roomStackRef.current.undo.filter(
      (entry) => entry.kind === 'room' && entry.action === 'delete',
    )
    setPendingRooms(new Set(roomEntries.map((entry) => entry.roomId)))
    setPendingRoomPlaceholders(
      roomEntries.map((entry) => ({
        roomId: entry.roomId,
        title: entry.snapshot.title,
        expiresAt: entry.expiresAt,
      })),
    )

    const timerPlaceholders: Record<
      string,
      Array<{ timerId: string; title: string; order: number; expiresAt: number }>
    > = {}
    Object.entries(timerStacksRef.current).forEach(([roomId, stack]) => {
      const entries = stack.undo.filter(
        (entry) => entry.kind === 'timer' && entry.action === 'delete',
      )
      if (!entries.length) return
      timerPlaceholders[roomId] = entries.map((entry) => ({
        timerId: entry.snapshot.timer.id,
        title: entry.snapshot.timer.title,
        order: entry.snapshot.timer.order,
        expiresAt: entry.expiresAt,
      }))
    })
    setPendingTimerPlaceholders(timerPlaceholders)
    setPendingTimers(derivePendingTimers(timerStacksRef.current))
  }, [])

  const persistRoomStack = useCallback(
    (stack: UndoStack) => {
      if (!roomStackKeyForUser) return
      persistStack(roomStackKeyForUser, stack)
    },
    [roomStackKeyForUser],
  )

  const persistTimerStack = useCallback(
    (roomId: string, stack: UndoStack) => {
      if (!user) return
      persistStack(timerStackKey(user.uid, roomId), stack)
    },
    [user],
  )

  useEffect(() => {
    const previous = lastUserIdRef.current
    if (previous && !user) {
      clearStack(roomStackKey(previous))
      Object.keys(timerStacksRef.current).forEach((roomId) =>
        clearStack(timerStackKey(previous, roomId)),
      )
      roomStackRef.current = createEmptyStack()
      timerStacksRef.current = {}
      syncPendingState()
    }
    lastUserIdRef.current = user?.uid ?? null
  }, [syncPendingState, user])

  useEffect(() => {
    if (!user) return
    const loaded = loadStack(roomStackKey(user.uid))
    roomStackRef.current = loaded
    syncPendingState()
  }, [syncPendingState, user])

  useEffect(() => {
    if (!user) return
    const stacks = loadTimerStacksForUser(user.uid)
    timerStacksRef.current = stacks
    syncPendingState()
  }, [syncPendingState, user])

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
  const visibleRooms = useMemo(
    () => state.rooms.filter((room) => !pendingRooms.has(room.id)),
    [pendingRooms, state.rooms],
  )

  const getRoom = useCallback(
    (roomId: string) => visibleRooms.find((room) => room.id === roomId),
    [visibleRooms],
  )

  const getTimers = useCallback(
    (roomId: string) => {
      const pendingForRoom = pendingTimers[roomId]
      return [...(state.timers[roomId] ?? [])]
        .filter((timer) => !pendingForRoom?.has(timer.id))
        .sort((a, b) => a.order - b.order)
    },
    [pendingTimers, state.timers],
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
      const room = state.rooms.find((candidate) => candidate.id === roomId)
      if (room) {
        const before: RoomUpdatePatch = {}
        if (patch.title !== undefined) before.title = room.title
        if (patch.timezone !== undefined) before.timezone = room.timezone
        if (Object.keys(before).length > 0) {
          const { stack, evicted } = pushWithCap(
            roomStackRef.current,
            {
              kind: 'room',
              action: 'update',
              id: randomId(),
              roomId,
              expiresAt: Date.now(),
              before,
              patch: {
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
              },
            },
            STACK_CAP,
          )
          roomStackRef.current = stack
          if (evicted && evicted.kind === 'room' && evicted.action === 'delete') {
            setState((prev) => ({
              rooms: prev.rooms.filter((candidate) => candidate.id !== evicted.roomId),
              timers: Object.fromEntries(
                Object.entries(prev.timers).filter(([id]) => id !== evicted.roomId),
              ),
            }))
          }
          syncPendingState()
          persistRoomStack(stack)
        }
      }
      updateRoom(roomId, (room) => ({
        ...room,
        ...patch,
      }))
      await delay()
    },
    [persistRoomStack, setState, state.rooms, syncPendingState, updateRoom],
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

      const entry: UndoEntry = {
        kind: 'room',
        action: 'create',
        id: randomId(),
        roomId: id,
        expiresAt: Date.now() + PLACEHOLDER_TTL,
        snapshot: buildRoomSnapshot(room, [defaultTimer]),
      }
      const { stack, evicted } = pushWithCap(roomStackRef.current, entry, STACK_CAP)
      roomStackRef.current = stack
      if (evicted && evicted.kind === 'room' && evicted.action === 'delete') {
        setState((prev) => ({
          rooms: prev.rooms.filter((candidate) => candidate.id !== evicted.roomId),
          timers: Object.fromEntries(
            Object.entries(prev.timers).filter(([idToKeep]) => idToKeep !== evicted.roomId),
          ),
        }))
      }
      syncPendingState()
      persistRoomStack(stack)

      await delay()

      return room
    },
    [persistRoomStack, setState, syncPendingState],
  )

  const deleteRoom = useCallback(
    async (roomId: string) => {
      if (!user) return
      const room = state.rooms.find((candidate) => candidate.id === roomId)
      const timersForRoom = [...(state.timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
      if (!room) return
      const entry: UndoEntry = {
        kind: 'room',
        action: 'delete',
        id: randomId(),
        roomId,
        expiresAt: Date.now() + PLACEHOLDER_TTL,
        snapshot: buildRoomSnapshot(room, timersForRoom),
      }

      const { stack, evicted } = pushWithCap(roomStackRef.current, entry, STACK_CAP)
      roomStackRef.current = stack
      if (evicted && evicted.kind === 'room' && evicted.action === 'delete') {
        setState((prev) => ({
          rooms: prev.rooms.filter((candidate) => candidate.id !== evicted.roomId),
          timers: Object.fromEntries(Object.entries(prev.timers).filter(([id]) => id !== evicted.roomId)),
        }))
      }
      syncPendingState()
      persistRoomStack(stack)
      await delay(50)
    },
    [persistRoomStack, setState, state.rooms, state.timers, syncPendingState, user],
  )

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

      const room = getRoom(roomId)
      if (room) {
        const entry: UndoEntry = {
          kind: 'timer',
          action: 'create',
          id: randomId(),
          roomId,
          expiresAt: Date.now() + PLACEHOLDER_TTL,
          snapshot: buildTimerSnapshot(room, timer),
        }
        const currentStack = timerStacksRef.current[roomId] ?? createEmptyStack()
        const { stack, evicted } = pushWithCap(currentStack, entry, STACK_CAP)
        if (evicted && evicted.kind === 'timer' && evicted.action === 'delete') {
          updateTimers(evicted.roomId, (timers) =>
            timers.filter((candidate) => candidate.id !== evicted.snapshot.timer.id),
          )
        }
        timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
        syncPendingState()
        persistTimerStack(roomId, stack)
      }

      await delay()

      return timer
    },
    [getRoom, persistTimerStack, syncPendingState, updateTimers],
  )

  const updateTimer = useCallback(
    async (
      roomId: string,
      timerId: string,
      patch: Partial<Omit<Timer, 'id' | 'roomId'>>,
    ) => {
      const timer = (state.timers[roomId] ?? []).find((candidate) => candidate.id === timerId)
      if (timer) {
        const before: TimerUpdatePatch = {}
        ;(['title', 'duration', 'speaker', 'type', 'order'] as const).forEach((key) => {
          if (patch[key] !== undefined) {
            // @ts-expect-error index by key
            before[key] = timer[key]
          }
        })
        if (Object.keys(before).length > 0) {
          const currentStack = timerStacksRef.current[roomId] ?? createEmptyStack()
          const { stack, evicted } = pushWithCap(
            currentStack,
            {
              kind: 'timer',
              action: 'update',
              id: randomId(),
              roomId,
              timerId,
              expiresAt: Date.now(),
              before,
              patch,
            },
            STACK_CAP,
          )
          if (evicted && evicted.kind === 'timer' && evicted.action === 'delete') {
            updateTimers(evicted.roomId, (timers) =>
              timers.filter((candidate) => candidate.id !== evicted.snapshot.timer.id),
            )
          }
          timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
          syncPendingState()
          persistTimerStack(roomId, stack)
        }
      }
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
    [persistTimerStack, state.timers, syncPendingState, updateRoom, updateTimers],
  )

  const deleteTimer = useCallback(
    async (roomId: string, timerId: string) => {
      const room = state.rooms.find((candidate) => candidate.id === roomId)
      const timer = (state.timers[roomId] ?? []).find((candidate) => candidate.id === timerId)
      if (!room || !timer || !user) return
      const entry: UndoEntry = {
        kind: 'timer',
        action: 'delete',
        id: randomId(),
        roomId,
        expiresAt: Date.now() + PLACEHOLDER_TTL,
        snapshot: buildTimerSnapshot(room, timer),
      }

      const currentStack = timerStacksRef.current[roomId] ?? createEmptyStack()
      const { stack, evicted } = pushWithCap(currentStack, entry, STACK_CAP)
      if (evicted && evicted.kind === 'timer' && evicted.action === 'delete') {
        updateTimers(evicted.roomId, (timers) =>
          timers.filter((candidate) => candidate.id !== evicted.snapshot.timer.id),
        )
      }
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
      syncPendingState()
      persistTimerStack(roomId, stack)
      await delay()
    },
    [persistTimerStack, state.rooms, state.timers, syncPendingState, updateTimers, user],
  )

  const undoRoomDelete: DataContextValue['undoRoomDelete'] = useCallback(async () => {
    if (!user) return
    const { entry, stack } = popUndo(roomStackRef.current)
    if (!entry || entry.kind !== 'room') return
    const nextStack = pushRedo(stack, entry, STACK_CAP)
    roomStackRef.current = nextStack
    syncPendingState()
    persistRoomStack(nextStack)

    if (entry.action === 'delete') {
      const snapshot = entry.snapshot
      const restoredRoom: Room = {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        title: snapshot.title,
        timezone: snapshot.timezone,
        createdAt: snapshot.createdAt,
        config: snapshot.config,
        state: snapshot.state,
      }
      setState((prev) => ({
        rooms: [...prev.rooms, restoredRoom],
        timers: {
          ...prev.timers,
          [snapshot.id]: snapshot.timers.map((timer) => ({ ...timer })),
        },
      }))
      syncPendingState()
      await delay(50)
    } else if (entry.action === 'create') {
      setState((prev) => ({
        rooms: prev.rooms.filter((candidate) => candidate.id !== entry.roomId),
        timers: Object.fromEntries(
          Object.entries(prev.timers).filter(([id]) => id !== entry.roomId),
        ),
      }))
      syncPendingState()
      await delay(20)
    } else if (entry.action === 'update') {
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === entry.roomId
            ? {
                ...room,
                ...(entry.before.title !== undefined ? { title: entry.before.title } : {}),
                ...(entry.before.timezone !== undefined ? { timezone: entry.before.timezone } : {}),
              }
            : room,
        ),
      }))
      syncPendingState()
      await delay(20)
    }
  }, [persistRoomStack, setState, syncPendingState, user])

  const redoRoomDelete: DataContextValue['redoRoomDelete'] = useCallback(async () => {
    if (!user) return
    const { entry, stack } = popRedo(roomStackRef.current)
    if (!entry || entry.kind !== 'room') return
    const nextUndo = [entry, ...stack.undo].slice(0, STACK_CAP)
    const nextStack: UndoStack = { undo: nextUndo, redo: stack.redo }
    roomStackRef.current = nextStack
    syncPendingState()
    persistRoomStack(nextStack)

    if (entry.action === 'delete') {
      syncPendingState()
      setState((prev) => ({
        rooms: prev.rooms.filter((candidate) => candidate.id !== entry?.roomId),
        timers: Object.fromEntries(
          Object.entries(prev.timers).filter(([id]) => id !== entry?.roomId),
        ),
      }))
      await delay(80)
    } else if (entry.action === 'create') {
      const snapshot = entry.snapshot
      const restoredRoom: Room = {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        title: snapshot.title,
        timezone: snapshot.timezone,
        createdAt: snapshot.createdAt,
        config: snapshot.config,
        state: snapshot.state,
      }
      setState((prev) => ({
        rooms: [...prev.rooms, restoredRoom],
        timers: {
          ...prev.timers,
          [snapshot.id]: snapshot.timers.map((timer) => ({ ...timer })),
        },
      }))
      syncPendingState()
      await delay(40)
    } else if (entry.action === 'update') {
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === entry.roomId
            ? {
                ...room,
                ...(entry.patch.title !== undefined ? { title: entry.patch.title } : {}),
                ...(entry.patch.timezone !== undefined ? { timezone: entry.patch.timezone } : {}),
              }
            : room,
        ),
      }))
      syncPendingState()
      await delay(30)
    }
  }, [persistRoomStack, setState, syncPendingState, user])

  const undoTimerDelete: DataContextValue['undoTimerDelete'] = useCallback(
    async (roomId) => {
      if (!user) return
      const current = timerStacksRef.current[roomId] ?? createEmptyStack()
      const { entry, stack } = popUndo(current)
      if (!entry || entry.kind !== 'timer') return
      const nextStack = pushRedo(stack, entry, STACK_CAP)
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: nextStack }
      syncPendingState()
      persistTimerStack(roomId, nextStack)
      if (entry.action === 'create') {
        updateTimers(roomId, (timers) =>
          timers.filter((timer) => timer.id !== entry.snapshot.timer.id),
        )
        updateRoom(roomId, (room) => {
          const progress = { ...(room.state.progress ?? {}) }
          delete progress[entry.snapshot.timer.id]
          const isActive = room.state.activeTimerId === entry.snapshot.timer.id
          return {
            ...room,
            state: {
              ...room.state,
              activeTimerId: isActive ? null : room.state.activeTimerId,
              isRunning: isActive ? false : room.state.isRunning,
              startedAt: isActive ? null : room.state.startedAt,
              elapsedOffset: isActive ? 0 : room.state.elapsedOffset,
              progress,
            },
          }
        })
      } else if (entry.action === 'update') {
        updateTimers(roomId, (timers) =>
          timers.map((timer) =>
            timer.id === entry.timerId
              ? {
                  ...timer,
                  ...(entry.before.title !== undefined ? { title: entry.before.title } : {}),
                  ...(entry.before.duration !== undefined ? { duration: entry.before.duration } : {}),
                  ...(entry.before.speaker !== undefined ? { speaker: entry.before.speaker } : {}),
                  ...(entry.before.type !== undefined ? { type: entry.before.type } : {}),
                  ...(entry.before.order !== undefined ? { order: entry.before.order } : {}),
                }
              : timer,
          ),
        )
      }
    },
    [persistTimerStack, syncPendingState, updateRoom, updateTimers, user],
  )

  const redoTimerDelete: DataContextValue['redoTimerDelete'] = useCallback(
    async (roomId) => {
      if (!user) return
      const current = timerStacksRef.current[roomId] ?? createEmptyStack()
      const { entry, stack } = popRedo(current)
      if (!entry || entry.kind !== 'timer') return
      const nextUndo = [entry, ...stack.undo].slice(0, STACK_CAP)
      const nextStack: UndoStack = { undo: nextUndo, redo: stack.redo }
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: nextStack }
      syncPendingState()
      persistTimerStack(roomId, nextStack)

      if (entry.action === 'delete') {
        const targetId = entry.snapshot.timer.id
        updateTimers(roomId, (timers) => timers.filter((timer) => timer.id !== targetId))
        updateRoom(roomId, (room) => {
          const progress = { ...(room.state.progress ?? {}) }
          delete progress[targetId]
          const isActive = room.state.activeTimerId === targetId
          return {
            ...room,
            state: {
              ...room.state,
              activeTimerId: isActive ? null : room.state.activeTimerId,
              isRunning: isActive ? false : room.state.isRunning,
              startedAt: isActive ? null : room.state.startedAt,
              elapsedOffset: isActive ? 0 : room.state.elapsedOffset,
              progress,
            },
          }
        })
        await delay(50)
      } else if (entry.action === 'create') {
        const targetId = entry.snapshot.timer.id
        updateTimers(roomId, (timers) => {
          const filtered = timers.filter((timer) => timer.id !== targetId)
          return [...filtered, entry.snapshot.timer].sort((a, b) => a.order - b.order)
        })
        updateRoom(roomId, (room) => {
          const progress = { ...(room.state.progress ?? {}) }
          progress[targetId] = entry.snapshot.progress ?? 0
          return {
            ...room,
            state: {
              ...room.state,
              progress,
            },
          }
        })
        await delay(30)
      } else if (entry.action === 'update') {
        updateTimers(roomId, (timers) =>
          timers.map((timer) =>
            timer.id === entry.timerId
              ? {
                  ...timer,
                  ...(entry.patch.title !== undefined ? { title: entry.patch.title } : {}),
                  ...(entry.patch.duration !== undefined ? { duration: entry.patch.duration } : {}),
                  ...(entry.patch.speaker !== undefined ? { speaker: entry.patch.speaker } : {}),
                  ...(entry.patch.type !== undefined ? { type: entry.patch.type } : {}),
                  ...(entry.patch.order !== undefined ? { order: entry.patch.order } : {}),
                }
              : timer,
          ),
        )
        await delay(20)
      }
    },
    [persistTimerStack, syncPendingState, updateRoom, updateTimers, user],
  )

  const clearUndoStacks: DataContextValue['clearUndoStacks'] = useCallback(async () => {
    const currentUserId = user?.uid
    if (currentUserId) {
      clearStack(roomStackKey(currentUserId))
      Object.keys(timerStacksRef.current).forEach((roomId) =>
        clearStack(timerStackKey(currentUserId, roomId)),
      )
    }
    roomStackRef.current = createEmptyStack()
    timerStacksRef.current = {}
    syncPendingState()
  }, [syncPendingState, user])

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
      rooms: visibleRooms,
      connectionStatus,
      setConnectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      undoRoomDelete,
      redoRoomDelete,
      undoTimerDelete,
      redoTimerDelete,
      clearUndoStacks,
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
    }),
    [
      visibleRooms,
      connectionStatus,
      setConnectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      undoRoomDelete,
      redoRoomDelete,
      undoTimerDelete,
      redoTimerDelete,
      clearUndoStacks,
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
