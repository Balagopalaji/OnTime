import { useMemo, useState } from 'react'
import { CompanionDataProvider } from '../context/CompanionDataContext'
import { useDataContext } from '../context/DataContext'

const CompanionTestInner = () => {
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
  const [pin, setPin] = useState('')
  const [clientType, setClientType] = useState<'controller' | 'viewer'>('controller')

  const roomState = useMemo(
    () => (ctx.getRoomState ? ctx.getRoomState(roomId) : ctx.getRoom(roomId)?.state),
    [ctx, roomId],
  )

  const handleJoin = () => {
    ctx.subscribeToRoom?.(roomId, pin, clientType)
  }

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
          <span>PIN</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="border px-2 py-1 rounded bg-slate-900 text-white"
            placeholder="6-digit PIN"
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
        <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={handleJoin}>
          Join
        </button>
      </div>

      <div className="space-y-1">
        <div>Connection: {ctx.connectionStatus}</div>
        <div>Companion mode: {ctx.companionMode ?? 'unknown'}</div>
        <div>
          Capabilities:{' '}
          {ctx.capabilities
            ? JSON.stringify(ctx.capabilities)
            : 'unavailable'}
        </div>
      </div>

      <div className="space-x-2">
        <button
          className="bg-green-600 text-white px-3 py-1 rounded"
          onClick={() => ctx.startTimer?.(roomId)}
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
          onClick={() => ctx.resetTimer?.(roomId)}
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
