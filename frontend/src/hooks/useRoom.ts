/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ConnectionStatus, MessageColor, Room } from '../types'
import { toMillis } from '../lib/undoStack'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

type RoomDoc = {
  title: string
  ownerId: string
  timezone: string
  order?: number
  createdAt: number | { seconds: number; nanoseconds: number }
  _version?: number
  tier?: Room['tier']
  features?: Room['features']
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

type V2StateDoc = {
  activeTimerId?: string | null
  isRunning?: boolean
  startedAt?: number | null
  elapsedOffset?: number
  progress?: Record<string, number>
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
    _version: data._version ?? 1,
    tier: data.tier ?? 'basic',
    features: data.features ?? { localMode: true, showControl: false, powerpoint: false, externalVideo: false },
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

export const useRoom = (roomId: string | undefined) => {
  const [room, setRoom] = useState<Room | undefined>(undefined)
  const [roomVersion, setRoomVersion] = useState<1 | 2>(1)
  const [v2State, setV2State] = useState<Partial<Room['state']> | null>(null)
  const [loadingState, setLoadingState] = useState<boolean>(false)
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  const [connectionStatusState, setConnectionStatusState] =
    useState<ConnectionStatus>('reconnecting')
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0)

  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatusState('reconnecting')
      setSubscriptionEpoch((prev) => prev + 1)
    }
    const handleOffline = () => setConnectionStatusState('offline')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!roomId) return undefined

    setLoadingState(true)
    setConnectionStatusState('reconnecting')
    setError(undefined)
    const unsub = onSnapshot(
      doc(db, 'rooms', roomId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setRoom(undefined)
          setRoomVersion(1)
          setV2State(null)
        } else {
          const next = mapRoom(snapshot.id, snapshot.data() as RoomDoc)
          setRoom(next)
          setRoomVersion((next._version ?? 1) === 2 ? 2 : 1)
          if ((next._version ?? 1) !== 2) {
            setV2State(null)
          }
        }
        setLoadingState(false)
        setConnectionStatusState('online')
        setError(undefined)
      },
      (err) => {
        setError(err)
        setConnectionStatusState('offline')
        setLoadingState(false)
      },
    )
    return () => unsub()
  }, [roomId, subscriptionEpoch])

  useEffect(() => {
    if (!roomId || roomVersion !== 2) return undefined
    const unsub = onSnapshot(
      doc(db, 'rooms', roomId, 'state', 'current'),
      (snapshot) => {
        if (!snapshot.exists()) {
          setV2State(null)
          return
        }
        const raw = snapshot.data() as V2StateDoc
        setV2State({
          activeTimerId: typeof raw.activeTimerId === 'string' ? raw.activeTimerId : null,
          isRunning: Boolean(raw.isRunning),
          startedAt: toMillis(raw.startedAt, null),
          elapsedOffset: typeof raw.elapsedOffset === 'number' ? raw.elapsedOffset : 0,
          progress: typeof raw.progress === 'object' && raw.progress ? raw.progress : {},
        })
      },
      (err) => {
        setError(err)
        setConnectionStatusState('offline')
      },
    )
    return () => unsub()
  }, [roomId, roomVersion])

  const loading = roomId ? loadingState : false
  const connectionStatus = roomId ? connectionStatusState : 'offline'

  return useMemo(() => {
    const roomValue =
      roomId && room
        ? roomVersion === 2 && v2State
          ? {
              ...room,
              state: {
                ...room.state,
                ...v2State,
              },
            }
          : room
        : undefined

    return {
      room: roomValue,
      loading,
      error,
      connectionStatus,
    }
  }, [connectionStatus, error, loading, room, roomId, roomVersion, v2State])
}
