import { useCallback, useEffect, useMemo, useState } from 'react'
import { CompanionDataProvider } from '../context/CompanionDataContext'
import { useDataContext } from '../context/DataContext'

const CompanionTestInner = () => {
  const SESSION_TOKEN_KEY = 'ontime:companionToken'
  const ctx = useDataContext() as ReturnType<typeof useDataContext> & {
    subscribeToRoom?: (roomId: string, token: string, clientType?: 'controller' | 'viewer') => void
    getRoomState?: (roomId: string) => unknown
    companionMode?: string
    capabilities?: {
      powerpoint: boolean
      externalVideo: boolean
      fileOperations: boolean
    }
    startTimer?: (roomId: string, timerId?: string) => Promise<void>
    pauseTimer?: (roomId: string) => Promise<void>
    resetTimer?: (roomId: string, timerId?: string) => Promise<void>
  }

  const [roomId, setRoomId] = useState('test-room')
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '')
  const [timerId, setTimerId] = useState('timer-1')
  const [clientType, setClientType] = useState<'controller' | 'viewer'>('controller')

  const roomState = useMemo(
    () => (ctx.getRoomState ? ctx.getRoomState(roomId) : ctx.getRoom(roomId)?.state),
    [ctx, roomId],
  )

  const handleJoin = () => {
    if (!token) return
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    ctx.subscribeToRoom?.(roomId, token, clientType)
  }

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:4001/api/token', {
        headers: {
          Origin: 'http://localhost:5173',
        },
      })
      if (!res.ok) {
        console.warn('[companion-test] Failed to fetch token', res.status)
        return
      }
      const data = (await res.json()) as { token?: string }
      if (data.token) {
        setToken(data.token)
        sessionStorage.setItem(SESSION_TOKEN_KEY, data.token)
      }
    } catch (error) {
      console.warn('[companion-test] Token fetch error', error)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      void fetchToken()
    }
  }, [fetchToken, token])

  return (
    <div className="p-6 space-y-4 text-slate-100">
      <h1 className="text-2xl font-semibold">Companion Test</h1>
      <div className="space-x-2 flex flex-wrap items-center gap-2">
        <label className="space-x-1 text-sm font-medium">
          <span>Room ID</span>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="border px-2 py-1 rounded bg-slate-900 text-white"
          />
        </label>
        <label className="space-x-1 text-sm font-medium">
          <span>Token</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="border px-2 py-1 rounded bg-slate-900 text-white"
            placeholder="JWT token"
          />
        </label>
        <label className="space-x-1 text-sm font-medium">
          <span>Role</span>
          <select
            value={clientType}
            onChange={(e) => setClientType(e.target.value as 'controller' | 'viewer')}
            className="border px-2 py-1 rounded bg-slate-900 text-white"
          >
            <option value="controller">controller</option>
            <option value="viewer">viewer</option>
          </select>
        </label>
        <label className="space-x-1 text-sm font-medium">
          <span>Timer ID</span>
          <input
            value={timerId}
            onChange={(e) => setTimerId(e.target.value)}
            className="border px-2 py-1 rounded bg-slate-900 text-white"
            placeholder="timer-1"
          />
        </label>
        <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={handleJoin}>
          Join
        </button>
        <button className="bg-slate-700 text-white px-3 py-1 rounded" onClick={fetchToken}>
          Fetch Token
        </button>
      </div>

      <div className="space-y-1">
        <div>Connection: {ctx.connectionStatus}</div>
        <div>Handshake: {ctx.handshakeStatus}</div>
        <div>Companion mode: {ctx.companionMode ?? 'unknown'}</div>
        <div>
          Capabilities:{' '}
          {ctx.capabilities
            ? JSON.stringify(ctx.capabilities)
            : 'unavailable'}
        </div>
        <div className="flex items-center gap-3">
          <span>Queue depth: {ctx.queueDepth ?? 0}</span>
          {ctx.isReplayingQueue ? <span className="text-amber-400">📤 Syncing...</span> : null}
          {ctx.queueWarning === 'full' ? (
            <span className="text-red-400">Queue full, some actions may be lost</span>
          ) : null}
        </div>
      </div>

      <div className="space-x-2">
        <button
          className="bg-green-600 text-white px-3 py-1 rounded"
          onClick={() => ctx.startTimer?.(roomId, timerId)}
        >
          Start Timer
        </button>
        <button
          className="bg-yellow-600 text-white px-3 py-1 rounded"
          onClick={() => ctx.pauseTimer?.(roomId, timerId)}
        >
          Pause Timer
        </button>
        <button
          className="bg-gray-700 text-white px-3 py-1 rounded"
          onClick={() => ctx.resetTimer?.(roomId, timerId)}
        >
          Reset Timer
        </button>
      </div>

      <div>
        <h2 className="font-semibold mb-1">Room State</h2>
        <pre className="bg-white text-slate-900 p-3 rounded text-sm overflow-auto">
{JSON.stringify(roomState ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  )
}

export const CompanionTestPage = () => {
  return (
    <CompanionDataProvider>
      <CompanionTestInner />
    </CompanionDataProvider>
  )
}
