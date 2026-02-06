import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, GripVertical, Plus, RotateCcw, X } from 'lucide-react'
import type { Cue, CueAckState, CueTriggerType, OperatorRole, Section, Segment } from '../../types'
import { EditableField } from '../core/EditableField'
import { SortableItem } from '../sortable/SortableItem'
import { SortableList } from '../sortable/SortableList'
import { getActiveDrag, useSortableList } from '../../hooks/useSortableList'
import {
  buildAckPatch,
  buildEditedByRolePatch,
  canEditCue,
  insertCueId,
  reorderCueIds,
} from '../../utils/cue-utils'

const ROLE_OPTIONS: Array<{ value: OperatorRole; label: string }> = [
  { value: 'lx', label: 'LX' },
  { value: 'ax', label: 'AX' },
  { value: 'vx', label: 'VX' },
  { value: 'sm', label: 'SM' },
  { value: 'foh', label: 'FOH' },
  { value: 'custom', label: 'Custom' },
]

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
      {over ? 'Drop here' : label}
    </div>
  )
}

const TRIGGER_OPTIONS: Array<{ value: CueTriggerType; label: string }> = [
  { value: 'timed', label: 'Timed' },
  { value: 'fixed_time', label: 'Fixed time' },
  { value: 'sequential', label: 'Sequential' },
  { value: 'follow', label: 'Follow' },
  { value: 'floating', label: 'Floating' },
]

const TIME_BASE_OPTIONS = [
  { value: 'actual', label: 'Actual' },
  { value: 'planned', label: 'Planned' },
] as const

type CueGroupMeta = {
  groupId: string
  label: string
  sectionId: string | null
  segmentId: string | null
  cues: Cue[]
}

type CuesPanelProps = {
  roomId: string
  cues: Cue[]
  sections: Section[]
  segments: Segment[]
  readOnly: boolean
  isOwner: boolean
  currentUserId: string | null
  onCreateCue: (input: {
    title: string
    role: OperatorRole
    triggerType: CueTriggerType
    sectionId?: string
    segmentId?: string
    order?: number
    offsetMs?: number
    timeBase?: 'actual' | 'planned'
    targetTimeMs?: number
    afterCueId?: string
    approximatePosition?: number
    triggerNote?: string
    notes?: string
    createdByRole?: OperatorRole
  }) => void
  onUpdateCue: (
    cueId: string,
    patch: Partial<Omit<Cue, 'id' | 'roomId' | 'createdBy' | 'createdAt'>>,
  ) => void
  onDeleteCue: (cueId: string) => void
  onReorderCues: (cueIds: string[]) => void
}

const formatTimeInput = (ms?: number) => {
  if (!ms && ms !== 0) return ''
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const parseTimeInput = (value: string) => {
  if (!value) return null
  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return (hours * 60 + minutes) * 60_000
}

const getSortValue = (cue: Cue) => cue.order ?? cue.createdAt ?? 0

const computeInsertOrder = (sorted: Cue[], movingId: string, targetIndex: number) => {
  const list = sorted.filter((cue) => cue.id !== movingId)
  const clamped = Math.max(0, Math.min(targetIndex, list.length))
  const before = list[clamped - 1]
  const after = list[clamped]
  if (!before && !after) return 10
  if (!before && after) return getSortValue(after) - 10
  if (before && !after) return getSortValue(before) + 10
  const beforeValue = getSortValue(before as Cue)
  const afterValue = getSortValue(after as Cue)
  if (Number.isFinite(beforeValue) && Number.isFinite(afterValue)) {
    return (beforeValue + afterValue) / 2
  }
  return Date.now()
}

export const CuesPanel = ({
  roomId,
  cues,
  sections,
  segments,
  readOnly,
  isOwner,
  currentUserId,
  onCreateCue,
  onUpdateCue,
  onDeleteCue,
  onReorderCues,
}: CuesPanelProps) => {
  const [activeRole, setActiveRole] = useState<OperatorRole | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = `ontime:cueRole:${roomId}:${currentUserId ?? 'guest'}`
    const stored = window.localStorage.getItem(key)
    const nextRole = ROLE_OPTIONS.find((option) => option.value === stored)?.value ?? null
    setActiveRole(nextRole)
  }, [roomId, currentUserId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = `ontime:cueRole:${roomId}:${currentUserId ?? 'guest'}`
    if (activeRole) {
      window.localStorage.setItem(key, activeRole)
    } else {
      window.localStorage.removeItem(key)
    }
  }, [activeRole, currentUserId, roomId])

  const sortedSections = useMemo(() => {
    return [...sections].sort((a, b) => a.order - b.order)
  }, [sections])

  const sortedSegments = useMemo(() => {
    return [...segments].sort((a, b) => a.order - b.order)
  }, [segments])

  const sortedCues = useMemo(() => {
    return [...cues].sort((a, b) => getSortValue(a) - getSortValue(b))
  }, [cues])

  const sectionGroups = useMemo(() => {
    return sortedSections.map((section) => ({
      id: section.id,
      title: section.title,
      sectionId: section.id,
    }))
  }, [sortedSections])

  const cuesBySegment = useMemo(() => {
    const map = new Map<string, Cue[]>()
    cues.forEach((cue) => {
      if (!cue.segmentId) return
      const list = map.get(cue.segmentId) ?? []
      list.push(cue)
      map.set(cue.segmentId, list)
    })
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => getSortValue(a) - getSortValue(b)))
    })
    return map
  }, [cues])

  const cuesBySectionLevel = useMemo(() => {
    const map = new Map<string, Cue[]>()
    cues.forEach((cue) => {
      if (cue.segmentId) return
      if (!cue.sectionId) return
      const list = map.get(cue.sectionId) ?? []
      list.push(cue)
      map.set(cue.sectionId, list)
    })
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => getSortValue(a) - getSortValue(b)))
    })
    return map
  }, [cues])

  const groupMeta = useMemo(() => {
    const meta = new Map<string, CueGroupMeta>()
    sectionGroups.forEach((section) => {
      const sectionGroupId = `section:${section.id}`
      meta.set(sectionGroupId, {
        groupId: sectionGroupId,
        label: section.title,
        sectionId: section.sectionId,
        segmentId: null,
        cues: cuesBySectionLevel.get(section.id) ?? [],
      })
    })
    sortedSegments.forEach((segment) => {
      const segmentGroupId = `segment:${segment.id}`
      meta.set(segmentGroupId, {
        groupId: segmentGroupId,
        label: segment.title,
        sectionId: segment.sectionId ?? null,
        segmentId: segment.id,
        cues: cuesBySegment.get(segment.id) ?? [],
      })
    })
    return meta
  }, [cuesBySectionLevel, cuesBySegment, sectionGroups, sortedSegments])

  const canCreate = !readOnly && (isOwner || Boolean(activeRole))
  // TODO(phase-3f): Replace local role selector with operator membership role.

  const applyCuePatch = useCallback(
    (cueId: string, patch: Record<string, unknown>, allowEdit: boolean) => {
      if (readOnly || !allowEdit) return
      const withRole = {
        ...patch,
        ...buildEditedByRolePatch(activeRole),
      }
      onUpdateCue(
        cueId,
        withRole as Partial<Omit<Cue, 'id' | 'roomId' | 'createdBy' | 'createdAt'>>,
      )
    },
    [activeRole, onUpdateCue, readOnly],
  )

  const handleCreateCue = useCallback(
    (sectionId: string | null, segmentId: string | null) => {
      if (!canCreate) return
      onCreateCue({
        title: 'New Cue',
        role: activeRole ?? 'lx',
        triggerType: 'timed',
        sectionId: sectionId ?? undefined,
        segmentId: segmentId ?? undefined,
        createdByRole: activeRole ?? undefined,
      })
    },
    [activeRole, canCreate, onCreateCue],
  )

  const handleReorder = useCallback(
    (groupId: string, fromIndex: number, toIndex: number) => {
      const meta = groupMeta.get(groupId)
      if (!meta || meta.cues.length === 0) return
      if (!isOwner) {
        const movingCue = meta.cues[fromIndex]
        if (!movingCue) return
        const canEdit = canEditCue({ isOwner, activeRole, cueRole: movingCue.role })
        if (!canEdit) return
        const nextOrder = computeInsertOrder(meta.cues, movingCue.id, toIndex)
        applyCuePatch(movingCue.id, { order: nextOrder }, canEdit)
        return
      }
      const nextIds = reorderCueIds(meta.cues, fromIndex, toIndex)
      onReorderCues(nextIds)
    },
    [activeRole, applyCuePatch, groupMeta, isOwner, onReorderCues],
  )

  const handleForeignDrop = useCallback(
    (groupId: string, cueId: string, fromGroupId: string, targetIndex: number) => {
      const target = groupMeta.get(groupId)
      if (!target) return
      const cue = cues.find((entry) => entry.id === cueId)
      if (!cue) return
      const canEdit = canEditCue({ isOwner, activeRole, cueRole: cue.role })
      if (readOnly || !canEdit) return

      if (!isOwner) {
        const nextOrder = computeInsertOrder(target.cues, cueId, targetIndex)
        applyCuePatch(
          cueId,
          {
            sectionId: target.sectionId,
            segmentId: target.segmentId,
            order: nextOrder,
          },
          canEdit,
        )
        return
      }

      applyCuePatch(
        cueId,
        {
          sectionId: target.sectionId,
          segmentId: target.segmentId,
        },
        canEdit,
      )

      const targetIds = insertCueId(
        target.cues.map((entry) => entry.id),
        cueId,
        targetIndex,
      )
      onReorderCues(targetIds)

      const source = groupMeta.get(fromGroupId)
      if (source && source.groupId !== target.groupId) {
        const sourceIds = source.cues.map((entry) => entry.id).filter((id) => id !== cueId)
        if (sourceIds.length > 0) {
          onReorderCues(sourceIds)
        }
      }
    },
    [activeRole, applyCuePatch, cues, groupMeta, isOwner, onReorderCues, readOnly],
  )

  const CueList = ({ meta }: { meta: CueGroupMeta }) => {
    const listRef = useRef<HTMLUListElement | null>(null)
    const { items, draggingId, overIndex, getItemProps, getHandleProps } = useSortableList({
      items: meta.cues.map((entry) => ({ id: entry.id, value: entry })),
      onReorder: (from, to) => handleReorder(meta.groupId, from, to),
      groupId: meta.groupId,
      itemType: 'cue',
      handleOnly: true,
      onForeignDrop: (foreignId, fromGroup, targetIndex) =>
        handleForeignDrop(meta.groupId, foreignId, fromGroup, targetIndex),
      containerRef: listRef,
    })

    return (
      <SortableList ref={listRef} className="mt-2 space-y-2">
        {items.length > 0 ? (
          items.map((item, index) => {
            const cue = item.value
            const ackState: CueAckState = cue.ackState ?? 'pending'
            const isFrozen = ackState !== 'pending'
            const baseEdit = !readOnly && canEditCue({ isOwner, activeRole, cueRole: cue.role })
            const allowEdit = baseEdit && (!isFrozen || isOwner)
            const ackTone =
              ackState === 'done'
                ? 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10'
                : ackState === 'skipped'
                  ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
                  : 'border-slate-700 text-slate-300 bg-slate-950/70'

            const dragProps = getItemProps(cue.id, index)
            const handleProps = allowEdit
              ? getHandleProps(cue.id, index)
              : ({ tabIndex: -1, role: 'button', 'aria-grabbed': false } as const)
            const isDragging = draggingId === cue.id
            const isOver = overIndex === index && draggingId !== cue.id

            const renderCueFields = () => {
              if (cue.triggerType === 'timed') {
                return (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <label className="text-xs text-slate-400">
                      Offset (sec)
                      <EditableField
                        value={cue.offsetMs !== undefined ? String(Math.round(cue.offsetMs / 1000)) : ''}
                        type="number"
                        disabled={!allowEdit}
                        className="mt-1 rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-sm text-white"
                        inputClassName="bg-transparent"
                        onSave={(value) => {
                          const trimmed = value.trim()
                          if (!trimmed) {
                            applyCuePatch(cue.id, { offsetMs: null }, allowEdit)
                            return
                          }
                          const next = Number(trimmed)
                          if (!Number.isFinite(next)) return
                          applyCuePatch(cue.id, { offsetMs: Math.round(next) * 1000 }, allowEdit)
                        }}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Time base
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-sm text-white"
                        value={cue.timeBase ?? 'actual'}
                        disabled={!allowEdit}
                        onChange={(event) =>
                          applyCuePatch(cue.id, { timeBase: event.target.value }, allowEdit)
                        }
                      >
                        {TIME_BASE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )
              }

              if (cue.triggerType === 'fixed_time') {
                return (
                  <label className="mt-2 block text-xs text-slate-400">
                    Target time (HH:MM)
                    <input
                      type="time"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-sm text-white"
                      value={formatTimeInput(cue.targetTimeMs)}
                      disabled={!allowEdit}
                      onChange={(event) => {
                        const next = parseTimeInput(event.target.value)
                        if (next === null) {
                          applyCuePatch(cue.id, { targetTimeMs: null }, allowEdit)
                          return
                        }
                        applyCuePatch(cue.id, { targetTimeMs: next }, allowEdit)
                      }}
                    />
                  </label>
                )
              }

              if (cue.triggerType === 'follow') {
                return (
                  <label className="mt-2 block text-xs text-slate-400">
                    After cue
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-sm text-white"
                      value={cue.afterCueId ?? ''}
                      disabled={!allowEdit}
                      onChange={(event) => {
                        const next = event.target.value
                        applyCuePatch(cue.id, { afterCueId: next ? next : null }, allowEdit)
                      }}
                    >
                      <option value="">Select cue</option>
                      {sortedCues
                        .filter((entry) => entry.id !== cue.id)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title || 'Untitled cue'}
                          </option>
                        ))}
                    </select>
                  </label>
                )
              }

              if (cue.triggerType === 'floating') {
                return (
                  <label className="mt-2 block text-xs text-slate-400">
                    Approximate position ({cue.approximatePosition ?? 50}%)
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      className="mt-2 w-full"
                      value={cue.approximatePosition ?? 50}
                      disabled={!allowEdit}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (!Number.isFinite(next)) return
                        applyCuePatch(cue.id, { approximatePosition: next }, allowEdit)
                      }}
                    />
                  </label>
                )
              }

              return null
            }

            return (
              <SortableItem
                key={cue.id}
                dragging={isDragging}
                over={isOver}
                className="rounded-xl border border-slate-900 bg-slate-950/60 p-3"
                {...dragProps}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <button
                      type="button"
                      className={`rounded-lg border border-slate-800 p-1 text-slate-400 transition ${
                        allowEdit ? 'hover:border-white/60' : 'cursor-not-allowed opacity-40'
                      }`}
                      {...handleProps}
                    >
                      <GripVertical size={14} />
                    </button>
                    <EditableField
                      value={cue.title}
                      disabled={!allowEdit}
                      className="text-sm font-semibold text-white"
                      inputClassName="bg-transparent"
                      onSave={(value) => {
                        const trimmed = value.trim()
                        if (!trimmed) return
                        applyCuePatch(cue.id, { title: trimmed }, allowEdit)
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ackTone}`}>
                      {ackState.toUpperCase()}
                    </span>
                    <select
                      className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
                      value={cue.role}
                      disabled={!allowEdit}
                      onChange={(event) =>
                        applyCuePatch(cue.id, { role: event.target.value }, allowEdit)
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-full border border-slate-800 bg-slate-950/80 px-3 py-1 text-xs font-semibold text-slate-200"
                    value={cue.triggerType}
                    disabled={!allowEdit}
                    onChange={(event) =>
                      applyCuePatch(cue.id, { triggerType: event.target.value }, allowEdit)
                    }
                  >
                    {TRIGGER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        allowEdit
                          ? 'border-emerald-500/70 text-emerald-200 hover:border-emerald-200'
                          : 'border-slate-800 text-slate-500'
                      }`}
                      onClick={() => {
                        const patch = buildAckPatch('done', currentUserId)
                        applyCuePatch(cue.id, patch, allowEdit)
                      }}
                      disabled={!allowEdit}
                    >
                      <span className="flex items-center gap-1">
                        <Check size={12} /> Done
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        allowEdit
                          ? 'border-amber-500/70 text-amber-200 hover:border-amber-200'
                          : 'border-slate-800 text-slate-500'
                      }`}
                      onClick={() => {
                        const patch = buildAckPatch('skipped', currentUserId)
                        applyCuePatch(cue.id, patch, allowEdit)
                      }}
                      disabled={!allowEdit}
                    >
                      <span className="flex items-center gap-1">
                        <X size={12} /> Skip
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        allowEdit
                          ? 'border-slate-600 text-slate-200 hover:border-white/60'
                          : 'border-slate-800 text-slate-500'
                      }`}
                      onClick={() => {
                        const patch = buildAckPatch('pending', currentUserId)
                        applyCuePatch(cue.id, patch, allowEdit)
                      }}
                      disabled={!allowEdit}
                    >
                      <span className="flex items-center gap-1">
                        <RotateCcw size={12} /> Reset
                      </span>
                    </button>
                  </div>
                </div>

                {renderCueFields()}

                <label className="mt-2 block text-xs text-slate-400">
                  Notes
                  <EditableField
                    value={cue.notes ?? ''}
                    disabled={!allowEdit}
                    className="mt-1 text-sm text-slate-200"
                    inputClassName="bg-transparent"
                    onSave={(value) => {
                      const trimmed = value.trim()
                      applyCuePatch(cue.id, { notes: trimmed ? trimmed : null }, allowEdit)
                    }}
                  />
                </label>

                <label className="mt-2 block text-xs text-slate-400">
                  Trigger note
                  <EditableField
                    value={cue.triggerNote ?? ''}
                    disabled={!allowEdit}
                    className="mt-1 text-sm text-slate-200"
                    inputClassName="bg-transparent"
                    onSave={(value) => {
                      const trimmed = value.trim()
                      applyCuePatch(cue.id, { triggerNote: trimmed ? trimmed : null }, allowEdit)
                    }}
                  />
                </label>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Created by {cue.createdByRole?.toUpperCase() ?? 'Owner'}.</span>
                  <button
                    type="button"
                    className={`text-rose-300 ${allowEdit ? 'hover:text-rose-100' : 'opacity-50'}`}
                    onClick={() => {
                      if (!allowEdit) return
                      onDeleteCue(cue.id)
                    }}
                    disabled={!allowEdit}
                  >
                    Delete
                  </button>
                </div>
              </SortableItem>
            )
          })
        ) : (
          <li className="space-y-2">
            <DropZone
              itemType="cue"
              groupId={meta.groupId}
              label="Drop cue here"
              onDrop={(foreignId, fromGroupId) =>
                handleForeignDrop(meta.groupId, foreignId, fromGroupId, 0)
              }
            />
          </li>
        )}
      </SortableList>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Show Cues</h2>
          <p className="text-xs text-slate-400">Manage cues per section and segment.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span>Editing as</span>
          <select
            className="rounded-full border border-slate-800 bg-slate-950/80 px-3 py-1 text-xs font-semibold text-slate-200"
            value={activeRole ?? ''}
            onChange={(event) => {
              const next = ROLE_OPTIONS.find((option) => option.value === event.target.value)?.value ?? null
              setActiveRole(next)
            }}
          >
            <option value="">Select role</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {!isOwner && !activeRole ? (
            <span className="text-[11px] text-amber-200">Select your role to edit cues.</span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {sectionGroups.map((section) => {
          const sectionKey = section.id
          const sectionMeta = groupMeta.get(`section:${sectionKey}`)
          const sectionSegments = sortedSegments.filter((segment) => {
            const segmentSectionId = segment.sectionId ?? null
            return segmentSectionId === section.sectionId
          })
          return (
            <div key={section.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-100">
                  {section.title || 'Untitled section'}
                </div>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    canCreate
                      ? 'border-slate-600 text-slate-200 hover:border-white/70'
                      : 'border-slate-800 text-slate-500'
                  }`}
                  onClick={() => handleCreateCue(section.sectionId, null)}
                  disabled={!canCreate}
                >
                  <span className="flex items-center gap-1">
                    <Plus size={12} /> Add section cue
                  </span>
                </button>
              </div>
              {sectionMeta ? <CueList meta={sectionMeta} /> : null}

              <div className="mt-4 space-y-3">
                {sectionSegments.map((segment) => {
                  const segmentMeta = groupMeta.get(`segment:${segment.id}`)
                  if (!segmentMeta) return null
                  return (
                    <div key={segment.id} className="rounded-xl border border-slate-900 bg-slate-950/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-100">
                          {segment.title || 'Untitled segment'}
                        </div>
                        <button
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                            canCreate
                              ? 'border-slate-600 text-slate-200 hover:border-white/70'
                              : 'border-slate-800 text-slate-500'
                          }`}
                          onClick={() => handleCreateCue(section.sectionId, segment.id)}
                          disabled={!canCreate}
                        >
                          <span className="flex items-center gap-1">
                            <Plus size={12} /> Add cue
                          </span>
                        </button>
                      </div>
                      <CueList meta={segmentMeta} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
