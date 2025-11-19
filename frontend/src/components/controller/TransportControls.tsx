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
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onStart}
        className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
        disabled={isRunning}
      >
        Start
      </button>
      <button
        type="button"
        onClick={onPause}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-white transition hover:border-white/70"
        disabled={!isRunning}
      >
        Pause
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => onNudge(60_000)}
        className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60"
      >
        + 1 min
      </button>
      <button
        type="button"
        onClick={() => onNudge(-60_000)}
        className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-white/60"
      >
        - 1 min
      </button>
    </div>
  )
}
