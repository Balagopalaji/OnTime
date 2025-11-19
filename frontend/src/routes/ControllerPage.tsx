import { useParams } from 'react-router-dom'
import { AlertTriangle, Radio } from 'lucide-react'
import { useMockData } from '../context/MockDataContext'
import { TimerPanel } from '../components/controller/TimerPanel'
import { RundownPanel } from '../components/controller/RundownPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { formatDate } from '../lib/time'

export const ControllerPage = () => {
  const { roomId } = useParams()
  const {
    getRoom,
    getTimers,
    setActiveTimer,
    startTimer,
    pauseTimer,
    resetTimer,
    nudgeTimer,
    createTimer,
    deleteTimer,
    moveTimer,
    updateMessage,
    connectionStatus,
  } = useMockData()

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
        Room not found. Return to the dashboard.
      </div>
    )
  }

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-slate-900 bg-slate-900/80 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Controller View
            </p>
            <h1 className="text-2xl font-semibold text-white">{room.title}</h1>
            <p className="text-sm text-slate-400">
              {room.timezone} • Created {formatDate(room.createdAt, room.timezone)}
            </p>
          </div>
          <ConnectionIndicator status={connectionStatus} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-emerald-400" />
            Active timers: {timers.length}
          </div>
          <ShareLinkButton roomId={room.id} />
        </div>
        {connectionStatus !== 'online' && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} />
            Mock latency enabled. Actions will delay slightly.
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr_320px]">
        <RundownPanel
          timers={timers}
          activeTimerId={room.state.activeTimerId}
          onSelect={(timerId) => {
            void setActiveTimer(room.id, timerId)
          }}
          onStart={(timerId) => {
            void startTimer(room.id, timerId)
          }}
          onDelete={(timerId) => {
            void deleteTimer(room.id, timerId)
          }}
          onMove={(timerId, direction) => {
            void moveTimer(room.id, timerId, direction)
          }}
          onCreate={(input) => {
            void createTimer(room.id, input)
          }}
        />

        <TimerPanel
          timer={activeTimer}
          engine={engine}
          isRunning={room.state.isRunning}
          onStart={() => {
            void startTimer(room.id)
          }}
          onPause={() => {
            void pauseTimer(room.id)
          }}
          onReset={() => {
            void resetTimer(room.id)
          }}
          onNudge={(deltaMs) => {
            void nudgeTimer(room.id, deltaMs)
          }}
        />

        <MessagePanel
          initial={room.state.message}
          onUpdate={(payload) => {
            void updateMessage(room.id, payload)
          }}
        />
      </div>
    </section>
  )
}
