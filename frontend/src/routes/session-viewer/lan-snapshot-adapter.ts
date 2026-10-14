// rebuild-target: app-internal (cloud-web session viewer)
import {
  createServerClock,
  createViewerSession,
  estimateServerNow,
  projectViewerSession,
  reduceViewerSession,
  type ServerClock,
  type ViewerSessionEvent,
  type ViewerSessionState,
} from '@ontime/remote-viewer-contracts'
import { projectPowerPointDisplay } from '@ontime/powerpoint-display'
import type { TimerDisplayModel } from '@ontime/timer-face'
import { PROJECTION_TICK_MS } from './presentation-session-controller'

/**
 * LAN counterpart of the cloud presentation session controller (ISSUE-002
 * S9b). It feeds the same transport-neutral reducer and projection, so the
 * same `RemoteSnapshotV1` reduces to the same display model over either path
 * (RPV-009). Only the transport differs: Companion's `REMOTE_SNAPSHOT`
 * envelopes arrive over an already admitted (paired, viewer-only) socket.
 *
 * The transport is a narrow boundary owned by the caller (the Socket.IO client
 * with pairing/JWT/trust handling is not part of this module), which keeps
 * this file free of socket and Firebase imports and of room/timer contexts.
 *
 * Clock: there is no resolve call on LAN. Companion stamps every envelope with
 * its own clock, which is also the clock domain of the sidecar's
 * `publishedAtMs` (same host), so the first envelope after each (re)connect
 * anchors the monotonic server clock. Freshness (live -> stale ->
 * disconnected) is then purely time-driven, so a silent socket degrades on its
 * own and a cached bootstrap snapshot can never look newer than it is.
 */

export type LanSnapshotTransport = {
  /** Fires on every (re)connection, after admission; the next envelope re-anchors the clock. */
  onConnect: (handler: () => void) => () => void
  /** Raw `REMOTE_SNAPSHOT` / `REMOTE_SNAPSHOT_ENDED` payloads as received; validated here. */
  onEnvelope: (handler: (envelope: unknown) => void) => () => void
  /** The viewer credential was revoked/expired or the handshake was refused for good. */
  onAccessEnded: (handler: () => void) => () => void
  /** Disconnect the socket and drop credentials. */
  close: () => void
}

export type LanControllerOptions = {
  roomId: string
  sessionId: string
  transport: LanSnapshotTransport
  /** Monotonic local clock (performance.now in the browser). */
  now: () => number
  onDisplay: (display: TimerDisplayModel) => void
}

export function createLanSnapshotController(options: LanControllerOptions) {
  const { roomId, sessionId, transport, now, onDisplay } = options
  let state: ViewerSessionState = createViewerSession(sessionId)
  let clock: ServerClock | null = null
  let anchorPending = true
  let released = false
  let lastDisplayKey = ''
  let ticker: ReturnType<typeof setInterval> | null = null
  let unsubscribers: Array<() => void> = []

  const isTerminal = () => state.phase === 'ended' || state.phase === 'access-ended'

  function release(): void {
    if (released) return
    released = true
    if (ticker !== null) clearInterval(ticker)
    ticker = null
    for (const unsubscribe of unsubscribers) unsubscribe()
    unsubscribers = []
    transport.close()
  }

  function render(): void {
    if (released) return
    const serverNow = clock === null ? 0 : estimateServerNow(clock, now())
    const display = projectPowerPointDisplay(projectViewerSession(state, serverNow))
    const key = JSON.stringify(display)
    if (key !== lastDisplayKey) {
      lastDisplayKey = key
      onDisplay(display)
    }
    if (isTerminal()) release()
  }

  function dispatch(event: ViewerSessionEvent): void {
    if (released) return
    state = reduceViewerSession(state, event)
    render()
  }

  function receive(envelope: unknown): void {
    if (released || typeof envelope !== 'object' || envelope === null) return
    const record = envelope as Record<string, unknown>
    if (record.roomId !== roomId) return
    if (record.type === 'REMOTE_SNAPSHOT') {
      if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) return
      if (clock === null || anchorPending) {
        const localMs = now()
        clock = createServerClock({ sentLocalMs: localMs, receivedLocalMs: localMs, serverNowMs: record.timestamp })
        anchorPending = false
      }
      dispatch({ type: 'snapshot', data: record.snapshot })
    } else if (record.type === 'REMOTE_SNAPSHOT_ENDED' && record.sessionId === sessionId) {
      dispatch({ type: 'session-ended' })
    }
  }

  return {
    start(): void {
      if (released || unsubscribers.length > 0) return
      unsubscribers = [
        transport.onConnect(() => {
          anchorPending = true
        }),
        transport.onEnvelope(receive),
        transport.onAccessEnded(() => dispatch({ type: 'access-ended' })),
      ]
      ticker = setInterval(render, PROJECTION_TICK_MS)
      render()
    },
    async stop(): Promise<void> {
      release()
    },
  }
}
