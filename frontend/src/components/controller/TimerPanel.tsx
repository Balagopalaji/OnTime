import type { Timer } from '../../types'
import { FitText } from '../core/FitText'
import { TransportControls } from './TransportControls'
import type { TimerEngineState } from '../../hooks/useTimerEngine'

export const TimerPanel = ({
  timer,
  engine,
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
}: {
  timer: Timer | undefined
  engine: TimerEngineState
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
}) => {
  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-6 shadow-card">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Active Timer
          </p>
          <p className="text-lg font-semibold text-white">
            {timer ? timer.title : 'Standby'}
          </p>
        </div>
        {timer?.speaker && (
          <p className="text-xs text-slate-400">Speaker: {timer.speaker}</p>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-10 text-center">
        <FitText className="font-display text-white" max={180}>
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
      </div>

      <div className="mt-6">
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
