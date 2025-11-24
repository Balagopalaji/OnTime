import { useEffect, useState } from 'react'
import type { Timer } from '../../types'
import { FitText } from '../core/FitText'
import { TransportControls } from './TransportControls'
import type { TimerEngineState } from '../../hooks/useTimerEngine'

export const TimerPanel = ({
  timer,
  selectedTimer,
  engine,
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
  onSaveDuration,
  onStartSelected,
}: {
  timer: Timer | undefined
  selectedTimer?: Timer | null
  engine: TimerEngineState
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  onSaveDuration: (minutes: number) => void
  onStartSelected: () => void
}) => {
  const [editableMinutes, setEditableMinutes] = useState(() =>
    timer ? Math.round(timer.duration / 60) : 5,
  )

  useEffect(() => {
    if (!timer) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditableMinutes(Math.max(1, Math.round(timer.duration / 60)))
  }, [timer])

  const handleDurationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!timer) return
    onSaveDuration(editableMinutes)
  }

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

      <form
        onSubmit={handleDurationSubmit}
        className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-left text-sm text-slate-300"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Set Timer Length
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Enter the total minutes for this segment; updating resets the clock.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="flex flex-1 items-center gap-2">
            <span className="text-xs text-slate-400">Minutes</span>
            <input
              type="number"
              min={1}
              className="w-24 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-white"
              value={editableMinutes}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isNaN(next)) return
                setEditableMinutes(Math.max(1, next))
              }}
              disabled={!timer}
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/70 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!timer}
          >
            Update
          </button>
        </div>
      </form>

      {selectedTimer && timer && selectedTimer.id !== timer.id && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-left text-sm text-slate-200">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Next Segment Ready
          </p>
          <div className="mt-2 text-white">
            <p className="text-base font-semibold">{selectedTimer.title}</p>
            <p className="text-xs text-slate-400">
              {Math.round(selectedTimer.duration / 60)} min
              {selectedTimer.speaker ? ` • ${selectedTimer.speaker}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onStartSelected}
            className="mt-4 inline-flex items-center rounded-lg border border-emerald-400/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-200"
          >
            Start This Segment
          </button>
        </div>
      )}
    </div>
  )
}
