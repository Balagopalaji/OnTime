import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { DataProviderBoundary, type DataContextValue } from './DataContext'
import { MockDataProvider } from './MockDataContext'
import { useAuth } from './AuthContext'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

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
  const startedAtMs =
    typeof data.state?.startedAt === 'number'
      ? data.state.startedAt
      : data.state?.startedAt
        ? data.state.startedAt.seconds * 1000 +
        Math.floor(data.state.startedAt.nanoseconds / 1_000_000)
        : null

  const createdAtMs =
    typeof data.createdAt === 'number'
      ? data.createdAt
      : data.createdAt
        ? data.createdAt.seconds * 1000 +
        Math.floor(data.createdAt.nanoseconds / 1_000_000)
        : Date.now()

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

  const { user } = useAuth()

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

  const getRoom = useCallback(
    (roomId: string) => rooms.find((room) => room.id === roomId),
    [rooms],
  )
  const getTimers = useCallback(
    (roomId: string) => [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order),
    [timers],
  )

  // Ensure a room with timers always has an active timer id
  useEffect(() => {
    rooms.forEach((room) => {
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
  }, [rooms, getTimers])

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

    const batch = writeBatch(db)
    batch.set(roomRef, {
      ...room,
      createdAt: serverTimestamp(),
    })
    batch.set(defaultTimerRef, defaultTimer)
    await batch.commit()
    return room
  }, [])

  const deleteRoom: DataContextValue['deleteRoom'] = useCallback(async (roomId) => {
    await deleteDoc(doc(db, 'rooms', roomId))
  }, [])

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

  const deleteTimer: DataContextValue['deleteTimer'] = useCallback(async (roomId, timerId) => {
    const room = getRoom(roomId)
    await deleteDoc(doc(db, 'rooms', roomId, 'timers', timerId))
    if (room?.state.activeTimerId === timerId) {
      await updateDoc(doc(db, 'rooms', roomId), {
        'state.activeTimerId': null,
        'state.isRunning': false,
        'state.startedAt': null,
        'state.elapsedOffset': 0,
        [`state.progress.${timerId}`]: 0,
      })
    } else {
      await updateDoc(doc(db, 'rooms', roomId), {
        [`state.progress.${timerId}`]: 0,
      })
    }
  }, [getRoom])

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
    const updates: Record<string, unknown> = {
      'state.isRunning': false,
      'state.startedAt': null,
      'state.elapsedOffset': 0,
      'state.progress': progress,
    }
    await updateDoc(doc(db, 'rooms', roomId), updates)
  }, [getRoom])

  const nudgeTimer: DataContextValue['nudgeTimer'] = useCallback(async (roomId, deltaMs) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    if (!room || !activeId) return
    const progress = computeProgress(room)
    const nextElapsed = (progress[activeId] ?? 0) - deltaMs
    progress[activeId] = nextElapsed
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.elapsedOffset': nextElapsed,
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
      rooms,
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
      rooms,
      connectionStatus,
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
