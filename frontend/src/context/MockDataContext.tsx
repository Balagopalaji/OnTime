import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { randomId } from '../lib/utils'
import { getTimezoneSuggestion } from '../lib/time'
import type { Room, Timer, MessageColor, ConnectionStatus, ControllerClient } from '../types'
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

const isTestEnv = Boolean((import.meta as unknown as { vitest?: unknown })?.vitest)

const STORAGE_KEY = 'stagetime.mockState.v2'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const roomOrderKey = (room: Pick<Room, 'order' | 'createdAt'>) => room.order ?? room.createdAt

// eslint-disable-next-line react-refresh/only-export-components
export const reorderOwnedRooms = (
  rooms: Room[],
  ownerId: string | undefined,
  pendingRooms: Set<string>,
  roomId: string,
  targetIndex: number,
): Room[] => {
  if (!ownerId) return rooms
  const owned = rooms
    .filter((room) => room.ownerId === ownerId && !pendingRooms.has(room.id))
    .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
  const fromIndex = owned.findIndex((room) => room.id === roomId)
  if (fromIndex === -1) return rooms
  const [moved] = owned.splice(fromIndex, 1)
  const clampedIndex = Math.max(0, Math.min(targetIndex, owned.length))
  owned.splice(clampedIndex, 0, moved)
  const updatedOrders = owned.reduce<Record<string, number>>((acc, room, idx) => {
    acc[room.id] = (idx + 1) * 10
    return acc
  }, {})
  return rooms.map((room) =>
    updatedOrders[room.id] !== undefined ? { ...room, order: updatedOrders[room.id] } : room,
  )
}

const STACK_CAP = 10
const PLACEHOLDER_TTL = 10_000

const createEmptyStack = (): UndoStack => ({ undo: [], redo: [] })

type PendingTimeout = { handle: ReturnType<typeof setTimeout>; resolve: () => void }

type MockState = {
  rooms: Room[]
  timers: Record<string, Timer[]>
}

type RoomSnapshot = {
  id: string
  ownerId: string
  title: string
  timezone: string
  createdAt: number
  order?: number
  config: Room['config']
  state: Room['state']
  timers: Timer[]
}

type TimerSnapshot = {
  roomId: string
  timer: Timer
  progress: number
}

const coerceRoomSnapshot = (snapshot: unknown): RoomSnapshot | null => {
  if (!snapshot || typeof snapshot !== 'object') return null
  const record = snapshot as RoomSnapshot
  if (typeof record.id !== 'string') return null
  if (!Array.isArray(record.timers)) return null
  return record
}

const coerceTimerSnapshot = (snapshot: unknown): TimerSnapshot | null => {
  if (!snapshot || typeof snapshot !== 'object') return null
  const record = snapshot as TimerSnapshot
  if (!record.timer || typeof record.timer.id !== 'string') return null
  return record
}

const normalizeState = (state: MockState): MockState => {
  let didChange = false
  const normalizedRooms = state.rooms.map((room) => {
    const timers = state.timers[room.id] ?? []
    const progress = { ...(room.state.progress ?? {}) }
    let nextRoom = room
    if (!nextRoom.state.clockMode) {
      didChange = true
      nextRoom = {
        ...nextRoom,
        state: {
          ...nextRoom.state,
          clockMode: '24h',
        },
      }
    }
    if (nextRoom.order === undefined) {
      didChange = true
      nextRoom = { ...nextRoom, order: nextRoom.createdAt }
    }

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
        .map((entry) => {
          const snap = coerceTimerSnapshot(entry.snapshot)
          return snap?.timer.id ?? ''
        }),
    )
    if (pending.size) {
      next[roomId] = pending
    }
  })
  return next
}

const buildRoomSnapshot = (room: Room, timers: Timer[]): RoomSnapshot => ({
  id: room.id,
  ownerId: room.ownerId,
  title: room.title,
  timezone: room.timezone,
  createdAt: room.createdAt,
  order: room.order,
  config: { ...room.config },
  state: {
    ...room.state,
    progress: captureProgress(room),
  },
  timers: timers.map((timer) => ({ ...timer })),
})

const buildTimerSnapshot = (room: Room, timer: Timer): TimerSnapshot => ({
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
      order: 10,
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
    Array<{ roomId: string; title: string; expiresAt: number; createdAt: number; order?: number }>
  >([])
  const [pendingTimers, setPendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders, setPendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const roomStackRef = useRef<UndoStack>(createEmptyStack())
  const timerStacksRef = useRef<Record<string, UndoStack>>({})
  const lastUserIdRef = useRef<string | null>(null)
  const pendingNudgeRef = useRef<Record<string, number>>({})
  const delayHandlesRef = useRef<PendingTimeout[]>([])
  const isMountedRef = useRef(true)
  const safeDelayRef = useRef<(ms?: number) => Promise<void>>((ms?: number) => {
    if (!isMountedRef.current) {
      return Promise.resolve()
    }
    const delayMs = ms ?? 0
    if (delayMs <= 0) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const handle = setTimeout(() => {
        delayHandlesRef.current = delayHandlesRef.current.filter((entry) => entry.handle !== handle)
        resolve()
      }, delayMs)
      delayHandlesRef.current.push({ handle, resolve })
    })
  })

  useEffect(
    () => () => {
      isMountedRef.current = false
      delayHandlesRef.current.forEach(({ handle, resolve }) => {
        clearTimeout(handle)
        resolve()
      })
      delayHandlesRef.current = []
    },
    [],
  )
  const { user } = useAuth()
  const roomStackKeyForUser = user ? roomStackKey(user.uid) : null

  const syncPendingState = useCallback(() => {
    const roomEntries = roomStackRef.current.undo.filter(
      (entry) => entry.kind === 'room' && entry.action === 'delete',
    )
    setPendingRooms(new Set(roomEntries.map((entry) => entry.roomId)))
    setPendingRoomPlaceholders(
      roomEntries.flatMap((entry) => {
        const snapshot = coerceRoomSnapshot(entry.snapshot)
        if (!snapshot) return []
        return [
          {
            roomId: entry.roomId,
            title: snapshot.title,
            expiresAt: entry.expiresAt,
            createdAt: snapshot.createdAt,
            order: snapshot.order,
          },
        ]
      }),
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
      timerPlaceholders[roomId] = entries.flatMap((entry) => {
        const snapshot = coerceTimerSnapshot(entry.snapshot)
        if (!snapshot) return []
        return [
          {
            timerId: snapshot.timer.id,
            title: snapshot.timer.title,
            order: snapshot.timer.order,
            expiresAt: entry.expiresAt,
          },
        ]
      })
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
    if (isTestEnv) return
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    state.rooms.forEach((room) => {
      pendingNudgeRef.current[room.id] = 0
    })
  }, [state.rooms])

  useEffect(() => {
    if (isTestEnv) return
    if (typeof window === 'undefined') return
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const next = JSON.parse(event.newValue) as MockState
        setStateRaw((prev) => {
      const hydrated = normalizeState({
        rooms: next.rooms?.map((room: Room) => ({
          ...room,
          state: {
            ...room.state,
            clockMode: room.state.clockMode ?? '24h',
          },
        })) ?? [],
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
    () =>
      state.rooms
        .filter((room) => !pendingRooms.has(room.id))
        .sort((a, b) => roomOrderKey(a) - roomOrderKey(b)),
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
      await safeDelayRef.current?.()
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
      await safeDelayRef.current?.(80)
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
      await safeDelayRef.current?.(60)
    },
    [updateRoom],
  )

  const createRoom = useCallback(
    async ({ title, timezone, ownerId }: CreateRoomInput) => {
      const ownedRooms = state.rooms.filter(
        (candidate) => candidate.ownerId === ownerId && !pendingRooms.has(candidate.id),
      )
      const nextOrder = ownedRooms.reduce((max, room) => Math.max(max, roomOrderKey(room)), 0) + 10
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
        order: nextOrder,
        config: DEFAULT_CONFIG,
        state: {
          activeTimerId: defaultTimer.id,
          isRunning: false,
          startedAt: null,
          elapsedOffset: 0,
          progress: { [defaultTimer.id]: 0 },
          showClock: false,
          clockMode: '24h',
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

      await safeDelayRef.current?.()

      return room
    },
    [pendingRooms, persistRoomStack, setState, state.rooms, syncPendingState],
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
      await safeDelayRef.current?.(50)
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
          const snapshot = coerceTimerSnapshot(evicted.snapshot)
          if (snapshot) {
            updateTimers(evicted.roomId, (timers) =>
              timers.filter((candidate) => candidate.id !== snapshot.timer.id),
            )
          }
        }
        timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
        syncPendingState()
        persistTimerStack(roomId, stack)
      }

      await safeDelayRef.current?.()

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
      const room = state.rooms.find((candidate) => candidate.id === roomId)
      if (timer) {
        const before: TimerUpdatePatch = {}
        ;(['title', 'duration', 'speaker', 'type', 'order'] as const).forEach((key) => {
          const currentValue = timer[key]
          if (patch[key] !== undefined) {
            before[key] = currentValue as never
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
            const snapshot = coerceTimerSnapshot(evicted.snapshot)
            if (snapshot) {
              updateTimers(evicted.roomId, (timers) =>
                timers.filter((candidate) => candidate.id !== snapshot.timer.id),
              )
            }
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
      if (patch.duration !== undefined && room) {
        updateRoom(roomId, (candidate) => {
          if (candidate.id !== room.id) return candidate
          const progress = { ...(candidate.state.progress ?? {}) }
          progress[timerId] = 0
          return {
            ...candidate,
            state: {
              ...candidate.state,
              elapsedOffset: candidate.state.activeTimerId === timerId ? 0 : candidate.state.elapsedOffset,
              startedAt:
                candidate.state.activeTimerId === timerId && candidate.state.isRunning
                  ? Date.now()
                  : candidate.state.startedAt,
              progress,
            },
          }
        })
      }
      await safeDelayRef.current?.()
    },
    [persistTimerStack, state.rooms, state.timers, syncPendingState, updateRoom, updateTimers],
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
        const snapshot = coerceTimerSnapshot(evicted.snapshot)
        if (snapshot) {
          updateTimers(evicted.roomId, (timers) =>
            timers.filter((candidate) => candidate.id !== snapshot.timer.id),
          )
        }
      }
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
      syncPendingState()
      persistTimerStack(roomId, stack)
      await safeDelayRef.current?.()
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
      const snapshot = coerceRoomSnapshot(entry.snapshot)
      if (!snapshot) return
      const restoredRoom: Room = {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        title: snapshot.title,
        timezone: snapshot.timezone,
        createdAt: snapshot.createdAt,
        order: snapshot.order,
        config: snapshot.config,
        state: snapshot.state,
      }
      setState((prev) => ({
        rooms: [...prev.rooms, restoredRoom],
        timers: {
          ...prev.timers,
          [snapshot.id]: snapshot.timers.map((timer: Timer) => ({ ...timer })),
        },
      }))
      syncPendingState()
      await safeDelayRef.current?.(50)
    } else if (entry.action === 'create') {
      setState((prev) => ({
        rooms: prev.rooms.filter((candidate) => candidate.id !== entry.roomId),
        timers: Object.fromEntries(
          Object.entries(prev.timers).filter(([id]) => id !== entry.roomId),
        ),
      }))
      syncPendingState()
      await safeDelayRef.current?.(20)
    } else if (entry.action === 'update') {
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === entry.roomId
            ? {
                ...room,
                ...((entry.before as { title?: string; timezone?: string })?.title !== undefined
                  ? { title: (entry.before as { title?: string }).title }
                  : {}),
                ...((entry.before as { title?: string; timezone?: string })?.timezone !== undefined
                  ? { timezone: (entry.before as { timezone?: string }).timezone }
                  : {}),
              }
            : room,
        ),
      }))
      syncPendingState()
      await safeDelayRef.current?.(20)
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
      await safeDelayRef.current?.(80)
    } else if (entry.action === 'create') {
      const snapshot = coerceRoomSnapshot(entry.snapshot)
      if (!snapshot) return
      const restoredRoom: Room = {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        title: snapshot.title,
        timezone: snapshot.timezone,
        createdAt: snapshot.createdAt,
        order: snapshot.order,
        config: snapshot.config,
        state: snapshot.state,
      }
      setState((prev) => ({
        rooms: [...prev.rooms, restoredRoom],
        timers: {
          ...prev.timers,
          [snapshot.id]: snapshot.timers.map((timer: Timer) => ({ ...timer })),
        },
      }))
      syncPendingState()
      await safeDelayRef.current?.(40)
    } else if (entry.action === 'update') {
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === entry.roomId
            ? {
                ...room,
                ...((entry.patch as { title?: string; timezone?: string })?.title !== undefined
                  ? { title: (entry.patch as { title?: string }).title }
                  : {}),
                ...((entry.patch as { title?: string; timezone?: string })?.timezone !== undefined
                  ? { timezone: (entry.patch as { timezone?: string }).timezone }
                  : {}),
              }
            : room,
        ),
      }))
      syncPendingState()
      await safeDelayRef.current?.(30)
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
        const snapshot = coerceTimerSnapshot(entry.snapshot)
        if (!snapshot) return
        updateTimers(roomId, (timers) =>
          timers.filter((timer) => timer.id !== snapshot.timer.id),
        )
        updateRoom(roomId, (room) => {
          const progress = { ...(room.state.progress ?? {}) }
          delete progress[snapshot.timer.id]
          const isActive = room.state.activeTimerId === snapshot.timer.id
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
          timers
            .map((timer) =>
              timer.id === entry.timerId
                ? {
                    ...timer,
                    ...((entry.before as Record<string, unknown>)?.title !== undefined
                      ? { title: (entry.before as { title?: string }).title }
                      : {}),
                    ...((entry.before as Record<string, unknown>)?.duration !== undefined
                      ? { duration: (entry.before as { duration?: number }).duration }
                      : {}),
                    ...((entry.before as Record<string, unknown>)?.speaker !== undefined
                      ? { speaker: (entry.before as { speaker?: string }).speaker }
                      : {}),
                    ...((entry.before as Record<string, unknown>)?.type !== undefined
                      ? { type: (entry.before as { type?: Timer['type'] }).type }
                      : {}),
                    ...((entry.before as Record<string, unknown>)?.order !== undefined
                      ? { order: (entry.before as { order?: number }).order }
                      : {}),
                  }
                : timer,
            ) as Timer[],
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
        const snapshot = coerceTimerSnapshot(entry.snapshot)
        if (!snapshot) return
        const targetId = snapshot.timer.id
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
        await safeDelayRef.current?.(50)
      } else if (entry.action === 'create') {
        const snapshot = coerceTimerSnapshot(entry.snapshot)
        if (!snapshot) return
        const targetId = snapshot.timer.id
        updateTimers(roomId, (timers) => {
          const filtered = timers.filter((timer) => timer.id !== targetId)
          return [...filtered, snapshot.timer].sort((a, b) => a.order - b.order)
        })
        updateRoom(roomId, (room) => {
          const progress = { ...(room.state.progress ?? {}) }
          progress[targetId] = snapshot.progress ?? 0
          return {
            ...room,
            state: {
              ...room.state,
              progress,
            },
          }
        })
        await safeDelayRef.current?.(30)
      } else if (entry.action === 'update') {
        updateTimers(roomId, (timers) =>
          timers
            .map((timer) =>
              timer.id === entry.timerId
                ? {
                    ...timer,
                    ...((entry.patch as Record<string, unknown>)?.title !== undefined
                      ? { title: (entry.patch as { title?: string }).title }
                      : {}),
                    ...((entry.patch as Record<string, unknown>)?.duration !== undefined
                      ? { duration: (entry.patch as { duration?: number }).duration }
                      : {}),
                    ...((entry.patch as Record<string, unknown>)?.speaker !== undefined
                      ? { speaker: (entry.patch as { speaker?: string }).speaker }
                      : {}),
                    ...((entry.patch as Record<string, unknown>)?.type !== undefined
                      ? { type: (entry.patch as { type?: Timer['type'] }).type }
                      : {}),
                    ...((entry.patch as Record<string, unknown>)?.order !== undefined
                      ? { order: (entry.patch as { order?: number }).order }
                      : {}),
                  }
                : timer,
            ) as Timer[],
        )
        await safeDelayRef.current?.(20)
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

  const moveRoom: DataContextValue['moveRoom'] = useCallback(
    async (roomId: string, direction: 'up' | 'down') => {
      if (!user) return
      setState((prev) => {
        const owned = prev.rooms
          .filter((room) => room.ownerId === user.uid && !pendingRooms.has(room.id))
          .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
        const index = owned.findIndex((room) => room.id === roomId)
        const swapIndex = direction === 'up' ? index - 1 : index + 1
        if (index === -1 || swapIndex < 0 || swapIndex >= owned.length) {
          return prev
        }
        ;[owned[index], owned[swapIndex]] = [owned[swapIndex], owned[index]]
        const updatedOrders = owned.reduce<Record<string, number>>((acc, room, idx) => {
          acc[room.id] = (idx + 1) * 10
          return acc
        }, {})
        return {
          ...prev,
          rooms: prev.rooms.map((room) =>
            updatedOrders[room.id] !== undefined ? { ...room, order: updatedOrders[room.id] } : room,
          ),
        }
      })
      await safeDelayRef.current?.()
    },
    [pendingRooms, setState, user],
  )

  const reorderRoom: DataContextValue['reorderRoom'] = useCallback(
    async (roomId: string, targetIndex: number) => {
      if (!user) return
      setState((prev) => {
        const nextRooms = reorderOwnedRooms(
          prev.rooms,
          user.uid,
          pendingRooms,
          roomId,
          targetIndex,
        )
        if (nextRooms === prev.rooms) {
          return prev
        }
        return { ...prev, rooms: nextRooms }
      })
      await safeDelayRef.current?.()
    },
    [pendingRooms, setState, user],
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
      await safeDelayRef.current?.()
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
      await safeDelayRef.current?.()
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
      await safeDelayRef.current?.(120)
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
      await safeDelayRef.current?.(80)
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
    await safeDelayRef.current?.(60)
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
    await safeDelayRef.current?.(60)
  }, [updateRoom])

  const nudgeTimer = useCallback(async (roomId: string, deltaMs: number) => {
    setState((prev) => {
      const room = prev.rooms.find((candidate) => candidate.id === roomId)
      const activeId = room?.state.activeTimerId
      if (!room || !activeId) return prev
      const currentElapsed =
        room.state.elapsedOffset +
        (room.state.isRunning && room.state.startedAt
          ? Date.now() - room.state.startedAt
          : 0)
      const pending = pendingNudgeRef.current[roomId] ?? 0
      const base = currentElapsed + pending
      const nextElapsedOffset = base - deltaMs
      pendingNudgeRef.current[roomId] = pending + (nextElapsedOffset - base)
      const nextStartedAt = room.state.isRunning ? Date.now() : room.state.startedAt
      const nextProgress = { ...(room.state.progress ?? {}) }
      nextProgress[activeId] = nextElapsedOffset
      return {
        ...prev,
        rooms: prev.rooms.map((candidate) =>
          candidate.id === roomId
            ? {
                ...candidate,
                state: {
                  ...candidate.state,
                  elapsedOffset: nextElapsedOffset,
                  startedAt: nextStartedAt,
                  progress: nextProgress,
                },
              }
            : candidate,
        ),
      }
    })
    await safeDelayRef.current?.(60)
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
      await safeDelayRef.current?.(60)
    },
    [updateRoom],
  )

  const setClockFormat = useCallback(
    async (roomId: string, format: '24h' | 'ampm') => {
      updateRoom(roomId, (room) => ({
        ...room,
        state: {
          ...room.state,
          clockMode: format,
        },
      }))
      await safeDelayRef.current?.(60)
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
      await safeDelayRef.current?.(80)
    },
    [updateRoom],
  )

  const controllerLocks = useMemo<Record<string, null>>(() => ({}), [])
  const roomPins = useMemo<Record<string, null>>(() => ({}), [])
  const roomClients = useMemo<Record<string, ControllerClient[]>>(() => ({}), [])
  const controlRequests = useMemo<Record<string, null>>(() => ({}), [])
  const pendingControlRequests = useMemo<Record<string, null>>(() => ({}), [])
  const controlDenials = useMemo<Record<string, null>>(() => ({}), [])
  const controlDisplacements = useMemo<Record<string, null>>(() => ({}), [])
  const controlErrors = useMemo<Record<string, null>>(() => ({}), [])
  const getControllerLock = useCallback(() => null, [])
  const getControllerLockState = useCallback(() => 'authoritative', [])
  const getRoomPin = useCallback(() => null, [])
  const setRoomPin = useCallback(() => {}, [])
  const requestControl = useCallback(() => {}, [])
  const forceTakeover = useCallback((_roomId: string, _options?: { pin?: string; reauthenticated?: boolean }) => {
    void _roomId
    void _options
  }, [])
  const handOverControl = useCallback(() => {}, [])
  const denyControl = useCallback(() => {}, [])
  const sendHeartbeat = useCallback(() => {}, [])

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
      moveRoom,
      reorderRoom,
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
      setClockFormat,
      updateMessage,
      controllerLocks,
      roomPins,
      roomClients,
      controlRequests,
      pendingControlRequests,
      controlDenials,
      controlDisplacements,
      controlErrors,
      getControllerLock,
      getControllerLockState,
      getRoomPin,
      setRoomPin,
      requestControl,
      forceTakeover,
      handOverControl,
      denyControl,
      sendHeartbeat,
      migrateRoomToV2: async () => {},
      rollbackRoomMigration: async () => {},
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
      moveRoom,
      reorderRoom,
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
      setClockFormat,
      updateMessage,
      controllerLocks,
      roomPins,
      roomClients,
      controlRequests,
      pendingControlRequests,
      controlDenials,
      controlDisplacements,
      controlErrors,
      getControllerLock,
      getControllerLockState,
      getRoomPin,
      setRoomPin,
      requestControl,
      forceTakeover,
      handOverControl,
      denyControl,
      sendHeartbeat,
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMockData = () => useDataContext()
