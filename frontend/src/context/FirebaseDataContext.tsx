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
import { DataProviderBoundary, type DataContextValue } from './DataContext'
import { MockDataProvider } from './MockDataContext'
import { useAuth } from './AuthContext'
import { doc as firestoreDoc, updateDoc as updateDocFs } from 'firebase/firestore'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const DEFAULT_FEATURES = {
  localMode: true,
  showControl: false,
  powerpoint: false,
  externalVideo: false,
}


type RoomDoc = {
  title: string
  ownerId: string
  timezone: string
  order?: number
  createdAt: number | { seconds: number; nanoseconds: number }
  _version?: number
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

const toMillis = (val: unknown, fallback: number | null = null): number | null => {
  if (typeof val === 'number') return val
  if (val && typeof val === 'object' && 'seconds' in val) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (val as any).seconds * 1000
  }
  return fallback
}

const mapRoom = (id: string, data: RoomDoc): Room => {
  const startedAtMs = toMillis(data.state?.startedAt, null)
  const createdAtMs = toMillis(data.createdAt, Date.now()) ?? Date.now()
  const record = data as unknown as Record<string, unknown>
  const tier =
    record.tier === 'basic' || record.tier === 'show_control' || record.tier === 'production'
      ? record.tier
      : 'basic'
  const features = typeof record.features === 'object' && record.features
    ? (record.features as Record<string, unknown>)
    : null

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
    _version: data._version ?? 1,
    tier,
    features: features
      ? {
          localMode: features.localMode !== undefined ? Boolean(features.localMode) : DEFAULT_FEATURES.localMode,
          showControl: features.showControl !== undefined ? Boolean(features.showControl) : DEFAULT_FEATURES.showControl,
          powerpoint: features.powerpoint !== undefined ? Boolean(features.powerpoint) : DEFAULT_FEATURES.powerpoint,
          externalVideo: features.externalVideo !== undefined ? Boolean(features.externalVideo) : DEFAULT_FEATURES.externalVideo,
        }
      : DEFAULT_FEATURES,
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



export const FirebaseDataProvider = ({
  children,
  fallbackToMock = false,
}: {
  children: ReactNode
  fallbackToMock?: boolean
}) => {
  const [rooms, setRooms] = useState<Room[]>([])
  const [timers, setTimers] = useState<Record<string, Timer[]>>({})
  const [connectionStatus, setConnectionStatus] = useState<DataContextValue['connectionStatus']>(() =>
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  )
  const [pendingRooms] = useState<Set<string>>(new Set())
  const [pendingRoomPlaceholders] = useState<
    Array<{ roomId: string; title: string; expiresAt: number; createdAt: number; order?: number }>
  >([])
  const [pendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0)
  const [stateOverrides, setStateOverrides] = useState<Record<string, Room['state']>>({})
  const pendingNudgeRef = useRef<Record<string, number>>({})

  const { user } = useAuth()

  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus('reconnecting')
      setSubscriptionEpoch((prev) => prev + 1)
    }
    const handleOffline = () => setConnectionStatus('offline')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (fallbackToMock || !user) return undefined
    const unsubscribe = onSnapshot(
      collection(db, 'rooms'),
      (snapshot) => {
        const next = snapshot.docs
          .map((docSnap) => mapRoom(docSnap.id, docSnap.data() as RoomDoc))
          .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
        setRooms(next)
        next.forEach((room) => {
          console.info(`[firebase] room ${room.id} v${room._version ?? 1} tier=${room.tier ?? 'basic'}`)
        })
        next.forEach((room) => {
          pendingNudgeRef.current[room.id] = 0
        })
        setConnectionStatus('online')
      },
      (error: FirestoreError) => {
        console.error('rooms snapshot error', error)
        setConnectionStatus('offline')
      },
    )
    return unsubscribe
  }, [fallbackToMock, subscriptionEpoch, user])

  useEffect(() => {
    if (fallbackToMock || !user) return undefined
    const unsubs = rooms.map((room) => {
      const timersQuery = query(
        collection(db, 'rooms', room.id, 'timers'),
        orderBy('order', 'asc'),
      )
      const roomVersion = room._version ?? 1
      const stateDocRef = roomVersion === 2 ? firestoreDoc(db, 'rooms', room.id, 'state', 'current') : firestoreDoc(db, 'rooms', room.id)

      const stateUnsub = onSnapshot(
        stateDocRef,
        (docSnap) => {
          if (!docSnap.exists()) return
          const raw = docSnap.data()
          if (!raw) return
          const statePayload =
            (raw as RoomDoc).state ??
            (raw as RoomDoc['state']) ??
            {}
          setStateOverrides((prev) => ({
            ...prev,
            [room.id]: {
              activeTimerId: statePayload?.activeTimerId ?? room.state.activeTimerId ?? null,
              isRunning: statePayload?.isRunning ?? room.state.isRunning ?? false,
              startedAt: toMillis(statePayload?.startedAt, room.state.startedAt) ?? room.state.startedAt ?? null,
              elapsedOffset: statePayload?.elapsedOffset ?? room.state.elapsedOffset ?? 0,
              progress: statePayload?.progress ?? room.state.progress ?? {},
              showClock: statePayload?.showClock ?? room.state.showClock ?? false,
              clockMode: statePayload?.clockMode ?? room.state.clockMode ?? '24h',
              message: {
                text: statePayload?.message?.text ?? room.state.message.text ?? '',
                visible: statePayload?.message?.visible ?? room.state.message.visible ?? false,
                color: statePayload?.message?.color ?? room.state.message.color ?? 'green',
              },
            },
          }))
          setConnectionStatus('online')
        },
        (error: FirestoreError) => {
          console.error('room state snapshot error', error)
        },
      )

      const timersUnsub = onSnapshot(
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
      return () => {
        stateUnsub()
        timersUnsub()
      }
    })
    return () => {
      unsubs.forEach((unsub) => unsub && unsub())
    }
  }, [fallbackToMock, subscriptionEpoch, user, rooms])


const visibleRooms = useMemo(
  () =>
    rooms
      .filter((room) => !pendingRooms.has(room.id))
      .map((room) =>
        stateOverrides[room.id]
          ? {
              ...room,
              state: {
                ...room.state,
                ...stateOverrides[room.id],
              },
            }
          : room,
      )
      .sort((a, b) => roomOrderKey(a) - roomOrderKey(b)),
  [pendingRooms, rooms, stateOverrides],
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
      _version: 2,
      tier: 'basic',
      features: DEFAULT_FEATURES,
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
    const roomPayload = {
      ...room,
      createdAt: serverTimestamp(),
      state: {
        ...room.state,
        clockMode: '24h',
      },
    }

    await setDoc(roomRef, roomPayload)
    // Seed v2 state doc
    await setDoc(firestoreDoc(db, 'rooms', roomRef.id, 'state', 'current'), {
      activeTimerId: defaultTimer.id,
      isRunning: false,
      currentTime: 0,
      lastUpdate: Date.now(),
    })
    await setDoc(defaultTimerRef, defaultTimer)

    return room
  }, [pendingRooms, rooms])

  const deleteRoom: DataContextValue['deleteRoom'] = useCallback(
    async (roomId) => {
      if (!user) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timersForRoom = [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
      if (!room) return

      const batch = writeBatch(db)
      timersForRoom.forEach((timer) => {
        batch.delete(doc(db, 'rooms', roomId, 'timers', timer.id))
      })
      batch.delete(doc(db, 'rooms', roomId))
      await batch.commit()
    },
    [rooms, timers, user],
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

  const updateTimer: DataContextValue['updateTimer'] = useCallback(
    async (roomId, timerId, patch) => {
      const room = rooms.find((candidate) => candidate.id === roomId)
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
    [rooms],
  )

  const updateRoomMeta: DataContextValue['updateRoomMeta'] = useCallback(
    async (roomId, patch) => {
      await updateDoc(doc(db, 'rooms', roomId), patch)
    },
    [],
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
      await deleteDoc(doc(db, 'rooms', roomId, 'timers', timerId))
      await updateDoc(doc(db, 'rooms', roomId), {
        [`state.progress.${timerId}`]: 0,
      })
    },
    [user],
  )

  // Undo/Redo Stubs
  const undoRoomDelete: DataContextValue['undoRoomDelete'] = useCallback(async () => {
    console.log('Undo Room Delete not implemented yet (Command Pattern pending)')
  }, [])

  const redoRoomDelete: DataContextValue['redoRoomDelete'] = useCallback(async () => {
    console.log('Redo Room Delete not implemented yet (Command Pattern pending)')
  }, [])

  const undoTimerDelete: DataContextValue['undoTimerDelete'] = useCallback(async () => {
    console.log('Undo Timer Delete not implemented yet (Command Pattern pending)')
  }, [])

  const redoTimerDelete: DataContextValue['redoTimerDelete'] = useCallback(async () => {
    console.log('Redo Timer Delete not implemented yet (Command Pattern pending)')
  }, [])

  const clearUndoStacks: DataContextValue['clearUndoStacks'] = useCallback(async () => {
    console.log('Clear Undo Stacks not implemented yet (Command Pattern pending)')
  }, [])

  const undoLatest: DataContextValue['undoLatest'] = useCallback(async () => {
    console.log('Undo Latest not implemented yet (Command Pattern pending)')
  }, [])

  const redoLatest: DataContextValue['redoLatest'] = useCallback(async () => {
    console.log('Redo Latest not implemented yet (Command Pattern pending)')
  }, [])

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
    const stateRef =
      room._version === 2 ? firestoreDoc(db, 'rooms', roomId, 'state', 'current') : firestoreDoc(db, 'rooms', roomId)
    await updateDocFs(stateRef, {
      activeTimerId: targetTimerId,
      isRunning: true,
      startedAt: Date.now(),
      elapsedOffset,
      progress,
    })
  }, [getRoom])

  const pauseTimer: DataContextValue['pauseTimer'] = useCallback(async (roomId) => {
    const room = getRoom(roomId)
    if (!room?.state.activeTimerId) return
    const activeId = room.state.activeTimerId
    const progress = computeProgress(room)
    const elapsed = progress[activeId] ?? 0
    const stateRef =
      room._version === 2 ? firestoreDoc(db, 'rooms', roomId, 'state', 'current') : firestoreDoc(db, 'rooms', roomId)
    await updateDocFs(stateRef, {
      isRunning: false,
      startedAt: null,
      elapsedOffset: elapsed,
      progress,
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
    const stateRef =
      room?._version === 2 ? firestoreDoc(db, 'rooms', roomId, 'state', 'current') : firestoreDoc(db, 'rooms', roomId)
    await updateDocFs(stateRef, {
      isRunning: false,
      startedAt: null,
      elapsedOffset: nextElapsedOffset,
      progress,
    })
  }, [getRoom])

  const nudgeTimer: DataContextValue['nudgeTimer'] = useCallback(async (roomId, deltaMs) => {
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    if (!room || !activeId) return
    const pending = pendingNudgeRef.current[roomId] ?? 0
    const currentProgress = computeProgress(room)[activeId] ?? room.state.elapsedOffset ?? 0
    const base = currentProgress + pending
    const nextElapsedOffset = base - deltaMs
    pendingNudgeRef.current[roomId] = pending + (nextElapsedOffset - base)
    const progress = { ...(room.state.progress ?? {}) }
    progress[activeId] = nextElapsedOffset
    const nextStartedAt = room.state.isRunning ? Date.now() : room.state.startedAt
    await updateDoc(doc(db, 'rooms', roomId), {
      'state.elapsedOffset': nextElapsedOffset,
      'state.startedAt': nextStartedAt,
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
      undoLatest,
      redoLatest,
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
      undoLatest,
      redoLatest,
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
