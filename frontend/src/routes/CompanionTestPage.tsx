import { useCallback, useMemo, useState } from 'react'
import { CompanionDataProvider } from '../context/CompanionDataContext'
import { useCompanionConnection } from '../context/CompanionConnectionContext'
import { useDataContext } from '../context/DataContext'

const CompanionTestInner = () => {
  const SESSION_TOKEN_KEY = 'ontime:companionToken'
  const connection = useCompanionConnection()
  const ctx = useDataContext() as ReturnType<typeof useDataContext> & {
    subscribeToCompanionRoom?: (
      roomId: string,
      clientType: 'controller' | 'viewer',
      tokenOverride?: string,
    ) => void
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
  const [newTitle, setNewTitle] = useState('New timer')
  const [newDuration, setNewDuration] = useState(300)

  const roomState = useMemo(
    () => (ctx.getRoomState ? ctx.getRoomState(roomId) : ctx.getRoom(roomId)?.state),
    [ctx, roomId],
  )
  const roomTimers = useMemo(() => ctx.getTimers?.(roomId) ?? [], [ctx, roomId])
  const selectedTimer = useMemo(
    () => roomTimers.find((timer) => timer.id === timerId) ?? null,
    [roomTimers, timerId],
  )
  const queueInfo = ctx.queueStatus?.[roomId]

  const handleJoin = () => {
    if (!token) return
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    ctx.subscribeToCompanionRoom?.(roomId, clientType, token)
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

  // Manual: click "Fetch Token" to populate session token (avoids setState-in-effect lint rule).

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
        <div>Handshake: {connection.handshakeStatus}</div>
        <div>Companion mode: {ctx.companionMode ?? 'unknown'}</div>
        <div>
          Capabilities:{' '}
          {ctx.capabilities
            ? JSON.stringify(ctx.capabilities)
            : 'unavailable'}
        </div>
        <div className="flex items-center gap-3">
          <span>Queue depth: {queueInfo?.count ?? 0}</span>
          {queueInfo?.nearLimit ? (
            <span className="text-amber-400">Queue nearing limit</span>
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
          onClick={() => ctx.pauseTimer?.(roomId)}
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

      <div className="space-y-2">
        <h2 className="font-semibold">Timer CRUD</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="space-x-1 text-sm font-medium">
            <span>New title</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="border px-2 py-1 rounded bg-slate-900 text-white"
            />
          </label>
          <label className="space-x-1 text-sm font-medium">
            <span>Duration (sec)</span>
            <input
              value={newDuration}
              onChange={(e) => setNewDuration(Number(e.target.value))}
              className="border px-2 py-1 rounded bg-slate-900 text-white w-28"
              type="number"
              min={1}
            />
          </label>
          <button
            className="bg-blue-600 text-white px-3 py-1 rounded"
            onClick={() =>
              void ctx
                .createTimer?.(roomId, { title: newTitle, duration: newDuration })
                .then((timer) => {
                  if (timer) setTimerId(timer.id)
                })
            }
          >
            Create
          </button>
          <button
            className="bg-slate-700 text-white px-3 py-1 rounded"
            onClick={() => void ctx.updateTimer?.(roomId, timerId, { title: `${newTitle} (edited)` })}
            disabled={!selectedTimer}
          >
            Update Title
          </button>
          <button
            className="bg-red-700 text-white px-3 py-1 rounded"
            onClick={() => void ctx.deleteTimer?.(roomId, timerId)}
            disabled={!selectedTimer}
          >
            Delete
          </button>
          <button
            className="bg-slate-700 text-white px-3 py-1 rounded"
            onClick={() => void ctx.reorderTimer?.(roomId, timerId, 0)}
            disabled={!selectedTimer}
          >
            Move to Top
          </button>
        </div>
        {selectedTimer ? (
          <div className="text-xs text-slate-300">
            Selected timer: <span className="font-mono">{selectedTimer.id}</span>
          </div>
        ) : (
          <div className="text-xs text-amber-300">
            Selected timerId not found in this room. Pick one from the list below (click its ID).
          </div>
        )}
        <div className="rounded border border-slate-800">
          <div className="p-2 text-xs uppercase tracking-[0.25em] text-slate-500">Timers</div>
          {roomTimers.length ? (
            <ul className="divide-y divide-slate-800">
              {roomTimers
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((timer) => (
                  <li key={timer.id} className="p-2 flex items-center justify-between gap-2">
                    <button
                      className="text-left flex-1"
                      onClick={() => setTimerId(timer.id)}
                      title="Select this timer"
                    >
                      <div className="text-sm text-white">
                        {timer.title}{' '}
                        <span className="text-xs text-slate-400">
                          ({timer.duration}s, order={timer.order})
                        </span>
                      </div>
                      <div className="font-mono text-xs text-slate-400">{timer.id}</div>
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        className="bg-slate-700 text-white px-2 py-1 rounded text-xs"
                        onClick={() => void ctx.updateTimer?.(roomId, timer.id, { title: `${timer.title} (edited)` })}
                      >
                        Edit
                      </button>
                      <button
                        className="bg-red-700 text-white px-2 py-1 rounded text-xs"
                        onClick={() => void ctx.deleteTimer?.(roomId, timer.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="bg-slate-700 text-white px-2 py-1 rounded text-xs"
                        onClick={() => void ctx.reorderTimer?.(roomId, timer.id, 0)}
                      >
                        Top
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="p-3 text-sm text-slate-400">No timers yet.</div>
          )}
        </div>
        <pre className="bg-white text-slate-900 p-3 rounded text-sm overflow-auto">
{JSON.stringify(roomTimers ?? [], null, 2)}
        </pre>
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
