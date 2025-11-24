import { useEffect, useMemo, useState } from 'react'
import type { Timer } from '../../types'
import { FitText } from '../core/FitText'
import type { TimerEngineState } from '../../hooks/useTimerEngine'
import { formatDuration } from '../../lib/time'

export const TimerPanel = ({
  timer,
  isLive,
  isRunning,
  engine,
  onStart,
  onPause,
  onReset,
  onNudge,
  onSaveDuration,
  onStartSelected,
  onUpdateDetails,
}: {
  timer: Timer | undefined | null
  isLive: boolean
  isRunning: boolean
  engine: TimerEngineState | undefined
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  onSaveDuration: (minutes: number) => void
  onStartSelected: () => void
  onUpdateDetails: (patch: { title?: string; speaker?: string }) => void
}) => {
  const [editableMinutes, setEditableMinutes] = useState(() =>
    timer ? Math.round(timer.duration / 60) : 5,
  )
  const [titleInput, setTitleInput] = useState(timer?.title ?? '')
  const [speakerInput, setSpeakerInput] = useState(timer?.speaker ?? '')

  useEffect(() => {
    if (!timer) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditableMinutes(Math.max(1, Math.round(timer.duration / 60)))
    setTitleInput(timer.title)
    setSpeakerInput(timer.speaker ?? '')
  }, [timer])

  const handleDurationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!timer) return
    onSaveDuration(editableMinutes)
  }

  const displayValue = useMemo(() => {
    if (isLive && engine) {
      return engine.display
    }
    if (timer) {
      return formatDuration(Math.max(1, editableMinutes) * 60_000)
    }
    return '00:00'
  }, [editableMinutes, engine, isLive, timer])

  const statusLabel = useMemo(() => {
    if (isLive && engine) {
      return engine.status.toUpperCase()
    }
    if (timer) {
      return 'STAGED'
    }
    return 'STANDBY'
  }, [engine, isLive, timer])

  const progressWidth = useMemo(() => {
    if (isLive && engine) {
      return Math.min(engine.progress * 100, 100)
    }
    return 0
  }, [engine, isLive])

  const handleStart = () => {
    if (!timer) return
    if (isLive) {
      onStart()
    } else {
      onStartSelected()
    }
  }

  const handlePause = () => {
    if (!timer || !isLive) return
    onPause()
  }

  const handleReset = () => {
    if (!timer || !isLive) return
    onReset()
  }

  const handleMinuteAdjust = (deltaMinutes: number) => {
    if (!timer) return
    if (isLive) {
      onNudge(deltaMinutes * 60_000)
    } else {
      const next = Math.max(1, editableMinutes + deltaMinutes)
      setEditableMinutes(next)
      onSaveDuration(next)
    }
  }

  const handleDetailsSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!timer) return
    onUpdateDetails({
      title: titleInput.trim(),
      speaker: speakerInput.trim(),
    })
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-6 shadow-card">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            {isLive ? 'Currently Live' : 'Selected Segment'}
          </p>
          <p className="text-lg font-semibold text-white">
            {timer ? timer.title : 'Select a timer to edit'}
          </p>
        </div>
        {timer?.speaker && (
          <p className="text-xs text-slate-400">Speaker: {timer.speaker}</p>
        )}
      </div>
      {isLive && timer && (
        <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/15 px-4 py-3 text-xs text-rose-100">
          <span className="rounded-full bg-rose-500/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white animate-pulse">
            Currently Live
          </span>
          <p className="mt-2 text-rose-100">
            Editing this segment updates the live timer instantly.
          </p>
        </div>
      )}

      {!timer ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-10 text-center text-sm text-slate-400">
          Choose a segment from the rundown to stage it here for adjustments.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Duration
            </p>
            <p className="text-lg font-semibold text-white">
              {Math.round(timer.duration / 60)} minutes
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Status
            </p>
            <p className="text-white">
              {isLive ? 'On Air' : 'Staged (not running)'}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
        <FitText className="font-display text-white" max={isLive ? 180 : 160}>
          {displayValue}
        </FitText>
        <p className="mt-4 text-sm uppercase tracking-[0.35em] text-slate-400">
          Status: {statusLabel}
        </p>
        <div className="mt-6 h-2 rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${
              statusLabel === 'OVERTIME' || statusLabel === 'CRITICAL'
                ? 'bg-rose-400'
                : statusLabel === 'WARNING'
                ? 'bg-amber-300'
                : 'bg-emerald-400'
            }`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          disabled={!timer || (isLive && isRunning)}
        >
          Start
        </button>
        <button
          type="button"
          onClick={handlePause}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-white transition hover:border-white/70 disabled:opacity-50"
          disabled={!timer || !isLive || !isRunning}
        >
          Pause
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300 disabled:opacity-50"
          disabled={!timer || !isLive}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => handleMinuteAdjust(1)}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
          disabled={!timer}
        >
          + 1 min
        </button>
        <button
          type="button"
          onClick={() => handleMinuteAdjust(-1)}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
          disabled={!timer}
        >
          - 1 min
        </button>
      </div>

      <form
        onSubmit={handleDetailsSubmit}
        className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-left text-sm text-slate-300"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Segment Details
        </p>
        <div className="mt-3 space-y-3">
          <label className="block text-slate-300">
            Title
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              disabled={!timer}
            />
          </label>
          <label className="block text-slate-300">
            Speaker
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={speakerInput}
              onChange={(event) => setSpeakerInput(event.target.value)}
              disabled={!timer}
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60"
            disabled={!timer}
          >
            Save Details
          </button>
        </div>
      </form>

      <form
        onSubmit={handleDurationSubmit}
        className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-left text-sm text-slate-300"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Set Timer Length
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Enter the total minutes for this segment; updating resets that timer.
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

    </div>
  )
}
