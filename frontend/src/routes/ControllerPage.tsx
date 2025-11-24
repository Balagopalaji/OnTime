import { useEffect, useMemo, useState } from 'react'
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
    setClockMode,
    updateMessage,
    connectionStatus,
  } = useMockData()

  const room = roomId ? getRoom(roomId) : undefined
  const timers = useMemo(
    () => (roomId ? getTimers(roomId) : []),
    [getTimers, roomId],
  )

  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)
  const currentRoomId = room?.id
  const isRunning = room?.state.isRunning ?? false
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    () => activeTimer?.id ?? null,
  )

  const effectiveSelectedTimerId = useMemo(() => {
    if (selectedTimerId && timers.some((timer) => timer.id === selectedTimerId)) {
      return selectedTimerId
    }
    return activeTimer?.id ?? null
  }, [activeTimer?.id, selectedTimerId, timers])

  const selectedTimer =
    timers.find((timer) => timer.id === effectiveSelectedTimerId) ?? activeTimer

  const startActiveTimer = () => {
    if (!currentRoomId) return
    void startTimer(currentRoomId)
  }

  const pauseActiveTimer = () => {
    if (!currentRoomId) return
    void pauseTimer(currentRoomId)
  }

  const resetActiveTimer = () => {
    if (!currentRoomId) return
    void resetTimer(currentRoomId)
  }

  const nudgeActiveTimer = (deltaMs: number) => {
    if (!currentRoomId) return
    void nudgeTimer(currentRoomId, deltaMs)
  }

  const startSelectedTimer = () => {
    if (!currentRoomId || !effectiveSelectedTimerId) return
    if (effectiveSelectedTimerId === activeTimer?.id) {
      startActiveTimer()
      return
    }
    void startTimer(currentRoomId, effectiveSelectedTimerId)
  }

  const handleSaveDuration = (timerId: string, minutes: number) => {
    if (!currentRoomId) return
    const duration = Math.max(0, Math.round(minutes * 60))
    void updateTimer(currentRoomId, timerId, { duration })
  }

  const handleUpdateDetails = (
    timerId: string,
    patch: { title?: string; speaker?: string },
  ) => {
    if (!currentRoomId) return
    void updateTimer(currentRoomId, timerId, patch)
  }

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  const activeIndex = activeTimer
    ? timers.findIndex((timer) => timer.id === activeTimer.id)
    : -1
  const prevTimer = activeIndex > 0 ? timers[activeIndex - 1] : null
  const nextTimer =
    activeIndex >= 0 && activeIndex < timers.length - 1
      ? timers[activeIndex + 1]
      : null

  const handleStartPrevTimer = () => {
    if (!prevTimer) return
    setSelectedTimerId(prevTimer.id)
    void startTimer(room.id, prevTimer.id)
  }

  const handleStartNextTimer = () => {
    if (!nextTimer) return
    setSelectedTimerId(nextTimer.id)
    void startTimer(room.id, nextTimer.id)
  }

  const handleToggleClock = () => {
    void setClockMode(room.id, !room.state.showClock)
  }

  useEffect(() => {
    if (!currentRoomId) return
    let repeatInterval: ReturnType<typeof window.setInterval> | null = null
    let repeatTimeout: ReturnType<typeof window.setTimeout> | null = null

    const stopRepeat = () => {
      if (repeatInterval) {
        window.clearInterval(repeatInterval)
        repeatInterval = null
      }
      if (repeatTimeout) {
        window.clearTimeout(repeatTimeout)
        repeatTimeout = null
      }
    }

    const performArrowAction = (direction: 'up' | 'down') => {
      if (selectedTimer && selectedTimer.id !== activeTimer?.id) {
        const delta = direction === 'up' ? 1 : -1
        const stagedMinutes = Math.max(
          0,
          Math.round(selectedTimer.duration / 60),
        )
        const nextMinutes = Math.max(0, stagedMinutes + delta)
        const duration = Math.max(0, Math.round(nextMinutes * 60))
        void updateTimer(currentRoomId, selectedTimer.id, { duration })
        return
      }
      void nudgeTimer(
        currentRoomId,
        direction === 'up' ? 60_000 : -60_000,
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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

      switch (event.code) {
        case 'Space': {
          event.preventDefault()
          if (isRunning) {
            void pauseTimer(currentRoomId)
          } else {
            void startTimer(currentRoomId)
          }
          break
        }
        case 'KeyR': {
          event.preventDefault()
          void resetTimer(currentRoomId)
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault()
          const direction = event.code === 'ArrowUp' ? 'up' : 'down'
          performArrowAction(direction)
          stopRepeat()
          repeatTimeout = window.setTimeout(() => {
            repeatInterval = window.setInterval(
              () => performArrowAction(direction),
              80,
            )
          }, 250)
          break
        }
        default:
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        stopRepeat()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', stopRepeat)
    return () => {
      stopRepeat()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', stopRepeat)
    }
  }, [
    activeTimer?.id,
    currentRoomId,
    isRunning,
    nudgeTimer,
    pauseTimer,
    resetTimer,
    selectedTimer,
    startTimer,
    updateTimer,
  ])

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Room not found. Return to the dashboard.
      </div>
    )
  }

  const messageKey = `${room.state.message.text}::${room.state.message.color}::${room.state.message.visible}`

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

      <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Operator Controls
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleStartPrevTimer}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
            disabled={!prevTimer}
          >
            Prev Segment
          </button>
          <button
            type="button"
            onClick={() => {
              if (room.state.isRunning) {
                pauseActiveTimer()
              } else {
                startActiveTimer()
              }
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60"
          >
            {room.state.isRunning ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            onClick={handleStartNextTimer}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
            disabled={!nextTimer}
          >
            Next Segment
          </button>
          <button
            type="button"
            onClick={handleToggleClock}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
              room.state.showClock
                ? 'bg-rose-500/30 text-rose-100 border border-rose-500/40'
                : 'border border-slate-700 text-slate-200 hover:border-white/60'
            }`}
          >
            {room.state.showClock ? 'Hide Clock' : 'Show Clock'}
          </button>
        </div>
      </div>

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
          onToggleClock={() => {
            void setClockMode(room.id, !room.state.showClock)
          }}
        />

        <TimerPanel
          timer={selectedTimer}
          isLive={Boolean(selectedTimer && selectedTimer.id === room.state.activeTimerId)}
          isRunning={Boolean(selectedTimer && selectedTimer.id === room.state.activeTimerId) && isRunning}
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
            key={messageKey}
            initial={room.state.message}
            onUpdate={(payload) => {
              void updateMessage(room.id, payload)
            }}
          />
          <LiveTimerPreview
            timer={activeTimer}
            showClock={room.state.showClock}
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
