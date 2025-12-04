import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type FirestoreError,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { MessageColor, Room, Timer } from '../types'
import {
  clearStack,
  loadStack,
  persistStack,
  popRedo,
  popUndo,
  pushRedo,
  pushWithCap,
  toMillis,
  type RoomSnapshot,
  type TimerSnapshot,
  type RoomUpdatePatch,
  type TimerUpdatePatch,
  type UndoEntry,
  type UndoStack,
} from '../lib/undoStack'
import { roomStackKey, timerStackKey } from '../lib/undoKeys'
import { randomId } from '../lib/utils'
import { DataProviderBoundary, type DataContextValue } from './DataContext'
import { MockDataProvider } from './MockDataContext'
import { useAuth } from './AuthContext'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const STACK_CAP = 10
const PLACEHOLDER_TTL = 10_000
const createEmptyStack = (): UndoStack => ({ undo: [], redo: [] })

type RoomDoc = {
  title: string
  ownerId: string
  timezone: string
  order?: number
  createdAt: number | { seconds: number; nanoseconds: number }
  config?: {
    warningSec?: number
    criticalSec?: number
  }
  state?: {
    activeTimerId?: string | null
    isRunning?: boolean
    startedAt?: number | null
    elapsedOffset?: number
    progress?: Record<string, number>
    showClock?: boolean
    clockMode?: '24h' | 'ampm'
    message?: {
      text?: string
      visible?: boolean
      color?: MessageColor
    }
  }
}

const mapRoom = (id: string, data: RoomDoc): Room => {
  const startedAtMs = toMillis(data.state?.startedAt, null)
  const createdAtMs = toMillis(data.createdAt, Date.now()) ?? Date.now()

  return {
    id,
    ownerId: data.ownerId,
    title: data.title,
    timezone: data.timezone,
    createdAt: createdAtMs,
    order: data.order ?? createdAtMs,
    config: {
      warningSec: data.config?.warningSec ?? DEFAULT_CONFIG.warningSec,
      criticalSec: data.config?.criticalSec ?? DEFAULT_CONFIG.criticalSec,
    },
    state: {
      activeTimerId: data.state?.activeTimerId ?? null,
      isRunning: data.state?.isRunning ?? false,
      startedAt: startedAtMs,
      elapsedOffset: data.state?.elapsedOffset ?? 0,
      progress: data.state?.progress ?? {},
      showClock: data.state?.showClock ?? false,
      clockMode: data.state?.clockMode ?? '24h',
      message: {
        text: data.state?.message?.text ?? '',
        visible: data.state?.message?.visible ?? false,
        color: data.state?.message?.color ?? 'green',
      },
    },
  }
}

type TimerDoc = {
  title: string
  duration: number
  speaker?: string
  type: string
  order: number
}

const mapTimer = (id: string, roomId: string, data: TimerDoc): Timer => ({
  id,
  roomId,
  title: data.title,
  duration: data.duration,
  speaker: data.speaker ?? '',
  type: (data.type as Timer['type']) ?? 'countdown',
  order: data.order ?? 0,
})

const roomOrderKey = (room: Pick<Room, 'order' | 'createdAt'>) => room.order ?? room.createdAt

const computeProgress = (room: Room) => {
  const progress = { ...(room.state.progress ?? {}) }
  const activeId = room.state.activeTimerId
  if (activeId) {
    let elapsed = room.state.elapsedOffset
    if (room.state.isRunning && room.state.startedAt) {
      elapsed += Date.now() - room.state.startedAt
    }
    progress[activeId] = elapsed
  }
  return progress
}

const derivePendingTimers = (stacks: Record<string, UndoStack>) => {
  const next: Record<string, Set<string>> = {}
  Object.entries(stacks).forEach(([roomId, stack]) => {
    const pending = new Set(
      stack.undo
        .filter((entry): entry is UndoEntry & { kind: 'timer'; snapshot: TimerSnapshot } => {
          return entry.kind === 'timer' && entry.action === 'delete'
        })
        .map((entry) => entry.snapshot.timer.id),
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
    clockMode: room.state.clockMode ?? '24h',
    progress: computeProgress(room),
  },
  timers: timers.map((timer) => ({
    ...timer,
    speaker: timer.speaker ?? '',
  })),
})

const buildTimerSnapshot = (room: Room, timer: Timer): TimerSnapshot => ({
  roomId: room.id,
  timer: { ...timer, speaker: timer.speaker ?? '' },
  progress: computeProgress(room)[timer.id] ?? 0,
})

const finalizeRoomRemoval = async (snapshot: RoomSnapshot) => {
  const batch = writeBatch(db)
  snapshot.timers.forEach((timer) => {
    batch.delete(doc(db, 'rooms', snapshot.id, 'timers', timer.id))
  })
  batch.delete(doc(db, 'rooms', snapshot.id))
  await batch.commit()
}

const restoreRoomFromSnapshot = async (snapshot: RoomSnapshot) => {
  const roomRef = doc(db, 'rooms', snapshot.id)
  await setDoc(roomRef, {
    ownerId: snapshot.ownerId,
    title: snapshot.title,
    timezone: snapshot.timezone,
    order: snapshot.order,
    createdAt: snapshot.createdAt,
    config: snapshot.config,
    state: {
      ...snapshot.state,
      clockMode: snapshot.state.clockMode ?? '24h',
    },
  })
  const batch = writeBatch(db)
  snapshot.timers.forEach((timer) => {
    batch.set(doc(db, 'rooms', snapshot.id, 'timers', timer.id), timer)
  })
  await batch.commit()
}

const finalizeTimerRemoval = async (snapshot: TimerSnapshot) => {
  await deleteDoc(doc(db, 'rooms', snapshot.roomId, 'timers', snapshot.timer.id))
  await updateDoc(doc(db, 'rooms', snapshot.roomId), {
    [`state.progress.${snapshot.timer.id}`]: 0,
  })
}

const restoreTimerFromSnapshot = async (snapshot: TimerSnapshot) => {
  await setDoc(doc(db, 'rooms', snapshot.roomId, 'timers', snapshot.timer.id), snapshot.timer)
  await updateDoc(doc(db, 'rooms', snapshot.roomId), {
    [`state.progress.${snapshot.timer.id}`]: snapshot.progress ?? 0,
  })
}

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

export const FirebaseDataProvider = ({
  children,
  fallbackToMock = false,
}: {
  children: ReactNode
  fallbackToMock?: boolean
}) => {
  const [rooms, setRooms] = useState<Room[]>([])
  const [timers, setTimers] = useState<Record<string, Timer[]>>({})
  const [connectionStatus, setConnectionStatus] = useState<DataContextValue['connectionStatus']>(
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

  const { user } = useAuth()
  const roomStackKeyForUser = user ? roomStackKey(user.uid) : null

  const syncPendingState = useCallback(() => {
    const roomEntries = roomStackRef.current.undo.filter(
      (entry): entry is UndoEntry & { kind: 'room'; snapshot: RoomSnapshot } =>
        entry.kind === 'room' && entry.action === 'delete',
    )
    setPendingRooms(new Set(roomEntries.map((entry) => entry.roomId)))
    setPendingRoomPlaceholders(
      roomEntries.map((entry) => ({
        roomId: entry.roomId,
        title: entry.snapshot.title,
        expiresAt: entry.expiresAt,
        createdAt: entry.snapshot.createdAt,
        order: entry.snapshot.order,
      })),
    )

    const timerPlaceholders: Record<
      string,
      Array<{ timerId: string; title: string; order: number; expiresAt: number }>
    > = {}
    Object.entries(timerStacksRef.current).forEach(([roomId, stack]) => {
      const entries = stack.undo.filter(
        (entry): entry is UndoEntry & { kind: 'timer'; snapshot: TimerSnapshot } =>
          entry.kind === 'timer' && entry.action === 'delete',
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
    if (fallbackToMock || !user) return undefined
    const unsubscribe = onSnapshot(
      collection(db, 'rooms'),
      (snapshot) => {
        const next = snapshot.docs
          .map((docSnap) => mapRoom(docSnap.id, docSnap.data() as RoomDoc))
          .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
        setRooms(next)
        setConnectionStatus('online')
      },
      (error: FirestoreError) => {
        console.error('rooms snapshot error', error)
        setConnectionStatus('offline')
      },
    )
    return unsubscribe
  }, [fallbackToMock, user])

  useEffect(() => {
    if (fallbackToMock || !user) return undefined
    const unsubs = rooms.map((room) => {
      const timersQuery = query(
        collection(db, 'rooms', room.id, 'timers'),
        orderBy('order', 'asc'),
      )
      return onSnapshot(
        timersQuery,
        (snapshot) => {
          const timersForRoom: Timer[] = []
          snapshot.forEach((docSnap) => {
            timersForRoom.push(mapTimer(docSnap.id, room.id, docSnap.data() as TimerDoc))
          })
          setTimers((prev) => ({
            ...prev,
            [room.id]: timersForRoom.sort((a, b) => a.order - b.order),
          }))
          setConnectionStatus('online')
        },
        (error: FirestoreError) => {
          console.error('timers snapshot error', error)
          setConnectionStatus('offline')
        },
      )
    })
    return () => {
      unsubs.forEach((unsub) => unsub && unsub())
    }
  }, [fallbackToMock, user, rooms])

  useEffect(() => {
    const previous = lastUserIdRef.current
    if (previous && !user) {
      clearStack(roomStackKey(previous))
      Object.keys(timerStacksRef.current).forEach((roomId) => clearStack(timerStackKey(previous, roomId)))
      roomStackRef.current = createEmptyStack()
      timerStacksRef.current = {}
      syncPendingState()
    }
    lastUserIdRef.current = user?.uid ?? null
  }, [syncPendingState, user])

  useEffect(() => {
    if (fallbackToMock || !user) return
    const loaded = loadStack(roomStackKey(user.uid))
    roomStackRef.current = loaded
    syncPendingState()
  }, [fallbackToMock, syncPendingState, user])

  useEffect(() => {
    if (fallbackToMock || !user) return
    const stacks = loadTimerStacksForUser(user.uid)
    timerStacksRef.current = stacks
    syncPendingState()
  }, [fallbackToMock, syncPendingState, user])

  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((room) => !pendingRooms.has(room.id))
        .sort((a, b) => roomOrderKey(a) - roomOrderKey(b)),
    [pendingRooms, rooms],
  )

  const getRoom = useCallback(
    (roomId: string) => visibleRooms.find((room) => room.id === roomId),
    [visibleRooms],
  )
  const getTimers = useCallback(
    (roomId: string) => {
      const pendingForRoom = pendingTimers[roomId]
      return [...(timers[roomId] ?? [])]
        .filter((timer) => !pendingForRoom?.has(timer.id))
        .sort((a, b) => a.order - b.order)
    },
    [pendingTimers, timers],
  )

  // Ensure a room with timers always has an active timer id
  useEffect(() => {
    visibleRooms.forEach((room) => {
      const roomTimers = getTimers(room.id)
      if (roomTimers.length === 0) return
      if (!room.state.activeTimerId) {
        void updateDoc(doc(db, 'rooms', room.id), {
          'state.activeTimerId': roomTimers[0].id,
          'state.elapsedOffset': 0,
          [`state.progress.${roomTimers[0].id}`]: 0,
        }).catch((error) => {
          console.error('failed to set default active timer', error)
        })
      }
    })
  }, [getTimers, visibleRooms])

  const createRoom: DataContextValue['createRoom'] = useCallback(async ({ title, timezone, ownerId }) => {
    const ownerRooms = rooms.filter((candidate) => candidate.ownerId === ownerId && !pendingRooms.has(candidate.id))
    const nextOrder =
      ownerRooms.reduce((max, room) => Math.max(max, roomOrderKey(room)), 0) + 10
    const roomRef = doc(collection(db, 'rooms'))
    const defaultTimerRef = doc(collection(roomRef, 'timers'))
    const defaultTimer: Timer = {
      id: defaultTimerRef.id,
      roomId: roomRef.id,
      title: 'Opening Remarks',
      duration: 300,
      speaker: 'Host',
      type: 'countdown',
      order: 10,
    }

    const room: Room = {
      id: roomRef.id,
      ownerId,
      title,
      timezone,
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
        message: { text: '', visible: false, color: 'green' },
      },
    }

    // Write the room first so Firestore rules can validate timer writes against an existing ownerId
    await setDoc(roomRef, {
      ...room,
      createdAt: serverTimestamp(),
      state: {
        ...room.state,
        clockMode: '24h',
      },
    })
    await setDoc(defaultTimerRef, defaultTimer)
    const entry: UndoEntry = {
      kind: 'room',
      action: 'create',
      id: randomId(),
      roomId: room.id,
      expiresAt: Date.now() + PLACEHOLDER_TTL,
      snapshot: buildRoomSnapshot(room, [defaultTimer]),
    }

    const { stack, evicted } = pushWithCap(roomStackRef.current, entry, STACK_CAP)
    roomStackRef.current = stack
    if (evicted && evicted.kind === 'room' && evicted.action === 'delete') {
      const batch = writeBatch(db)
      evicted.snapshot.timers.forEach((timer) => {
        batch.delete(doc(db, 'rooms', evicted.roomId, 'timers', timer.id))
      })
      batch.delete(doc(db, 'rooms', evicted.roomId))
      await batch.commit()
    }
    syncPendingState()
    persistRoomStack(stack)

    return room
  }, [pendingRooms, persistRoomStack, rooms, syncPendingState])

  const deleteRoom: DataContextValue['deleteRoom'] = useCallback(
    async (roomId) => {
      if (!user) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timersForRoom = [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
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
        await finalizeRoomRemoval(evicted.snapshot)
      }
      syncPendingState()
      persistRoomStack(stack)
    },
    [persistRoomStack, rooms, syncPendingState, timers, user],
  )

  const createTimer: DataContextValue['createTimer'] = useCallback(async (roomId, input) => {
    const timerRef = doc(collection(db, 'rooms', roomId, 'timers'))
    const timer: Timer = {
      id: timerRef.id,
      roomId,
      title: input.title,
      duration: input.duration,
      speaker: input.speaker ?? '',
      type: 'countdown',
      order: Date.now(),
    }
    await setDoc(timerRef, timer)
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timer.id}`]: 0,
      'state.activeTimerId': getRoom(roomId)?.state.activeTimerId ?? timer.id,
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
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
      if (evicted && evicted.kind === 'timer' && evicted.action === 'delete') {
        await deleteDoc(doc(db, 'rooms', roomId, 'timers', evicted.snapshot.timer.id))
      }
      syncPendingState()
      persistTimerStack(roomId, stack)
    }
    return timer
  }, [getRoom, persistTimerStack, syncPendingState])

  const updateTimer: DataContextValue['updateTimer'] = useCallback(
    async (roomId, timerId, patch) => {
      const timer = (timers[roomId] ?? []).find((candidate) => candidate.id === timerId)
      const room = rooms.find((candidate) => candidate.id === roomId)
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
          timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
          // Only finalize evicted deletes; updates just drop.
          if (evicted && evicted.kind === 'timer' && evicted.action === 'delete') {
            await finalizeTimerRemoval(evicted.snapshot)
          }
          syncPendingState()
          persistTimerStack(roomId, stack)
        }
      }
      try {
        await updateDoc(doc(db, 'rooms', roomId, 'timers', timerId), patch)
        if (patch.duration !== undefined && room) {
          const stateUpdates: Record<string, unknown> = {
            [`state.progress.${timerId}`]: 0,
          }
          if (room.state.activeTimerId === timerId) {
            stateUpdates['state.elapsedOffset'] = 0
            stateUpdates['state.startedAt'] = room.state.isRunning ? Date.now() : null
          }
          await updateDoc(doc(db, 'rooms', roomId), stateUpdates)
        }
      } catch (error) {
        console.warn('Failed to update timer', error)
      }
    },
    [persistTimerStack, rooms, syncPendingState, timers],
  )

  const updateRoomMeta: DataContextValue['updateRoomMeta'] = useCallback(
    async (roomId, patch) => {
      const room = rooms.find((candidate) => candidate.id === roomId)
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
            await finalizeRoomRemoval(evicted.snapshot)
          }
          syncPendingState()
          persistRoomStack(stack)
        }
      }
      await updateDoc(doc(db, 'rooms', roomId), patch)
    },
    [persistRoomStack, rooms, syncPendingState],
  )

  const restoreTimer: DataContextValue['restoreTimer'] = useCallback(async (roomId, timer) => {
    await setDoc(doc(db, 'rooms', roomId, 'timers', timer.id), timer)
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timer.id}`]: 0,
    })
  }, [])

  const resetTimerProgress: DataContextValue['resetTimerProgress'] = useCallback(async (roomId, timerId) => {
    const room = rooms.find((candidate) => candidate.id === roomId)
    const isActive = room?.state.activeTimerId === timerId
    const updates: Record<string, unknown> = {
      [`state.progress.${timerId}`]: 0,
    }
    if (isActive) {
      updates['state.elapsedOffset'] = 0
      updates['state.startedAt'] = null
      updates['state.isRunning'] = false
    }
    await updateDoc(doc(db, 'rooms', roomId), updates)
  }, [rooms])

  const deleteTimer: DataContextValue['deleteTimer'] = useCallback(
    async (roomId, timerId) => {
      if (!user) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timer = (timers[roomId] ?? []).find((candidate) => candidate.id === timerId)
      if (!room || !timer) return
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
        await finalizeTimerRemoval(evicted.snapshot)
      }
      timerStacksRef.current = { ...timerStacksRef.current, [roomId]: stack }
      syncPendingState()
      persistTimerStack(roomId, stack)

      // Soft delete: hide locally, delete on redo/overflow only.
    },
    [persistTimerStack, rooms, syncPendingState, timers, user],
  )

  const undoRoomDelete: DataContextValue['undoRoomDelete'] = useCallback(async () => {
    if (!user) return
    const { entry, stack } = popUndo(roomStackRef.current)
    if (!entry || entry.kind !== 'room') return
    const nextStack = pushRedo(stack, entry, STACK_CAP)
    roomStackRef.current = nextStack
    syncPendingState()
    persistRoomStack(nextStack)
    if (entry.action === 'create') {
      try {
        await finalizeRoomRemoval(entry.snapshot)
      } catch (error) {
        console.warn('Failed to finalize room create undo', error)
      }
    } else if (entry.action === 'update') {
      const updates: Partial<Record<string, string>> = {}
      if (entry.before.title !== undefined) updates.title = entry.before.title
      if (entry.before.timezone !== undefined) updates.timezone = entry.before.timezone
      if (Object.keys(updates).length) {
        try {
          await updateDoc(doc(db, 'rooms', entry.roomId), updates)
        } catch (error) {
          console.warn('Failed to undo room update', error)
        }
      }
    }
  }, [persistRoomStack, syncPendingState, user])

  const redoRoomDelete: DataContextValue['redoRoomDelete'] = useCallback(async () => {
    if (!user) return
    const { entry, stack } = popRedo(roomStackRef.current)
    if (!entry || entry.kind !== 'room') return
    const nextUndo = [entry, ...stack.undo].slice(0, STACK_CAP)
    const nextStack: UndoStack = { undo: nextUndo, redo: stack.redo }
    roomStackRef.current = nextStack
    syncPendingState()
    persistRoomStack(nextStack)

    try {
      if (entry.action === 'delete') {
        await finalizeRoomRemoval(entry.snapshot)
      } else if (entry.action === 'create') {
        await restoreRoomFromSnapshot(entry.snapshot)
      } else if (entry.action === 'update') {
        const updates: Partial<Record<string, string>> = {}
        if (entry.patch.title !== undefined) updates.title = entry.patch.title
        if (entry.patch.timezone !== undefined) updates.timezone = entry.patch.timezone
        if (Object.keys(updates).length) {
          await updateDoc(doc(db, 'rooms', entry.roomId), updates)
        }
      }
    } catch (error) {
      console.warn('Failed to redo room action', error)
    }
    syncPendingState()
  }, [persistRoomStack, syncPendingState, user])

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
        try {
          await finalizeTimerRemoval(entry.snapshot)
        } catch (error) {
          console.warn('Failed to undo timer create', error)
        }
      } else if (entry.action === 'update') {
        const updates: Record<string, unknown> = {}
        ;(['title', 'duration', 'speaker', 'type', 'order'] as const).forEach((key) => {
          if (entry.before[key] !== undefined) {
            updates[key] = entry.before[key] as unknown
          }
        })
        if (Object.keys(updates).length) {
          try {
            await updateDoc(doc(db, 'rooms', roomId, 'timers', entry.timerId), updates)
          } catch (error) {
            console.warn('Failed to undo timer update', error)
          }
        }
      }
    },
    [persistTimerStack, syncPendingState, user],
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

      try {
        if (entry.action === 'delete') {
          await finalizeTimerRemoval(entry.snapshot)
        } else if (entry.action === 'create') {
          await restoreTimerFromSnapshot(entry.snapshot)
        } else if (entry.action === 'update') {
          const updates: Record<string, unknown> = {}
          ;(['title', 'duration', 'speaker', 'type', 'order'] as const).forEach((key) => {
            if (entry.patch[key] !== undefined) {
              updates[key] = entry.patch[key] as unknown
            }
          })
          if (Object.keys(updates).length) {
            await updateDoc(doc(db, 'rooms', roomId, 'timers', entry.timerId), updates)
          }
        }
      } catch (error) {
        console.warn('Failed to redo timer action', error)
      }
    },
    [persistTimerStack, syncPendingState, user],
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
      const owned = rooms.filter(
        (room) => room.ownerId === user.uid && !pendingRooms.has(room.id),
      )
      const ordered = [...owned].sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
      const index = ordered.findIndex((room) => room.id === roomId)
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return
      ;[ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]]
      const batch = writeBatch(db)
      ordered.forEach((room, idx) => {
        batch.update(doc(db, 'rooms', room.id), { order: (idx + 1) * 10 })
      })
      await batch.commit()
    },
    [pendingRooms, rooms, user],
  )

  const reorderRoom: DataContextValue['reorderRoom'] = useCallback(
    async (roomId: string, targetIndex: number) => {
      if (!user) return
      const owned = rooms.filter(
        (room) => room.ownerId === user.uid && !pendingRooms.has(room.id),
      )
      const ordered = [...owned].sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
      const fromIndex = ordered.findIndex((room) => room.id === roomId)
      if (fromIndex === -1) return
      const [moved] = ordered.splice(fromIndex, 1)
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
      ordered.splice(clampedIndex, 0, moved)
      const batch = writeBatch(db)
      ordered.forEach((room, idx) => {
        batch.update(doc(db, 'rooms', room.id), { order: (idx + 1) * 10 })
      })
      await batch.commit()
    },
    [pendingRooms, rooms, user],
  )

  const moveTimer: DataContextValue['moveTimer'] = useCallback(async (roomId, timerId, direction) => {
    const list = getTimers(roomId)
    const ordered = [...list].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((t) => t.id === timerId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return
      ;[ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]]
    const batch = writeBatch(db)
    ordered.forEach((timer, idx) => {
      batch.update(doc(db, 'rooms', roomId, 'timers', timer.id), { order: (idx + 1) * 10 })
    })
    await batch.commit()
  }, [getTimers])

  const reorderTimer: DataContextValue['reorderTimer'] = useCallback(async (roomId, timerId, targetIndex) => {
    const ordered = [...getTimers(roomId)].sort((a, b) => a.order - b.order)
    const fromIndex = ordered.findIndex((t) => t.id === timerId)
    if (fromIndex === -1) return
    const [moved] = ordered.splice(fromIndex, 1)
    const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
    ordered.splice(clampedIndex, 0, moved)
    const batch = writeBatch(db)
    ordered.forEach((timer, idx) => {
      batch.update(doc(db, 'rooms', roomId, 'timers', timer.id), { order: (idx + 1) * 10 })
    })
    await batch.commit()
  }, [getTimers])

  const setActiveTimer: DataContextValue['setActiveTimer'] = useCallback(async (roomId, timerId) => {
    const room = getRoom(roomId)
    const progress = room ? computeProgress(room) : {}
    const elapsedOffset = progress[timerId] ?? 0
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.activeTimerId': timerId,
      'state.elapsedOffset': elapsedOffset,
      'state.startedAt': null,
      'state.isRunning': false,
      'state.progress': progress,
    })
  }, [getRoom])

  const startTimer: DataContextValue['startTimer'] = useCallback(async (roomId, timerId) => {
    const room = getRoom(roomId)
    const targetTimerId = timerId ?? room?.state.activeTimerId
    if (!targetTimerId || !room) return
    const progress = computeProgress(room)
    const elapsedOffset = progress[targetTimerId] ?? 0
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.activeTimerId': targetTimerId,
      'state.isRunning': true,
      'state.startedAt': Date.now(),
      'state.elapsedOffset': elapsedOffset,
      'state.progress': progress,
    })
  }, [getRoom])

  const pauseTimer: DataContextValue['pauseTimer'] = useCallback(async (roomId) => {
    const room = getRoom(roomId)
    if (!room?.state.activeTimerId) return
    const activeId = room.state.activeTimerId
    const progress = computeProgress(room)
    const elapsed = progress[activeId] ?? 0
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.isRunning': false,
      'state.startedAt': null,
      'state.elapsedOffset': elapsed,
      'state.progress': progress,
    })
  }, [getRoom])

  const resetTimer: DataContextValue['resetTimer'] = useCallback(async (roomId) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    const progress = room ? computeProgress(room) : {}
    if (activeId) {
      progress[activeId] = 0
    }
    const nextElapsedOffset = 0
    const updates: Record<string, unknown> = {
      'state.isRunning': false,
      'state.startedAt': null,
      'state.elapsedOffset': nextElapsedOffset,
      'state.progress': progress,
    }
    await updateDoc(doc(db, 'rooms', roomId), updates)
  }, [getRoom])

  const nudgeTimer: DataContextValue['nudgeTimer'] = useCallback(async (roomId, deltaMs) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    if (!room || !activeId) return
    const nextElapsedOffset = room.state.elapsedOffset - deltaMs
    const progress = { ...(room.state.progress ?? {}) }
    progress[activeId] = Math.max(0, nextElapsedOffset)
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.elapsedOffset': nextElapsedOffset,
      'state.startedAt': room.state.startedAt,
      'state.progress': progress,
    })
  }, [getRoom])

  const setClockMode: DataContextValue['setClockMode'] = useCallback(async (roomId, enabled) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.showClock': enabled,
    })
  }, [])

  const setClockFormat: DataContextValue['setClockFormat'] = useCallback(async (roomId, format) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.clockMode': format,
    })
  }, [])

  const updateMessage: DataContextValue['updateMessage'] = useCallback(async (roomId, message) => {
    const payload: Record<string, unknown> = {}
    if (message.text !== undefined) payload['state.message.text'] = message.text
    if (message.visible !== undefined) payload['state.message.visible'] = message.visible
    if (message.color !== undefined) payload['state.message.color'] = message.color
    await updateDoc(doc(db, 'rooms', roomId), payload)
  }, [])

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
      deleteTimer,
      moveTimer,
      reorderTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
      setClockFormat,
      updateMessage,
    }),
    [
      visibleRooms,
      connectionStatus,
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
      deleteTimer,
      moveTimer,
      reorderTimer,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
      setClockFormat,
      updateMessage,
    ],
  )

  if (fallbackToMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
