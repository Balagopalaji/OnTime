import type { MessageColor, Timer } from '../../types'
import type { TimerEngineState } from '../../hooks/useTimerEngine'
import { FitText } from '../core/FitText'
import { TransportControls } from './TransportControls'

export const LiveTimerPreview = ({
  timer,
  engine,
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
  message,
}: {
  timer: Timer | undefined
  engine: TimerEngineState
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  message: { text: string; color: MessageColor; visible: boolean }
}) => {
  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
    none: 'border border-white/40 bg-transparent text-white',
  }[message.color] as string | undefined

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-5 shadow-card">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Live Countdown
          </p>
          <p className="text-lg font-semibold text-white">
            {timer ? timer.title : 'Standby'}
          </p>
        </div>
        {timer?.speaker && (
          <p className="text-xs text-slate-400">Speaker: {timer.speaker}</p>
        )}
      </div>
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
        <FitText className="font-display text-white" max={140}>
          {engine.display}
        </FitText>
        <p className="mt-4 text-sm uppercase tracking-[0.35em] text-slate-400">
          Status: {engine.status.toUpperCase()}
        </p>
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
            style={{ width: `${Math.min(engine.progress * 100, 100)}%` }}
          />
        </div>
        {message.visible && message.text && messageBg && (
          <div
            className={`mt-6 flex w-full items-center justify-center rounded-2xl px-4 py-5 text-center text-sm font-semibold ${messageBg}`}
          >
            <FitText
              className="w-full text-center font-semibold leading-[1.05]"
              max={80}
              min={20}
              ratio={6}
            >
              {message.text}
            </FitText>
          </div>
        )}
      </div>
      <div className="mt-5">
        <TransportControls
          isRunning={isRunning}
          onStart={onStart}
          onPause={onPause}
          onReset={onReset}
          onNudge={onNudge}
        />
      </div>
    </div>
  )
}
