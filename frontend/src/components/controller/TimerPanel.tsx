import { useEffect, useMemo, useState } from 'react'
import type { Timer } from '../../types'
import { FitText } from '../core/FitText'
import type { TimerEngineState } from '../../hooks/useTimerEngine'
import { formatDuration } from '../../lib/time'
import { EditableField } from '../core/EditableField'
import { Tooltip } from '../core/Tooltip'

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
  const [durationInput, setDurationInput] = useState('0')
  const [isDurationEditing, setIsDurationEditing] = useState(false)

  useEffect(() => {
    if (!timer) return
    // Show originalDuration if timer was nudged, otherwise actual duration
    const displayDuration = timer.originalDuration ?? timer.duration
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDurationInput(Math.max(0, Math.round(displayDuration / 60)).toString())
  }, [timer])

  let displayValue = '00:00'
  if (timer) {
    displayValue = formatDuration((timer.duration ?? 0) * 1000)
  }
  if (isLive && engine) {
    displayValue = engine.display
  }

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
    if (timer) {
      if (engine) {
        const durationMs = timer.duration * 1000
        if (durationMs <= 0) return 0
        const ratio = Math.max(0, Math.min(1, engine.remainingMs / durationMs))
        return ratio * 100
      }
      return 0
    }
    return 0
  }, [engine, timer])

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
      const current = Math.max(0, Math.round((timer.duration ?? 0) / 60))
      const next = Math.max(0, current + deltaMinutes)
      onSaveDuration(next)
    }
  }

  const durationDisplay = () => {
    if (!timer) {
      return (
        <div className="flex justify-center">
          <FitText className="font-display text-white" max={160}>
            00:00
          </FitText>
        </div>
      )
    }

    if (isDurationEditing) {
      return (
        <div className="flex justify-center">
          <input
            type="number"
            className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-center text-2xl font-semibold text-white focus:border-emerald-400 focus:outline-none"
            value={durationInput}
            onChange={(event) => setDurationInput(event.target.value)}
            onBlur={() => {
              const parsed = Number(durationInput)
              if (!Number.isNaN(parsed) && parsed >= 0) {
                onSaveDuration(parsed)
              } else {
                const displayDuration = timer.originalDuration ?? timer.duration
                setDurationInput(Math.max(0, Math.round(displayDuration / 60)).toString())
              }
              setIsDurationEditing(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const parsed = Number(durationInput)
                if (!Number.isNaN(parsed) && parsed >= 0) {
                  onSaveDuration(parsed)
                }
                setIsDurationEditing(false)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                const displayDuration = timer.originalDuration ?? timer.duration
                setDurationInput(Math.max(0, Math.round(displayDuration / 60)).toString())
                setIsDurationEditing(false)
              }
            }}
          />
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={() => setIsDurationEditing(true)}
        className="flex justify-center"
      >
        <FitText className="font-display text-white" max={isLive ? 180 : 160}>
          {displayValue}
        </FitText>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-6 shadow-card">
      <div className="flex items-start justify-between gap-4 text-sm text-slate-400">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            {isLive ? 'Currently Live' : 'Selected Segment'}
          </p>
          {timer ? (
            <EditableField
              value={timer.title}
              onSave={(next) => onUpdateDetails({ title: next })}
              className="text-left text-2xl font-semibold text-white hover:text-emerald-300"
              inputClassName="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white w-64"
              placeholder="Title"
            />
          ) : (
            <p className="text-lg font-semibold text-white">Select a timer to edit</p>
          )}
        </div>
        {timer && (
          <EditableField
            value={timer.speaker ?? ''}
            onSave={(next) => onUpdateDetails({ speaker: next })}
            className="text-sm text-slate-400 hover:text-emerald-200"
            inputClassName="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            placeholder="Speaker"
          />
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

      {timer && (
        <div className="mt-6 flex flex-wrap gap-6 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Duration
            </p>
            <button
              type="button"
              className="text-lg font-semibold text-white hover:text-emerald-300"
              onClick={() => setIsDurationEditing(true)}
            >
              {Math.round((timer?.originalDuration ?? timer?.duration ?? 0) / 60)} minutes
            </button>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Status
            </p>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${isLive
                ? 'bg-rose-500/30 text-rose-100 animate-pulse shadow-[0_0_8px_rgba(248,113,113,0.5)]'
                : 'bg-slate-800 text-slate-200'
                }`}
            >
              {isLive ? 'On Air' : 'Staged'}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center">
        {durationDisplay()}
        <p className="mt-4 text-sm uppercase tracking-[0.35em] text-slate-400">
          Status: {statusLabel}
        </p>
        <div className="mt-6 h-2 rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${statusLabel === 'OVERTIME' || statusLabel === 'CRITICAL'
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
        <Tooltip content="Start Timer">
          <button
            type="button"
            onClick={handleStart}
            className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            disabled={!timer || (isLive && isRunning)}
          >
            Start
          </button>
        </Tooltip>
        <Tooltip content="Pause Timer">
          <button
            type="button"
            onClick={handlePause}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-white transition hover:border-white/70 disabled:opacity-50"
            disabled={!timer || !isLive || !isRunning}
          >
            Pause
          </button>
        </Tooltip>
        <Tooltip content="Reset Timer">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300 disabled:opacity-50"
            disabled={!timer || !isLive}
          >
            Reset
          </button>
        </Tooltip>
        <Tooltip content="Remove 1 minute">
          <button
            type="button"
            onClick={() => handleMinuteAdjust(-1)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
            disabled={!timer}
          >
            - 1 min
          </button>
        </Tooltip>
        <Tooltip content="Add 1 minute">
          <button
            type="button"
            onClick={() => handleMinuteAdjust(1)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60 disabled:opacity-50"
            disabled={!timer}
          >
            + 1 min
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
