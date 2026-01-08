import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export const CompanionTrustHelper = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem('stagetime.lastPath') : null
  const returnTo =
    searchParams.get('return') ||
    location.state?.from ||
    stored ||
    `${window.location.pathname}${window.location.search}${window.location.hash}` ||
    '/dashboard'
  const absoluteReturn =
    returnTo.startsWith('http://') || returnTo.startsWith('https://')
      ? returnTo
      : `${window.location.origin}${returnTo}`

  useEffect(() => {
    // Open trust page in a new tab/window so user can approve, then redirect back here automatically
    const url = `https://localhost:4441/api/token?return=${encodeURIComponent(absoluteReturn)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [absoluteReturn, navigate, returnTo])

  const openTrustInTab = () => {
    const url = `https://localhost:4441/api/token?return=${encodeURIComponent(absoluteReturn)}`
    window.location.href = url
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center text-slate-100">
      <h1 className="text-2xl font-semibold text-white">Opening trust page…</h1>
      <p className="mt-3 text-sm text-slate-300">
        We’re opening a local trust page in a new tab so your browser can connect to the Companion app. After approving,
        you’ll be sent back to the dashboard automatically.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        If nothing opens, your browser may have blocked the popup. You can manually visit https://localhost:4441/api/token,
        click “Advanced” → “Proceed”, then return to the app.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Using Brave or an ad blocker? Allow this site to connect to localhost or temporarily disable Shields.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2 text-xs text-slate-200">
        <button
          type="button"
          onClick={openTrustInTab}
          className="rounded-full border border-amber-300/60 bg-amber-500/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-200"
        >
          Open trust page
        </button>
        <button
          type="button"
          onClick={() => navigate(returnTo, { replace: true })}
          className="rounded-full border border-slate-700 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
        >
          Return to app
        </button>
      </div>
    </div>
  )
}
