import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export const AppShell = () => {
  const { user, status, login, logout } = useAuth()
  const location = useLocation()
  const isAuthed = Boolean(user)

  const handleAuthClick = () => {
    if (isAuthed) {
      void logout()
    } else {
      void login()
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-900/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-semibold text-white">
            StageTime
          </Link>
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <nav className="hidden gap-4 text-sm font-medium text-slate-300 md:flex">
              <Link
                to="/"
                className={`transition hover:text-white ${
                  location.pathname === '/' ? 'text-white' : ''
                }`}
              >
                Home
              </Link>
              {isAuthed && (
                <Link
                  to="/dashboard"
                  className={`transition hover:text-white ${
                    location.pathname.startsWith('/dashboard')
                      ? 'text-white'
                      : ''
                  }`}
                >
                  Dashboard
                </Link>
              )}
            </nav>
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
                : 'Mock Login'}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  )
}
