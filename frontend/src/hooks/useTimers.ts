/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query, type FirestoreError } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ConnectionStatus, Timer } from '../types'

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

export const useTimers = (roomId: string | undefined) => {
  const [timers, setTimers] = useState<Timer[]>([])
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
    const timersQuery = query(collection(db, 'rooms', roomId, 'timers'), orderBy('order', 'asc'))
    const unsub = onSnapshot(
      timersQuery,
      (snapshot) => {
        const next: Timer[] = []
        snapshot.forEach((docSnap) => {
          next.push(mapTimer(docSnap.id, roomId, docSnap.data() as TimerDoc))
        })
        setTimers(next.sort((a, b) => a.order - b.order))
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

  return useMemo(() => {
    const safeTimers = roomId ? timers : []
    const loading = roomId ? loadingState : false
    const connectionStatus = roomId ? connectionStatusState : 'offline'

    return {
      timers: safeTimers,
      loading,
      error,
      connectionStatus,
    }
  }, [connectionStatusState, error, loadingState, roomId, timers])
}
