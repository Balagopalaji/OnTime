import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppMode, type AppMode } from '../../context/AppModeContext'
import { useCompanionConnection } from '../../context/CompanionConnectionContext'
import { useDataContext } from '../../context/DataProvider'
import { CompanionDownloadPrompt } from '../core/CompanionDownloadPrompt'
import {
  isElectron,
  onCrashRecovery,
  ackCrashRecovery,
  onUpdateStateChanged,
  downloadUpdate,
  installUpdate,
  getControllerPortPreference,
  setControllerPortPreference,
  type CrashRecoveryData,
  type UpdateState,
  type ControllerPortPreference,
} from '../../lib/electron'

export const AppShell = () => {
  const { user, status, login, logout } = useAuth()
  const location = useLocation()
  const isAuthed = Boolean(user)
  const isViewerRoute = /\/room\/[^/]+\/view$/.test(location.pathname)
  const { mode, effectiveMode, setMode } = useAppMode()
  const data = useDataContext() as ReturnType<typeof useDataContext> & {
    queueStatus?: Record<string, { count: number; max: number; percent: number; nearLimit: boolean }>
  }
  const connection = useCompanionConnection()
  const [isDownloadOpen, setIsDownloadOpen] = useState(false)
  const [showCompanionWizard, setShowCompanionWizard] = useState(false)
  const [showTrustStep, setShowTrustStep] = useState(false)
  const [crashRecovery, setCrashRecovery] = useState<CrashRecoveryData | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [reconnectNow, setReconnectNow] = useState(() => Date.now())
  const [reconnectBannerDismissed, setReconnectBannerDismissed] = useState(false)
  const [cloudBannerDismissed, setCloudBannerDismissed] = useState(false)
  const [capabilityBannerDismissed, setCapabilityBannerDismissed] = useState(false)
  const [tokenBannerDismissed, setTokenBannerDismissed] = useState(false)
  const protocolFallbackRef = useRef(false)
  const [protocolFallbackActive, setProtocolFallbackActive] = useState(false)
  const [portPreference, setPortPreference] = useState<ControllerPortPreference | null>(null)
  const [showPortDialog, setShowPortDialog] = useState(false)
  const [portDraft, setPortDraft] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [portSaved, setPortSaved] = useState(false)
  const portInputRef = useRef<HTMLInputElement | null>(null)

  const openTrustPage = useCallback(() => {
    if (typeof window === 'undefined') return
    const pathWithSearch = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const current = pathWithSearch === '/' ? '/dashboard' : pathWithSearch
    window.location.href = `/companion/trust?return=${encodeURIComponent(current)}`
  }, [])

  const handleAuthClick = () => {
    if (isAuthed) {
      void logout()
    } else {
      void login()
    }
  }

  const handleCompanionClick = async () => {
    if (connection.isConnected) return
    setShowCompanionWizard(true)
  }

  useEffect(() => {
    if (location.pathname !== '/') {
      window.localStorage.setItem('stagetime.lastPath', location.pathname)
    }
  }, [location.pathname])

  // Listen for crash recovery events from Electron main process
  useEffect(() => {
    if (!isElectron()) return
    return onCrashRecovery((data) => {
      if (data.lastPath) {
        setCrashRecovery(data)
      }
    })
  }, [])

  const handleDismissCrashRecovery = useCallback(() => {
    setCrashRecovery(null)
    void ackCrashRecovery()
  }, [])

  // Listen for update state changes from Electron main process
  useEffect(() => {
    if (!isElectron()) return
    return onUpdateStateChanged((state) => {
      setUpdateState(state)
      // Reset dismissed state when a new version becomes available
      if (state.available && !updateState?.available) {
        setUpdateDismissed(false)
      }
    })
  }, [updateState?.available])

  const loadPortPreference = useCallback(async () => {
    const next = await getControllerPortPreference()
    if (next) setPortPreference(next)
    return next
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    let cancelled = false
    void getControllerPortPreference().then((next) => {
      if (!cancelled && next) setPortPreference(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showPortDialog) return
    portInputRef.current?.focus()
    portInputRef.current?.select()
  }, [showPortDialog])

  const handleOpenPortDialog = () => {
    setPortDraft(portPreference?.preferredPort ? String(portPreference.preferredPort) : '')
    setPortError(null)
    setPortSaved(false)
    setShowPortDialog(true)
  }

  const handleSavePortPreference = useCallback(async () => {
    const trimmed = portDraft.trim()
    if (trimmed.length === 0) {
      await setControllerPortPreference(null)
      await loadPortPreference()
      setPortError(null)
      setPortSaved(true)
      return
    }
    const nextPort = Number(trimmed)
    if (!Number.isFinite(nextPort) || nextPort <= 0 || nextPort > 65535) {
      setPortError('Enter a valid port between 1 and 65535.')
      return
    }
    await setControllerPortPreference(Math.trunc(nextPort))
    await loadPortPreference()
    setPortError(null)
    setPortSaved(true)
  }, [portDraft, loadPortPreference])

  const handleClearPortPreference = useCallback(async () => {
    await setControllerPortPreference(null)
    await loadPortPreference()
    setPortDraft('')
    setPortError(null)
    setPortSaved(true)
  }, [loadPortPreference])

  const handleDownloadUpdate = useCallback(() => {
    void downloadUpdate()
  }, [])

  const handleInstallUpdate = useCallback(() => {
    void installUpdate()
  }, [])

  const handleDismissUpdate = useCallback(() => {
    setUpdateDismissed(true)
  }, [])

  const queueWarning = useMemo(() => {
    const match = location.pathname.match(/^\/room\/([^/]+)\/(control|view)$/)
    const roomId = match?.[1]
    const view = match?.[2]
    if (!roomId || view !== 'control') return null
    const status = data.queueStatus?.[roomId]
    if (!status?.nearLimit) return null
    return status
  }, [data.queueStatus, location.pathname])

  const activeRoomId = useMemo(() => {
    const match = location.pathname.match(/^\/room\/([^/]+)\/(control|view)$/)
    return match?.[1] ?? null
  }, [location.pathname])

  const activeRoom = useMemo(() => {
    if (!activeRoomId || typeof data.getRoom !== 'function') return null
    return data.getRoom(activeRoomId)
  }, [activeRoomId, data])

  const companionTone = useMemo(() => {
    // Amber for companion (distinct from mode colors), red when offline
    if (connection.isConnected) {
      return 'border-amber-400/50 bg-green-950/40 text-amber-200'
    }
    if (connection.handshakeStatus === 'pending') {
      return 'border-cyan-700 bg-cyan-950/40 text-cyan-400'
    }
    return 'border-slate-700 bg-slate-900/40 text-slate-400'
  }, [connection.handshakeStatus, connection.isConnected])

  const cloudTone = useMemo(() => {
    if (data.connectionStatus === 'online') {
      return 'border-emerald-400/60 bg-emerald-950/40 text-emerald-200'
    }
    if (data.connectionStatus === 'reconnecting') {
      return 'border-amber-400/60 bg-amber-950/40 text-amber-200'
    }
    return 'border-rose-400/60 bg-rose-950/40 text-rose-200'
  }, [data.connectionStatus])

  const cloudLabel = useMemo(() => {
    if (data.connectionStatus === 'online') return 'Cloud Online'
    if (data.connectionStatus === 'reconnecting') return 'Cloud Reconnecting'
    return 'Cloud Offline'
  }, [data.connectionStatus])

  const modeTone = useMemo(() => {
    // Color-code modes: cloud=blue, auto=emerald, local=amber
    if (mode === 'cloud') return 'border-blue-400 bg-blue-950/60 text-blue-200'
    if (mode === 'auto') return 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
    return 'border-amber-400 bg-amber-950/60 text-amber-200' // local
  }, [mode])

  const cloudBanner = useMemo(() => {
    if (cloudBannerDismissed) return null
    if (data.connectionStatus === 'offline') {
      return {
        tone: 'border-rose-800/50 bg-rose-950/80 text-rose-200',
        title: 'Cloud connection offline',
        detail: 'Cloud sync is unavailable. Local Companion changes continue if connected.',
      }
    }
    if (data.connectionStatus === 'reconnecting') {
      return {
        tone: 'border-amber-800/50 bg-amber-950/80 text-amber-200',
        title: 'Reconnecting to Cloud',
        detail: 'We will resync cloud state as soon as the connection returns.',
      }
    }
    return null
  }, [cloudBannerDismissed, data.connectionStatus])

  const capabilityBanner = useMemo(() => {
    if (capabilityBannerDismissed) return null
    if (!activeRoom || !connection.isConnected || connection.handshakeStatus !== 'ack') return null
    const missing: string[] = []
    if (activeRoom.features?.powerpoint && !connection.capabilities.powerpoint) {
      missing.push('PowerPoint')
    }
    if (activeRoom.features?.externalVideo && !connection.capabilities.externalVideo) {
      missing.push('External video')
    }
    if (!connection.capabilities.fileOperations) {
      missing.push('File operations')
    }
    if (!missing.length) return null
    return {
      tone: 'border-amber-800/50 bg-amber-950/80 text-amber-200',
      title: 'Companion capability unavailable',
      detail: `Missing: ${missing.join(', ')}`,
    }
  }, [
    activeRoom,
    capabilityBannerDismissed,
    connection.capabilities.externalVideo,
    connection.capabilities.fileOperations,
    connection.capabilities.powerpoint,
    connection.handshakeStatus,
    connection.isConnected,
  ])

  const tokenBanner = useMemo(() => {
    if (tokenBannerDismissed) return null
    const tokenError =
      connection.lastErrorCode === 'INVALID_TOKEN' || connection.lastErrorCode === 'TOKEN_MISSING'
    if (!tokenError) return null
    return {
      tone: 'border-rose-800/50 bg-rose-950/80 text-rose-200',
      title: 'Companion session expired',
      detail: 'Refresh your Companion token to resume local features.',
    }
  }, [connection.lastErrorCode, tokenBannerDismissed])

  const reconnectBanner = useMemo(() => {
    const isCompanionReady = connection.isConnected && connection.handshakeStatus === 'ack'
    const reconnectElapsedMs = connection.reconnectStartedAt
      ? Math.max(0, reconnectNow - connection.reconnectStartedAt)
      : 0
    if (reconnectBannerDismissed) return null
    if (connection.reconnectState === 'stopped') {
      return {
        tone: 'border-rose-800/50 bg-rose-950/80 text-rose-200',
        title: 'Companion reconnect paused',
        detail: 'We stopped after 20 failed attempts. Click retry to try again.',
        variant: 'stopped',
      }
    }
    if ((connection.reconnectAttempts >= 5 || reconnectElapsedMs >= 8000) && !isCompanionReady) {
      return {
        tone: 'border-amber-800/50 bg-amber-950/80 text-amber-200',
        title: 'Having trouble reconnecting to Companion',
        detail: 'We will keep retrying. You can also retry now.',
        variant: 'retrying',
      }
    }
    return null
  }, [
    connection.handshakeStatus,
    connection.isConnected,
    connection.reconnectAttempts,
    connection.reconnectState,
    connection.reconnectStartedAt,
    reconnectNow,
    reconnectBannerDismissed,
  ])

  useEffect(() => {
    if (!connection.nextRetryAt || connection.isConnected) return
    const interval = window.setInterval(() => {
      setReconnectNow(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [connection.isConnected, connection.nextRetryAt])

  const reconnectCountdown = useMemo(() => {
    if (!connection.nextRetryAt) return null
    const delta = Math.max(0, Math.ceil((connection.nextRetryAt - reconnectNow) / 1000))
    return delta > 0 ? `${delta}s` : null
  }, [connection.nextRetryAt, reconnectNow])

  useEffect(() => {
    if (connection.handshakeStatus !== 'ack') return
    window.setTimeout(() => {
      setReconnectBannerDismissed(false)
    }, 0)
  }, [connection.handshakeStatus])

  useEffect(() => {
    if (!connection.token) return
    window.setTimeout(() => {
      setTokenBannerDismissed(false)
    }, 0)
  }, [connection.token])

  useEffect(() => {
    if (data.connectionStatus === 'online') {
      window.setTimeout(() => {
        setCloudBannerDismissed(false)
      }, 0)
    }
  }, [data.connectionStatus])

  const capabilitySignature = useMemo(
    () =>
      JSON.stringify({
        roomId: activeRoom?.id ?? null,
        features: activeRoom?.features ?? null,
        capabilities: connection.capabilities,
        handshake: connection.handshakeStatus,
      }),
    [activeRoom?.features, activeRoom?.id, connection.capabilities, connection.handshakeStatus],
  )

  useEffect(() => {
    window.setTimeout(() => {
      setCapabilityBannerDismissed(false)
    }, 0)
  }, [capabilitySignature])

  const protocolWarning = useMemo(() => {
    if (connection.protocolStatus.compatibility === 'incompatible') {
      return {
        tone: 'border-amber-800/50 bg-amber-950/80 text-amber-200',
        title: 'Companion version mismatch',
        detail: 'Switching to Cloud to avoid sync issues. Update Companion to restore local mode.',
      }
    }
    if (connection.protocolStatus.compatibility === 'warn') {
      return {
        tone: 'border-slate-700/50 bg-slate-900/80 text-slate-200',
        title: 'Companion version unclear',
        detail: 'If you see sync issues, update Companion.',
      }
    }
    return null
  }, [connection.protocolStatus.compatibility])

  useEffect(() => {
    if (connection.protocolStatus.compatibility !== 'incompatible') {
      protocolFallbackRef.current = false
      if (protocolFallbackActive && mode !== 'cloud') {
        window.setTimeout(() => {
          setProtocolFallbackActive(false)
        }, 0)
      }
      return
    }
    if (protocolFallbackRef.current) return
    protocolFallbackRef.current = true
    window.setTimeout(() => {
      setProtocolFallbackActive(true)
    }, 0)
    if (mode !== 'cloud') {
      setMode('cloud')
    }
  }, [connection.protocolStatus.compatibility, mode, protocolFallbackActive, setMode])

  const handleModeChange = useMemo(() => {
    return async (nextMode: AppMode) => {
      const currentlyCloud = effectiveMode === 'cloud'
      const switchingToCompanion = nextMode === 'local' || nextMode === 'auto'
      const match = location.pathname.match(/^\/room\/([^/]+)\/(control|view)$/)
      const roomId = match?.[1]

      // If switching from Cloud to Auto/Local, save the current Cloud state BEFORE switching
      // so CompanionDataProvider can use it for SYNC_ROOM_STATE.
      if (currentlyCloud && switchingToCompanion && roomId) {
        sessionStorage.setItem('ontime:justSwitchedFromCloud', 'true')
        // Force-save the current Cloud state snapshot right now (before provider switch)
        const room = data.getRoom(roomId)
        const timers = data.getTimers(roomId)
        if (room && timers) {
          const snapshot = {
            roomId,
            savedAt: Date.now(),
            room,
            timers,
          }
          console.info('[mode-switch] saving Cloud snapshot before switch:', {
            isRunning: room.state.isRunning,
            startedAt: room.state.startedAt,
            elapsedOffset: room.state.elapsedOffset,
          })
          window.localStorage.setItem(`ontime:cloudRoomSnapshot:${roomId}`, JSON.stringify(snapshot))
        }
      }

      if (nextMode !== 'cloud') {
        protocolFallbackRef.current = false
        setProtocolFallbackActive(false)
      }
      setMode(nextMode)
    }
  }, [data, effectiveMode, location.pathname, setMode])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {!isViewerRoute && (
        <header className="border-b border-slate-900/60 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link to="/" className="text-lg font-semibold text-white">
              StageTime
            </Link>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              {/* Combined mode selector with color coding */}
              <div className="hidden items-center md:flex">
                <label className="sr-only" htmlFor="mode-select">
                  App mode
                </label>
                <select
                  id="mode-select"
                  value={mode}
                  onChange={(e) => void handleModeChange(e.target.value as AppMode)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${modeTone}`}
                >
                  <option value="cloud">Cloud</option>
                  <option value="auto">Auto{mode === 'auto' ? ` (${effectiveMode})` : ''}</option>
                  <option value="local">Local</option>
                </select>
              </div>

              <div className="hidden items-center gap-2 md:flex">
                <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${cloudTone}`}>
                  {cloudLabel}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCompanionClick()}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${companionTone} transition hover:opacity-80`}
                >
                  {connection.isConnected ? 'Companion' : 'No Companion'}
                </button>
                {queueWarning ? (
                  <div className="rounded-full border border-amber-900/60 bg-amber-950/40 px-2.5 py-1 text-[10px] font-semibold text-amber-200">
                    Queue {Math.round(queueWarning.percent * 100)}%
                  </div>
                ) : null}
                {isElectron() ? (
                  <button
                    type="button"
                    onClick={handleOpenPortDialog}
                    className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200/80 transition hover:border-slate-600"
                  >
                    {portPreference?.activePort ? `Port ${portPreference.activePort}` : 'Port'}
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleAuthClick}
                className="rounded-full border border-slate-800 bg-slate-900 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-slate-600"
                disabled={status === 'loading'}
              >
                {status === 'loading'
                  ? 'Please wait'
                  : isAuthed
                    ? 'Logout'
                    : 'Login'}
              </button>
            </div>
          </div>
        </header>
      )}
      {!isViewerRoute && tokenBanner && (
        <div className="px-4 py-2">
          <div
            className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-full border px-3 py-1 text-xs ${tokenBanner.tone}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-inherit">!</span>
              <span className="font-semibold">{tokenBanner.title}</span>
              <span className="text-white/70">{tokenBanner.detail}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => connection.retryConnection()}
                className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={() => setTokenBannerDismissed(true)}
                className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {!isViewerRoute && reconnectBanner && (
        <div className="px-4 py-2">
          <div
            className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-full border px-3 py-1 text-xs ${reconnectBanner.tone}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-inherit">!</span>
              <span className="font-semibold">{reconnectBanner.title}</span>
              <span className="text-white/70">{reconnectBanner.detail}</span>
              {connection.lastErrorCode ? (
                <span className="text-white/50">Last error: {connection.lastErrorCode}</span>
              ) : null}
              {reconnectCountdown ? (
                <span className="text-white/50">Next attempt in {reconnectCountdown}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {reconnectBanner.variant !== 'stopped' ? (
                <button
                  type="button"
                  onClick={() => connection.retryConnection()}
                  className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
                >
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setReconnectBannerDismissed(true)
                }}
                className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {!isViewerRoute && cloudBanner && (
        <div className="px-4 py-2">
          <div
            className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-full border px-3 py-1 text-xs ${cloudBanner.tone}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-inherit">Cloud</span>
              <span className="font-semibold">{cloudBanner.title}</span>
              <span className="text-white/70">{cloudBanner.detail}</span>
            </div>
            <button
              type="button"
              onClick={() => setCloudBannerDismissed(true)}
              className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {!isViewerRoute && capabilityBanner && (
        <div className="px-4 py-2">
          <div
            className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-full border px-3 py-1 text-xs ${capabilityBanner.tone}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-inherit">!</span>
              <span className="font-semibold">{capabilityBanner.title}</span>
              <span className="text-white/70">{capabilityBanner.detail}</span>
            </div>
            <button
              type="button"
              onClick={() => setCapabilityBannerDismissed(true)}
              className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {protocolWarning && (
        <div className={`border-b px-4 py-3 ${protocolWarning.tone}`}>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-inherit">!</span>
              <p className="text-sm">
                <strong>{protocolWarning.title}</strong> — {protocolWarning.detail}
              </p>
            </div>
            {connection.protocolStatus.compatibility === 'incompatible' ? (
              <button
                type="button"
                onClick={() => setMode('cloud')}
                className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/20"
              >
                Switch to Cloud
              </button>
            ) : null}
          </div>
        </div>
      )}
      {protocolFallbackActive && connection.protocolStatus.compatibility === 'ok' && mode === 'cloud' ? (
        <div className="border-b border-emerald-800/50 bg-emerald-950/80 px-4 py-3 text-emerald-200">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-inherit">✓</span>
              <p className="text-sm">
                <strong>Companion compatible again</strong> — Switch back to Auto or Local to reconnect.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleModeChange('auto')}
              className="rounded-md border border-emerald-700 bg-emerald-900/50 px-2.5 py-1 text-xs font-medium text-emerald-100 transition hover:bg-emerald-800/50"
            >
              Switch to Auto
            </button>
          </div>
        </div>
      ) : null}
      {/* Crash recovery banner (Electron only) */}
      {crashRecovery && (
        <div className="border-b border-emerald-800/50 bg-emerald-950/80 px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              <p className="text-sm text-emerald-200">
                <strong>Recovered session</strong> — Your previous session has been restored.
                {crashRecovery.lastRoomId && (
                  <span className="ml-1 text-emerald-300/80">
                    (Room: {crashRecovery.lastRoomId})
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismissCrashRecovery}
              className="rounded-md border border-emerald-700 bg-emerald-900/50 px-2.5 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-800/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {/* Update available/downloaded banner (Electron only) */}
      {updateState && !updateDismissed && (updateState.available || updateState.downloaded) && (
        <div className="border-b border-blue-800/50 bg-blue-950/80 px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-blue-400">↑</span>
              <p className="text-sm text-blue-200">
                {updateState.downloaded ? (
                  <>
                    <strong>Update ready</strong> — Version {updateState.version} is ready to install.
                  </>
                ) : updateState.downloading ? (
                  <>
                    <strong>Downloading update</strong> — {Math.round(updateState.progress)}%
                  </>
                ) : (
                  <>
                    <strong>Update available</strong> — Version {updateState.version} is available.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {updateState.downloaded ? (
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  className="rounded-md border border-blue-600 bg-blue-700/50 px-2.5 py-1 text-xs font-medium text-blue-100 transition hover:bg-blue-600/50"
                >
                  Restart & Update
                </button>
              ) : !updateState.downloading ? (
                <button
                  type="button"
                  onClick={handleDownloadUpdate}
                  className="rounded-md border border-blue-600 bg-blue-700/50 px-2.5 py-1 text-xs font-medium text-blue-100 transition hover:bg-blue-600/50"
                >
                  Download
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleDismissUpdate}
                className="rounded-md border border-blue-800 bg-blue-900/50 px-2.5 py-1 text-xs font-medium text-blue-300 transition hover:bg-blue-800/50"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
      {showPortDialog ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">Enterprise</p>
                <h2 className="text-lg font-semibold text-white">Controller port</h2>
                <p className="text-sm text-slate-300">
                  Choose a fixed local port for the Controller app. Changes apply after restart.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Switching ports may require re-auth the first time on that new port. Previously used ports remain cached.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPortDialog(false)}
                className="text-slate-400 transition hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <div>
                Active port: <span className="text-white">{portPreference?.activePort ?? '—'}</span>
              </div>
              {portPreference?.envOverride ? (
                <div className="text-xs text-amber-300">
                  Environment override is active; this preference applies once the env override is removed.
                </div>
              ) : null}
              <label className="text-xs font-semibold uppercase text-slate-400" htmlFor="controller-port-input">
                Preferred port
              </label>
              <input
                id="controller-port-input"
                ref={portInputRef}
                type="number"
                min={1}
                max={65535}
                value={portDraft}
                onChange={(event) => {
                  setPortDraft(event.target.value)
                  setPortSaved(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleSavePortPreference()
                  }
                  if (event.key === 'Escape') {
                    setShowPortDialog(false)
                  }
                }}
                placeholder="Leave blank for default"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-slate-600"
              />
              {portError ? <div className="text-xs text-rose-300">{portError}</div> : null}
              {portSaved ? (
                <div className="text-xs text-emerald-300">
                  Saved. Restart the Controller app to apply.
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPortDialog(false)}
                className="rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold uppercase text-slate-300 transition hover:border-slate-600"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleClearPortPreference()}
                className="rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold uppercase text-slate-300 transition hover:border-slate-600"
              >
                Use default
              </button>
              <button
                type="button"
                onClick={() => void handleSavePortPreference()}
                className="rounded-md border border-emerald-600 bg-emerald-700/40 px-3 py-1.5 text-xs font-semibold uppercase text-emerald-100 transition hover:border-emerald-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Degraded banner removed for a cleaner, less noisy UI; status is still visible in the header badge. */}
      <main
        className={
          isViewerRoute ? 'w-full px-0 py-4 sm:px-4' : 'mx-auto max-w-6xl px-4 py-10'
        }
      >
        <Outlet />
      </main>
      {showCompanionWizard ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-300">Local Companion</p>
                <h2 className="text-xl font-semibold text-white">Get Companion connected</h2>
                <p className="text-sm text-slate-300">
                  Use the Companion app to control timers locally. Choose the path that matches your setup.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompanionWizard(false)}
                className="text-slate-400 transition hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="text-sm font-semibold text-white">I need to install Companion</p>
                <ol className="mt-2 space-y-1 text-sm text-slate-300 list-decimal list-inside">
                  <li>Download and install the Companion app.</li>
                  <li>Launch it (it runs in the menu bar/tray).</li>
                  <li>Return here and click “Retry connect”.</li>
                </ol>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDownloadOpen(true)}
                    className="rounded-md border border-amber-400/60 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/10"
                  >
                    Download Companion
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="text-sm font-semibold text-white">I already have Companion</p>
                <div className="mt-2 space-y-2 text-sm text-slate-300">
                  <p className="font-semibold text-emerald-200">Secure local link</p>
                  <p>
                    Your browser needs to trust the Companion running on this machine so offline/local mode works.
                    This approval is local-only and never leaves your device.
                  </p>
                  <p className="text-xs text-slate-400">
                    Arc/Chrome: you’ll see a “Not private” page; click Advanced → Proceed once. Safari/Firefox: approve once if prompted.
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTrustStep(true)
                    }}
                    className="rounded-md border border-emerald-400/60 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/10"
                  >
                    Retry connect
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCompanionWizard(false)}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showTrustStep ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-300">Trust Companion</p>
                <h3 className="text-lg font-semibold text-white">Allow your browser to talk to Companion</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTrustStep(false)}
                className="text-slate-400 transition hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <p>
                We need a one-time approval so your browser can securely reach the Companion app on this device
                (https://localhost). This stays on your machine and does not expose your data online.
              </p>
              <p className="text-slate-200 font-semibold">What happens next?</p>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>A “Not private” page opens. Click Advanced → Proceed to trust localhost.</li>
                <li>This only allows your browser to talk to the Companion on this computer.</li>
                <li>After approving, reload if prompted and the connection will complete.</li>
              </ul>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  openTrustPage()
                  void connection.fetchToken()
                  setShowTrustStep(false)
                  setShowCompanionWizard(false)
                }}
                className="rounded-md border border-emerald-400/60 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/10"
              >
                Open trust page
              </button>
              <button
                type="button"
                onClick={() => setShowTrustStep(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <CompanionDownloadPrompt isOpen={isDownloadOpen} onClose={() => setIsDownloadOpen(false)} />
    </div>
  )
}
