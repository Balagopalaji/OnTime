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
        .filter((entry) => entry.kind === 'timer')
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
  config: { ...room.config },
  state: {
    ...room.state,
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
    const roomEntries = roomStackRef.current.undo.filter((entry) => entry.kind === 'room')
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
      const entries = stack.undo.filter((entry) => entry.kind === 'timer')
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
        const next = snapshot.docs.map((docSnap) =>
          mapRoom(docSnap.id, docSnap.data() as RoomDoc),
        )
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
    () => rooms.filter((room) => !pendingRooms.has(room.id)),
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
      config: DEFAULT_CONFIG,
      state: {
        activeTimerId: defaultTimer.id,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
        progress: { [defaultTimer.id]: 0 },
        showClock: false,
        message: { text: '', visible: false, color: 'green' },
      },
    }

    // Write the room first so Firestore rules can validate timer writes against an existing ownerId
    await setDoc(roomRef, {
      ...room,
      createdAt: serverTimestamp(),
    })
    await setDoc(defaultTimerRef, defaultTimer)

    return room
  }, [])

  const deleteRoom: DataContextValue['deleteRoom'] = useCallback(
    async (roomId) => {
      if (!user) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timersForRoom = [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
      if (!room) return
      const entry: UndoEntry = {
        kind: 'room',
        id: randomId(),
        roomId,
        expiresAt: Date.now() + PLACEHOLDER_TTL,
        snapshot: buildRoomSnapshot(room, timersForRoom),
      }

      const { stack, evicted } = pushWithCap(roomStackRef.current, entry, STACK_CAP)
      roomStackRef.current = stack
      if (evicted && evicted.kind === 'room') {
        const batch = writeBatch(db)
        evicted.snapshot.timers.forEach((timer) => {
          batch.delete(doc(db, 'rooms', evicted.roomId, 'timers', timer.id))
        })
        batch.delete(doc(db, 'rooms', evicted.roomId))
        await batch.commit()
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
    return timer
  }, [getRoom])

  const updateTimer: DataContextValue['updateTimer'] = useCallback(async (roomId, timerId, patch) => {
    await updateDoc(doc(db, 'rooms', roomId, 'timers', timerId), patch)
  }, [])

  const updateRoomMeta: DataContextValue['updateRoomMeta'] = useCallback(async (roomId, patch) => {
    await updateDoc(doc(db, 'rooms', roomId), patch)
  }, [])

  const restoreTimer: DataContextValue['restoreTimer'] = useCallback(async (roomId, timer) => {
    await setDoc(doc(db, 'rooms', roomId, 'timers', timer.id), timer)
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timer.id}`]: 0,
    })
  }, [])

  const resetTimerProgress: DataContextValue['resetTimerProgress'] = useCallback(async (roomId, timerId) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timerId}`]: 0,
      'state.elapsedOffset': 0,
      'state.startedAt': null,
      'state.isRunning': false,
    })
  }, [])

  const deleteTimer: DataContextValue['deleteTimer'] = useCallback(
    async (roomId, timerId) => {
      if (!user) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timer = (timers[roomId] ?? []).find((candidate) => candidate.id === timerId)
      if (!room || !timer) return
      const entry: UndoEntry = {
        kind: 'timer',
        id: randomId(),
        roomId,
        expiresAt: Date.now() + PLACEHOLDER_TTL,
        snapshot: buildTimerSnapshot(room, timer),
      }

      const currentStack = timerStacksRef.current[roomId] ?? createEmptyStack()
      const { stack, evicted } = pushWithCap(currentStack, entry, STACK_CAP)
      if (evicted && evicted.kind === 'timer') {
        await deleteDoc(doc(db, 'rooms', evicted.roomId, 'timers', evicted.snapshot.timer.id))
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

    const snapshot = entry.snapshot
    const batch = writeBatch(db)
    snapshot.timers.forEach((timer) => {
      batch.delete(doc(db, 'rooms', snapshot.id, 'timers', timer.id))
    })
    batch.delete(doc(db, 'rooms', snapshot.id))
    await batch.commit()
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

      const timerSnapshot = entry.snapshot
      await deleteDoc(doc(db, 'rooms', roomId, 'timers', timerSnapshot.timer.id))
      await updateDoc(doc(db, 'rooms', roomId), {
        [`state.progress.${timerSnapshot.timer.id}`]: 0,
      })
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
    const progress = computeProgress(room)
    const nextElapsed = Math.max(0, (progress[activeId] ?? 0) - deltaMs)
    progress[activeId] = nextElapsed
    const isActiveRunning = room.state.isRunning && room.state.activeTimerId === activeId
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.elapsedOffset': nextElapsed,
      'state.startedAt': isActiveRunning ? Date.now() : room.state.startedAt,
      'state.progress': progress,
    })
  }, [getRoom])

  const setClockMode: DataContextValue['setClockMode'] = useCallback(async (roomId, enabled) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.showClock': enabled,
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
      updateMessage,
    ],
  )

  if (fallbackToMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
