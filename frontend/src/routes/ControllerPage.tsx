import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Radio } from 'lucide-react'
import { useMockData } from '../context/MockDataContext'
import { TimerPanel } from '../components/controller/TimerPanel'
import { RundownPanel } from '../components/controller/RundownPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { LiveTimerPreview } from '../components/controller/LiveTimerPreview'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { formatDate } from '../lib/time'

export const ControllerPage = () => {
  const { roomId } = useParams()
  const {
    getRoom,
    getTimers,
    startTimer,
    pauseTimer,
    resetTimer,
    nudgeTimer,
    createTimer,
    deleteTimer,
    moveTimer,
    updateTimer,
    updateMessage,
    connectionStatus,
  } = useMockData()

  const room = roomId ? getRoom(roomId) : undefined
  const timers = roomId ? getTimers(roomId) : []

  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)
  const currentRoomId = room?.id
  const isRunning = room?.state.isRunning ?? false
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    () => activeTimer?.id ?? null,
  )

  useEffect(() => {
    setSelectedTimerId((prev) => {
      if (prev && timers.some((timer) => timer.id === prev)) {
        return prev
      }
      return activeTimer?.id ?? prev ?? null
    })
  }, [activeTimer, timers])

  const selectedTimer =
    timers.find((timer) => timer.id === selectedTimerId) ?? activeTimer

  const startActiveTimer = useCallback(() => {
    if (!currentRoomId) return
    void startTimer(currentRoomId)
  }, [currentRoomId, startTimer])

  const pauseActiveTimer = useCallback(() => {
    if (!currentRoomId) return
    void pauseTimer(currentRoomId)
  }, [currentRoomId, pauseTimer])

  const resetActiveTimer = useCallback(() => {
    if (!currentRoomId) return
    void resetTimer(currentRoomId)
  }, [currentRoomId, resetTimer])

  const nudgeActiveTimer = useCallback(
    (deltaMs: number) => {
      if (!currentRoomId) return
      void nudgeTimer(currentRoomId, deltaMs)
    },
    [currentRoomId, nudgeTimer],
  )

  const startSelectedTimer = useCallback(() => {
    if (!currentRoomId || !selectedTimerId) return
    if (selectedTimerId === activeTimer?.id) {
      startActiveTimer()
      return
    }
    void startTimer(currentRoomId, selectedTimerId)
  }, [
    activeTimer?.id,
    currentRoomId,
    selectedTimerId,
    startActiveTimer,
    startTimer,
  ])

  const handleSaveDuration = useCallback(
    (timerId: string, minutes: number) => {
      if (!currentRoomId) return
      const duration = Math.max(30, Math.round(minutes * 60))
      void updateTimer(currentRoomId, timerId, { duration })
    },
    [currentRoomId, updateTimer],
  )

  const handleUpdateDetails = useCallback(
    (timerId: string, patch: { title?: string; speaker?: string }) => {
      if (!currentRoomId) return
      void updateTimer(currentRoomId, timerId, patch)
    },
    [currentRoomId, updateTimer],
  )

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  useEffect(() => {
    if (!currentRoomId) return
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.repeat) return

      switch (event.code) {
        case 'Space': {
          event.preventDefault()
          if (isRunning) {
            pauseActiveTimer()
          } else {
            startActiveTimer()
          }
          break
        }
        case 'KeyR': {
          event.preventDefault()
          resetActiveTimer()
          break
        }
        case 'ArrowUp': {
          event.preventDefault()
          if (selectedTimer && selectedTimer.id !== activeTimer?.id) {
            const nextMinutes = Math.max(
              1,
              Math.round(selectedTimer.duration / 60) + 1,
            )
            handleSaveDuration(selectedTimer.id, nextMinutes)
          } else {
            nudgeActiveTimer(60_000)
          }
          break
        }
        case 'ArrowDown': {
          event.preventDefault()
          if (selectedTimer && selectedTimer.id !== activeTimer?.id) {
            const nextMinutes = Math.max(
              1,
              Math.round(selectedTimer.duration / 60) - 1,
            )
            handleSaveDuration(selectedTimer.id, nextMinutes)
          } else {
            nudgeActiveTimer(-60_000)
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    currentRoomId,
    activeTimer?.id,
    handleSaveDuration,
    isRunning,
    nudgeActiveTimer,
    pauseActiveTimer,
    resetActiveTimer,
    selectedTimer,
    startActiveTimer,
  ])

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Room not found. Return to the dashboard.
      </div>
    )
  }

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-slate-900 bg-slate-900/80 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Controller View
            </p>
            <h1 className="text-2xl font-semibold text-white">{room.title}</h1>
            <p className="text-sm text-slate-400">
              {room.timezone} • Created {formatDate(room.createdAt, room.timezone)}
            </p>
          </div>
          <ConnectionIndicator status={connectionStatus} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-emerald-400" />
            Active timers: {timers.length}
          </div>
          <ShareLinkButton roomId={room.id} />
        </div>
        {connectionStatus !== 'online' && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} />
            Mock latency enabled. Actions will delay slightly.
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr_320px]">
        <RundownPanel
          timers={timers}
          activeTimerId={room.state.activeTimerId}
          selectedTimerId={selectedTimerId}
          onSelect={(timerId) => {
            setSelectedTimerId(timerId)
          }}
          onStart={(timerId) => {
            setSelectedTimerId(timerId)
            void startTimer(room.id, timerId)
          }}
          onDelete={(timerId) => {
            void deleteTimer(room.id, timerId)
          }}
          onMove={(timerId, direction) => {
            void moveTimer(room.id, timerId, direction)
          }}
          onCreate={(input) => {
            void createTimer(room.id, input)
          }}
        />

        <TimerPanel
          timer={selectedTimer}
          isLive={Boolean(selectedTimer && selectedTimer.id === activeTimer?.id)}
          isRunning={
            Boolean(selectedTimer && selectedTimer.id === activeTimer?.id) && isRunning
          }
          engine={engine}
          onStart={startActiveTimer}
          onPause={pauseActiveTimer}
          onReset={resetActiveTimer}
          onNudge={nudgeActiveTimer}
          onSaveDuration={(minutes) => {
            if (!selectedTimer) return
            handleSaveDuration(selectedTimer.id, minutes)
          }}
          onStartSelected={startSelectedTimer}
          onUpdateDetails={(patch) => {
            if (!selectedTimer) return
            handleUpdateDetails(selectedTimer.id, patch)
          }}
        />

        <div className="space-y-4">
          <MessagePanel
            initial={room.state.message}
            onUpdate={(payload) => {
              void updateMessage(room.id, payload)
            }}
          />
          <LiveTimerPreview
            timer={activeTimer}
            engine={engine}
            isRunning={isRunning}
            onStart={startActiveTimer}
            onPause={pauseActiveTimer}
            onReset={resetActiveTimer}
            onNudge={nudgeActiveTimer}
            message={room.state.message}
          />
        </div>
      </div>
    </section>
  )
}
