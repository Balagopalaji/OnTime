import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  type CrashRecoveryData,
  type UpdateState,
} from '../../lib/electron'

export const AppShell = () => {
  const { user, status, login, logout } = useAuth()
  const location = useLocation()
  const isAuthed = Boolean(user)
  const isViewerRoute = /\/room\/[^/]+\/view$/.test(location.pathname)
  const { mode, effectiveMode, setMode } = useAppMode()
  const data = useDataContext() as ReturnType<typeof useDataContext> & {
    flushRoomToFirestore?: (roomId: string) => Promise<void>
    queueStatus?: Record<string, { count: number; max: number; percent: number; nearLimit: boolean }>
  }
  const connection = useCompanionConnection()
  const [isDownloadOpen, setIsDownloadOpen] = useState(false)
  const [showCompanionWizard, setShowCompanionWizard] = useState(false)
  const [showTrustStep, setShowTrustStep] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [crashRecovery, setCrashRecovery] = useState<CrashRecoveryData | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

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

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

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

  const modeTone = useMemo(() => {
    // Color-code modes: cloud=blue, auto=emerald, local=amber
    if (mode === 'cloud') return 'border-blue-400 bg-blue-950/60 text-blue-200'
    if (mode === 'auto') return 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
    return 'border-amber-400 bg-amber-950/60 text-amber-200' // local
  }, [mode])

  const handleModeChange = useMemo(() => {
    return async (nextMode: AppMode) => {
      // If we are currently on Companion provider and switching to Cloud, best-effort flush the active room
      // so Cloud view doesn't "lose" timers/state.
      const currentlyCompanion = effectiveMode === 'local'
      const currentlyCloud = effectiveMode === 'cloud'
      const switchingToCloud = nextMode === 'cloud'
      const switchingToCompanion = nextMode === 'local' || nextMode === 'auto'
      const match = location.pathname.match(/^\/room\/([^/]+)\/(control|view)$/)
      const roomId = match?.[1]

      if (currentlyCompanion && switchingToCloud && roomId && typeof data.flushRoomToFirestore === 'function') {
        try {
          // wait briefly for flush, but don't hang the UI forever
          await Promise.race([
            data.flushRoomToFirestore(roomId),
            new Promise((resolve) => window.setTimeout(resolve, 800)),
          ])
        } catch {
          // ignore
        }
      }

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
                <div
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isOnline
                    ? 'border-emerald-400/60 bg-emerald-950/40 text-emerald-200'
                    : 'border-rose-400/60 bg-rose-950/40 text-rose-200'
                    }`}
                >
                  {isOnline ? 'Online' : 'Offline'}
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
