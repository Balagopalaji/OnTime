import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useEffect, useMemo, useState } from 'react'
import { useAppMode, type AppMode } from '../../context/AppModeContext'
import { useCompanionConnection } from '../../context/CompanionConnectionContext'
import { useDataContext } from '../../context/DataProvider'
import { CompanionConnectModal } from '../core/CompanionConnectModal'

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
  const [isConnectOpen, setIsConnectOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  const handleAuthClick = () => {
    if (isAuthed) {
      void logout()
    } else {
      void login()
    }
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
                <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${companionTone}`}>
                  {connection.isConnected ? 'Companion' : 'No Companion'}
                </div>
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
      {/* Degraded banner removed for a cleaner, less noisy UI; status is still visible in the header badge. */}
      <main
        className={
          isViewerRoute ? 'w-full px-0 py-4 sm:px-4' : 'mx-auto max-w-6xl px-4 py-10'
        }
      >
        <Outlet />
      </main>
      <CompanionConnectModal isOpen={isConnectOpen} onClose={() => setIsConnectOpen(false)} />
    </div>
  )
}
