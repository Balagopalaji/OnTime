// rebuild-target: app-internal (cloud-web session viewer)
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createFirebasePresentationTransport } from './firebase-transport'
import type { PresentationTransport } from './presentation-session-controller'
import { scrubViewerToken, takeViewerToken } from './session-link'
import { SessionViewerFace } from './SessionViewerFace'
import { usePresentationSession } from './usePresentationSession'

export function SessionViewerPage({
  createTransport = createFirebasePresentationTransport,
}: {
  createTransport?: () => PresentationTransport
}) {
  const { sessionId = '' } = useParams()
  // Read the credential (fragment, else this tab's stored copy), then remove it from the URL.
  const [token, setToken] = useState(() => takeViewerToken(sessionId, window.location.hash))
  useEffect(() => {
    if (window.location.hash) scrubViewerToken()
    // A newly opened link in the same tab changes only the fragment (no reload): adopt it.
    const onHashChange = () => {
      const next = takeViewerToken(sessionId, window.location.hash)
      if (window.location.hash) scrubViewerToken()
      if (next !== null) setToken(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [sessionId])
  const display = usePresentationSession(sessionId, token, createTransport)
  return <SessionViewerFace display={display} />
}
