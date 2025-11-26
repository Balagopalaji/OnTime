import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  collection,
  collectionGroup,
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

  useEffect(() => {
    if (fallbackToMock) return undefined
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
  }, [fallbackToMock])

  useEffect(() => {
    if (fallbackToMock) return undefined
    const timersQuery = query(collectionGroup(db, 'timers'), orderBy('order', 'asc'))
    const unsubscribe = onSnapshot(
      timersQuery,
      (snapshot) => {
        const grouped: Record<string, Timer[]> = {}
        snapshot.forEach((docSnap) => {
          const segments = docSnap.ref.path.split('/')
          const roomId = segments[1]
          const timer = mapTimer(docSnap.id, roomId, docSnap.data() as TimerDoc)
          grouped[roomId] = grouped[roomId] ? [...grouped[roomId], timer] : [timer]
        })
        Object.keys(grouped).forEach((roomId) => {
          grouped[roomId] = grouped[roomId].sort((a, b) => a.order - b.order)
        })
        setTimers(grouped)
        setConnectionStatus('online')
      },
      (error: FirestoreError) => {
        console.error('timers snapshot error', error)
        setConnectionStatus('offline')
      },
    )
    return unsubscribe
  }, [fallbackToMock])

  const getRoom = (roomId: string) => rooms.find((room) => room.id === roomId)
  const getTimers = (roomId: string) => [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)

  const createRoom: DataContextValue['createRoom'] = async ({ title, timezone, ownerId }) => {
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
  }

  const deleteRoom: DataContextValue['deleteRoom'] = async (roomId) => {
    await deleteDoc(doc(db, 'rooms', roomId))
  }

  const createTimer: DataContextValue['createTimer'] = async (roomId, input) => {
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
    return timer
  }

  const updateTimer: DataContextValue['updateTimer'] = async (roomId, timerId, patch) => {
    await updateDoc(doc(db, 'rooms', roomId, 'timers', timerId), patch)
  }

  const updateRoomMeta: DataContextValue['updateRoomMeta'] = async (roomId, patch) => {
    await updateDoc(doc(db, 'rooms', roomId), patch)
  }

  const restoreTimer: DataContextValue['restoreTimer'] = async (roomId, timer) => {
    await setDoc(doc(db, 'rooms', roomId, 'timers', timer.id), timer)
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timer.id}`]: 0,
    })
  }

  const resetTimerProgress: DataContextValue['resetTimerProgress'] = async (roomId, timerId) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      [`state.progress.${timerId}`]: 0,
      'state.elapsedOffset': 0,
      'state.startedAt': null,
      'state.isRunning': false,
    })
  }

  const deleteTimer: DataContextValue['deleteTimer'] = async (roomId, timerId) => {
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
  }

  const moveTimer: DataContextValue['moveTimer'] = async (roomId, timerId, direction) => {
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
  }

  const reorderTimer: DataContextValue['reorderTimer'] = async (roomId, timerId, targetIndex) => {
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
  }

  const setActiveTimer: DataContextValue['setActiveTimer'] = async (roomId, timerId) => {
    const room = getRoom(roomId)
    const progress = room?.state.progress ?? {}
    const elapsedOffset = progress[timerId] ?? 0
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.activeTimerId': timerId,
      'state.elapsedOffset': elapsedOffset,
      'state.startedAt': null,
      'state.isRunning': false,
    })
  }

  const startTimer: DataContextValue['startTimer'] = async (roomId, timerId) => {
    const room = getRoom(roomId)
    const targetTimerId = timerId ?? room?.state.activeTimerId
    if (!targetTimerId) return
    const progress = room?.state.progress ?? {}
    const elapsedOffset = progress[targetTimerId] ?? 0
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.activeTimerId': targetTimerId,
      'state.isRunning': true,
      'state.startedAt': Date.now(),
      'state.elapsedOffset': elapsedOffset,
    })
  }

  const pauseTimer: DataContextValue['pauseTimer'] = async (roomId) => {
    const room = getRoom(roomId)
    if (!room?.state.activeTimerId) return
    const activeId = room.state.activeTimerId
    let elapsed = room.state.elapsedOffset
    if (room.state.isRunning && room.state.startedAt) {
      elapsed += Date.now() - room.state.startedAt
    }
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.isRunning': false,
      'state.startedAt': null,
      'state.elapsedOffset': elapsed,
      [`state.progress.${activeId}`]: elapsed,
    })
  }

  const resetTimer: DataContextValue['resetTimer'] = async (roomId) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    const updates: Record<string, unknown> = {
      'state.isRunning': false,
      'state.startedAt': null,
      'state.elapsedOffset': 0,
    }
    if (activeId) {
      updates[`state.progress.${activeId}`] = 0
    }
    await updateDoc(doc(db, 'rooms', roomId), updates)
  }

  const nudgeTimer: DataContextValue['nudgeTimer'] = async (roomId, deltaMs) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    if (!room || !activeId) return
    const nextElapsed = (room.state.elapsedOffset ?? 0) - deltaMs
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.elapsedOffset': nextElapsed,
      [`state.progress.${activeId}`]: nextElapsed,
    })
  }

  const setClockMode: DataContextValue['setClockMode'] = async (roomId, enabled) => {
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.showClock': enabled,
    })
  }

  const updateMessage: DataContextValue['updateMessage'] = async (roomId, message) => {
    const payload: Record<string, unknown> = {}
    if (message.text !== undefined) payload['state.message.text'] = message.text
    if (message.visible !== undefined) payload['state.message.visible'] = message.visible
    if (message.color !== undefined) payload['state.message.color'] = message.color
    await updateDoc(doc(db, 'rooms', roomId), payload)
  }

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
    [rooms, connectionStatus, timers],
  )

  if (fallbackToMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
