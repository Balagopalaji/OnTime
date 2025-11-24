import { FormEvent, useState } from 'react'
import type { Timer } from '../../types'

export const RundownPanel = ({
  timers,
  activeTimerId,
  selectedTimerId,
  onSelect,
  onStart,
  onDelete,
  onMove,
  onCreate,
}: {
  timers: Timer[]
  activeTimerId: string | null
  selectedTimerId: string | null
  onSelect: (timerId: string) => void
  onStart: (timerId: string) => void
  onDelete: (timerId: string) => void
  onMove: (timerId: string, direction: 'up' | 'down') => void
  onCreate: (input: { title: string; duration: number; speaker?: string }) => void
}) => {
  const [title, setTitle] = useState('New Segment')
  const [duration, setDuration] = useState('5')
  const [speaker, setSpeaker] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const durationMinutes = Number(duration)
    const safeDuration = Number.isNaN(durationMinutes) ? 1 : durationMinutes
    onCreate({ title, duration: Math.round(safeDuration * 60), speaker })
    setTitle('New Segment')
    setDuration('5')
    setSpeaker('')
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Rundown</h2>
        <p className="text-xs text-slate-400">{timers.length} segments</p>
      </div>
      {timers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
          No timers yet
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {timers.map((timer, index) => {
            const isActive = timer.id === activeTimerId
            const isSelected = timer.id === selectedTimerId
            return (
              <li
                key={timer.id}
                className={`rounded-xl border px-4 py-3 text-sm ${
                  isActive
                    ? 'border-emerald-400/60 bg-emerald-400/10'
                    : isSelected
                    ? 'border-sky-400/70 bg-sky-400/10'
                    : 'border-slate-800 bg-slate-950/40'
                }`}
              >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-white">{timer.title}</p>
                  <p className="text-xs text-slate-400">
                    {Math.round(timer.duration / 60)} min •{' '}
                    {timer.speaker ? timer.speaker : 'No speaker'}
                  </p>
                  <div className="mt-1 flex gap-2 text-[10px] uppercase tracking-wide">
                    {isActive && (
                      <span className="rounded-full bg-rose-500/30 px-2 py-0.5 text-rose-100">
                        On Air
                      </span>
                    )}
                    {!isActive && isSelected && (
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-sky-200">
                        Selected
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => onSelect(timer.id)}
                    className="rounded-full border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-white/60"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => onStart(timer.id)}
                    className="rounded-full border border-emerald-400/60 px-2 py-1 text-emerald-200 transition hover:border-emerald-200"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(timer.id, 'up')}
                    className="rounded-full border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-white/60"
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(timer.id, 'down')}
                    className="rounded-full border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-white/60"
                    disabled={index === timers.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(timer.id)}
                    className="rounded-full border border-rose-500/40 px-2 py-1 text-rose-200 transition hover:border-rose-200"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          )})}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-2 rounded-xl border border-dashed border-slate-800 p-4 text-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Add Timer
        </p>
        <label className="block text-slate-300">
          Title
          <input
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-slate-300">
            Duration (min)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={duration}
              onChange={(event) => {
                setDuration(event.target.value)
              }}
            />
          </label>
          <label className="text-slate-300">
            Speaker (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-2 inline-flex items-center rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        >
          Add Timer
        </button>
      </form>
    </div>
  )
}
