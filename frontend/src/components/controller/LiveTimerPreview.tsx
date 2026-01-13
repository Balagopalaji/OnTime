import type { MessageColor, Timer } from '../../types'
import type { TimerEngineState } from '../../hooks/useTimerEngine'
import { FitText } from '../core/FitText'
import { TransportControls } from './TransportControls'
import { useClock } from '../../hooks/useClock'

export const LiveTimerPreview = ({
  timer,
  showClock,
  engine,
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
  onToggleClock,
  message,
  timezone,
  clockMode = '24h',
  readOnly = false,
}: {
  timer: Timer | undefined
  showClock: boolean
  engine: TimerEngineState
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  onToggleClock: () => void
  message: { text: string; color: MessageColor; visible: boolean }
  timezone: string
  clockMode?: '24h' | 'ampm'
  readOnly?: boolean
}) => {
  const clockTime = useClock(timezone, clockMode)
  const [clockBody, clockSuffix] = clockTime.split(' ')
  const clockSegments = clockBody.split(':')
  const clockPrimary =
    clockSegments.length >= 2 ? `${clockSegments[0]}:${clockSegments[1]}` : clockBody
  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
    none: 'border border-white/40 bg-transparent text-white',
  }[message.color] as string | undefined

  const durationMs = (timer?.duration ?? 0) * 1000
  const progressPercent =
    durationMs <= 0
      ? 0
      : Math.max(0, Math.min(1, engine.remainingMs / durationMs)) * 100

  const statusText =
    engine.status === 'default'
      ? 'On Schedule'
      : engine.status === 'warning'
      ? 'Warning'
      : engine.status === 'critical'
      ? 'Critical'
      : 'Overtime'

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-5 shadow-card">
      <div className="text-sm text-slate-400">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Live Countdown
        </p>
        <p className="text-lg font-semibold text-white">
          {timer ? timer.title : 'Standby'}
        </p>
        {timer?.speaker && (
          <p className="text-xs text-slate-400">Speaker: {timer.speaker}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {showClock && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-100">
              Showing Clock
            </span>
          )}
        </div>
      </div>
      <div className="mb-4 mt-3">
        <TransportControls
          isRunning={isRunning}
          onStart={onStart}
          onPause={onPause}
          onReset={onReset}
          onNudge={onNudge}
          onToggleClock={onToggleClock}
          showClock={showClock}
          disableActions={showClock}
          readOnly={readOnly}
        />
      </div>
      <div
        className={`mt-6 rounded-xl border border-slate-800 px-4 py-8 text-center ${
          engine.status === 'overtime' && !showClock
            ? 'bg-rose-950/80 border-rose-900'
            : 'bg-slate-950/60'
        }`}
      >
        <div className="flex justify-center">
          <FitText className="font-display text-white" max={140}>
            {showClock ? (
              <span className="inline-flex items-baseline gap-2 justify-center align-middle leading-none">
                <span className="text-white">{clockPrimary}</span>
                {clockSuffix && (
                  <span className="text-2xl font-semibold uppercase text-slate-200 align-middle">
                    {clockSuffix}
                  </span>
                )}
              </span>
            ) : (
              engine.display
            )}
          </FitText>
        </div>
        <p className="mt-4 text-sm uppercase tracking-[0.35em] text-slate-400">
          Status: {statusText}
        </p>
        {!showClock && (
          <div className="mt-6 h-2 rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${
                engine.status === 'overtime'
                  ? 'bg-rose-400'
                  : engine.status === 'critical'
                  ? 'bg-rose-400'
                  : engine.status === 'warning'
                  ? 'bg-amber-300'
                  : 'bg-emerald-400'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
        {message.visible && message.text && messageBg && (
          <div
            className={`mt-4 rounded-2xl px-3 py-3 text-[10px] font-semibold ${messageBg} max-h-24 overflow-auto`}
          >
            <p className="leading-[1.2] break-words text-left">{message.text}</p>
          </div>
        )}
      </div>
    </div>
  )
}
