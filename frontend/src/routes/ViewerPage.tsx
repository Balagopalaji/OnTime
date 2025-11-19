import { useParams } from 'react-router-dom'
import { useMockData } from '../context/MockDataContext'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'

export const ViewerPage = () => {
  const { roomId } = useParams()
  const { getRoom, getTimers, connectionStatus } = useMockData()
  const room = roomId ? getRoom(roomId) : undefined
  const timers = roomId ? getTimers(roomId) : []
  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Viewer is offline. Ask the operator for a new link.
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

  const messageBg = {
    green: 'bg-emerald-600/90 text-white',
    yellow: 'bg-amber-400/90 text-slate-900',
    red: 'bg-rose-500/90 text-white',
    blue: 'bg-sky-500/90 text-white',
    white: 'bg-white/90 text-slate-900',
  }[room.state.message.color]

  return (
    <div className={`rounded-3xl border border-slate-900 p-8 text-center shadow-card ${bgClass}`}>
      <div className="flex items-center justify-between text-xs text-slate-300">
        <p>{room.title}</p>
        <ConnectionIndicator status={connectionStatus} />
      </div>
      <div className="mt-12 text-[20vw] font-semibold leading-none text-white">
        {engine.display}
      </div>
      <p className="mt-6 text-sm uppercase tracking-[0.4em] text-slate-300">
        {activeTimer ? activeTimer.title : 'Standby'}
      </p>
      {room.state.message.visible && room.state.message.text && (
        <div
          className={`mt-10 inline-flex rounded-full px-6 py-3 text-lg font-semibold ${messageBg}`}
        >
          {room.state.message.text}
        </div>
      )}
    </div>
  )
}
