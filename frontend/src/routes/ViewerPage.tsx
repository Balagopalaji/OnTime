import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useMockData } from '../context/MockDataContext'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { FitText } from '../components/core/FitText'
import { useFullscreen } from '../hooks/useFullscreen'

export const ViewerPage = () => {
  const { roomId } = useParams()
  const { getRoom, getTimers, connectionStatus } = useMockData()
  const room = roomId ? getRoom(roomId) : undefined
  const timers = roomId ? getTimers(roomId) : []
  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)

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

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Viewer is offline. Ask the operator for a new link.
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

  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
  }[room.state.message.color]

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
          {isOvertime ? (
            <div className="flex w-full flex-col items-center gap-4 text-white">
              <FitText className="font-semibold text-white" max={320} min={90} ratio={3.4}>
                Time is up!
              </FitText>
              <FitText
                className="font-semibold text-rose-100"
                max={220}
                min={60}
                ratio={4}
              >
                {engine.display}
              </FitText>
            </div>
          ) : (
            <FitText className="font-semibold text-white" max={480} min={120} ratio={2.2}>
              {engine.display}
            </FitText>
          )}
        </div>

        {room.state.message.visible && room.state.message.text && (
          <div
            className={`mt-8 flex w-full items-center justify-center rounded-3xl px-4 py-4 text-lg font-semibold ${messageBg}`}
          >
            <FitText
              className="w-full text-center font-semibold"
              max={160}
              min={40}
              ratio={6}
            >
              {room.state.message.text}
            </FitText>
          </div>
        )}
      </div>
    </section>
  )
}
