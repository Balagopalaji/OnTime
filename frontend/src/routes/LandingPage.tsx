import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export const LandingPage = () => {
  const { user, login } = useAuth()
  const navigate = useNavigate()

  // Auto-redirect logged-in users to dashboard
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, navigate])

  const handleLogin = async () => {
    await login()
    navigate('/dashboard')
  }

  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm space-y-8 p-8 text-center">
        <h1 className="font-display text-6xl text-white">StageTime</h1>

        <button
          type="button"
          onClick={handleLogin}
          className="w-full rounded-full bg-emerald-500 px-8 py-4 text-base font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
        >
          Sign In
        </button>

        <p className="text-xs text-slate-500">
          Sign in with Google
        </p>
      </div>
    </section>
  )
}
