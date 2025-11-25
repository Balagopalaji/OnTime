import { Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react'

export const TransportControls = ({
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
}: {
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onStart}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/90 text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"
        disabled={isRunning}
      >
        <Play size={18} />
      </button>
      <button
        type="button"
        onClick={onPause}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-white transition hover:border-white/70 disabled:opacity-40"
        disabled={!isRunning}
      >
        <Pause size={18} />
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-500/50 text-rose-200 transition hover:border-rose-200"
      >
        <RotateCcw size={18} />
      </button>
      <button
        type="button"
        onClick={() => onNudge(-60_000)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70"
      >
        <Minus size={18} />
      </button>
      <button
        type="button"
        onClick={() => onNudge(60_000)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70"
      >
        <Plus size={18} />
      </button>
    </div>
  )
}
