import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  Share2,
  SkipBack,
  SkipForward,
  QrCode,
} from 'lucide-react'
import { useDataContext } from '../context/DataProvider'
import { RundownPanel } from '../components/controller/RundownPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { LiveTimerPreview } from '../components/controller/LiveTimerPreview'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { Tooltip } from '../components/core/Tooltip'
import { formatDate, formatDuration } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'
import { useAppMode } from '../context/AppModeContext'
import { useCompanionConnection } from '../context/CompanionConnectionContext'

export const ControllerPage = () => {
  const { roomId } = useParams()
  const { effectiveMode } = useAppMode()
  const { handshakeStatus } = useCompanionConnection()
  const ctx = useDataContext()
  const {
    getRoom,
    getTimers,
    getRoomAuthority,
    startTimer,
    pauseTimer,
    resetTimer,
    nudgeTimer,
    createTimer,
    deleteTimer,
    reorderTimer,
    updateTimer,
    updateRoomMeta,
    resetTimerProgress,
    setActiveTimer,
    setClockMode,
    setClockFormat,
    updateMessage,
    connectionStatus,
    pendingTimerPlaceholders,
    undoTimerDelete,
    redoTimerDelete,
    undoRoomDelete,
    redoRoomDelete,
  } = ctx
  const subscribeToCompanionRoom = (ctx as typeof ctx & {
    subscribeToCompanionRoom?: (roomId: string, clientType: 'controller' | 'viewer') => void
  }).subscribeToCompanionRoom
  const lastJoinKeyRef = useRef<string | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const debugCompanion =
    typeof import.meta !== 'undefined' &&
    ((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_DEBUG_COMPANION === 'true')

  const ensureCompanionJoin = useCallback(
    (options?: { force?: boolean; reason?: string }) => {
      if (!roomId) return
      if (!subscribeToCompanionRoom) return
      const joinKey = `${roomId}::controller::${effectiveMode}`
      if (!options?.force && lastJoinKeyRef.current === joinKey) return
      lastJoinKeyRef.current = joinKey
      if (debugCompanion) {
        console.info(
          `[Companion] auto-joining controller for room ${roomId} (${effectiveMode}) reason=${options?.reason ?? 'auto'}`,
        )
      }
      subscribeToCompanionRoom(roomId, 'controller')
    },
    [debugCompanion, effectiveMode, roomId, subscribeToCompanionRoom],
  )

  const bumpCompanionOnActivity = useCallback(
    (reason: string) => {
      if (!subscribeToCompanionRoom) return
      const now = Date.now()
      const idleMs = now - lastActivityRef.current
      lastActivityRef.current = now
      if (idleMs < 60_000) return
      ensureCompanionJoin({ force: true, reason })
    },
    [ensureCompanionJoin, subscribeToCompanionRoom],
  )

  const room = roomId ? getRoom(roomId) : undefined
  const roomAuthority = roomId && getRoomAuthority ? getRoomAuthority(roomId) : undefined
  const timers = useMemo(
    () => (roomId ? getTimers(roomId) : []),
    [getTimers, roomId],
  )

  useEffect(() => {
    lastActivityRef.current = Date.now()
    ensureCompanionJoin({ reason: 'auto' })
  }, [ensureCompanionJoin, roomId])

  useEffect(() => {
    if (!roomId) return
    if (!subscribeToCompanionRoom) return
    const handleMouseMove = () => {
      const now = Date.now()
      const idleMs = now - lastActivityRef.current
      if (idleMs <= 300_000) return
      lastActivityRef.current = now
      ensureCompanionJoin({ force: true, reason: 'idle-move' })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [ensureCompanionJoin, handshakeStatus, roomId, subscribeToCompanionRoom])

  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)
  const currentRoomId = room?.id
  const isRunning = room?.state.isRunning ?? false
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    () => activeTimer?.id ?? null,
  )
  const [qrOpen, setQrOpen] = useState(false)
  const [qrError, setQrError] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleInput, setTitleInput] = useState(room?.title ?? '')
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [isTimezoneEditing, setIsTimezoneEditing] = useState(false)
  const [timezoneInput, setTimezoneInput] = useState(room?.timezone ?? '')
  const timezoneInputRef = useRef<HTMLInputElement | null>(null)
  const [shortcutScope, setShortcutScope] = useState<'controls' | 'rundown'>('controls')
  const [placeholderNow, setPlaceholderNow] = useState(() => Date.now())

  const effectiveSelectedTimerId = useMemo(() => {
    if (selectedTimerId && timers.some((timer) => timer.id === selectedTimerId)) {
      return selectedTimerId
    }
    return activeTimer?.id ?? null
  }, [activeTimer?.id, selectedTimerId, timers])

  const selectedTimer =
    timers.find((timer) => timer.id === effectiveSelectedTimerId) ?? activeTimer
  const timezoneOptions = useMemo(() => getAllTimezones(), [])
  const timezoneListId = room ? `timezone-${room.id}` : 'timezone-global'
  const undoPlaceholder = useMemo(() => {
    if (!roomId) return null
    const placeholders = (pendingTimerPlaceholders[roomId] ?? []).filter(
      (entry) => entry.expiresAt > placeholderNow,
    )
    if (!placeholders.length) return null
    const first = [...placeholders].sort((a, b) => a.order - b.order)[0]
    const orderedTimers = [...timers].sort((a, b) => a.order - b.order)
    const insertion = orderedTimers.findIndex((timer) => timer.order > first.order)
    const index = insertion === -1 ? orderedTimers.length : insertion
    return { index, title: first.title, timerId: first.timerId, expiresAt: first.expiresAt }
  }, [pendingTimerPlaceholders, placeholderNow, roomId, timers])

  useEffect(() => {
    if (isTimezoneEditing && timezoneInputRef.current) {
      timezoneInputRef.current.focus()
      timezoneInputRef.current.select()
    }
    if (isTitleEditing && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isTimezoneEditing, isTitleEditing])

  useEffect(() => {
    const id = window.setInterval(() => setPlaceholderNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [setPlaceholderNow])

  useEffect(() => {
    if (!room) return
    setTitleInput(room.title)
    setTimezoneInput(room.timezone)
    // This effect mirrors incoming room props to local inputs; avoids stale values when switching rooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.title, room?.timezone])

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
      const metaPressed = isMac ? event.metaKey : event.ctrlKey
      if (!metaPressed || !roomId) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y'
      if (isUndo) {
        event.preventDefault()
        void undoRoomDelete()
      } else if (isRedo) {
        event.preventDefault()
        void redoRoomDelete()
      }
    }
    window.addEventListener('keydown', handleUndoShortcut)
    return () => window.removeEventListener('keydown', handleUndoShortcut)
  }, [redoRoomDelete, roomId, undoRoomDelete])

  const controlTargetTimerId =
    shortcutScope === 'rundown' && selectedTimerId
      ? selectedTimerId
      : room?.state.activeTimerId ?? null

  const startControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    bumpCompanionOnActivity('play')
    void startTimer(currentRoomId, controlTargetTimerId)
  }

  const pauseControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    bumpCompanionOnActivity('pause')
    if (controlTargetTimerId !== room.state.activeTimerId) {
      void setActiveTimer(room.id, controlTargetTimerId)
    }
    void pauseTimer(currentRoomId)
  }

  const resetControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    bumpCompanionOnActivity('reset')
    if (controlTargetTimerId === room.state.activeTimerId) {
      void resetTimer(currentRoomId)
      return
    }
    void resetTimerProgress(currentRoomId, controlTargetTimerId)
  }

  const nudgeActiveTimer = (deltaMs: number) => {
    if (!currentRoomId || !room) return
    bumpCompanionOnActivity('nudge')
    if (room.state.isRunning) {
      void nudgeTimer(currentRoomId, deltaMs)
      return
    }
    if (activeTimer) {
      const nextDurationSec = Math.max(0, Math.round(activeTimer.duration + deltaMs / 1000))
      void updateTimer(currentRoomId, activeTimer.id, { duration: nextDurationSec })
    }
  }

  const handleEditTimer = (
    timerId: string,
    patch: { title?: string; speaker?: string; duration?: number },
  ) => {
    if (!currentRoomId) return
    void updateTimer(currentRoomId, timerId, patch)
  }

  const handleReorderTimer = (sourceId: string, targetIndex: number) => {
    if (!currentRoomId) return
    bumpCompanionOnActivity('reorder')
    void reorderTimer(currentRoomId, sourceId, targetIndex)
  }

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  const activeIndex = activeTimer
    ? timers.findIndex((timer) => timer.id === activeTimer.id)
    : -1
  const prevTimer = activeIndex > 0 ? timers[activeIndex - 1] : null
  const nextTimer =
    activeIndex >= 0 && activeIndex < timers.length - 1
      ? timers[activeIndex + 1]
      : null

  const handleStartPrevTimer = useCallback(() => {
    if (!prevTimer || !room) return
    bumpCompanionOnActivity('set-active')
    setSelectedTimerId(prevTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, prevTimer.id)
  }, [prevTimer, room, setActiveTimer, bumpCompanionOnActivity])

  const handleStartNextTimer = useCallback(() => {
    if (!nextTimer || !room) return
    bumpCompanionOnActivity('set-active')
    setSelectedTimerId(nextTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, nextTimer.id)
  }, [nextTimer, room, setActiveTimer, bumpCompanionOnActivity])

  const handleToggleClock = () => {
    if (!room) return
    void setClockMode(room.id, !room.state.showClock)
  }

  const remainingLookup = useMemo(() => {
    if (!room) return {}
    const { progress, activeTimerId, elapsedOffset } = room.state
    const lookup: Record<string, string> = {}
    timers.forEach((timer) => {
      if (timer.id === activeTimerId) {
        lookup[timer.id] = engine ? engine.display : formatDuration(timer.duration * 1000 - elapsedOffset)
        return
      }
      const elapsed = progress?.[timer.id] ?? 0
      const remainingMs = timer.duration * 1000 - elapsed
      lookup[timer.id] = formatDuration(remainingMs)
    })
    return lookup
  }, [engine, room, timers])

  const handleTimezoneSave = () => {
    if (!room) return
    const next = timezoneInput.trim()
    if (!next) {
      setTimezoneInput(room.timezone)
      setIsTimezoneEditing(false)
      return
    }
    void updateRoomMeta(room.id, { timezone: next })
    setIsTimezoneEditing(false)
  }

  const handleTitleSave = () => {
    if (!room) return
    const next = titleInput.trim()
    if (!next || next === room.title) {
      setTitleInput(room.title)
      setIsTitleEditing(false)
      return
    }
    void updateRoomMeta(room.id, { title: next })
    setIsTitleEditing(false)
  }

  const handleShare = async () => {
    if (!viewerUrl || !room) return
    if (navigator.share) {
      try {
        await navigator.share({ title: room.title, url: viewerUrl })
        return
      } catch {
        // fall back to clipboard if share was cancelled or unavailable
      }
    }
    try {
      await navigator.clipboard.writeText(viewerUrl)
      window.alert('Viewer link copied to clipboard')
    } catch {
      window.prompt('Copy viewer link', viewerUrl)
    }
  }

  const handleAddSegment = () => {
    if (!room) return
    void createTimer(room.id, {
      title: 'New Segment',
      duration: 5 * 60,
      speaker: '',
    }).then((newTimer) => {
      if (!newTimer) return
      setSelectedTimerId(newTimer.id)
      setShortcutScope('rundown')
    })
  }

  const handleDeleteTimer = (timerId: string) => {
    if (!room) return
    void deleteTimer(room.id, timerId)
  }

  const handleResetTimer = (timerId: string) => {
    if (!room) return
    bumpCompanionOnActivity('reset')
    if (room.state.activeTimerId === timerId) {
      void resetTimer(room.id)
      return
    }
    void resetTimerProgress(room.id, timerId)
  }

  const pendingStagedDelta = useRef(0)
  const stagedFlush = useRef<number | null>(null)
  const flushStaged = useCallback(() => {
    if (!currentRoomId || !selectedTimer) return
    const deltaMs = pendingStagedDelta.current
    pendingStagedDelta.current = 0
    if (deltaMs !== 0) {
      const nextDurationSec = Math.max(0, Math.round(selectedTimer.duration + deltaMs / 1000))
      void updateTimer(currentRoomId, selectedTimer.id, { duration: nextDurationSec })
    }
    if (stagedFlush.current) {
      window.clearTimeout(stagedFlush.current)
      stagedFlush.current = null
    }
  }, [currentRoomId, selectedTimer, updateTimer])

  useEffect(() => {
    if (!currentRoomId) return
    let repeatInterval: ReturnType<typeof window.setInterval> | null = null
    let repeatTimeout: ReturnType<typeof window.setTimeout> | null = null

    const stopRepeat = () => {
      if (repeatInterval) {
        window.clearInterval(repeatInterval)
        repeatInterval = null
      }
      if (repeatTimeout) {
        window.clearTimeout(repeatTimeout)
        repeatTimeout = null
      }
    }

    const performArrowAction = (direction: 'up' | 'down', deltaMs: number) => {
      const adjustSelected =
        shortcutScope === 'rundown' &&
        selectedTimer &&
        selectedTimer.id !== activeTimer?.id

      const signedDelta = direction === 'up' ? deltaMs : -deltaMs

      if (adjustSelected) {
        bumpCompanionOnActivity('nudge')
        pendingStagedDelta.current += signedDelta
        if (!stagedFlush.current) {
          stagedFlush.current = window.setTimeout(flushStaged, 100)
        }
        return
      }

      if (!currentRoomId || !room) return
      bumpCompanionOnActivity('nudge')
      if (room.state.isRunning) {
        void nudgeTimer(currentRoomId, signedDelta)
      } else if (activeTimer) {
        const nextDurationSec = Math.max(
          0,
          Math.round(activeTimer.duration + signedDelta / 1000),
        )
        void updateTimer(currentRoomId, activeTimer.id, { duration: nextDurationSec })
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'r') return

      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      switch (event.code) {
        case 'Space': {
          event.preventDefault()
          const activeId = room?.state.activeTimerId
          const targetId = shortcutScope === 'rundown' && selectedTimer ? selectedTimer.id : activeId
          if (!targetId) break

          const isActiveTarget = targetId === activeId
          if (isActiveTarget && isRunning) {
            void pauseTimer(currentRoomId)
          } else {
            void startTimer(currentRoomId, targetId)
          }
          break
        }
        case 'KeyR': {
          event.preventDefault()
          void resetTimer(currentRoomId)
          break
        }
        case 'Escape': {
          if (shortcutScope !== 'controls') {
            event.preventDefault()
            setShortcutScope('controls')
          }
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (event.repeat) return
          const deltaMs = event.shiftKey
            ? 600_000
            : event.ctrlKey || event.metaKey
              ? 1_000
              : 60_000
          event.preventDefault()
          const direction = event.code === 'ArrowUp' ? 'up' : 'down'
          performArrowAction(direction, deltaMs)
          stopRepeat()
          repeatTimeout = window.setTimeout(() => {
            repeatInterval = window.setInterval(
              () => performArrowAction(direction, deltaMs),
              110,
            )
          }, 180)
          break
        }
        case 'BracketLeft': {
          event.preventDefault()
          handleStartPrevTimer()
          break
        }
        case 'BracketRight': {
          event.preventDefault()
          handleStartNextTimer()
          break
        }
        default:
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        stopRepeat()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', stopRepeat)
    return () => {
      stopRepeat()
      flushStaged()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', stopRepeat)
    }
  }, [
    activeTimer,
    currentRoomId,
    isRunning,
    nudgeTimer,
    pauseTimer,
    resetTimer,
    selectedTimer,
    shortcutScope,
    room,
    startTimer,
    updateTimer,
    handleStartNextTimer,
    handleStartPrevTimer,
    flushStaged,
    bumpCompanionOnActivity,
  ])

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Room not found. Return to the dashboard.
      </div>
    )
  }

  const viewerUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${room.id}/view`
      : ''

  const messageKey = `${room.state.message.text}::${room.state.message.color}::${room.state.message.visible}`

  return (
    <>
      <section className="space-y-6">
        <header className="rounded-3xl border border-slate-900/70 bg-slate-950/70 p-4 shadow-card sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Current Room
                </p>
                {isTitleEditing ? (
                  <input
                    ref={titleInputRef}
                    value={titleInput}
                    onChange={(event) => setTitleInput(event.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleTitleSave()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setTitleInput(room.title)
                        setIsTitleEditing(false)
                      }
                    }}
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1 text-lg font-semibold text-white"
                  />
                ) : (
                  <button
                    type="button"
                    className="text-left text-2xl font-semibold text-white hover:text-emerald-200"
                    onClick={() => {
                      setTitleInput(room.title)
                      setIsTitleEditing(true)
                    }}
                  >
                    {room.title}
                  </button>
                )}
                <p className="text-xs text-slate-500">
                  Created {formatDate(room.createdAt, room.timezone)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Timezone
                </p>
                {isTimezoneEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      list={timezoneListId}
                      className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-white"
                      name="room-timezone"
                      ref={timezoneInputRef}
                      value={timezoneInput}
                      onChange={(event) => setTimezoneInput(event.target.value)}
                      onBlur={handleTimezoneSave}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleTimezoneSave()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setTimezoneInput(room.timezone)
                          setIsTimezoneEditing(false)
                        }
                      }}
                    />
                    <datalist id={timezoneListId}>
                      {timezoneOptions.map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 transition hover:border-emerald-400/60"
                      onClick={() => {
                        setTimezoneInput(room.timezone)
                        setIsTimezoneEditing(true)
                      }}
                    >
                      {room.timezone}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/60"
                      onClick={(event) => {
                        event.preventDefault()
                        if (room) {
                          const next = (room.state.clockMode ?? '24h') === '24h' ? 'ampm' : '24h'
                          void setClockFormat(room.id, next)
                        }
                      }}
                      aria-label="Toggle 12/24 hour clock"
                    >
                      {(room?.state.clockMode ?? '24h') === '24h' ? '24h' : 'AM·PM'}
                    </button>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Clock
                  </span>
                  <span className="text-xs text-slate-300">
                    {(room?.state.clockMode ?? '24h') === '24h' ? '24-hour' : 'AM/PM'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ConnectionIndicator status={connectionStatus} />
              {roomAuthority?.status === 'syncing' ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                  <span className="h-2 w-2 rounded-full bg-sky-300 animate-pulse" />
                  Sync
                </span>
              ) : null}
              <Tooltip content="Undo timer delete (Cmd/Ctrl+Z)">
                <button
                  type="button"
                  onClick={() => roomId && void undoTimerDelete(roomId)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-100 transition hover:border-emerald-500/60 hover:text-emerald-200"
                >
                  ↺
                </button>
              </Tooltip>
              <Tooltip content="Redo timer delete (Shift+Cmd/Ctrl+Z)">
                <button
                  type="button"
                  onClick={() => roomId && void redoTimerDelete(roomId)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-100 transition hover:border-emerald-500/60 hover:text-emerald-200"
                >
                  ↻
                </button>
              </Tooltip>
              <Tooltip content="Open Viewer in new tab">
                <a
                  href={`/room/${room.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/60"
                >
                  Viewer
                </a>
              </Tooltip>
              <ShareLinkButton roomId={room.id} />
            </div>
          </div>
          {connectionStatus !== 'online' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <AlertTriangle size={16} />
              Mock latency enabled. Actions will delay slightly.
            </div>
          )}
        </header>

        <div
          className={`relative rounded-3xl border bg-slate-950/60 p-4 shadow-card transition ${shortcutScope === 'controls' ? 'border-emerald-400/70 shadow-[0_0_25px_rgba(16,185,129,0.25)]' : 'border-slate-900/60'
            } sm:flex sm:items-center sm:justify-between sm:gap-4`}
          role="group"
          onClick={() => setShortcutScope('controls')}
        >
          <div className="flex flex-wrap items-center gap-2 text-base text-white">
            <Tooltip content="Previous Timer" shortcut="[">
              <button
                type="button"
                onClick={handleStartPrevTimer}
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30"
                disabled={!prevTimer}
                aria-label="Previous timer (BracketLeft)"
              >
                <SkipBack size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Start Timer" shortcut="Space">
              <button
                type="button"
                onClick={() => {
                  startControlTimer()
                }}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl font-semibold shadow-sm transition ${room.state.isRunning
                  ? 'bg-rose-500/85 text-white shadow-[0_4px_16px_rgba(248,113,113,0.35)]'
                  : 'bg-emerald-500/95 text-slate-950 hover:bg-emerald-400 shadow-[0_4px_16px_rgba(16,185,129,0.35)]'
                  }`}
                aria-label="Play"
              >
                <Play size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Pause Timer" shortcut="Space">
              <button
                type="button"
                onClick={() => {
                  pauseControlTimer()
                }}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border font-semibold transition ${room.state.isRunning
                  ? 'border-rose-400/80 bg-rose-500/15 text-rose-100 hover:border-rose-200'
                  : 'border-indigo-300/70 bg-slate-900/90 text-indigo-100 hover:border-indigo-200'
                  }`}
                disabled={!room.state.isRunning}
                aria-label="Pause"
              >
                <Pause size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Next Timer" shortcut="]">
              <button
                type="button"
                onClick={handleStartNextTimer}
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30"
                disabled={!nextTimer}
                aria-label="Next timer (BracketRight)"
              >
                <SkipForward size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Reset Timer" shortcut="R">
              <button
                type="button"
                onClick={() => {
                  resetControlTimer()
                }}
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/70 bg-slate-900/80 text-amber-100 transition hover:border-amber-200"
                aria-label="Reset timer"
              >
                <RotateCcw size={20} />
              </button>
            </Tooltip>
            {shortcutScope === 'controls' && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-100">
                Selected
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:mt-0">
            <span className="text-xs font-semibold text-slate-300">
              {activeIndex >= 0 ? activeIndex + 1 : 0} / {timers.length}
            </span>
            <Tooltip content={room.state.showClock ? 'Hide big clock' : 'Show big clock'}>
              <button
                type="button"
                onClick={handleToggleClock}
                className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition ${room.state.showClock
                  ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                  : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
                  }`}
                aria-label={room.state.showClock ? 'Hide clock' : 'Show clock'}
              >
                <Clock3 size={18} />
                {room.state.showClock ? 'Hide Clock' : 'Show Clock'}
              </button>
            </Tooltip>
            <div className="relative flex items-center gap-2">
              <Tooltip content="Share Viewer Link">
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-white/50"
                  aria-label="Share"
                >
                  <Share2 size={20} />
                </button>
              </Tooltip>
              <Tooltip content="Show QR Code">
                <button
                  type="button"
                  onClick={() => {
                    setQrError(false)
                    setQrOpen((prev) => !prev)
                  }}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border px-3 font-semibold transition ${qrOpen
                    ? 'border-emerald-400/70 text-emerald-200'
                    : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
                    }`}
                  aria-label="Toggle QR code"
                >
                  <QrCode size={20} />
                </button>
              </Tooltip>
              {qrOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20 bg-transparent"
                    onClick={() => {
                      setQrOpen(false)
                      setQrModalOpen(false)
                    }}
                  />
                  <div
                    className="absolute right-0 top-full z-30 mt-2 flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-lg"
                    style={{ width: 320, height: 320, minWidth: 320, minHeight: 320 }}
                  >
                    {viewerUrl ? (
                      qrError ? (
                        <p className="text-xs text-slate-400">
                          QR code unavailable. Copy the link instead.
                        </p>
                      ) : (
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                            viewerUrl,
                          )}`}
                          alt="Viewer QR"
                          className="h-72 w-72 cursor-pointer object-contain"
                          onError={() => setQrError(true)}
                          onClick={() => setQrModalOpen(true)}
                        />
                      )
                    ) : (
                      <p className="text-xs text-slate-400">QR available once the app loads.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {qrModalOpen && viewerUrl && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4"
            onClick={() => setQrModalOpen(false)}
          >
            <div
            className="rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                viewerUrl,
              )}`}
              alt="Viewer QR"
              className="h-80 w-80 object-contain"
              onError={() => setQrError(true)}
            />
              <button
                type="button"
                className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60"
                onClick={() => setQrModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <RundownPanel
            timers={timers}
            activeTimerId={room.state.activeTimerId}
            isRunning={isRunning}
            activeTimerDisplay={isRunning && activeTimer ? engine.display : null}
            remainingLookup={remainingLookup}
            selectedTimerId={selectedTimerId}
            showSelection={shortcutScope === 'rundown'}
            onSelect={(timerId) => {
              setSelectedTimerId(timerId)
              setShortcutScope('rundown')
            }}
            onStart={(timerId) => {
              setSelectedTimerId(timerId)
              setShortcutScope('rundown')
              bumpCompanionOnActivity('start')
              void startTimer(room.id, timerId)
            }}
            onDelete={handleDeleteTimer}
            onAddSegment={handleAddSegment}
            onEdit={(timerId, patch) => {
              handleEditTimer(timerId, patch)
            }}
            onReorder={(timerId, targetIndex) => {
              handleReorderTimer(timerId, targetIndex)
            }}
            onPauseActive={pauseControlTimer}
            onActiveNudge={nudgeActiveTimer}
            onReset={handleResetTimer}
            undoPlaceholder={undoPlaceholder}
            onUndoDelete={roomId ? () => void undoTimerDelete(roomId) : undefined}
          />

          <div className="space-y-4">
            <MessagePanel
              key={messageKey}
              initial={room.state.message}
              onUpdate={(payload) => {
                void updateMessage(room.id, payload)
              }}
            />
            <LiveTimerPreview
              timer={activeTimer}
              showClock={room.state.showClock}
              engine={engine}
              isRunning={isRunning}
              onStart={startControlTimer}
              onPause={pauseControlTimer}
              onReset={resetControlTimer}
              onNudge={nudgeActiveTimer}
              onToggleClock={handleToggleClock}
              clockMode={room.state.clockMode ?? '24h'}
              message={room.state.message}
              timezone={room.timezone}
            />
          </div>
        </div>
      </section>
    </>
  )
}
