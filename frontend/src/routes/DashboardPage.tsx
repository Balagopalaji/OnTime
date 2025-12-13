import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock, Globe, Plus, QrCode, Redo2, Share2, Trash2, Undo2, X } from 'lucide-react'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { SortableItem } from '../components/sortable/SortableItem'
import { SortableList } from '../components/sortable/SortableList'
import { Tooltip } from '../components/core/Tooltip'
import { useAuth } from '../context/AuthContext'
import { useDataContext } from '../context/DataProvider'
import { db } from '../lib/firebase'
import { getTimezoneSuggestion } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'

const DEBUG_SORTABLE = false

type DraftState = {
  title: string
  timezone: string
  editingTitle: boolean
  editingTz: boolean
}

type PlaceholderEntry = {
  roomId: string
  title: string
  expiresAt: number
  createdAt: number
  order?: number
}

export const DashboardPage = () => {
  const { user } = useAuth()
  const {
    rooms,
    createRoom,
    deleteRoom,
    updateRoomMeta,
    getTimers,
    pendingRooms,
    pendingRoomPlaceholders,
    undoRoomDelete,
    redoRoomDelete,
    reorderRoom,
    migrateRoomToV2,
    rollbackRoomMigration,
  } = useDataContext()
  const localTimezone = getTimezoneSuggestion()
  const allTimezones = useMemo(() => getAllTimezones(), [])
  const [isCreating, setIsCreating] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [now, setNow] = useState(() => Date.now())
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title' | 'custom'>(() => {
    if (typeof window === 'undefined') return 'newest'
    const saved = window.localStorage.getItem('stagetime.sort')
    return saved === 'oldest' || saved === 'title' || saved === 'custom' ? saved : 'newest'
  })
  const titleRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const tzRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [qrOpenId, setQrOpenId] = useState<string | null>(null)
  const [qrErrorId, setQrErrorId] = useState<string | null>(null)
  const [qrModalId, setQrModalId] = useState<string | null>(null)
  const qrButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [qrAnchors, setQrAnchors] = useState<Record<string, DOMRect | null>>({})
  const [placeholderNow, setPlaceholderNow] = useState(() => Date.now())
  const [dismissedPlaceholders, setDismissedPlaceholders] = useState<Set<string>>(new Set())
  const isCustomSort = sortBy === 'custom'
  const [columnCount, setColumnCount] = useState<1 | 2 | 3 | 4>(() => {
    if (typeof window === 'undefined') return 2
    const saved = window.localStorage.getItem('stagetime.columns')
    if (saved === '1' || saved === '2' || saved === '3' || saved === '4') return Number(saved) as 1 | 2 | 3 | 4
    return 2
  })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null)
  const [migrationState, setMigrationState] = useState<
    Record<string, { status: 'idle' | 'migrating' | 'complete' | 'failed'; error?: string }>
  >({})
  const [recentlyMigrated, setRecentlyMigrated] = useState<Set<string>>(new Set())
  const [rollbackAvailable, setRollbackAvailable] = useState<Record<string, boolean>>({})
  const dragFromIndexRef = useRef<number | null>(null)
  const overIndexRef = useRef<number | null>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const dragRectsRef = useRef<Array<{ id: string; index: number; centerX: number; centerY: number }>>([])
  const dropFlashTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQrOpenId(null)
        setQrModalId(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  useEffect(() => {
    return () => {
      if (dropFlashTimeoutRef.current) {
        window.clearTimeout(dropFlashTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stagetime.columns', String(columnCount))
    }
  }, [columnCount])

  const orderKey = useCallback(
    (item: { order?: number; createdAt: number }) => item.order ?? item.createdAt,
    [],
  )

  const ownedRooms = useMemo(() => {
    if (!user) return []
    return rooms.filter((room) => room.ownerId === user.uid && !pendingRooms.has(room.id))
  }, [pendingRooms, rooms, user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const v2OwnedRooms = ownedRooms.filter((room) => (room._version ?? 1) === 2)

    void Promise.all(
      v2OwnedRooms.map(async (room) => {
        try {
          const snap = await getDocs(query(collection(db, 'rooms', room.id, 'migrationBackups'), limit(1)))
          return [room.id, !snap.empty] as const
        } catch {
          return [room.id, false] as const
        }
      }),
    ).then((pairs) => {
      if (cancelled) return
      setRollbackAvailable((prev) => {
        const next: Record<string, boolean> = {}
        pairs.forEach(([roomId, exists]) => {
          next[roomId] = exists
        })
        Object.entries(prev).forEach(([roomId, exists]) => {
          if (!(roomId in next)) next[roomId] = exists
        })
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [ownedRooms, user])

  const compareCards = useMemo(
    () => (a: { title: string; createdAt: number; order?: number }, b: { title: string; createdAt: number; order?: number }) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      if (sortBy === 'oldest') return a.createdAt - b.createdAt
      if (sortBy === 'custom') return orderKey(a) - orderKey(b)
      return b.createdAt - a.createdAt
    },
    [orderKey, sortBy],
  )

  const sortedRooms = useMemo(() => {
    const next = [...ownedRooms]
    next.sort(compareCards)
    return next
  }, [compareCards, ownedRooms])

  const visiblePlaceholders = useMemo(() => {
    return pendingRoomPlaceholders
      .filter((entry) => entry.expiresAt > placeholderNow)
      .filter((entry) => !dismissedPlaceholders.has(entry.roomId))
  }, [dismissedPlaceholders, pendingRoomPlaceholders, placeholderNow])

  const sortedPlaceholders = useMemo(
    () => [...visiblePlaceholders].sort(compareCards),
    [compareCards, visiblePlaceholders],
  )

  const renderEntries = useMemo(
    () =>
      [...sortedRooms, ...sortedPlaceholders]
        .map((entry) =>
          'id' in entry && 'ownerId' in entry
            ? { kind: 'room' as const, id: entry.id, order: orderKey(entry), room: entry }
            : {
                kind: 'placeholder' as const,
                id: `placeholder-${(entry as PlaceholderEntry).roomId}`,
                order: orderKey(entry as PlaceholderEntry),
                placeholder: entry as PlaceholderEntry,
              },
        )
        .sort((a, b) => a.order - b.order),
    [orderKey, sortedPlaceholders, sortedRooms],
  )

  const displayEntries = useMemo(() => {
    if (!draggingId || overIndex === null) return renderEntries
    const current = [...renderEntries]
    const fromIndex = current.findIndex((entry) => entry.id === draggingId)
    if (fromIndex === -1) return renderEntries
    const [moving] = current.splice(fromIndex, 1)
    const target = Math.max(0, Math.min(current.length, overIndex))
    current.splice(target, 0, moving)
    return current
  }, [draggingId, overIndex, renderEntries])

  useEffect(() => {
    const validKeys = new Set(renderEntries.map((entry) => entry.id))
    Object.keys(itemRefs.current).forEach((key) => {
      if (!validKeys.has(key)) {
        delete itemRefs.current[key]
      }
    })
  }, [renderEntries])

  const resolveTargetIndex = useCallback((clientX: number, clientY: number) => {
    const rects = dragRectsRef.current
    if (!rects.length) return null
    let best = rects[0]
    let bestDist =
      (best.centerX - clientX) * (best.centerX - clientX) + (best.centerY - clientY) * (best.centerY - clientY)
    rects.slice(1).forEach((r) => {
      const dist = (r.centerX - clientX) * (r.centerX - clientX) + (r.centerY - clientY) * (r.centerY - clientY)
      if (dist < bestDist) {
        best = r
        bestDist = dist
      }
    })
    return best.index
  }, [])

  const pointerMoveHandler = useRef<((event: PointerEvent) => void) | null>(null)
  const pointerUpHandler = useRef<((event: PointerEvent) => void) | null>(null)

  const endDrag = useCallback(() => {
    window.setTimeout(() => {
      setDraggingId(null)
      setOverIndex(null)
      dragFromIndexRef.current = null
      overIndexRef.current = null
      dragRectsRef.current = []
      if (pointerMoveHandler.current) {
        document.removeEventListener('pointermove', pointerMoveHandler.current)
      }
      if (pointerUpHandler.current) {
        document.removeEventListener('pointerup', pointerUpHandler.current)
      }
      pointerMoveHandler.current = null
      pointerUpHandler.current = null
    }, 48)
  }, [])

  const startPointerDrag = useCallback(
    (id: string, listIndex: number, event: React.PointerEvent) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRectsRef.current = renderEntries
        .map((entry, idx) => {
          const el = itemRefs.current[entry.id]
          const rect = el?.getBoundingClientRect()
          return rect
            ? {
                id: entry.id,
                index: idx,
                centerX: rect.left + rect.width / 2,
                centerY: rect.top + rect.height / 2,
              }
            : null
        })
        .filter((entry): entry is { id: string; index: number; centerX: number; centerY: number } => entry !== null)
      dragFromIndexRef.current = listIndex
      overIndexRef.current = listIndex
      setDraggingId(id)
      setOverIndex(listIndex)
      pointerMoveHandler.current = (nativeEvent: PointerEvent) => {
        const target = resolveTargetIndex(nativeEvent.clientX, nativeEvent.clientY)
        if (target !== null) {
          setOverIndex(target)
          overIndexRef.current = target
        }
      }
      pointerUpHandler.current = () => {
        const fromIndex = dragFromIndexRef.current
        const toIndex = overIndexRef.current ?? listIndex
        const movingEntry = fromIndex != null ? renderEntries[fromIndex] : null
        if (
          isCustomSort &&
          reorderRoom &&
          movingEntry &&
          movingEntry.kind === 'room' &&
          fromIndex != null &&
          toIndex != null &&
          fromIndex !== toIndex
        ) {
          const working = [...renderEntries]
          const [moved] = working.splice(fromIndex, 1)
          working.splice(toIndex, 0, moved)
          const roomOrder = working.filter((entry) => entry.kind === 'room').map((entry) => entry.id)
          const targetRoomIndex = roomOrder.indexOf(movingEntry.id)
          if (targetRoomIndex >= 0) {
            if (dropFlashTimeoutRef.current) {
              window.clearTimeout(dropFlashTimeoutRef.current)
            }
            setJustDroppedId(movingEntry.id)
            dropFlashTimeoutRef.current = window.setTimeout(() => setJustDroppedId(null), 200)
            void reorderRoom(movingEntry.id, targetRoomIndex)
          }
        }
        endDrag()
      }
      document.addEventListener('pointermove', pointerMoveHandler.current)
      document.addEventListener('pointerup', pointerUpHandler.current)
    },
    [endDrag, isCustomSort, renderEntries, reorderRoom, resolveTargetIndex],
  )

  const renderPlaceholderItem = (placeholder: PlaceholderEntry, listIndex: number) => {
    return (
      <SortableItem
        key={`placeholder-${placeholder.roomId}`}
        ref={(node) => {
          itemRefs.current[`placeholder-${placeholder.roomId}`] = node
        }}
        over={draggingId !== null && overIndex === listIndex}
        className="relative flex items-center justify-center rounded-3xl border border-dashed border-slate-800/70 bg-slate-950/50 p-6 text-center text-sm text-slate-200"
        data-sort-index={listIndex}
        draggable={false}
      >
        {DEBUG_SORTABLE && (
          <span className="absolute left-2 top-2 rounded bg-slate-800 px-2 py-1 text-[10px] font-semibold text-emerald-200">
            {listIndex + 1}
          </span>
        )}
        <div className="flex flex-col items-center gap-2">
          <span className="font-semibold text-slate-100">Removed “{placeholder.title}”</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-full border border-emerald-400/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-200"
              onClick={() => void undoRoomDelete()}
            >
              Undo
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-slate-500 transition hover:text-slate-200"
              onClick={() =>
                setDismissedPlaceholders((prev) => {
                  const next = new Set(prev)
                  next.add(placeholder.roomId)
                  return next
                })
              }
            >
              ×
            </button>
          </div>
        </div>
      </SortableItem>
    )
  }

  const renderRoomCard = (
    room: (typeof sortedRooms)[number],
    listIndex: number,
    enableSort: boolean,
  ) => {
    const isLegacyRoom = (room._version ?? 1) !== 2
    const migration = migrationState[room.id] ?? { status: 'idle' as const }
    const canMigrate = Boolean(migrateRoomToV2) && user?.uid === room.ownerId
    const hasRollbackBackup = recentlyMigrated.has(room.id) || rollbackAvailable[room.id] === true
    const canRollback = Boolean(rollbackRoomMigration) && user?.uid === room.ownerId && !isLegacyRoom && hasRollbackBackup
    const isMigrating = migration.status === 'migrating'
    const cardDragProps =
      enableSort && isCustomSort
        ? {
            onPointerDown: (event: React.PointerEvent) => {
              const target = event.target as HTMLElement
              const blocker = target.closest(
                'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]',
              )
              if (blocker && blocker !== event.currentTarget) {
                return
              }
              startPointerDrag(room.id, listIndex, event)
            },
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === ' ' || event.key.toLowerCase() === 'enter') {
                const target = event.target as HTMLElement
                const blocker = target.closest(
                  'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]',
                )
                if (blocker && blocker !== event.currentTarget) {
                  return
                }
                event.preventDefault()
                startPointerDrag(room.id, listIndex, event as unknown as React.PointerEvent)
              }
            },
            tabIndex: 0,
            role: 'button' as const,
            'aria-grabbed': draggingId === room.id,
          }
        : {}
    return (
      <SortableItem
        key={room.id}
        ref={(node) => {
          itemRefs.current[room.id] = node
        }}
        dragging={enableSort && draggingId === room.id}
        over={enableSort && overIndex === listIndex}
        dataIndex={listIndex}
        draggable={false}
        className={`group relative flex flex-col overflow-visible rounded-3xl border border-slate-800/90 bg-slate-950/80 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] ${
          enableSort ? 'cursor-grab select-none transition-transform duration-150' : ''
        }`}
        {...cardDragProps}
        style={
          justDroppedId === room.id
            ? { transform: 'scale(0.99)', boxShadow: '0 0 0 4px rgba(56,189,248,0.35)' }
            : undefined
        }
      >
        {DEBUG_SORTABLE && (
          <span className="absolute left-2 top-2 rounded bg-slate-800 px-2 py-1 text-[10px] font-semibold text-emerald-200">
            {listIndex + 1}
          </span>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Room</p>
          </div>
          <div className="flex items-start gap-2">
            <Tooltip content="Delete room">
              <button
                type="button"
                onClick={() => handleDeleteRoom(room.id)}
                className="rounded-full border border-transparent p-2 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                aria-label="Delete room"
              >
                <Trash2 size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {isLegacyRoom ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Legacy room</p>
                <p className="mt-1 text-sm text-slate-200">
                  Upgrade to v2 to use the modular room/state model. This keeps legacy fields for compatibility.
                </p>
                {migration.status === 'failed' ? (
                  <p className="mt-2 text-xs text-rose-200">Upgrade failed: {migration.error ?? 'unknown error'}</p>
                ) : null}
                {migration.status === 'complete' ? (
                  <p className="mt-2 text-xs text-emerald-200">Upgraded to v2.</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-amber-400/60 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-50"
                  disabled={!canMigrate || isMigrating}
                  onClick={() => {
                    if (!migrateRoomToV2) return
                    setMigrationState((prev) => ({ ...prev, [room.id]: { status: 'migrating' } }))
                    void migrateRoomToV2(room.id)
                      .then(() => {
                        setMigrationState((prev) => ({ ...prev, [room.id]: { status: 'complete' } }))
                        setRecentlyMigrated((prev) => {
                          const next = new Set(prev)
                          next.add(room.id)
                          return next
                        })
                      })
                      .catch((error) => {
                        setMigrationState((prev) => ({
                          ...prev,
                          [room.id]: { status: 'failed', error: error instanceof Error ? error.message : String(error) },
                        }))
                      })
                  }}
                >
                  {isMigrating ? 'Upgrading…' : 'Upgrade to v2'}
                </button>
              </div>
            </div>
          </div>
        ) : canRollback ? (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-200">Rollback available</p>
                <p className="mt-1 text-sm text-slate-300">
                  You can rollback this upgrade within 30 days.
                </p>
                {migration.status === 'failed' ? (
                  <p className="mt-2 text-xs text-rose-200">Rollback failed: {migration.error ?? 'unknown error'}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
                disabled={isMigrating}
                onClick={() => {
                  if (!rollbackRoomMigration) return
                  setMigrationState((prev) => ({ ...prev, [room.id]: { status: 'migrating' } }))
                  void rollbackRoomMigration(room.id)
                    .then(() => {
                      setMigrationState((prev) => ({ ...prev, [room.id]: { status: 'complete' } }))
                      setRecentlyMigrated((prev) => {
                        const next = new Set(prev)
                        next.delete(room.id)
                        return next
                      })
                    })
                    .catch((error) => {
                      setMigrationState((prev) => ({
                        ...prev,
                        [room.id]: { status: 'failed', error: error instanceof Error ? error.message : String(error) },
                      }))
                    })
                }}
              >
                Rollback
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          {drafts[room.id]?.editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                className="w-full min-w-[180px] rounded-xl border border-emerald-500/40 bg-slate-900 px-3 py-2 text-base font-semibold text-white focus:border-emerald-400 focus:outline-none"
                name={`room-title-${room.id}`}
                ref={(node) => {
                  titleRefs.current[room.id] = node
                }}
                value={drafts[room.id]?.title ?? ''}
                onChange={(event) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [room.id]: { ...prev[room.id], title: event.target.value },
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitTitle(room.id)
                  }
                  if (event.key === 'Escape') {
                    setDrafts((prev) => ({
                      ...prev,
                      [room.id]: {
                        ...prev[room.id],
                        title: room.title,
                        editingTitle: false,
                      },
                    }))
                  }
                }}
                onBlur={() => void commitTitle(room.id)}
                autoFocus
              />
              <button
                type="button"
                className="rounded-full border border-emerald-500/60 bg-emerald-500/10 p-2 text-emerald-300 hover:bg-emerald-500/20"
                onClick={() => void commitTitle(room.id)}
                aria-label="Save title"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-slate-500"
                onClick={() =>
                  setDrafts((prev) => ({
                    ...prev,
                    [room.id]: {
                      ...prev[room.id],
                      title: room.title,
                      editingTitle: false,
                    },
                  }))
                }
                aria-label="Cancel title edit"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <Tooltip content="Click to rename">
              <button
                type="button"
                className="text-left text-lg font-semibold text-white hover:text-emerald-200"
                onClick={() => {
                  setDrafts((prev) => ({
                    ...prev,
                    [room.id]: { ...prev[room.id], editingTitle: true },
                  }))
                  window.setTimeout(() => {
                    const ref = titleRefs.current[room.id]
                    ref?.focus()
                    ref?.select()
                  }, 0)
                }}
              >
                {room.title}
              </button>
            </Tooltip>
          )}
          <div className="flex items-center gap-2">
            {drafts[room.id]?.editingTz ? (
              <>
                <input
                  list={`tz-${room.id}`}
                  className="rounded-full border border-emerald-500/40 bg-slate-900 px-3 py-1 text-xs text-white focus:border-emerald-400 focus:outline-none"
                  name={`room-timezone-${room.id}`}
                  ref={(node) => {
                    tzRefs.current[room.id] = node
                  }}
                  value={drafts[room.id]?.timezone ?? ''}
                  onChange={(event) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [room.id]: { ...prev[room.id], timezone: event.target.value },
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void commitTimezone(room.id)
                    }
                    if (event.key === 'Escape') {
                      setDrafts((prev) => ({
                        ...prev,
                        [room.id]: {
                          ...prev[room.id],
                          timezone: room.timezone,
                          editingTz: false,
                        },
                      }))
                    }
                  }}
                  onBlur={() => void commitTimezone(room.id)}
                  autoFocus
                />
                <datalist id={`tz-${room.id}`}>
                  <option value={localTimezone}>{`Local (${localTimezone})`}</option>
                  {allTimezones.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className="rounded-full border border-emerald-500/60 bg-emerald-500/10 p-1.5 text-emerald-300 hover:bg-emerald-500/20"
                  onClick={() => void commitTimezone(room.id)}
                  aria-label="Save timezone"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:border-slate-500"
                  onClick={() =>
                    setDrafts((prev) => ({
                      ...prev,
                      [room.id]: {
                        ...prev[room.id],
                        timezone: room.timezone,
                        editingTz: false,
                      },
                    }))
                  }
                  aria-label="Cancel timezone edit"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <Tooltip content={`Timezone: ${room.timezone}`} delay={1500}>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 transition hover:border-emerald-500/60"
                  onClick={() => {
                    setDrafts((prev) => ({
                      ...prev,
                      [room.id]: { ...prev[room.id], editingTz: true },
                    }))
                    window.setTimeout(() => {
                      const ref = tzRefs.current[room.id]
                      ref?.focus()
                      ref?.select()
                    }, 0)
                  }}
                >
                  <Globe size={12} />
                  {room.timezone}
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center gap-4">
          <div
            className={`flex w-full max-w-[240px] flex-col items-center gap-1 rounded-2xl border px-5 py-3 text-center ${(() => {
              const timers = getTimers(room.id)
              const active = timers.find((timer) => timer.id === room.state.activeTimerId)
              const baseElapsed = active ? room.state.progress?.[active.id] ?? 0 : 0
              const runningElapsed =
                active && room.state.isRunning && room.state.startedAt
                  ? now - room.state.startedAt + baseElapsed
                  : baseElapsed
              const remainingMs = active ? active.duration * 1000 - runningElapsed : 0
              const warningMs = (room.config?.warningSec ?? 120) * 1000
              const criticalMs = (room.config?.criticalSec ?? 30) * 1000
              if (remainingMs < 0) {
                return 'border-rose-500/40 bg-rose-500/10'
              }
              if (remainingMs <= criticalMs) {
                return 'border-amber-500/40 bg-amber-500/10'
              }
              if (remainingMs <= warningMs) {
                return 'border-yellow-500/30 bg-yellow-500/5'
              }
              return 'border-slate-800 bg-slate-900'
            })()}`}
          >
            <p className="w-full text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 leading-tight line-clamp-1 truncate">
              {(() => {
                const timers = getTimers(room.id)
                const active = timers.find((timer) => timer.id === room.state.activeTimerId)
                return active?.title ?? 'No active segment'
              })()}
            </p>
            <div className="flex w-full items-center justify-center pt-0.5">
              <span className="relative inline-flex items-center justify-center">
                <span
                  className={`absolute -left-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${(() => {
                    const timers = getTimers(room.id)
                    const active = timers.find((timer) => timer.id === room.state.activeTimerId)
                    const baseElapsed = active ? room.state.progress?.[active.id] ?? 0 : 0
                    const runningElapsed =
                      active && room.state.isRunning && room.state.startedAt
                        ? now - room.state.startedAt + baseElapsed
                        : baseElapsed
                    const remainingMs = active ? active.duration * 1000 - runningElapsed : 0
                    const warningMs = (room.config?.warningSec ?? 120) * 1000
                    const criticalMs = (room.config?.criticalSec ?? 30) * 1000
                    if (remainingMs < 0) return 'bg-rose-400'
                    if (remainingMs <= criticalMs) return 'bg-amber-400'
                    if (remainingMs <= warningMs) return 'bg-yellow-400'
                    return room.state.isRunning ? 'bg-emerald-400' : 'bg-slate-500'
                  })()}`}
                />
                <span className="text-lg font-semibold text-white">{formatRemaining(room.id)}</span>
              </span>
            </div>
            <p className="w-full text-[11px] tracking-[0.2em] text-slate-500 uppercase">
              {(() => {
                const timers = getTimers(room.id)
                const active = timers.find((timer) => timer.id === room.state.activeTimerId)
                const baseElapsed = active ? room.state.progress?.[active.id] ?? 0 : 0
                const runningElapsed =
                  active && room.state.isRunning && room.state.startedAt
                    ? now - room.state.startedAt + baseElapsed
                    : baseElapsed
                const remainingMs = active ? active.duration * 1000 - runningElapsed : 0
                const warningMs = (room.config?.warningSec ?? 120) * 1000
                const criticalMs = (room.config?.criticalSec ?? 30) * 1000
                if (remainingMs < 0) return 'Overtime'
                if (remainingMs <= criticalMs) return 'Critical'
                if (remainingMs <= warningMs) return 'Warning'
                return room.state.isRunning ? 'Counting' : 'Paused'
              })()}
            </p>
            <p className="w-full text-[10px] tracking-[0.24em] text-slate-500 uppercase">
              {(() => {
                const timers = getTimers(room.id)
                const activeIndex = timers.findIndex((timer) => timer.id === room.state.activeTimerId)
                const total = timers.length
                if (activeIndex === -1) return `0/${total || 0}`
                return `${activeIndex + 1}/${total}`
              })()}
            </p>
            <div className="flex h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full ${(() => {
                  const timers = getTimers(room.id)
                  const active = timers.find((timer) => timer.id === room.state.activeTimerId)
                  const baseElapsed = active ? room.state.progress?.[active.id] ?? 0 : 0
                  const runningElapsed =
                    active && room.state.isRunning && room.state.startedAt
                      ? now - room.state.startedAt + baseElapsed
                      : baseElapsed
                  const remainingMs = active ? active.duration * 1000 - runningElapsed : 0
                  const warningMs = (room.config?.warningSec ?? 120) * 1000
                  const criticalMs = (room.config?.criticalSec ?? 30) * 1000
                  if (remainingMs < 0) return 'bg-rose-400'
                  if (remainingMs <= criticalMs) return 'bg-amber-400'
                  if (remainingMs <= warningMs) return 'bg-yellow-400'
                  return room.state.isRunning ? 'bg-emerald-400' : 'bg-slate-500'
                })()}`}
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      (() => {
                        const timers = getTimers(room.id)
                        const active = timers.find((timer) => timer.id === room.state.activeTimerId)
                        if (!active) return 0
                        const baseElapsed = room.state.progress?.[active.id] ?? 0
                        const runningElapsed =
                          room.state.isRunning && room.state.startedAt
                            ? now - room.state.startedAt + baseElapsed
                            : baseElapsed
                        const remainingMs = active.duration * 1000 - runningElapsed
                        const remainingPct = (Math.max(0, remainingMs) / (active.duration * 1000)) * 100
                        const pct = Number.isNaN(remainingPct) ? 0 : remainingPct
                        return Number.isNaN(pct) ? 0 : pct
                      })(),
                    ),
                  )}%`,
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Tooltip content="Open controller">
              <Link
                to={`/room/${room.id}/control`}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                <Clock size={16} />
                Controller
              </Link>
            </Tooltip>
            <Tooltip content="Open viewer">
              <Link
                to={`/room/${room.id}/view`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-sm text-white transition hover:border-white/70"
              >
                Viewer
              </Link>
            </Tooltip>
            <div className="flex items-center gap-2">
              <Tooltip content="Share viewer link">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-white/50"
                  onClick={() => {
                    const origin =
                      typeof window !== 'undefined' && window.location.origin
                        ? window.location.origin
                        : 'https://stagetime.app'
                    const viewerUrl = `${origin}/room/${room.id}/view`
                    if (navigator.share) {
                      void navigator.share({ title: room.title, url: viewerUrl }).catch(() => {})
                    } else {
                      void navigator.clipboard.writeText(viewerUrl).then(() => window.alert('Viewer link copied to clipboard'))
                    }
                  }}
                  aria-label="Share viewer link"
                >
                  <Share2 size={18} />
                </button>
              </Tooltip>
              <div className="relative">
                <Tooltip content="Show QR Code">
                  <button
                    type="button"
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border px-3 font-semibold transition ${
                      qrOpenId === room.id
                        ? 'border-emerald-400/70 text-emerald-200'
                        : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
                    }`}
                    ref={(node) => {
                      qrButtonRefs.current[room.id] = node
                    }}
                    onClick={() => {
                      setQrErrorId(null)
                      setQrOpenId((prev) => {
                        const next = prev === room.id ? null : room.id
                        if (next) {
                          const rect = qrButtonRefs.current[room.id]?.getBoundingClientRect() ?? null
                          setQrAnchors((prevAnchors) => ({ ...prevAnchors, [room.id]: rect }))
                        }
                        return next
                      })
                    }}
                    aria-label="Toggle QR code"
                  >
                    <QrCode size={18} />
                  </button>
                </Tooltip>
                {qrOpenId === room.id &&
                  createPortal(
                    (() => {
                      const rect = qrAnchors[room.id]
                      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
                      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
                      const margin = 12
                      const top =
                        rect && typeof window !== 'undefined'
                          ? Math.min(viewportHeight - 340 - margin, Math.max(margin, rect.top + rect.height + 8))
                          : 0
                      let preferredLeft =
                        rect && typeof window !== 'undefined' ? rect.left + rect.width + 8 : margin
                      const overflowRight = preferredLeft + 320 + margin - viewportWidth
                      if (overflowRight > 0 && rect) {
                        const leftSide = rect.left - 8 - 320
                        preferredLeft = leftSide >= margin ? leftSide : Math.max(margin, viewportWidth - 320 - margin)
                      }
                      const clampedRight = Math.min(viewportWidth - 320 - margin, Math.max(margin, preferredLeft))
                      const centerLeft =
                        rect && typeof window !== 'undefined'
                          ? Math.min(
                              viewportWidth - 320 - margin,
                              Math.max(margin, rect.left + rect.width / 2 - 160),
                            )
                          : clampedRight
                      const left = rect && overflowRight <= 0 ? clampedRight : centerLeft
                      return (
                        <div
                          className="fixed z-[140] flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-lg"
                          style={{ width: 320, height: 320, minWidth: 320, minHeight: 320, top, left }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {typeof window !== 'undefined' ? (
                            qrErrorId === room.id ? (
                              <p className="text-xs text-slate-400">QR code unavailable. Copy the link instead.</p>
                            ) : (
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                                  `${window.location.origin}/room/${room.id}/view`,
                                )}`}
                                alt="Viewer QR"
                                className="h-72 w-72 cursor-pointer object-contain"
                                onError={() => setQrErrorId(room.id)}
                                onClick={() => setQrModalId(room.id)}
                              />
                            )
                          ) : (
                            <p className="text-xs text-slate-400">QR available once loaded.</p>
                          )}
                        </div>
                      )
                    })(),
                    document.body,
                  )}
              </div>
            </div>
          </div>
        </div>
      </SortableItem>
    )
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stagetime.sort', sortBy)
    }
  }, [sortBy])

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, DraftState> = { ...prev }
      sortedRooms.forEach((room) => {
        const existing = next[room.id] ?? {}
        next[room.id] = {
          ...existing,
          title: room.title,
          timezone: room.timezone,
          editingTitle: existing.editingTitle ?? false,
          editingTz: existing.editingTz ?? false,
        }
      })
      return next
    })
  }, [sortedRooms])

  const hasRunning = ownedRooms.some((room) => room.state.isRunning)
  useEffect(() => {
    if (!hasRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [hasRunning])

  // Tick placeholders so they disappear after TTL
  useEffect(() => {
    const id = window.setInterval(() => setPlaceholderNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const handleDeleteRoom = async (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId)
    if (!room) return
    await deleteRoom(roomId)
  }

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
      const metaPressed = isMac ? event.metaKey : event.ctrlKey
      if (!metaPressed) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        void undoRoomDelete()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        void redoRoomDelete()
      }
    }
    window.addEventListener('keydown', handleKeys)
    return () => window.removeEventListener('keydown', handleKeys)
  }, [redoRoomDelete, undoRoomDelete])

  const commitTitle = async (roomId: string) => {
    const draft = drafts[roomId]
    if (!draft) return
    const next = draft.title.trim()
    if (!next) {
      setDrafts((prev) => ({
        ...prev,
        [roomId]: {
          ...prev[roomId],
          title: rooms.find((room) => room.id === roomId)?.title ?? 'Room',
          editingTitle: false,
        },
      }))
      return
    }
    if (rooms.find((room) => room.id === roomId)?.title !== next) {
      await updateRoomMeta(roomId, { title: next })
    }
    setDrafts((prev) => ({
      ...prev,
      [roomId]: { ...prev[roomId], editingTitle: false },
    }))
  }

  const commitTimezone = async (roomId: string) => {
    const draft = drafts[roomId]
    if (!draft) return
    const next = draft.timezone.trim()
    if (!next) {
      setDrafts((prev) => ({
        ...prev,
        [roomId]: {
          ...prev[roomId],
          timezone: rooms.find((room) => room.id === roomId)?.timezone ?? localTimezone,
          editingTz: false,
        },
      }))
      return
    }
    if (rooms.find((room) => room.id === roomId)?.timezone !== next) {
      await updateRoomMeta(roomId, { timezone: next })
    }
    setDrafts((prev) => ({
      ...prev,
      [roomId]: { ...prev[roomId], editingTz: false },
    }))
  }

  const formatRemaining = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId)
    if (!room) return '—'
    const timers = getTimers(roomId)
    const active = timers.find((timer) => timer.id === room.state.activeTimerId)
    if (!active) return 'No active timer'
    const baseElapsed = room.state.progress?.[active.id] ?? 0
    const runningElapsed = room.state.isRunning && room.state.startedAt ? now - room.state.startedAt + baseElapsed : baseElapsed
    const remainingMs = active.duration * 1000 - runningElapsed
    const isNegative = remainingMs < 0
    const absMs = Math.abs(remainingMs)
    const hours = Math.floor(absMs / 3_600_000)
    const minutes = Math.floor((absMs % 3_600_000) / 60_000)
    const seconds = Math.floor((absMs % 60_000) / 1000)
    return `${isNegative ? '-' : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const qrOverlay =
    qrOpenId && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[120] cursor-default bg-transparent"
            role="presentation"
            onPointerDown={() => {
              setQrOpenId(null)
              setQrModalId(null)
            }}
            onClick={() => {
              setQrOpenId(null)
              setQrModalId(null)
            }}
          />,
          document.body,
        )
      : null

  if (!user) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-300">
        Sign in to manage rooms.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {qrOverlay}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-900/70 bg-slate-950/70 p-5 shadow-card">
        <div className="flex items-center gap-3">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Rooms</p>
          <Tooltip content="Quick-create a room with default timer" shortcut="+">
            <button
              type="button"
              onClick={async () => {
                setIsCreating(true)
                try {
                  await createRoom({ title: 'New Room', timezone: localTimezone, ownerId: user.uid })
                } finally {
                  setIsCreating(false)
                }
              }}
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-70"
            >
              <Plus size={16} />
              {isCreating ? 'Creating…' : 'New Room'}
            </button>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Sort</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs uppercase tracking-wide text-slate-200"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {isCustomSort && (
            <label className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Columns</span>
              <select
                value={columnCount}
                onChange={(event) => setColumnCount(Number(event.target.value) as 1 | 2 | 3 | 4)}
                className="rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-xs uppercase tracking-wide text-slate-200"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          )}
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
            {ownedRooms.length} rooms
          </span>
          <div className="flex items-center gap-2">
            <Tooltip content="Undo (Cmd/Ctrl+Z)">
              <button
                type="button"
                onClick={() => void undoRoomDelete()}
                disabled={!pendingRoomPlaceholders.length}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-200 transition hover:border-emerald-500/60 hover:text-emerald-200 disabled:opacity-40"
              >
                <Undo2 size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Redo (Shift+Cmd/Ctrl+Z)">
              <button
                type="button"
                onClick={() => void redoRoomDelete()}
                disabled={!pendingRooms.size && !pendingRoomPlaceholders.length}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-200 transition hover:border-emerald-500/60 hover:text-emerald-200 disabled:opacity-40"
              >
                <Redo2 size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        {renderEntries.filter((entry) => entry.kind === 'room').length === 0 && sortedPlaceholders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-emerald-900/60 bg-emerald-500/5 p-10 text-center text-sm text-slate-300">
            Create a room to start building a rundown.
          </div>
        ) : isCustomSort ? (
          <SortableList
            className={`grid grid-cols-1 gap-4 ${
              columnCount === 1
                ? 'md:grid-cols-1'
                : columnCount === 2
                  ? 'md:grid-cols-2'
                  : columnCount === 3
                    ? 'md:grid-cols-3'
                    : 'md:grid-cols-4'
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => event.preventDefault()}
          >
            {displayEntries.map((entry, listIndex) =>
              entry.kind === 'room'
                ? renderRoomCard(entry.room, listIndex, true)
                : renderPlaceholderItem(entry.placeholder, listIndex),
            )}
          </SortableList>
        ) : (
          <SortableList
            className={`grid grid-cols-1 gap-4 ${
              columnCount === 1
                ? 'md:grid-cols-1'
                : columnCount === 2
                  ? 'md:grid-cols-2'
                  : columnCount === 3
                    ? 'md:grid-cols-3'
                    : 'md:grid-cols-4'
            }`}
          >
            {[...sortedRooms.map((room) => ({
              kind: 'room' as const,
              createdAt: room.createdAt,
              title: room.title,
              room,
            })),
            ...sortedPlaceholders.map((pending) => ({
              kind: 'placeholder' as const,
              createdAt: pending.createdAt,
              title: pending.title,
              roomId: pending.roomId,
              order: pending.order,
            }))].sort((a, b) => compareCards(a, b)).map((card, index) => {
              if (card.kind === 'placeholder') {
                return renderPlaceholderItem(
                  {
                    roomId: card.roomId,
                    title: card.title,
                    createdAt: card.createdAt,
                    expiresAt: 0,
                    order: card.order,
                  },
                  index,
                )
              }
              return renderRoomCard(card.room, index, false)
            })}
          </SortableList>
        )}
      </section>

      {qrModalId && typeof window !== 'undefined' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setQrModalId(null)}
        >
          <div
            className="rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                `${window.location.origin}/room/${qrModalId}/view`,
              )}`}
              alt="Viewer QR"
              className="h-80 w-80 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
