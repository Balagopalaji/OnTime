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
  const [loading, setLoading] = useState<boolean>(Boolean(roomId))
  const [error, setError] = useState<FirestoreError | undefined>(undefined)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting')

  useEffect(() => {
    if (!roomId) {
      setTimers([])
      setLoading(false)
      setConnectionStatus('offline')
      return undefined
    }
    setLoading(true)
    const timersQuery = query(collection(db, 'rooms', roomId, 'timers'), orderBy('order', 'asc'))
    const unsub = onSnapshot(
      timersQuery,
      (snapshot) => {
        const next: Timer[] = []
        snapshot.forEach((docSnap) => {
          next.push(mapTimer(docSnap.id, roomId, docSnap.data() as TimerDoc))
        })
        setTimers(next.sort((a, b) => a.order - b.order))
        setLoading(false)
        setConnectionStatus('online')
        setError(undefined)
      },
      (err) => {
        setError(err)
        setConnectionStatus('offline')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [roomId])

  return useMemo(
    () => ({
      timers,
      loading,
      error,
      connectionStatus,
    }),
    [connectionStatus, error, loading, timers],
  )
}
