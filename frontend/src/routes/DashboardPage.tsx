import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock, Globe, GripVertical, Plus, QrCode, Redo2, Share2, Trash2, Undo2, X } from 'lucide-react'
import { SortableItem } from '../components/sortable/SortableItem'
import { SortableList } from '../components/sortable/SortableList'
import { Tooltip } from '../components/core/Tooltip'
import { useSortableList } from '../hooks/useSortableList'
import { useAuth } from '../context/AuthContext'
import { useDataContext } from '../context/DataProvider'
import { getTimezoneSuggestion } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'

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
  const [placeholderNow, setPlaceholderNow] = useState(() => Date.now())
  const [dismissedPlaceholders, setDismissedPlaceholders] = useState<Set<string>>(new Set())
  const isCustomSort = sortBy === 'custom'

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

  const orderKey = useCallback(
    (item: { order?: number; createdAt: number }) => item.order ?? item.createdAt,
    [],
  )

  const ownedRooms = useMemo(() => {
    if (!user) return []
    return rooms.filter((room) => room.ownerId === user.uid && !pendingRooms.has(room.id))
  }, [pendingRooms, rooms, user])

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

  const sortableItems = useMemo(
    () => (isCustomSort ? sortedRooms.map((room) => ({ id: room.id, value: room })) : []),
    [isCustomSort, sortedRooms],
  )

  const { draggingId, overIndex, getItemProps, getHandleProps } = useSortableList({
    items: sortableItems,
    onReorder: (from, to) => {
      if (!isCustomSort) return
      const movingId = sortableItems[from]?.id
      if (movingId && reorderRoom) {
        void reorderRoom(movingId, to)
      }
    },
  })

  const renderDropIndicator = (key: string) => (
    <li key={key} className="col-span-full px-2">
      <div className="h-0.5 rounded-full bg-slate-700/70" />
    </li>
  )

  const renderPlaceholderItem = (placeholder: PlaceholderEntry) => (
    <li
      key={`placeholder-${placeholder.roomId}`}
      className="flex items-center justify-center rounded-3xl border border-dashed border-slate-800/70 bg-slate-950/50 p-6 text-center text-sm text-slate-200"
    >
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
    </li>
  )

  const renderRoomCard = (room: (typeof sortedRooms)[number], index: number, enableSort: boolean) => {
    const itemProps = enableSort ? getItemProps(room.id, index) : {}
    const handleProps = enableSort ? getHandleProps(room.id, index) : null
    return (
      <SortableItem
        key={room.id}
        {...itemProps}
        dragging={enableSort && draggingId === room.id}
        over={enableSort && overIndex === index}
        className={`relative flex flex-col overflow-visible rounded-3xl border border-slate-800/90 bg-slate-950/80 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] ${enableSort ? 'cursor-grab' : ''}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {enableSort && handleProps && (
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 transition hover:border-emerald-500/70 hover:text-emerald-200"
                aria-label="Drag to reorder"
                {...handleProps}
              >
                <GripVertical size={14} />
              </button>
            )}
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
            className={`flex min-w-[200px] flex-col items-center gap-2 rounded-2xl border px-4 py-3 text-center ${(() => {
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
            <div className="flex items-center justify-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${(() => {
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
            </div>
            <p className="text-[11px] tracking-[0.28em] text-slate-500 uppercase">
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
            <p className="text-[10px] tracking-[0.24em] text-slate-500 uppercase">
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
                    onClick={() => {
                      setQrErrorId(null)
                      setQrOpenId((prev) => (prev === room.id ? null : room.id))
                    }}
                    aria-label="Toggle QR code"
                  >
                    <QrCode size={18} />
                  </button>
                </Tooltip>
                {qrOpenId === room.id && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => {
                        setQrOpenId(null)
                        setQrModalId(null)
                      }}
                    />
                    <div
                      className="absolute right-0 top-full z-30 mt-2 flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-lg"
                      style={{ width: 320, height: 320, minWidth: 320, minHeight: 320 }}
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
                  </>
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
    const minutes = Math.floor(absMs / 60000)
    const seconds = Math.floor((absMs % 60000) / 1000)
    return `${isNegative ? '-' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-300">
        Sign in to manage rooms.
      </div>
    )
  }

  return (
    <div className="space-y-8">
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
          <span className="text-sm text-slate-400">{ownedRooms.length} total</span>
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
        {sortedRooms.length === 0 && sortedPlaceholders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-emerald-900/60 bg-emerald-500/5 p-10 text-center text-sm text-slate-300">
            Create a room to start building a rundown.
          </div>
        ) : isCustomSort ? (
          <SortableList className="grid gap-4 md:grid-cols-2">
            {(() => {
              const placeholderQueue = [...sortedPlaceholders]
              const nodes: ReactNode[] = []
              sortedRooms.forEach((room, index) => {
                while (placeholderQueue.length && orderKey(placeholderQueue[0]) <= orderKey(room)) {
                  nodes.push(renderPlaceholderItem(placeholderQueue.shift()!))
                }
                if (draggingId && overIndex === index) {
                  nodes.push(renderDropIndicator(`drop-${room.id}-before`))
                }
                nodes.push(renderRoomCard(room, index, true))
              })
              placeholderQueue.forEach((placeholder) => nodes.push(renderPlaceholderItem(placeholder)))
              if (draggingId && overIndex === sortedRooms.length) {
                nodes.push(renderDropIndicator('drop-end'))
              }
              return nodes
            })()}
          </SortableList>
        ) : (
          <SortableList className="grid gap-4 md:grid-cols-2">
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
                return renderPlaceholderItem({
                  roomId: card.roomId,
                  title: card.title,
                  createdAt: card.createdAt,
                  expiresAt: 0,
                  order: card.order,
                })
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
