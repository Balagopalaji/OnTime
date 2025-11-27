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
import type { Timer } from '../types'
import { RundownPanel } from '../components/controller/RundownPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { LiveTimerPreview } from '../components/controller/LiveTimerPreview'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { formatDate, formatDuration } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'

export const ControllerPage = () => {
  const { roomId } = useParams()
  const {
    getRoom,
    getTimers,
    startTimer,
    pauseTimer,
    resetTimer,
    nudgeTimer,
    createTimer,
    deleteTimer,
    reorderTimer,
    updateTimer,
    updateRoomMeta,
    restoreTimer,
    resetTimerProgress,
    setActiveTimer,
    setClockMode,
    updateMessage,
    connectionStatus,
  } = useDataContext()

  const room = roomId ? getRoom(roomId) : undefined
  const timers = useMemo(
    () => (roomId ? getTimers(roomId) : []),
    [getTimers, roomId],
  )

  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)
  const currentRoomId = room?.id
  const isRunning = room?.state.isRunning ?? false
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    () => activeTimer?.id ?? null,
  )
  const [qrOpen, setQrOpen] = useState(false)
  const [qrError, setQrError] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [isTimezoneEditing, setIsTimezoneEditing] = useState(false)
  const [timezoneInput, setTimezoneInput] = useState(room?.timezone ?? '')
  const timezoneInputRef = useRef<HTMLInputElement | null>(null)
  const [undoTimer, setUndoTimer] = useState<{ timer: Timer; index: number } | null>(null)
  const undoTimeoutRef = useRef<number | null>(null)
  const [shortcutScope, setShortcutScope] = useState<'controls' | 'rundown'>('controls')

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

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        window.clearTimeout(undoTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (isTimezoneEditing && timezoneInputRef.current) {
      timezoneInputRef.current.focus()
      timezoneInputRef.current.select()
    }
  }, [isTimezoneEditing])

  const controlTargetTimerId =
    shortcutScope === 'rundown' && selectedTimerId
      ? selectedTimerId
      : room?.state.activeTimerId ?? null

  const startControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    void startTimer(currentRoomId, controlTargetTimerId)
  }

  const pauseControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    if (controlTargetTimerId !== room.state.activeTimerId) {
      void setActiveTimer(room.id, controlTargetTimerId)
    }
    void pauseTimer(currentRoomId)
  }

  const resetControlTimer = () => {
    if (!currentRoomId || !controlTargetTimerId) return
    if (controlTargetTimerId !== room.state.activeTimerId) {
      void setActiveTimer(room.id, controlTargetTimerId)
    }
    void resetTimer(currentRoomId)
  }

  const nudgeActiveTimer = (deltaMs: number) => {
    if (!currentRoomId) return
    void nudgeTimer(currentRoomId, deltaMs)
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
    setSelectedTimerId(prevTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, prevTimer.id)
  }, [prevTimer, room, setActiveTimer])

  const handleStartNextTimer = useCallback(() => {
    if (!nextTimer || !room) return
    setSelectedTimerId(nextTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, nextTimer.id)
  }, [nextTimer, room, setActiveTimer])

  const handleToggleClock = () => {
    void setClockMode(room.id, !room.state.showClock)
  }

  const remainingLookup = useMemo(() => {
    if (!room) return {}
    const { progress, activeTimerId, elapsedOffset } = room.state
    const lookup: Record<string, string> = {}
    timers.forEach((timer) => {
      if (timer.id === activeTimerId) {
        lookup[timer.id] = formatDuration(timer.duration * 1000 - elapsedOffset)
        return
      }
      const elapsed = progress?.[timer.id] ?? 0
      const remainingMs = timer.duration * 1000 - elapsed
      lookup[timer.id] = formatDuration(remainingMs)
    })
    return lookup
  }, [room, timers])

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

  const handleShare = async () => {
    if (!viewerUrl) return
    if (navigator.share) {
      await navigator.share({ title: room.title, url: viewerUrl })
      return
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
      setSelectedTimerId(newTimer.id)
      setShortcutScope('rundown')
    })
  }

  const handleDeleteTimer = (timerId: string) => {
    if (!room) return
    const index = timers.findIndex((timer) => timer.id === timerId)
    const snapshot = index >= 0 ? timers[index] : undefined
    if (snapshot) {
      if (undoTimeoutRef.current) {
        window.clearTimeout(undoTimeoutRef.current)
      }
      setUndoTimer({ timer: snapshot, index })
      undoTimeoutRef.current = window.setTimeout(() => {
        setUndoTimer(null)
      }, 8000)
    }
    void deleteTimer(room.id, timerId)
  }

  const handleUndoDelete = useCallback(() => {
    if (!room || !undoTimer) return
    void restoreTimer(room.id, undoTimer.timer)
    setUndoTimer(null)
    if (undoTimeoutRef.current) {
      window.clearTimeout(undoTimeoutRef.current)
      undoTimeoutRef.current = null
    }
  }, [room, undoTimer, restoreTimer])

  const handleResetTimer = (timerId: string) => {
    if (!currentRoomId) return
    if (room.state.activeTimerId === timerId) {
      resetActiveTimer()
    } else {
      void resetTimerProgress(currentRoomId, timerId)
    }
  }

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

      if (adjustSelected) {
        const deltaMinutes =
          direction === 'up'
            ? deltaMs / 60_000
            : -deltaMs / 60_000
        const stagedMinutes = Math.max(
          0,
          Math.round(selectedTimer.duration / 60),
        )
        const nextMinutes = Math.max(0, stagedMinutes + deltaMinutes)
        const duration = Math.max(0, Math.round(nextMinutes * 60))
        void updateTimer(currentRoomId, selectedTimer.id, { duration })
        return
      }
      void nudgeTimer(
        currentRoomId,
        direction === 'up' ? deltaMs : -deltaMs,
      )
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
          if (shortcutScope === 'rundown' && selectedTimer) {
            void startTimer(currentRoomId, selectedTimer.id)
          } else if (isRunning) {
            void pauseTimer(currentRoomId)
          } else {
            void startTimer(currentRoomId)
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
          const deltaMs = event.shiftKey
            ? 600_000
            : event.ctrlKey
            ? 1_000
            : 60_000
          event.preventDefault()
          const direction = event.code === 'ArrowUp' ? 'up' : 'down'
          performArrowAction(direction, deltaMs)
          stopRepeat()
          repeatTimeout = window.setTimeout(() => {
            repeatInterval = window.setInterval(
              () => performArrowAction(direction, deltaMs),
              80,
            )
          }, 250)
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
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', stopRepeat)
    }
  }, [
    activeTimer?.id,
    currentRoomId,
    isRunning,
    nudgeTimer,
    pauseTimer,
    resetTimer,
    selectedTimer,
    shortcutScope,
    startTimer,
    updateTimer,
    handleStartNextTimer,
    handleStartPrevTimer,
  ])

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        window.clearTimeout(undoTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z'
      if (isUndo && undoTimer) {
        event.preventDefault()
        handleUndoDelete()
      }
    }
    window.addEventListener('keydown', handleUndoShortcut)
    return () => window.removeEventListener('keydown', handleUndoShortcut)
  }, [undoTimer, handleUndoDelete])

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
            <span className="rounded-full bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.4em] text-white">
              StageTime
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Current Room
              </p>
              <p className="text-2xl font-semibold text-white">{room.title}</p>
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
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionIndicator status={connectionStatus} />
            <a
              href={`/room/${room.id}/view`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/60"
            >
              Viewer
            </a>
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
        className={`relative rounded-3xl border bg-slate-950/60 p-4 shadow-card transition ${
          shortcutScope === 'controls' ? 'border-emerald-400/70 shadow-[0_0_25px_rgba(16,185,129,0.25)]' : 'border-slate-900/60'
        } sm:flex sm:items-center sm:justify-between sm:gap-4`}
        role="group"
        onClick={() => setShortcutScope('controls')}
      >
        <div className="flex flex-wrap items-center gap-2 text-base text-white">
          <button
            type="button"
            onClick={handleStartPrevTimer}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30"
            disabled={!prevTimer}
            aria-label="Previous timer (BracketLeft)"
          >
            <SkipBack size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShortcutScope('controls')
              startControlTimer()
            }}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl font-semibold shadow-sm transition ${
              room.state.isRunning
                ? 'bg-rose-500/85 text-white shadow-[0_4px_16px_rgba(248,113,113,0.35)]'
                : 'bg-emerald-500/95 text-slate-950 hover:bg-emerald-400 shadow-[0_4px_16px_rgba(16,185,129,0.35)]'
            }`}
            disabled={room.state.isRunning}
            aria-label="Play"
          >
            <Play size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShortcutScope('controls')
              pauseControlTimer()
            }}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border font-semibold transition ${
              room.state.isRunning
                ? 'border-rose-400/80 bg-rose-500/15 text-rose-100 hover:border-rose-200'
                : 'border-indigo-300/70 bg-slate-900/90 text-indigo-100 hover:border-indigo-200'
            }`}
            disabled={!room.state.isRunning}
            aria-label="Pause"
          >
            <Pause size={20} />
          </button>
          <button
            type="button"
            onClick={handleStartNextTimer}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30"
            disabled={!nextTimer}
            aria-label="Next timer (BracketRight)"
          >
            <SkipForward size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShortcutScope('controls')
              resetControlTimer()
            }}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/70 bg-slate-900/80 text-amber-100 transition hover:border-amber-200"
            aria-label="Reset timer"
          >
            <RotateCcw size={20} />
          </button>
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
          <button
            type="button"
            onClick={handleToggleClock}
            className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition ${
              room.state.showClock
                ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
            }`}
            aria-label={room.state.showClock ? 'Hide clock' : 'Show clock'}
          >
            <Clock3 size={18} />
            {room.state.showClock ? 'Hide Clock' : 'Show Clock'}
          </button>
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-white/50"
              aria-label="Share"
            >
              <Share2 size={20} />
            </button>
          <button
            type="button"
            onClick={() => {
              setQrError(false)
              setQrOpen((prev) => !prev)
            }}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border px-3 font-semibold transition ${
                qrOpen
                  ? 'border-emerald-400/70 text-emerald-200'
                  : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
              }`}
              aria-label="Toggle QR code"
            >
              <QrCode size={20} />
            </button>
            {qrOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => {
                    setQrOpen(false)
                    setQrModalOpen(false)
                  }}
                />
                <div className="absolute right-0 top-full z-30 mt-2 rounded-2xl border border-slate-800 bg-slate-950/90 p-3 shadow-lg">
                  {viewerUrl ? (
                    qrError ? (
                      <p className="text-xs text-slate-400">
                        QR code unavailable. Copy the link instead.
                      </p>
                    ) : (
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                          viewerUrl,
                        )}`}
                        alt="Viewer QR"
                        className="h-32 w-32 object-contain cursor-pointer"
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
          onReset={handleResetTimer}
          undoPlaceholder={
            undoTimer ? { index: Math.min(undoTimer.index, timers.length), title: undoTimer.timer.title } : null
          }
          onUndoDelete={undoTimer ? handleUndoDelete : undefined}
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
            message={room.state.message}
            timezone={room.timezone}
          />
        </div>
      </div>
    </section>
    </>
  )
}
