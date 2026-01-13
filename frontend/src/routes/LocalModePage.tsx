import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppMode } from '../context/AppModeContext'
import { useCompanionConnection } from '../context/CompanionConnectionContext'
import { useDataContext } from '../context/DataProvider'

const SESSION_TOKEN_KEY = 'ontime:companionToken'
const LAST_ROOM_KEY = 'ontime:lastCompanionRoomId'

export const LocalModePage = () => {
  const { mode, setMode } = useAppMode()
  const navigate = useNavigate()
  const connection = useCompanionConnection()
  const ctx = useDataContext() as ReturnType<typeof useDataContext> & {
    subscribeToCompanionRoom?: (
      roomId: string,
      clientType: 'controller' | 'viewer',
      tokenOverride?: string,
    ) => void
  }

  const [roomId, setRoomId] = useState(() => window.localStorage.getItem(LAST_ROOM_KEY) ?? 'test-room')
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '')
  const [clientType, setClientType] = useState<'controller' | 'viewer'>('controller')

  const fetchToken = useCallback(async () => {
    const res = await fetch('http://localhost:4001/api/token', {
      headers: { Origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173' },
    })
    if (!res.ok) return
    const data = (await res.json()) as { token?: string }
    if (data.token) {
      setToken(data.token)
      sessionStorage.setItem(SESSION_TOKEN_KEY, data.token)
    }
  }, [])

  const join = useCallback(() => {
    if (!token || !roomId) return
    window.localStorage.setItem(LAST_ROOM_KEY, roomId)
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    ctx.subscribeToCompanionRoom?.(roomId, clientType, token)
  }, [clientType, ctx, roomId, token])

  const openController = useCallback(() => {
    if (!roomId) return
    navigate(`/room/${encodeURIComponent(roomId)}/control`)
  }, [navigate, roomId])

  const openViewer = useCallback(() => {
    if (!roomId) return
    navigate(`/room/${encodeURIComponent(roomId)}/view`)
  }, [navigate, roomId])

  return (
    <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-slate-900 bg-slate-900/50 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">Local Mode</h1>
        <p className="text-sm text-slate-300">
          Connect the main app to the Companion running on this machine (ports 4000/4001).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Mode</div>
          <select
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'auto' | 'cloud' | 'local')}
          >
            <option value="auto">auto (freshest source)</option>
            <option value="local">local (Companion preferred)</option>
            <option value="cloud">cloud (Firebase preferred)</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Room ID</div>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Token</div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="JWT token"
            className="w-[28rem] max-w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-300">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Role</div>
          <select
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={clientType}
            onChange={(e) => setClientType(e.target.value as 'controller' | 'viewer')}
          >
            <option value="controller">controller</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="rounded bg-slate-700 px-4 py-2 text-white" onClick={fetchToken} type="button">
          Fetch Token
        </button>
        <button className="rounded bg-emerald-600 px-4 py-2 font-semibold text-slate-950" onClick={join} type="button">
          Connect
        </button>
        <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={openController} type="button">
          Open Controller
        </button>
        <button className="rounded bg-slate-800 px-4 py-2 text-white" onClick={openViewer} type="button">
          Open Viewer
        </button>
      </div>

      <div className="text-sm text-slate-300">
        <div>Connection: {connection.isConnected ? 'online' : 'offline'}</div>
        <div>Handshake: {String(connection.handshakeStatus ?? 'unknown')}</div>
      </div>
    </div>
  )
}
