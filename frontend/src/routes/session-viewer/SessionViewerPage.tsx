// rebuild-target: app-internal (cloud-web session viewer)
import '@ontime/timer-face/timer-face.css'
import './session-viewer.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { announcementFor, patchTimerFace, renderDisclosureList, renderTimerFace, type TimerDisplayModel } from '@ontime/timer-face'
import { createFirebasePresentationTransport } from './firebase-transport'
import type { PresentationTransport } from './presentation-session-controller'
import { scrubViewerToken, takeViewerToken } from './session-link'
import { usePresentationSession } from './usePresentationSession'

/** Everything except timer strings: when unchanged, a tick only patches times in place. */
function structureKey(display: TimerDisplayModel): string {
  return JSON.stringify({
    ...display,
    timeText: undefined,
    disclosureRows: display.disclosureRows.map((row) => ({ ...row, timeText: undefined })),
  })
}

/** Mounts the shared DOM face into a React-owned container. */
function TimerFaceMount({ display, showRows }: { display: TimerDisplayModel; showRows: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastKey = useRef('')
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const key = `${showRows}|${structureKey(display)}`
    if (key === lastKey.current) {
      patchTimerFace(node, display)
      return
    }
    lastKey.current = key
    const rows = showRows ? renderDisclosureList(display.disclosureRows) : null
    node.replaceChildren(...[renderTimerFace(display), rows].filter((child): child is HTMLElement => child !== null))
  }, [display, showRows])
  return <div ref={ref} className="session-viewer-face" />
}

export function SessionViewerPage({
  createTransport = createFirebasePresentationTransport,
}: {
  createTransport?: () => PresentationTransport
}) {
  const { sessionId = '' } = useParams()
  // Read the credential once (fragment, else this tab's stored copy), then remove it from the URL.
  const [token] = useState(() => takeViewerToken(sessionId, window.location.hash))
  useEffect(() => {
    if (window.location.hash) scrubViewerToken()
  }, [])
  const display = usePresentationSession(sessionId, token, createTransport)
  const [open, setOpen] = useState(false)
  const hasRows = display.disclosureRows.length > 0
  const showRows = open && hasRows

  return (
    <main className="session-viewer" data-panel-mode={showRows ? 'videos' : 'closed'}>
      <TimerFaceMount display={display} showRows={showRows} />
      {hasRows && (
        <button
          type="button"
          className="session-viewer-toggle"
          aria-expanded={showRows}
          aria-label={showRows ? 'Hide video list' : 'Show video list'}
          title={showRows ? 'Hide video list' : 'Show video list'}
          onClick={() => setOpen(!showRows)}
        >
          <span className="session-viewer-caret" />
        </button>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcementFor(display)}
      </div>
    </main>
  )
}
