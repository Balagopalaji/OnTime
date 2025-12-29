import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export const CompanionTrustHelper = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const returnTo = searchParams.get('return') || '/dashboard'
  const absoluteReturn =
    returnTo.startsWith('http://') || returnTo.startsWith('https://')
      ? returnTo
      : `${window.location.origin}${returnTo}`

  useEffect(() => {
    // Open trust page in a new tab/window so user can approve, then redirect back here automatically
    const url = `https://localhost:4441/api/token?return=${encodeURIComponent(absoluteReturn)}`
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      // Popup blocked; navigate back immediately
      navigate(returnTo, { replace: true })
      return
    }

    const timeout = window.setTimeout(() => {
      navigate(returnTo, { replace: true })
    }, 2000)

    return () => {
      if (timeout) window.clearTimeout(timeout)
    }
  }, [absoluteReturn, navigate, returnTo])

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
    </div>
  )
}
