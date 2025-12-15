import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppMode } from '../context/AppModeContext'

const FEATURES = [
  'Real-time timer sync with Firestore listeners',
  'Drag-and-drop rundown routing for multi-segment shows',
  'Public viewer URL with wake-lock friendly display',
]

export const LandingPage = () => {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const { setMode } = useAppMode()

  const handlePrimaryClick = async () => {
    if (user) {
      navigate('/dashboard')
      return
    }

    await login()
    navigate('/dashboard')
  }

  return (
    <section className="space-y-10">
      <div className="rounded-2xl border border-slate-900 bg-gradient-to-br from-slate-900 to-slate-950 px-8 py-12 shadow-card">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">
          StageTime MVP
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl text-white md:text-5xl">
          Keep speakers and show callers in sync with deterministic timers.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
            This frontend mirrors the tasks outlined in `docs/tasks.md`. It
            includes routing, auth guards, a controller workspace, and a viewer
            page powered by Firestore.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={handlePrimaryClick}
            className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
          >
            {user ? 'Go to Dashboard' : 'Enter Demo Dashboard'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('local')
              navigate('/local')
            }}
            className="rounded-full bg-blue-500 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-blue-500/40 transition hover:bg-blue-400"
          >
            Local Mode (Companion)
          </button>
          <button
            type="button"
            onClick={() => navigate('/room/room-main/view')}
            className="rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
          >
            Peek at Viewer
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature}
            className="rounded-xl border border-slate-900 bg-slate-900/60 p-6"
          >
            <p className="text-sm text-slate-300">{feature}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
