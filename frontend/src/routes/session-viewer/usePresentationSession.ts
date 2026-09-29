// rebuild-target: app-internal (cloud-web session viewer)
import { useEffect, useState } from 'react'
import type { TimerDisplayModel } from '@ontime/timer-face'
import { createPresentationSessionController, type PresentationTransport } from './presentation-session-controller'

const CONNECTING: TimerDisplayModel = { connection: 'connecting', statusText: 'Connecting', timeText: '--:--', disclosureRows: [] }

const monotonicNow = () => performance.now()

/**
 * Presentation-session adapter for the cloud browser viewer. Deliberately
 * independent of room/timer contexts (useRoom/useTimers/useTimerEngine,
 * UnifiedDataContext, FirebaseDataContext).
 */
export function usePresentationSession(
  sessionId: string,
  token: string | null,
  createTransport: () => PresentationTransport,
): TimerDisplayModel {
  const [display, setDisplay] = useState<TimerDisplayModel>(CONNECTING)
  useEffect(() => {
    let controller: ReturnType<typeof createPresentationSessionController> | null = null
    // Deferred one task, transport included, so StrictMode's discarded first mount creates
    // no Firebase app and the link resolves once.
    const starting = setTimeout(() => {
      controller = createPresentationSessionController({
        sessionId,
        token,
        createTransport,
        now: monotonicNow,
        onDisplay: setDisplay,
      })
      controller.start()
    }, 0)
    return () => {
      clearTimeout(starting)
      void controller?.stop()
    }
  }, [sessionId, token, createTransport])
  return display
}
