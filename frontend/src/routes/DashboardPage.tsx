import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, PlayCircle, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useMockData } from '../context/MockDataContext'
import { formatDate, getTimezoneSuggestion } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'
import type { ConnectionStatus } from '../types'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'

export const DashboardPage = () => {
  const { user } = useAuth()
  const {
    rooms,
    createRoom,
    deleteRoom,
    connectionStatus,
    setConnectionStatus,
  } = useMockData()
  const localTimezone = getTimezoneSuggestion()
  const [title, setTitle] = useState('New Broadcast')
  const [timezone, setTimezone] = useState(localTimezone)
  const [isCreating, setIsCreating] = useState(false)
  const allTimezones = useMemo(() => getAllTimezones(), [])

  const myRooms = useMemo(() => {
    if (!user) return []
    return rooms.filter((room) => room.ownerId === user.uid)
  }, [rooms, user])

  if (!user) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-300">
        Sign in to manage rooms.
      </div>
    )
  }

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsCreating(true)
    try {
      await createRoom({ title, timezone, ownerId: user.uid })
      setTitle('New Broadcast')
      setTimezone(localTimezone)
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteRoom = async (roomId: string) => {
    if (!window.confirm('Delete this room and its rundown?')) return
    await deleteRoom(roomId)
  }

  const handleConnectionChange = (status: ConnectionStatus) => {
    setConnectionStatus(status)
  }

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
            <p className="text-sm text-slate-400">
              Rooms are backed by the mock Firestore provider from `docs/tasks.md`.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionIndicator status={connectionStatus} />
            <select
              value={connectionStatus}
              onChange={(event) =>
                handleConnectionChange(event.target.value as ConnectionStatus)
              }
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs uppercase tracking-wide text-slate-200"
            >
              <option value="online">Online</option>
              <option value="reconnecting">Reconnecting</option>
              <option value="offline">Offline</option>
            </select>
          </div>
        </div>
      </header>

      <form
        onSubmit={handleCreateRoom}
        className="rounded-2xl border border-slate-900 bg-slate-900/60 p-6"
      >
        <h2 className="font-semibold text-white">Create Room</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            Title
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label className="text-sm text-slate-300">
            Timezone
            <input
              list="all-timezones"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <datalist id="all-timezones">
              <option value={localTimezone}>{`Local (${localTimezone})`}</option>
              {allTimezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          disabled={isCreating}
        >
          <PlayCircle size={16} />
          {isCreating ? 'Creating...' : 'Create Room'}
        </button>
      </form>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Your Rooms</h2>
          <span className="text-sm text-slate-400">{myRooms.length} total</span>
        </div>
        {myRooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
            Create a room to start building a rundown.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {myRooms.map((room) => (
              <article
                key={room.id}
                className="flex flex-col rounded-2xl border border-slate-900 bg-slate-900/60 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {room.title}
                    </h3>
                    <p className="text-sm text-slate-400">{room.timezone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRoom(room.id)}
                    className="rounded-full border border-transparent p-2 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                    aria-label="Delete room"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-xs text-slate-400">
                  <div>
                    <dt>Created</dt>
                    <dd className="text-slate-200">
                      {formatDate(room.createdAt, room.timezone)}
                    </dd>
                  </div>
                  <div>
                    <dt>Active Timer</dt>
                    <dd className="text-slate-200">
                      {room.state.activeTimerId ?? 'None'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    to={`/room/${room.id}/control`}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    <Clock size={16} />
                    Controller
                  </Link>
                  <Link
                    to={`/room/${room.id}/view`}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-white transition hover:border-white/70"
                  >
                    Viewer
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
