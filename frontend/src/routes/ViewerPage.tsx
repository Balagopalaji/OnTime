import { useEffect, useRef, useState, type RefObject } from 'react'
import { useParams } from 'react-router-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { FitText } from '../components/core/FitText'
import { useFullscreen } from '../hooks/useFullscreen'
import { useClock } from '../hooks/useClock'
import { useWakeLock } from '../hooks/useWakeLock'
import { Tooltip } from '../components/core/Tooltip'
import { useDataContext } from '../context/DataProvider'
import { useAppMode } from '../context/AppModeContext'
import { useRoom } from '../hooks/useRoom'
import { useTimers } from '../hooks/useTimers'
import { useCompanionConnection } from '../context/CompanionConnectionContext'
import { claimLanPairing } from '../lib/companion-pairing'

type ViewerTokenState = {
  token: string
  expiresAt: number
  role: string
}

const getViewerTokenKey = (roomId: string) => `ontime:viewerToken:${roomId}`

const readViewerToken = (roomId?: string | null): ViewerTokenState | null => {
  if (!roomId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getViewerTokenKey(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ViewerTokenState
    if (!parsed?.token || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(getViewerTokenKey(roomId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const writeViewerToken = (roomId: string, payload: ViewerTokenState) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getViewerTokenKey(roomId), JSON.stringify(payload))
  } catch {
    // ignore
  }
}

const clearViewerToken = (roomId: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getViewerTokenKey(roomId))
  } catch {
    // ignore
  }
}

export const ViewerPage = () => {
  const { roomId } = useParams()
  const { effectiveMode } = useAppMode()
  const ctx = useDataContext()
  const companion = useCompanionConnection()
  const isCompanionHosted =
    typeof window !== 'undefined' &&
    (window.location.port === '4440' ||
      window.location.port === '4000' ||
      window.location.pathname.startsWith('/viewer/'))
  const [viewerToken, setViewerToken] = useState<ViewerTokenState | null>(() => readViewerToken(roomId))
  const [pairingCode, setPairingCode] = useState(() => {
    if (typeof window === 'undefined') return ''
    const params = new URLSearchParams(window.location.search)
    return params.get('code') ?? ''
  })
  const [pairingRole, setPairingRole] = useState('all')
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)

  const publicRoomId = isCompanionHosted ? undefined : roomId
  // Direct Firestore access for unauthenticated users (cloud viewer only)
  const { room: publicRoom, connectionStatus: publicRoomStatus } = useRoom(publicRoomId)
  const { timers: publicTimers } = useTimers(publicRoomId)

  const roomAuthority = roomId
    ? (ctx as typeof ctx & { getRoomAuthority?: (roomId: string) => { source: string; status: string } }).getRoomAuthority?.(roomId)
    : undefined
  
  // Prefer context (Companion merged), fallback to public Firestore
  const room = (roomId ? ctx.getRoom(roomId) : undefined) ?? publicRoom
  const ctxTimers = roomId ? ctx.getTimers(roomId) : []
  const timers = ctxTimers.length > 0 ? ctxTimers : publicTimers
  
  const connectionStatus = ctx.connectionStatus === 'online' ? 'online' : publicRoomStatus
  const subscribeToCompanionRoom = (ctx as typeof ctx & {
    subscribeToCompanionRoom?: (
      roomId: string,
      clientType: 'controller' | 'viewer',
      tokenOverride?: string,
    ) => void
  }).subscribeToCompanionRoom
  const setActiveRoomIntent = (ctx as typeof ctx & {
    setActiveRoomIntent?: (roomId: string | null) => void
  }).setActiveRoomIntent
  const lastJoinKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (roomId) setActiveRoomIntent?.(roomId)
    return () => setActiveRoomIntent?.(null)
  }, [roomId, setActiveRoomIntent])

  useEffect(() => {
    setViewerToken(readViewerToken(roomId))
  }, [roomId])

  useEffect(() => {
    const socket = companion.socket
    if (!socket || !roomId) return
    const handleHandshakeError = (err: { code?: string }) => {
      if (err?.code !== 'INVALID_TOKEN') return
      clearViewerToken(roomId)
      setViewerToken(null)
      setPairingError('Pairing expired or revoked. Request a new code.')
    }
    socket.on('HANDSHAKE_ERROR', handleHandshakeError)
    return () => {
      socket.off('HANDSHAKE_ERROR', handleHandshakeError)
    }
  }, [companion.socket, roomId])
  
  const isLoading = !room && connectionStatus !== 'offline'
  const deviceName =
    typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : undefined

  const handlePairingSubmit = async () => {
    if (!roomId) return
    const code = pairingCode.trim()
    if (!code) {
      setPairingError('Enter a pairing code.')
      return
    }
    setPairingBusy(true)
    setPairingError(null)
    try {
      const tokenResponse = await claimLanPairing({
        roomId,
        code,
        role: pairingRole,
        deviceName,
      })
      const nextToken: ViewerTokenState = {
        token: tokenResponse.token,
        expiresAt: tokenResponse.expiresAt,
        role: tokenResponse.role,
      }
      writeViewerToken(roomId, nextToken)
      setViewerToken(nextToken)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pairing failed.'
      setPairingError(message)
    } finally {
      setPairingBusy(false)
    }
  }

  const roleOptions = ['all', 'lx', 'ax', 'vx', 'sm', 'foh', 'custom']
  const activeTimer =
    timers.find((timer) => timer.id === room?.state.activeTimerId) ?? timers[0]

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef as unknown as RefObject<HTMLElement | null>)
  const wakeLockStatus = useWakeLock(true)
  const [hasTriedFullscreen, setHasTriedFullscreen] = useState(false)
  const [wakeLockDismissed, setWakeLockDismissed] = useState(false)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      const wantsToggle =
        event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)
      if (wantsToggle) {
        event.preventDefault()
        setHasTriedFullscreen(true)
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toggleFullscreen])

  useEffect(() => {
    if (!roomId) return
    if (!subscribeToCompanionRoom) return
    const tokenOverride = viewerToken?.token ?? null
    const joinKey = `${roomId}::viewer::${effectiveMode}::${tokenOverride ?? 'public'}`
    if (lastJoinKeyRef.current === joinKey) return
    lastJoinKeyRef.current = joinKey
    if (tokenOverride) {
      subscribeToCompanionRoom(roomId, 'viewer', tokenOverride)
      return
    }
    if (!isCompanionHosted) {
      subscribeToCompanionRoom(roomId, 'viewer')
    }
  }, [effectiveMode, isCompanionHosted, roomId, subscribeToCompanionRoom, viewerToken?.token])

  const clockTime = useClock(room?.timezone ?? 'UTC', room?.state.clockMode ?? '24h')
  const [clockBody, clockSuffix] = clockTime.split(' ')
  const clockSegments = clockBody.split(':')
  const clockHours = clockSegments[0] ?? ''
  const clockMinutes = clockSegments[1] ?? ''

  if (isCompanionHosted && !viewerToken) {
    return (
      <div className="flex min-h-[calc(100vh-80px)] items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg rounded-3xl border border-slate-900 bg-slate-950/80 p-6 text-slate-200 shadow-card">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">LAN Viewer</p>
            <h1 className="text-2xl font-semibold text-white">Connect to this room</h1>
            <p className="text-sm text-slate-300">
              Enter the pairing code from the controller to unlock read-only access.
            </p>
          </div>
          {!roomId ? (
            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
              Missing room id. Ask the operator for a new LAN viewer link.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Pairing Code
              </label>
              <input
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300/70"
              />
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Role
              </label>
              <select
                value={pairingRole}
                onChange={(event) => setPairingRole(event.target.value)}
                className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300/70"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role === 'all' ? 'All roles' : role.toUpperCase()}
                  </option>
                ))}
              </select>
              {pairingError ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {pairingError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void handlePairingSubmit()}
                disabled={pairingBusy}
                className="w-full rounded-2xl border border-emerald-300/70 bg-emerald-500/20 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 disabled:opacity-60"
              >
                {pairingBusy ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (isCompanionHosted && viewerToken && roomAuthority?.source !== 'companion') {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Connecting to Companion...
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Connecting to room...
      </div>
    )
  }

  if (!room || !roomId || timers.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Viewer is offline or no timers found. Ask the operator for a new link.
      </div>
    )
  }

  const bgClass =
    engine.status === 'overtime'
      ? 'bg-rose-950'
      : engine.status === 'critical'
      ? 'bg-rose-900'
      : engine.status === 'warning'
      ? 'bg-amber-900'
      : 'bg-slate-950'

  const isOvertime = engine.status === 'overtime'
  const timerLabel = activeTimer ? activeTimer.title : 'Standby'
  const displayLength = engine.display.length
  // vwMax ensures text fits horizontally (especially portrait mode)
  // Lower values for longer text strings
  const timerVwMax = displayLength >= 9 ? 14 : displayLength >= 8 ? 16 : displayLength >= 7 ? 18 : 21
  const showWakeLockBanner =
    hasTriedFullscreen && !wakeLockDismissed &&
    (Boolean(wakeLockStatus.error) || wakeLockStatus.isSupported === false)
  const isIphone =
    typeof navigator !== 'undefined' && /iphone|ipod/i.test(navigator.userAgent) && !/ipad/i.test(navigator.userAgent)
  const isMobileLandscape =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(orientation: landscape)').matches &&
    window.innerWidth < 1024

  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
    none: 'border border-white/40 bg-transparent text-white',
  }[room.state.message.color]


  const durationMs = (activeTimer?.duration ?? 0) * 1000
  const progressPercent =
    durationMs <= 0
      ? 0
      : Math.max(0, Math.min(1, engine.remainingMs / durationMs)) * 100
  const progressColor =
    engine.status === 'overtime' || engine.status === 'critical'
      ? 'bg-rose-400'
      : engine.status === 'warning'
      ? 'bg-amber-300'
      : 'bg-emerald-400'

  return (
    <section
      className={`flex min-h-[calc(100vh-80px)] w-full items-center justify-center ${
        isMobileLandscape ? 'px-2 py-3' : 'px-4 py-6 md:py-10'
      }`}
    >
      <div
        ref={containerRef}
        className={`relative flex h-full w-full max-w-[1600px] flex-col rounded-[36px] border border-slate-900 text-center shadow-card ${
          isMobileLandscape ? 'px-4 py-4' : 'px-5 py-6 sm:px-12 sm:py-12'
        } ${bgClass}`}
      >
        <div className="flex flex-1 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-slate-200">
              <div className="text-left">
                <p className="text-sm font-semibold uppercase tracking-[0.4em] text-white/80">
                  {timerLabel}
                </p>
                <p className="text-base font-medium text-white">{room.title}</p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <ConnectionIndicator status={connectionStatus} />
                {roomAuthority ? (
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium ${
                      roomAuthority.source === 'companion'
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : 'bg-slate-400/10 text-slate-200'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        roomAuthority.source === 'companion' ? 'bg-emerald-300' : 'bg-slate-300'
                      }`}
                    />
                    {roomAuthority.source === 'companion' ? 'Local' : 'Cloud'}
                  </span>
                ) : null}
                {isIphone ? (
                  <Tooltip content="Fullscreen isn't supported on iPhone browsers." triggerOnClick delay={0}>
                    <span
                      className="inline-flex"
                      onClick={() => setHasTriedFullscreen(true)}
                      onTouchStart={() => setHasTriedFullscreen(true)}
                    >
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/60"
                      >
                        <Maximize2 size={14} />
                        Fullscreen
                      </button>
                    </span>
                  </Tooltip>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setHasTriedFullscreen(true)
                      void toggleFullscreen()
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:bg-white/20"
                  >
                    {isFullscreen ? (
                      <>
                        <Minimize2 size={14} />
                        Exit fullscreen
                      </>
                    ) : (
                      <>
                        <Maximize2 size={14} />
                        Fullscreen
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {showWakeLockBanner ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-100">
                <div>
                  <p className="font-semibold text-amber-100">Keep screen awake failed</p>
                  <p className="text-amber-100/80">
                    The screen may sleep. You may need to turn off Auto-Lock in your device settings.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWakeLockDismissed(true)}
                  className="rounded-full border border-amber-200/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-100"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            <div className="flex flex-1 flex-col items-center justify-center py-2 sm:py-4">
              {room.state.showClock ? (
                <div className="flex justify-center items-center w-full">
                  <FitText
                    className="font-semibold text-white leading-[0.9] font-[inherit]"
                    max={600}
                    min={60}
                    ratio={2}
                    vhMax={38}
                    vwMax={18}
                  >
                    <span className="inline-flex items-baseline gap-3 justify-center text-white leading-none">
                      <span className="text-white">
                        {clockHours}:{clockMinutes}
                      </span>
                      {clockSuffix && (
                        <span className="text-5xl font-semibold uppercase text-slate-200 align-middle">
                          {clockSuffix}
                        </span>
                      )}
                    </span>
                  </FitText>
                </div>
              ) : isOvertime ? (
                <div className="flex w-full flex-col items-center justify-center gap-1 text-white">
                  <FitText className="font-semibold text-white" max={320} min={32} ratio={3} vhMax={14} vwMax={9}>
                    Time is up!
                  </FitText>
                  <FitText
                    className="font-semibold text-rose-100 leading-[0.95]"
                    max={800}
                    min={48}
                    ratio={2}
                    vhMax={55}
                    vwMax={timerVwMax}
                  >
                    {engine.display}
                  </FitText>
                </div>
              ) : (
                <div className="flex justify-center items-center w-full">
                  <FitText className="font-semibold text-white" max={800} min={60} ratio={2} vhMax={58} vwMax={timerVwMax}>
                    {engine.display}
                  </FitText>
                </div>
              )}
              {!room.state.showClock && (
                <div className="mt-4 sm:mt-8 h-3 sm:h-4 w-full max-w-6xl rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all ${progressColor}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>

            {room.state.message.visible && room.state.message.text && messageBg && (
              <div
                className={`mt-8 flex w-full items-center justify-center rounded-3xl px-5 py-4 text-lg font-semibold break-words ${messageBg}`}
                style={{ maxHeight: '40vh' }}
              >
                <div className="w-full text-center font-semibold leading-tight break-words">
                  <p
                    className="mx-auto"
                    style={{
                      fontSize: 'clamp(16px, 4vw, 56px)',
                      lineHeight: 1.05,
                      display: '-webkit-box',
                      WebkitLineClamp: 8,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {room.state.message.text}
                  </p>
                </div>
              </div>
            )}
        </div>
      </div>
    </section>
  )
}
