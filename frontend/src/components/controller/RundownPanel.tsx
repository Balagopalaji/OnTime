import { Fragment, useEffect, useRef, useState } from 'react'
import type { Timer } from '../../types'
import { formatDuration } from '../../lib/time'
import { EditableField } from '../core/EditableField'
import { Pause, Play, RotateCcw, Trash2 } from 'lucide-react'

const formatDurationInput = (durationSec: number) => {
  const hours = Math.floor(durationSec / 3600)
  const minutes = Math.floor((durationSec % 3600) / 60)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}`
  }
  return `${Math.max(0, Math.round(durationSec / 60))}`
}

const parseDurationInput = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((part) => Number(part))
    if (parts.some((part) => Number.isNaN(part) || part < 0)) {
      return null
    }
    if (parts.length === 2) {
      const [hours, mins] = parts
      return hours * 60 + mins
    }
    if (parts.length === 3) {
      const [hours, mins, secs] = parts
      return hours * 60 + mins + secs / 60
    }
    return null
  }
  const numeric = Number(trimmed)
  if (Number.isNaN(numeric) || numeric < 0) return null
  return numeric
}

export const RundownPanel = ({
  timers,
  activeTimerId,
  isRunning,
  activeTimerDisplay,
  remainingLookup,
  selectedTimerId,
  onSelect,
  onStart,
  onDelete,
  onAddSegment,
  onEdit,
  onReorder,
  onPauseActive,
  onReset,
  undoPlaceholder,
  onUndoDelete,
}: {
  timers: Timer[]
  activeTimerId: string | null
  isRunning: boolean
  activeTimerDisplay: string | null
  remainingLookup: Record<string, string>
  selectedTimerId: string | null
  onSelect: (timerId: string) => void
  onStart: (timerId: string) => void
  onDelete: (timerId: string) => void
  onAddSegment: () => void
  onEdit: (timerId: string, patch: { title?: string; speaker?: string; duration?: number }) => void
  onReorder: (timerId: string, targetIndex: number) => void
  onPauseActive: () => void
  onReset: (timerId: string) => void
  undoPlaceholder?: { index: number; title: string } | null
  onUndoDelete?: () => void
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [editingDuration, setEditingDuration] = useState<{
    id: string
    value: string
  } | null>(null)
  const durationInputRef = useRef<HTMLInputElement | null>(null)

  const focusedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!editingDuration) {
      focusedIdRef.current = null
      return
    }
    if (editingDuration.id === focusedIdRef.current) return
    focusedIdRef.current = editingDuration.id
    if (durationInputRef.current) {
      durationInputRef.current.focus()
      durationInputRef.current.select()
    }
  }, [editingDuration])

  useEffect(() => {
    if (!editingDuration) return
    const handleClick = (event: MouseEvent) => {
      if (
        durationInputRef.current &&
        !durationInputRef.current.contains(event.target as Node)
      ) {
        const parsed = parseDurationInput(editingDuration.value)
        if (parsed !== null) {
          onEdit(editingDuration.id, { duration: Math.round(parsed * 60) })
        }
        setEditingDuration(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [editingDuration, onEdit])

  return (
    <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Rundown</h2>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          {timers.length} segments
        </p>
      </div>
      {timers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
          No timers yet
        </p>
      ) : (
        <>
        <ul className="mt-4 space-y-3">
          {timers.map((timer, index) => {
            const isActive = timer.id === activeTimerId
            const isSelected = timer.id === selectedTimerId
            const durationLabel = formatDuration(timer.duration * 1000)
            const displayValue =
              isActive && activeTimerDisplay
                ? activeTimerDisplay
                : remainingLookup[timer.id] ?? durationLabel
            return (
              <Fragment key={timer.id}>
                {undoPlaceholder && undoPlaceholder.index === index && (
                  <li className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>
                        Removed “{undoPlaceholder.title}”
                      </span>
                      {onUndoDelete && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onUndoDelete()
                          }}
                          className="rounded-full border border-emerald-400/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-200"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                )}
                {draggingId && hoverIndex === index && (
                  <div className="pointer-events-none px-8">
                    <div className="h-0.5 rounded-full bg-slate-600/70" />
                  </div>
                )}
                <li
                  className={`relative rounded-2xl border px-4 py-4 text-sm transition cursor-pointer ${
                    isActive
                      ? 'border-rose-400/70 bg-rose-500/10 shadow-[0_0_25px_rgba(244,114,182,0.2)]'
                      : isSelected
                      ? 'border-emerald-400/70 bg-emerald-400/10'
                      : 'border-slate-800 bg-slate-950/30 hover:border-slate-600'
                  } ${draggingId === timer.id ? 'opacity-60' : ''}`}
                  onClick={() => onSelect(timer.id)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    setDraggingId(timer.id)
                    setHoverIndex(index)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (!draggingId || draggingId === timer.id) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    const offset = event.clientY - rect.top
                    const nextIndex = offset < rect.height / 2 ? index : index + 1
                    setHoverIndex(nextIndex)
                  }}
                  onDragLeave={() => {
                    if (hoverIndex === index || hoverIndex === index + 1) {
                      setHoverIndex(null)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggingId && hoverIndex !== null) {
                      onReorder(draggingId, hoverIndex)
                    }
                    setHoverIndex(null)
                    setDraggingId(null)
                  }}
                  onDragEnd={() => {
                    setHoverIndex(null)
                    setDraggingId(null)
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <EditableField
                      value={timer.title}
                      onSave={(next) => onEdit(timer.id, { title: next })}
                      className="text-left text-base font-semibold text-white hover:text-emerald-300"
                      inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-white"
                    />
                    <EditableField
                      value={timer.speaker ?? ''}
                      onSave={(next) => onEdit(timer.id, { speaker: next })}
                      className="text-left text-xs text-slate-400 hover:text-emerald-200"
                      inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-white text-xs"
                      placeholder="No speaker"
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-white/80">
                      {isActive && (
                        <span className="inline-flex items-center rounded-full bg-rose-500/30 px-3 py-0.5 text-[10px] text-rose-100">
                          On Air
                        </span>
                      )}
                      {isSelected && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-0.5 text-[10px] text-emerald-200">
                          Selected
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right text-xs text-slate-500">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      Duration
                    </p>
                    <p>{Math.round(timer.duration / 60)} min</p>
                    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <div className="rounded-2xl bg-slate-900/80 px-4 py-3 text-right">
                        {editingDuration?.id === timer.id ? (
                          <input
                            ref={durationInputRef}
                            type="text"
                            className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-center text-white focus:border-emerald-400 focus:outline-none"
                            value={editingDuration.value}
                            onChange={(event) =>
                              setEditingDuration({
                                id: timer.id,
                                value: event.target.value,
                              })
                            }
                            onBlur={() => {
                              const parsed = parseDurationInput(editingDuration.value)
                              if (parsed !== null) {
                                onEdit(timer.id, { duration: Math.round(parsed * 60) })
                              }
                              setEditingDuration(null)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                const parsed = parseDurationInput(editingDuration.value)
                                if (parsed !== null) {
                                  onEdit(timer.id, { duration: Math.round(parsed * 60) })
                                }
                                setEditingDuration(null)
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                setEditingDuration(null)
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="text-2xl font-semibold text-white"
                            onClick={() =>
                              setEditingDuration({
                                id: timer.id,
                                value: formatDurationInput(timer.duration),
                              })
                            }
                          >
                            {displayValue}
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onStart(timer.id)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/70 text-emerald-200 transition hover:border-emerald-200"
                        >
                          <Play size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (isActive) onPauseActive()
                          }}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40"
                          disabled={!isActive || !isRunning}
                        >
                          <Pause size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onReset(timer.id)
                          }}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70"
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(timer.id)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/50 text-rose-200 transition hover:border-rose-200"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                </li>
              </Fragment>
            )
          })}
          {undoPlaceholder && undoPlaceholder.index >= timers.length && (
            <li className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>
                  Removed “{undoPlaceholder.title}”
                </span>
                {onUndoDelete && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onUndoDelete()
                    }}
                    className="rounded-full border border-emerald-400/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-200"
                  >
                    Undo
                  </button>
                )}
              </div>
            </li>
          )}
        </ul>
        {draggingId && hoverIndex === timers.length && (
          <div className="pointer-events-none px-8">
            <div className="h-0.5 rounded-full bg-slate-600/70" />
          </div>
        )}
        </>
      )}

      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onAddSegment}
          className="flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 text-xl text-slate-200 transition hover:border-slate-500"
        >
          <span className="text-2xl">+</span>
          <span className="sr-only">Add new segment</span>
        </button>
      </div>
    </div>
  )
}
