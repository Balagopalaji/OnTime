import { Clock3, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { Tooltip } from '../core/Tooltip'

export const TransportControls = ({
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
  onToggleClock,
  showClock,
  disableActions = false,
}: {
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  onToggleClock?: () => void
  showClock?: boolean
  disableActions?: boolean
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content="Start Timer">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/90 text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"
          disabled={disableActions || isRunning}
        >
          <Play size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Pause Timer">
        <button
          type="button"
          onClick={onPause}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-white transition hover:border-white/70 disabled:opacity-40"
          disabled={disableActions || !isRunning}
        >
          <Pause size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Reset Timer">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-500/50 text-rose-200 transition hover:border-rose-200 disabled:opacity-40"
          disabled={disableActions}
        >
          <RotateCcw size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Remove 1 minute">
        <button
          type="button"
          onClick={() => onNudge(-60_000)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40"
          disabled={disableActions}
        >
          <Minus size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Add 1 minute">
        <button
          type="button"
          onClick={() => onNudge(60_000)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40"
          disabled={disableActions}
        >
          <Plus size={18} />
        </button>
      </Tooltip>
      {onToggleClock && (
        <Tooltip content={showClock ? 'Hide Clock' : 'Show Clock'}>
          <button
            type="button"
            onClick={onToggleClock}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${showClock
                ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/70'
              }`}
            aria-label={showClock ? 'Hide clock' : 'Show clock'}
          >
            <Clock3 size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
