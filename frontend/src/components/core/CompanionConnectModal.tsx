import { useCallback, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCompanionConnection } from '../../context/CompanionConnectionContext'
import { useDataContext } from '../../context/DataProvider'
import { useAppMode } from '../../context/AppModeContext'

const TOKEN_KEY = 'ontime:companionToken'
const LAST_ROOM_KEY = 'ontime:lastCompanionRoomId'

export const CompanionConnectModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) => {
  const { mode, effectiveMode, setMode } = useAppMode()
  const connection = useCompanionConnection()
  const ctx = useDataContext() as ReturnType<typeof useDataContext> & {
    subscribeToCompanionRoom?: (
      roomId: string,
      clientType: 'controller' | 'viewer',
      tokenOverride?: string,
    ) => void
  }

  const [roomId, setRoomId] = useState(() => window.localStorage.getItem(LAST_ROOM_KEY) ?? 'test-room')
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [clientType, setClientType] = useState<'controller' | 'viewer'>('controller')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  const canConnect =
    Boolean(token.trim()) && Boolean(roomId.trim()) && typeof ctx.subscribeToCompanionRoom === 'function'

  const status = useMemo(() => {
    const connectionStatus = connection.isConnected ? 'online' : 'offline'
    const handshake = connection.handshakeStatus ?? 'unknown'
    return { connection: connectionStatus, handshake }
  }, [connection.handshakeStatus, connection.isConnected])

  const fetchToken = useCallback(async () => {
    setIsFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('http://localhost:4001/api/token', {
        headers: { Origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173' },
      })
      if (!res.ok) {
        setFetchError(`Token fetch failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { token?: string }
      if (!data.token) {
        setFetchError('Token fetch returned no token')
        return
      }
      setToken(data.token)
      window.localStorage.setItem(TOKEN_KEY, data.token)
      sessionStorage.setItem(TOKEN_KEY, data.token)
    } catch (err) {
      setFetchError(`Token fetch error: ${String(err)}`)
    } finally {
      setIsFetching(false)
    }
  }, [])

  const connect = useCallback(() => {
    const t = token.trim()
    const r = roomId.trim()
    if (!t || !r) return
    window.localStorage.setItem(LAST_ROOM_KEY, r)
    window.localStorage.setItem(TOKEN_KEY, t)
    sessionStorage.setItem(TOKEN_KEY, t)
    ctx.subscribeToCompanionRoom?.(r, clientType, t)
  }, [clientType, ctx, roomId, token])

  const enableCompanion = useCallback(() => {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    // If online, Auto is the most useful default; otherwise Local.
    setMode(isOnline ? 'auto' : 'local')
  }, [setMode])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Connect Companion</h2>
            <p className="mt-1 text-sm text-slate-300">
              Connect to the local Companion app on this machine (ports 4000/4001).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-900 p-2 text-slate-200 hover:border-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-300">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Room ID</div>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-300">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Role</div>
            <select
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={clientType}
              onChange={(e) => setClientType(e.target.value as 'controller' | 'viewer')}
            >
              <option value="controller">controller</option>
              <option value="viewer">viewer</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-slate-300 md:col-span-2">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Token</div>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="JWT token"
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void fetchToken()}
            disabled={isFetching}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {isFetching ? 'Fetching…' : 'Fetch Token'}
          </button>
          <button
            type="button"
            onClick={connect}
            disabled={!canConnect}
            className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            Connect
          </button>
          <div className="text-sm text-slate-300">
            <span className="mr-3">Connection: {String(status.connection)}</span>
            <span>Handshake: {String(status.handshake)}</span>
          </div>
        </div>

        {fetchError ? (
          <div className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            <p className="mb-2 font-semibold">Companion App Not Found</p>
            <p className="mb-3">{fetchError}</p>
            <div className="flex gap-3">
              <a 
                href="https://github.com/your-username/OnTime/releases/latest" 
                target="_blank" 
                rel="noreferrer"
                className="rounded bg-rose-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Download Companion
              </a>
              <button
                type="button"
                onClick={() => void fetchToken()}
                className="rounded border border-rose-700 bg-transparent px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-900/50"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : null}

        {typeof ctx.subscribeToCompanionRoom !== 'function' ? (
          <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/40 p-3 text-sm text-amber-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Companion is not enabled in the app right now (current mode:{' '}
                <span className="font-mono">{mode === 'auto' ? `auto (${effectiveMode})` : effectiveMode}</span>).
              </span>
              <button
                type="button"
                onClick={enableCompanion}
                className="rounded-full border border-amber-400/60 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:bg-amber-500/15"
              >
                Enable Companion
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

