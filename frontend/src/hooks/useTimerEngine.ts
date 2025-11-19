import { useEffect, useMemo, useState } from 'react'
import { formatDuration } from '../lib/time'

export type TimerEngineArgs = {
  durationSec: number
  isRunning: boolean
  startedAt: number | null
  elapsedOffset: number
  warningSec: number
  criticalSec: number
}

export type TimerEngineState = {
  remainingMs: number
  display: string
  status: 'default' | 'warning' | 'critical' | 'overtime'
  progress: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const useTimerEngine = ({
  durationSec,
  isRunning,
  startedAt,
  elapsedOffset,
  warningSec,
  criticalSec,
}: TimerEngineArgs): TimerEngineState => {
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning || !startedAt) return

    const tick = () => setTimestamp(Date.now())
    const handle = window.setInterval(tick, 200)
    return () => window.clearInterval(handle)
  }, [isRunning, startedAt])

  const state = useMemo(() => {
    const durationMs = durationSec * 1000
    const warningMs = warningSec * 1000
    const criticalMs = criticalSec * 1000
    const elapsedFromStart =
      isRunning && startedAt ? Math.max(0, timestamp - startedAt) : 0
    const totalElapsed = elapsedOffset + elapsedFromStart
    const remainingMs = durationMs - totalElapsed

    let status: TimerEngineState['status'] = 'default'
    if (remainingMs <= 0) {
      status = 'overtime'
    } else if (remainingMs <= criticalMs) {
      status = 'critical'
    } else if (remainingMs <= warningMs) {
      status = 'warning'
    }

    const progress =
      durationMs <= 0
        ? 1
        : clamp(totalElapsed / durationMs, 0, 2) // allow overtime headroom

    return {
      remainingMs,
      display: formatDuration(remainingMs),
      status,
      progress,
    }
  }, [
    criticalSec,
    durationSec,
    elapsedOffset,
    isRunning,
    startedAt,
    timestamp,
    warningSec,
  ])

  return state
}
