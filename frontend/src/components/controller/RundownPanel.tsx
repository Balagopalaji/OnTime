import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Section, Segment, Timer } from '../../types'
import { formatDuration } from '../../lib/time'
import { EditableField } from '../core/EditableField'
import { ChevronDown, ChevronRight, GripVertical, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Tooltip } from '../core/Tooltip'
import { useSortableList, getActiveDrag } from '../../hooks/useSortableList'
import { SortableList } from '../sortable/SortableList'
import { SortableItem } from '../sortable/SortableItem'

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

// ---------------------------------------------------------------------------
// DropZone — accepts foreign drops when a container is empty
// ---------------------------------------------------------------------------
const DropZone = ({
  itemType,
  groupId,
  onDrop,
  label,
}: {
  itemType: string
  groupId: string
  onDrop: (foreignId: string, fromGroupId: string) => void
  label: string
}) => {
  const [over, setOver] = useState(false)

  const isCompatible = () => {
    const drag = getActiveDrag()
    return drag !== null && drag.itemType === itemType && drag.groupId !== groupId
  }

  return (
    <div
      onDragOver={(event) => {
        if (!isCompatible()) return
        event.preventDefault()
        setOver(true)
      }}
      onDragEnter={(event) => {
        if (!isCompatible()) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const drag = getActiveDrag()
        if (drag && drag.itemType === itemType && drag.groupId !== groupId) {
          onDrop(drag.id, drag.groupId)
        }
      }}
      className={`rounded-xl border border-dashed px-4 py-3 text-center text-xs transition ${
        over
          ? 'border-sky-400/70 bg-sky-500/10 text-sky-300'
          : 'border-slate-800 bg-slate-950/40 text-slate-500'
      }`}
    >
      {over ? `Drop here` : label}
    </div>
  )
}

type RundownProps = {
  timers: Timer[]
  sections: Section[]
  segments: Segment[]
  activeTimerId: string | null
  isRunning: boolean
  activeTimerDisplay: string | null
  remainingLookup: Record<string, string>
  selectedTimerId: string | null
  showSelection: boolean
  onSelect: (timerId: string) => void
  onStart: (timerId: string) => void
  onDeleteTimer: (timerId: string) => void
  onAddTimer: (segmentId?: string) => void
  onEditTimer: (timerId: string, patch: { title?: string; speaker?: string; duration?: number }) => void
  onReorderTimers: (timerId: string, targetIndex: number) => void
  onReorderSegmentTimers: (segmentId: string, timerIds: string[]) => void
  onAddSection: () => void
  onEditSection: (sectionId: string, patch: Partial<{ title: string; notes: string }>) => void
  onDeleteSection: (sectionId: string) => void
  onReorderSections: (sectionIds: string[]) => void
  onAddSegment: (sectionId?: string) => void
  onEditSegment: (segmentId: string, patch: Partial<{ title: string; notes: string; sectionId: string }>) => void
  onDeleteSegment: (segmentId: string) => void
  onReorderSegments: (sectionId: string, segmentIds: string[]) => void
  onMoveSegmentToSection?: (segmentId: string, fromSectionId: string, targetSectionId: string, targetIndex: number) => void
  onMoveTimerToSegment?: (timerId: string, fromSegmentId: string, targetSegmentId: string, targetIndex: number) => void
  onPauseActive: () => void
  onActiveNudge: (deltaMs: number) => void
  onReset: (timerId: string) => void
  undoPlaceholder?: { index: number; title: string; timerId?: string; expiresAt?: number } | null
  onUndoDelete?: () => void
  readOnly?: boolean
}

type TimerRowSharedProps = {
  activeTimerId: string | null
  selectedTimerId: string | null
  showSelection: boolean
} & Omit<Parameters<typeof TimerRow>[0], 'timer' | 'isActive' | 'showSelectedState'>

// ---------------------------------------------------------------------------
// TimerRow — renders a single timer item (extracted from old RundownPanel)
// ---------------------------------------------------------------------------
const TimerRow = ({
  timer,
  isActive,
  showSelectedState,
  activeTimerDisplay,
  remainingLookup,
  isRunning,
  readOnly,
  blockedClass,
  onSelect,
  onStart,
  onDelete,
  onEdit,
  onPauseActive,
  onReset,
  editingDuration,
  setEditingDuration,
  durationInputRef,
  startHoldAdjust,
  stopHoldAdjust,
}: {
  timer: Timer
  isActive: boolean
  showSelectedState: boolean
  activeTimerDisplay: string | null
  remainingLookup: Record<string, string>
  isRunning: boolean
  readOnly: boolean
  blockedClass: string
  onSelect: (timerId: string) => void
  onStart: (timerId: string) => void
  onDelete: (timerId: string) => void
  onEdit: (timerId: string, patch: { title?: string; speaker?: string; duration?: number }) => void
  onPauseActive: () => void
  onReset: (timerId: string) => void
  editingDuration: { id: string; value: string } | null
  setEditingDuration: (v: { id: string; value: string } | null) => void
  durationInputRef: React.RefObject<HTMLInputElement | null>
  startHoldAdjust: (timerId: string, direction: -1 | 1) => void
  stopHoldAdjust: () => void
}) => {
  const durationLabel = formatDuration(timer.duration * 1000)
  const displayValue =
    isActive && activeTimerDisplay
      ? activeTimerDisplay
      : remainingLookup[timer.id] ?? durationLabel

  return (
    <div
      className={`relative rounded-2xl border px-4 py-4 text-sm transition ${readOnly ? 'cursor-not-allowed' : 'cursor-pointer'} ${
        isActive && showSelectedState
          ? 'border-emerald-400/80 bg-rose-500/10 shadow-[0_0_25px_rgba(244,114,182,0.2)]'
          : isActive
            ? 'border-rose-400/70 bg-rose-500/10 shadow-[0_0_25px_rgba(244,114,182,0.2)]'
            : showSelectedState
              ? 'border-emerald-400/70 bg-emerald-400/10'
              : 'border-slate-800 bg-slate-950/30 hover:border-slate-600'
      }`}
      onClick={() => onSelect(timer.id)}
    >
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <EditableField
            value={timer.title}
            onSave={(next) => onEdit(timer.id, { title: next })}
            className={`text-left text-base font-semibold text-white hover:text-emerald-300 ${blockedClass}`}
            inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-white"
          />
          <EditableField
            value={timer.speaker ?? ''}
            onSave={(next) => onEdit(timer.id, { speaker: next })}
            className={`text-left text-xs text-slate-400 hover:text-emerald-200 ${blockedClass}`}
            inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-white text-xs"
            placeholder="No speaker"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-white/80">
            {isActive && (
              <span className="inline-flex items-center rounded-full bg-rose-500/30 px-3 py-0.5 text-[10px] text-rose-100">
                On Air
              </span>
            )}
            {showSelectedState && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-0.5 text-[10px] font-semibold tracking-[0.3em] text-emerald-100">
                Selected
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-xs text-slate-500">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Duration</p>
          <p>{Math.round((timer.originalDuration ?? timer.duration) / 60)} min</p>
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <div className="rounded-2xl bg-slate-900/80 px-4 py-3 text-right">
              {editingDuration?.id === timer.id ? (
                <input
                  ref={durationInputRef}
                  type="text"
                  className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-center text-white focus:border-emerald-400 focus:outline-none"
                  value={editingDuration.value}
                  onChange={(event) =>
                    setEditingDuration({ id: timer.id, value: event.target.value })
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
                  aria-disabled={readOnly}
                  className={`text-2xl font-semibold text-white ${blockedClass}`}
                  onClick={() =>
                    setEditingDuration({ id: timer.id, value: formatDurationInput(timer.duration) })
                  }
                >
                  {displayValue}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Tooltip content="Start Timer">
                <button
                  type="button"
                  onClick={() => onStart(timer.id)}
                  aria-disabled={readOnly}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/70 text-emerald-200 transition hover:border-emerald-200 ${blockedClass}`}
                >
                  <Play size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Pause Timer">
                <button
                  type="button"
                  onClick={() => {
                    if (isActive) onPauseActive()
                  }}
                  aria-disabled={readOnly}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40 ${blockedClass}`}
                  disabled={!isActive || !isRunning}
                >
                  <Pause size={16} />
                </button>
              </Tooltip>
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  startHoldAdjust(timer.id, -1)
                }}
                onPointerUp={stopHoldAdjust}
                onPointerCancel={stopHoldAdjust}
                aria-disabled={readOnly}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 ${blockedClass}`}
                aria-label="Decrease duration"
                style={{ touchAction: 'none' }}
              >
                −
              </button>
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  startHoldAdjust(timer.id, 1)
                }}
                onPointerUp={stopHoldAdjust}
                onPointerCancel={stopHoldAdjust}
                aria-disabled={readOnly}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 ${blockedClass}`}
                aria-label="Increase duration"
                style={{ touchAction: 'none' }}
              >
                +
              </button>
              <Tooltip content="Reset Timer">
                <button
                  type="button"
                  onClick={() => onReset(timer.id)}
                  aria-disabled={readOnly}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 ${blockedClass}`}
                >
                  <RotateCcw size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Delete Timer">
                <button
                  type="button"
                  onClick={() => onDelete(timer.id)}
                  aria-disabled={readOnly}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-500/50 text-rose-200 transition hover:border-rose-200 ${blockedClass}`}
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SegmentGroup — renders a segment header + its timers
// ---------------------------------------------------------------------------
const SegmentGroup = ({
  segment,
  timers,
  readOnly,
  blockedClass,
  onEditSegment,
  onDeleteSegment,
  onAddTimer,
  onReorderTimers,
  onReorderSegmentTimers,
  onMoveTimerToSegment,
  timerRowProps,
  groupIdOverride,
}: {
  segment: Segment | null // null = unsectioned timers
  timers: Timer[]
  readOnly: boolean
  blockedClass: string
  onEditSegment: (segmentId: string, patch: Partial<{ title: string; notes: string }>) => void
  onDeleteSegment: (segmentId: string) => void
  onAddTimer: (segmentId?: string) => void
  onReorderTimers: (timerId: string, targetIndex: number) => void
  onReorderSegmentTimers: (segmentId: string, timerIds: string[]) => void
  onMoveTimerToSegment?: (timerId: string, fromSegmentId: string, targetSegmentId: string, targetIndex: number) => void
  timerRowProps: TimerRowSharedProps
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>
  groupIdOverride?: string
}) => {
  const segmentGroupId = groupIdOverride ?? segment?.id ?? '__none__'
  const sorted = useMemo(
    () => [...timers].sort((a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order)),
    [timers],
  )
  const listRef = useRef<HTMLUListElement | null>(null)
  const sortableItems = useMemo(
    () => sorted.map((timer) => ({ id: timer.id, value: timer })),
    [sorted],
  )
  const { draggingId, overIndex, getItemProps } = useSortableList({
    items: sortableItems,
    containerRef: listRef,
    groupId: segmentGroupId,
    itemType: 'timer',
    onForeignDrop: (foreignId, fromGroupId, targetIndex) => {
      if (onMoveTimerToSegment) {
        onMoveTimerToSegment(foreignId, fromGroupId, segmentGroupId, targetIndex)
      }
    },
    onReorder: (fromIndex, toIndex) => {
      const ordered = [...sorted]
      const [moved] = ordered.splice(fromIndex, 1)
      const clamped = Math.max(0, Math.min(toIndex, ordered.length))
      ordered.splice(clamped, 0, moved)
      if (segment) {
        onReorderSegmentTimers(segment.id, ordered.map((timer) => timer.id))
        return
      }
      const movingId = sorted[fromIndex]?.id
      if (movingId) {
        onReorderTimers(movingId, clamped)
      }
    },
  })

  const displayTimers = useMemo(() => {
    if (!draggingId || overIndex === null) return sorted
    const current = [...sorted]
    const fromIndex = current.findIndex((timer) => timer.id === draggingId)
    if (fromIndex === -1) return sorted
    const [moving] = current.splice(fromIndex, 1)
    const target = Math.max(0, Math.min(current.length, overIndex))
    current.splice(target, 0, moving)
    return current
  }, [draggingId, overIndex, sorted])

  const allowTimerDrop = (event: React.DragEvent) => {
    const drag = getActiveDrag()
    if (!drag || drag.itemType !== 'timer' || drag.groupId === segmentGroupId) return false
    event.preventDefault()
    return true
  }

  return (
    <div className="space-y-2">
      {segment && (
        <div
          className="flex items-center justify-between gap-2 px-1"
          onDragOver={(event) => {
            allowTimerDrop(event)
          }}
          onDragEnter={(event) => {
            allowTimerDrop(event)
          }}
          onDrop={(event) => {
            if (!allowTimerDrop(event)) return
            const drag = getActiveDrag()
            if (drag && onMoveTimerToSegment) {
              onMoveTimerToSegment(drag.id, drag.groupId, segmentGroupId, 0)
            }
          }}
        >
          <EditableField
            value={segment.title}
            onSave={(next) => onEditSegment(segment.id, { title: next })}
            className={`text-left text-sm font-medium text-slate-300 hover:text-emerald-300 ${blockedClass}`}
            inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-white text-sm"
          />
          <div className="flex items-center gap-1">
            <Tooltip content="Add Timer">
              <button
                type="button"
                onClick={() => onAddTimer(segment.id)}
                aria-disabled={readOnly}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white ${blockedClass}`}
              >
                <Plus size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Delete Segment">
              <button
                type="button"
                onClick={() => onDeleteSegment(segment.id)}
                aria-disabled={readOnly}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:text-rose-300 ${blockedClass}`}
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      <SortableList ref={listRef} className="space-y-3">
        {displayTimers.map((timer, index) => {
          const isActive = timer.id === timerRowProps.activeTimerId
          const isSelected = timer.id === timerRowProps.selectedTimerId
          const showSelectedState = isSelected && timerRowProps.showSelection
          const itemProps = getItemProps(timer.id, index)
          const stopPropagation = (event: React.DragEvent) => {
            event.stopPropagation()
          }
          return (
            <SortableItem
              key={timer.id}
              {...itemProps}
              onDragStart={(event) => {
                stopPropagation(event)
                itemProps.onDragStart(event)
              }}
              onDragOver={(event) => {
                stopPropagation(event)
                itemProps.onDragOver(event)
              }}
              onDragEnter={(event) => {
                stopPropagation(event)
                itemProps.onDragEnter(event)
              }}
              onDrop={(event) => {
                stopPropagation(event)
                itemProps.onDrop(event)
              }}
              onDragEnd={() => {
                itemProps.onDragEnd()
              }}
              dragging={draggingId === timer.id}
              over={overIndex === index}
              dataIndex={index}
            >
              <TimerRow
                timer={timer}
                isActive={isActive}
                showSelectedState={showSelectedState}
                {...timerRowProps}
              />
            </SortableItem>
          )
        })}
      </SortableList>
      {sorted.length === 0 && segment && (
        <DropZone
          itemType="timer"
          groupId={segmentGroupId}
          onDrop={(foreignId, fromGroupId) => {
            if (onMoveTimerToSegment) {
              onMoveTimerToSegment(foreignId, fromGroupId, segmentGroupId, 0)
            }
          }}
          label="No timers in this segment"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionGroup — renders a section header + its segments + ungrouped timers
// ---------------------------------------------------------------------------
const SectionGroup = ({
  section,
  segments,
  timers,
  readOnly,
  blockedClass,
  onEditSection,
  onDeleteSection,
  onAddSegment,
  onEditSegment,
  onDeleteSegment,
  onAddTimer,
  onReorderSegments,
  onReorderTimers,
  onReorderSegmentTimers,
  onMoveSegmentToSection,
  onMoveTimerToSegment,
  timerRowProps,
  dragHandleProps,
}: {
  section: Section | null // null = default/unsectioned
  segments: Segment[]
  timers: Timer[]
  readOnly: boolean
  blockedClass: string
  onEditSection: (sectionId: string, patch: Partial<{ title: string; notes: string }>) => void
  onDeleteSection: (sectionId: string) => void
  onAddSegment: (sectionId?: string) => void
  onEditSegment: (segmentId: string, patch: Partial<{ title: string; notes: string }>) => void
  onDeleteSegment: (segmentId: string) => void
  onAddTimer: (segmentId?: string) => void
  onReorderSegments: (sectionId: string, segmentIds: string[]) => void
  onReorderTimers: (timerId: string, targetIndex: number) => void
  onReorderSegmentTimers: (segmentId: string, timerIds: string[]) => void
  onMoveSegmentToSection?: (segmentId: string, fromSectionId: string, targetSectionId: string, targetIndex: number) => void
  onMoveTimerToSegment?: (timerId: string, fromSegmentId: string, targetSegmentId: string, targetIndex: number) => void
  timerRowProps: TimerRowSharedProps
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>
}) => {
  const [collapsed, setCollapsed] = useState(false)
  const sectionGroupId = section?.id ?? '__none__'

  // Segments belonging to this section, sorted by order
  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => a.order - b.order),
    [segments],
  )
  const segmentListRef = useRef<HTMLUListElement | null>(null)
  const segmentItems = useMemo(
    () => sortedSegments.map((seg) => ({ id: seg.id, value: seg })),
    [sortedSegments],
  )
  const { draggingId, overIndex, getItemProps } = useSortableList({
    items: segmentItems,
    containerRef: segmentListRef,
    groupId: sectionGroupId,
    itemType: 'segment',
    onForeignDrop: (foreignId, fromGroupId, targetIndex) => {
      if (onMoveSegmentToSection) {
        onMoveSegmentToSection(foreignId, fromGroupId, sectionGroupId, targetIndex)
      }
    },
    onReorder: (fromIndex, toIndex) => {
      if (!section) return
      const ordered = [...sortedSegments]
      const [moved] = ordered.splice(fromIndex, 1)
      const clamped = Math.max(0, Math.min(toIndex, ordered.length))
      ordered.splice(clamped, 0, moved)
      onReorderSegments(section.id, ordered.map((seg) => seg.id))
    },
  })

  const displaySegments = useMemo(() => {
    if (!draggingId || overIndex === null) return sortedSegments
    const current = [...sortedSegments]
    const fromIndex = current.findIndex((seg) => seg.id === draggingId)
    if (fromIndex === -1) return sortedSegments
    const [moving] = current.splice(fromIndex, 1)
    const target = Math.max(0, Math.min(current.length, overIndex))
    current.splice(target, 0, moving)
    return current
  }, [draggingId, overIndex, sortedSegments])

  // Build a map: segmentId → timers
  const timersBySegment = useMemo(() => {
    const map: Record<string, Timer[]> = {}
    for (const timer of timers) {
      const key = timer.segmentId ?? '__none__'
      if (!map[key]) map[key] = []
      map[key].push(timer)
    }
    return map
  }, [timers])

  // Section-level timers: timers with sectionId matching this section but no segmentId
  const sectionLevelTimers = useMemo(
    () => timers.filter((timer) => timer.sectionId === section?.id && !timer.segmentId),
    [timers, section],
  )

  return (
    <div className="space-y-3">
      {section && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {dragHandleProps && (
              <button
                type="button"
                {...dragHandleProps}
                className="text-slate-500 transition hover:text-slate-200 cursor-grab active:cursor-grabbing"
                aria-label="Reorder section"
              >
                <GripVertical size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="text-slate-400 transition hover:text-white"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            <EditableField
              value={section.title}
              onSave={(next) => onEditSection(section.id, { title: next })}
              className={`text-left text-base font-semibold text-slate-200 hover:text-emerald-300 ${blockedClass}`}
              inputClassName="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-white"
            />
          </div>
          <div className="flex items-center gap-1">
            <Tooltip content="Add Timer to Section">
              <button
                type="button"
                onClick={() => onAddTimer(`__section__${section.id}`)}
                aria-disabled={readOnly}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white ${blockedClass}`}
              >
                <Plus size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Add Segment">
              <button
                type="button"
                onClick={() => onAddSegment(section.id)}
                aria-disabled={readOnly}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white ${blockedClass}`}
              >
                <Plus size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Delete Section">
              <button
                type="button"
                onClick={() => onDeleteSection(section.id)}
                aria-disabled={readOnly}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:text-rose-300 ${blockedClass}`}
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className={section ? 'ml-4 space-y-4' : 'space-y-4'}>
          <SortableList ref={segmentListRef} className="space-y-4">
            {displaySegments.map((seg, index) => {
              const itemProps = getItemProps(seg.id, index)
              const stopPropagation = (event: React.DragEvent) => {
                event.stopPropagation()
              }
              return (
                <SortableItem
                  key={seg.id}
                  {...itemProps}
                  onDragStart={(event) => {
                    stopPropagation(event)
                    itemProps.onDragStart(event)
                  }}
                  onDragOver={(event) => {
                    stopPropagation(event)
                    itemProps.onDragOver(event)
                  }}
                  onDragEnter={(event) => {
                    stopPropagation(event)
                    itemProps.onDragEnter(event)
                  }}
                  onDrop={(event) => {
                    stopPropagation(event)
                    itemProps.onDrop(event)
                  }}
                  onDragEnd={() => {
                    itemProps.onDragEnd()
                  }}
                  dragging={draggingId === seg.id}
                  over={overIndex === index}
                  dataIndex={index}
                >
                  <SegmentGroup
                    segment={seg}
                    timers={timersBySegment[seg.id] ?? []}
                    readOnly={readOnly}
                    blockedClass={blockedClass}
                    onEditSegment={onEditSegment}
                    onDeleteSegment={onDeleteSegment}
                    onAddTimer={onAddTimer}
                    onReorderTimers={onReorderTimers}
                    onReorderSegmentTimers={onReorderSegmentTimers}
                    onMoveTimerToSegment={onMoveTimerToSegment}
                    timerRowProps={timerRowProps}
                  />
                </SortableItem>
              )
            })}
          </SortableList>
          {sortedSegments.length === 0 && (
            <DropZone
              itemType="segment"
              groupId={sectionGroupId}
              onDrop={(foreignId, fromGroupId) => {
                if (onMoveSegmentToSection) {
                  onMoveSegmentToSection(foreignId, fromGroupId, sectionGroupId, 0)
                }
              }}
              label={section ? 'No segments in this section' : 'Drop segment here'}
            />
          )}
          {section && (
            <div className="space-y-2">
              <p className="px-1 text-xs uppercase tracking-[0.2em] text-slate-500">Section Items</p>
              <SegmentGroup
                segment={null}
                timers={sectionLevelTimers}
                readOnly={readOnly}
                blockedClass={blockedClass}
                onEditSegment={onEditSegment}
                onDeleteSegment={onDeleteSegment}
                onAddTimer={onAddTimer}
                onReorderTimers={onReorderTimers}
                onReorderSegmentTimers={onReorderSegmentTimers}
                onMoveTimerToSegment={onMoveTimerToSegment}
                timerRowProps={timerRowProps}
                groupIdOverride={`__section__${section.id}`}
              />
              {sectionLevelTimers.length === 0 && (
                <DropZone
                  itemType="timer"
                  groupId={`__section__${section.id}`}
                  onDrop={(foreignId, fromGroupId) => {
                    if (onMoveTimerToSegment) {
                      onMoveTimerToSegment(foreignId, fromGroupId, `__section__${section.id}`, 0)
                    }
                  }}
                  label="Drop timer here for section-level item"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RundownPanel — main export
// ---------------------------------------------------------------------------
export const RundownPanel = ({
  timers,
  sections,
  segments,
  activeTimerId,
  isRunning,
  activeTimerDisplay,
  remainingLookup,
  selectedTimerId,
  showSelection,
  onSelect,
  onStart,
  onDeleteTimer,
  onAddTimer,
  onEditTimer,
  onReorderTimers,
  onReorderSegmentTimers,
  onAddSection,
  onEditSection,
  onDeleteSection,
  onReorderSections,
  onAddSegment,
  onEditSegment,
  onDeleteSegment,
  onReorderSegments,
  onMoveSegmentToSection,
  onMoveTimerToSegment,
  onPauseActive,
  onActiveNudge,
  onReset,
  undoPlaceholder,
  onUndoDelete,
  readOnly = false,
}: RundownProps) => {
  // ---- Hold-adjust state (shared across all timer rows) ----
  const holdIntervalRef = useRef<number | null>(null)
  const holdAccumRef = useRef(0)
  const holdStartRef = useRef<number | null>(null)
  const holdTargetRef = useRef<string | null>(null)
  const holdDirectionRef = useRef<-1 | 1>(1)
  const holdingRef = useRef(false)

  const applyDurationDeltaRef = useRef<(timerId: string, deltaMinutes: number) => void>(() => {})
  useEffect(() => {
    applyDurationDeltaRef.current = (timerId: string, deltaMinutes: number) => {
      const timer = timers.find((candidate) => candidate.id === timerId)
      if (!timer) return
      if (timer.id === activeTimerId && isRunning) {
        onActiveNudge(deltaMinutes * 60_000)
        return
      }
      const nextSeconds = Math.max(0, timer.duration + deltaMinutes * 60)
      onEditTimer(timerId, { duration: nextSeconds })
    }
  })

  const stopHoldAdjust = useCallback(() => {
    if (holdIntervalRef.current) {
      window.clearTimeout(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
    holdTargetRef.current = null
    holdAccumRef.current = 0
    holdStartRef.current = null
    holdingRef.current = false
  }, [])

  const startHoldAdjust = useCallback((timerId: string, direction: -1 | 1) => {
    stopHoldAdjust()
    holdingRef.current = true
    holdTargetRef.current = timerId
    holdDirectionRef.current = direction
    holdAccumRef.current = 1
    holdStartRef.current = Date.now()
    applyDurationDeltaRef.current(timerId, direction)
    const tick = () => {
      if (!holdingRef.current || !holdTargetRef.current) return
      const elapsedMs = holdStartRef.current ? Date.now() - holdStartRef.current : 0
      const step = holdAccumRef.current >= 30 || elapsedMs >= 4000 ? 10 : 1
      holdAccumRef.current += step
      applyDurationDeltaRef.current(holdTargetRef.current, holdDirectionRef.current * step)
      const nextDelay = holdAccumRef.current >= 30 ? 140 : 200
      holdIntervalRef.current = window.setTimeout(tick, nextDelay)
    }
    holdIntervalRef.current = window.setTimeout(tick, 250)
  }, [stopHoldAdjust])

  const [editingDuration, setEditingDuration] = useState<{ id: string; value: string } | null>(null)
  const blockedClass = readOnly ? 'cursor-not-allowed' : ''
  const durationInputRef = useRef<HTMLInputElement | null>(null)
  const focusedIdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => stopHoldAdjust()
  }, [stopHoldAdjust])

  useEffect(() => {
    const stop = () => stopHoldAdjust()
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [stopHoldAdjust])

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
          onEditTimer(editingDuration.id, { duration: Math.round(parsed * 60) })
        }
        setEditingDuration(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [editingDuration, onEditTimer])

  // ---- Build hierarchy ----

  // Sorted sections
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  )
  const sectionListRef = useRef<HTMLUListElement | null>(null)
  const sectionItems = useMemo(
    () => sortedSections.map((section) => ({ id: section.id, value: section })),
    [sortedSections],
  )
  const {
    draggingId: draggingSectionId,
    overIndex: overSectionIndex,
    getItemProps: getSectionItemProps,
    getHandleProps: getSectionHandleProps,
  } = useSortableList({
    items: sectionItems,
    containerRef: sectionListRef,
    handleOnly: true,
    onReorder: (fromIndex, toIndex) => {
      const ordered = [...sortedSections]
      const [moved] = ordered.splice(fromIndex, 1)
      const clamped = Math.max(0, Math.min(toIndex, ordered.length))
      ordered.splice(clamped, 0, moved)
      onReorderSections(ordered.map((section) => section.id))
    },
  })

  const displaySections = useMemo(() => {
    if (!draggingSectionId || overSectionIndex === null) return sortedSections
    const current = [...sortedSections]
    const fromIndex = current.findIndex((section) => section.id === draggingSectionId)
    if (fromIndex === -1) return sortedSections
    const [moving] = current.splice(fromIndex, 1)
    const target = Math.max(0, Math.min(current.length, overSectionIndex))
    current.splice(target, 0, moving)
    return current
  }, [draggingSectionId, overSectionIndex, sortedSections])

  // Group segments by sectionId
  const segmentsBySection = useMemo(() => {
    const map: Record<string, Segment[]> = {}
    for (const seg of segments) {
      const key = seg.sectionId ?? '__none__'
      if (!map[key]) map[key] = []
      map[key].push(seg)
    }
    return map
  }, [segments])

  // For each section, collect its timers (timers with direct sectionId, or via segment's sectionId)
  const timersForSection = useMemo(() => {
    const map: Record<string, Timer[]> = {}
    // Build reverse lookup: segmentId → sectionId
    const segToSection: Record<string, string> = {}
    for (const seg of segments) {
      if (seg.sectionId) segToSection[seg.id] = seg.sectionId
    }
    for (const timer of timers) {
      let sectionKey = '__none__'
      // Direct sectionId on timer takes priority (section-level items)
      if (timer.sectionId) {
        sectionKey = timer.sectionId
      } else if (timer.segmentId && segToSection[timer.segmentId]) {
        sectionKey = segToSection[timer.segmentId]
      }
      if (!map[sectionKey]) map[sectionKey] = []
      map[sectionKey].push(timer)
    }
    return map
  }, [timers, segments])

  // Shared props for TimerRow (everything except per-timer state)
  const timerRowProps = useMemo(
    () => ({
      activeTimerId,
      selectedTimerId,
      showSelection,
      activeTimerDisplay,
      remainingLookup,
      isRunning,
      readOnly,
      blockedClass,
      onSelect,
      onStart,
      onDelete: onDeleteTimer,
      onEdit: onEditTimer,
      onPauseActive,
      onActiveNudge,
      onReset,
      editingDuration,
      setEditingDuration,
      durationInputRef,
      startHoldAdjust,
      stopHoldAdjust,
    }),
    [
      activeTimerId,
      selectedTimerId,
      showSelection,
      activeTimerDisplay,
      remainingLookup,
      isRunning,
      readOnly,
      blockedClass,
      onSelect,
      onStart,
      onDeleteTimer,
      onEditTimer,
      onPauseActive,
      onActiveNudge,
      onReset,
      editingDuration,
      startHoldAdjust,
      stopHoldAdjust,
    ],
  )

  const totalTimers = timers.length

  return (
    <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Rundown</h2>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
          {totalTimers} timer{totalTimers !== 1 ? 's' : ''}
        </p>
      </div>

      {totalTimers === 0 && sections.length === 0 && segments.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500">
          No timers yet
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {/* Undo placeholder at top if index 0 */}
          {undoPlaceholder && undoPlaceholder.index === 0 && (
            <div className="flex justify-center px-4 py-3 text-sm text-slate-200">
              <div className="flex items-center gap-3">
                <span>Removed &ldquo;{undoPlaceholder.title}&rdquo;</span>
                {onUndoDelete && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onUndoDelete()
                    }}
                    className={`rounded-full border border-emerald-400/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-200 ${blockedClass}`}
                  >
                    Undo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Render sections */}
          <SortableList ref={sectionListRef} className="space-y-6">
            {displaySections.map((section, index) => {
              const itemProps = getSectionItemProps(section.id, index)
              return (
                <SortableItem
                  key={section.id}
                  {...itemProps}
                  dragging={draggingSectionId === section.id}
                  over={overSectionIndex === index}
                  dataIndex={index}
                >
                  <SectionGroup
                    section={section}
                    segments={segmentsBySection[section.id] ?? []}
                    timers={timersForSection[section.id] ?? []}
                    readOnly={readOnly}
                    blockedClass={blockedClass}
                    dragHandleProps={getSectionHandleProps(section.id, index)}
                    onEditSection={onEditSection}
                    onDeleteSection={onDeleteSection}
                    onAddSegment={onAddSegment}
                    onEditSegment={onEditSegment}
                    onDeleteSegment={onDeleteSegment}
                    onAddTimer={onAddTimer}
                    onReorderSegments={onReorderSegments}
                    onReorderTimers={onReorderTimers}
                    onReorderSegmentTimers={onReorderSegmentTimers}
                    onMoveSegmentToSection={onMoveSegmentToSection}
                    onMoveTimerToSegment={onMoveTimerToSegment}
                    timerRowProps={timerRowProps}
                  />
                </SortableItem>
              )
            })}
          </SortableList>

          {/* NOTE: Unsectioned bucket removed — all items should belong to a section after bootstrapping */}

          {/* Undo placeholder at bottom */}
          {undoPlaceholder && undoPlaceholder.index > 0 && (
            <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-4">
                <span>Removed &ldquo;{undoPlaceholder.title}&rdquo;</span>
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
            </div>
          )}
        </div>
      )}

      {/* Action buttons at the bottom */}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => onAddTimer()}
          aria-disabled={readOnly}
          className={`flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-6 text-sm text-slate-200 transition hover:border-slate-500 ${blockedClass}`}
        >
          <Plus size={16} />
          <span>Add Timer</span>
        </button>
        <button
          type="button"
          onClick={onAddSection}
          aria-disabled={readOnly}
          className={`flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-6 text-sm text-slate-200 transition hover:border-slate-500 ${blockedClass}`}
        >
          <Plus size={16} />
          <span>Add Section</span>
        </button>
      </div>
    </div>
  )
}
