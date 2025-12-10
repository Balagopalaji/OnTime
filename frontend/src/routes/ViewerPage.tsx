import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useRoom } from '../hooks/useRoom'
import { useTimers } from '../hooks/useTimers'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { FitText } from '../components/core/FitText'
import { useFullscreen } from '../hooks/useFullscreen'
import { useClock } from '../hooks/useClock'
import { useWakeLock } from '../hooks/useWakeLock'

export const ViewerPage = () => {
  const { roomId } = useParams()
  const {
    room,
    loading: roomLoading,
    connectionStatus: roomStatus,
  } = useRoom(roomId)
  const {
    timers,
    loading: timersLoading,
    connectionStatus: timerStatus,
  } = useTimers(roomId)

  const connectionStatus =
    roomStatus === 'online' && timerStatus === 'online'
      ? 'online'
      : roomStatus === 'offline' || timerStatus === 'offline'
      ? 'offline'
      : 'reconnecting'

  const isLoading = roomLoading || timersLoading
  const activeTimer =
    timers.find((timer) => timer.id === room?.state.activeTimerId) ?? timers[0]

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef)
  useWakeLock(true)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      const wantsToggle =
        event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)
      if (wantsToggle) {
        event.preventDefault()
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toggleFullscreen])

  const clockTime = useClock(room?.timezone ?? 'UTC', room?.state.clockMode ?? '24h')

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Connecting to room...
      </div>
    )
  }

  if (!room || !roomId || timers.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Viewer is offline or no timers found. Ask the operator for a new link.
      </div>
    )
  }

  const bgClass =
    engine.status === 'overtime'
      ? 'bg-rose-950'
      : engine.status === 'critical'
      ? 'bg-rose-900'
      : engine.status === 'warning'
      ? 'bg-amber-900'
      : 'bg-slate-950'

  const isOvertime = engine.status === 'overtime'
  const timerLabel = activeTimer ? activeTimer.title : 'Standby'

  if (!room) return null

  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
    none: 'border border-white/40 bg-transparent text-white',
  }[room.state.message.color]

  const getMessageFitProps = (length: number) => {
    if (length > 160) {
      return { max: 80, min: 20, ratio: 9 }
    }
    if (length > 100) {
      return { max: 120, min: 28, ratio: 7 }
    }
    return { max: 160, min: 40, ratio: 6 }
  }

  const durationMs = (activeTimer?.duration ?? 0) * 1000
  const progressPercent =
    durationMs <= 0
      ? 0
      : Math.max(0, Math.min(1, engine.remainingMs / durationMs)) * 100
  const progressColor =
    engine.status === 'overtime' || engine.status === 'critical'
      ? 'bg-rose-400'
      : engine.status === 'warning'
      ? 'bg-amber-300'
      : 'bg-emerald-400'

  return (
    <section className="flex min-h-[calc(100vh-80px)] w-full items-center justify-center px-4 py-6 md:py-10">
      <div
        ref={containerRef}
        className={`relative flex w-full max-w-[1600px] flex-col rounded-[36px] border border-slate-900 px-5 py-6 text-center shadow-card sm:px-12 sm:py-12 ${bgClass}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-slate-200">
          <div className="text-left">
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-white/80">
              {timerLabel}
            </p>
            <p className="text-base font-medium text-white">{room.title}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <ConnectionIndicator status={connectionStatus} />
            <button
              type="button"
              onClick={() => {
                void toggleFullscreen()
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:bg-white/20"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 size={14} />
                  Exit fullscreen
                </>
              ) : (
                <>
                  <Maximize2 size={14} />
                  Fullscreen
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-1 flex-col items-center justify-center">
          {room.state.showClock ? (
            <div className="flex justify-center w-full">
              <FitText className="font-semibold text-white" max={360} min={140} ratio={2}>
                {clockTime}
              </FitText>
            </div>
          ) : isOvertime ? (
            <div className="flex w-full flex-col items-center gap-4 text-white">
              <div className="flex justify-center w-full">
                <FitText className="font-semibold text-white" max={320} min={90} ratio={3.4}>
                  Time is up!
                </FitText>
              </div>
              <div className="flex justify-center w-full">
                <FitText
                  className="font-semibold text-rose-100"
                  max={220}
                  min={60}
                  ratio={4}
                >
                  {engine.display}
                </FitText>
              </div>
            </div>
          ) : (
            <div className="flex justify-center w-full">
              <FitText className="font-semibold text-white" max={480} min={120} ratio={2.2}>
                {engine.display}
              </FitText>
            </div>
          )}
          {!room.state.showClock && (
            <div className="mt-10 h-4 w-full max-w-6xl rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${progressColor}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {room.state.message.visible && room.state.message.text && messageBg && (
          <div
            className={`mt-8 flex w-full items-center justify-center rounded-3xl px-5 py-8 text-lg font-semibold break-words ${messageBg}`}
          >
            <FitText
              className="w-full text-center font-semibold leading-[1.05] break-words"
              {...getMessageFitProps(room.state.message.text.length)}
            >
              {room.state.message.text}
            </FitText>
          </div>
        )}
      </div>
    </section>
  )
}
