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

export const useRoom = (roomId: string | undefined) => {
  const [room, setRoom] = useState<Room | undefined>(undefined)
  const [loadingState, setLoadingState] = useState<boolean>(false)
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  const [connectionStatusState, setConnectionStatusState] =
    useState<ConnectionStatus>('reconnecting')

  useEffect(() => {
    const handleOnline = () => setConnectionStatusState('reconnecting')
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
        } else {
          setRoom(mapRoom(snapshot.id, snapshot.data() as RoomDoc))
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
  }, [roomId])

  const roomValue = roomId ? room : undefined
  const loading = roomId ? loadingState : false
  const connectionStatus = roomId ? connectionStatusState : 'offline'

  return useMemo(
    () => ({
      room: roomValue,
      loading,
      error,
      connectionStatus,
    }),
    [connectionStatus, error, loading, roomValue],
  )
}
