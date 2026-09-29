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

/**
 * Framework-free cloud viewer session (endpoints "Browser operation matrix"):
 * resolve the link and anchor a monotonic server clock, sign in with the
 * viewer token, attach the viewer-state listener, then the snapshot listener;
 * reduce through the shared transport-neutral reducer and project on a 250 ms
 * tick. Transient failures reconnect with capped, jittered backoff on a fresh
 * transport (a denied target can wedge a Firestore client); a refused
 * reconnect is classified by resolve's reason (session ended vs access
 * ended). A terminal state releases listeners and credentials.
 * `stop()` detaches state then snapshot listeners, cancels every timer, and
 * clears credentials. There is no lease to release.
 */

export type ResolveResult = { customToken: string; serverNowMs: number; activeWindowExpiresAtMs: number }
export type ViewerStateDoc = { status: 'active' | 'ended'; viewerGeneration: number; activeWindowExpiresAtMs: number }

/**
 * The Firebase boundary. A listener's `next(null)` means the document does not
 * exist (yet); `error(code)` reports a terminal listener error (the SDK stops
 * the listener) with its Firestore error code.
 */
export type PresentationTransport = {
  resolve: (sessionId: string, token: string) => Promise<ResolveResult>
  signIn: (customToken: string) => Promise<void>
  onViewerState: (sessionId: string, next: (state: ViewerStateDoc | null) => void, error: (code: string) => void) => () => void
  onSnapshot: (sessionId: string, next: (doc: unknown) => void, error: (code: string) => void) => () => void
  /** Sign out and dispose the isolated viewer app (clears credentials). */
  close: () => Promise<void>
}

export type ControllerOptions = {
  sessionId: string
  token: string | null
  /** Builds an isolated transport; called once per (re)connection. */
  createTransport: () => PresentationTransport
  /** Monotonic local clock (performance.now in the browser). */
  now: () => number
  /** Jitter source in [0, 1); injectable for tests. */
  random?: () => number
  onDisplay: (display: TimerDisplayModel) => void
}

export const PROJECTION_TICK_MS = 250
const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 60_000
const RETRY_AFTER_MIN_MS = 1_000
const WRAPPER_KEYS = new Set(['snapshot', 'cleanupAfterMs'])
const RETRYABLE_RESOLVE = new Set(['functions/unavailable', 'functions/internal', 'functions/deadline-exceeded'])
const RETRYABLE_SIGN_IN = new Set(['auth/network-request-failed', 'auth/too-many-requests', 'auth/internal-error'])
/** Listener-driven reconnects that never delivered data before access is declared ended. */
const MAX_EMPTY_RECONNECTS = 5

type CallableError = { code?: string; details?: { retryAfterMs?: unknown } }

/** Accept only the `{snapshot, cleanupAfterMs}` wrapper; anything else is treated as invalid data. */
function unwrapSnapshot(doc: unknown): unknown {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return undefined
  if (Object.keys(doc).some((key) => !WRAPPER_KEYS.has(key))) return undefined
  return (doc as { snapshot?: unknown }).snapshot
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function createPresentationSessionController(options: ControllerOptions) {
  const { sessionId, createTransport, now, onDisplay } = options
  const random = options.random ?? Math.random
  let state: ViewerSessionState = createViewerSession(sessionId)
  let clock: ServerClock | null = null
  let windowExpiresAtMs = Number.POSITIVE_INFINITY
  let stopped = false
  let released = false
  let failures = 0
  let emptyReconnects = 0
  let reconnectPending = false
  let transport: PresentationTransport | null = null
  let lastDisplayKey = ''
  let unsubscribeState: (() => void) | null = null
  let unsubscribeSnapshot: (() => void) | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let ticker: ReturnType<typeof setInterval> | null = null

  const serverNow = () => (clock === null ? 0 : estimateServerNow(clock, now()))
  const isTerminal = () => state.phase === 'ended' || state.phase === 'access-ended'

  /** Viewer state first, then snapshot (endpoint browser step 6 order). */
  function detachListeners(): void {
    unsubscribeState?.()
    unsubscribeSnapshot?.()
    unsubscribeState = null
    unsubscribeSnapshot = null
  }

  function clearTimers(): void {
    if (ticker !== null) clearInterval(ticker)
    ticker = null
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  /** Listeners, timers, and credentials go away once; the final display stays rendered. */
  /** Detach listeners and dispose the current transport (its app and credentials). */
  async function disposeTransport(): Promise<void> {
    detachListeners()
    const current = transport
    transport = null
    await current?.close()
  }

  async function release(): Promise<void> {
    if (released) return
    released = true
    stopped = true
    clearTimers()
    await disposeTransport()
  }

  function render(): void {
    if (released) return
    if (clock !== null && serverNow() >= windowExpiresAtMs) state = reduceViewerSession(state, { type: 'access-ended' })
    const display = projectPowerPointDisplay(projectViewerSession(state, serverNow()))
    const key = JSON.stringify(display)
    if (key !== lastDisplayKey) {
      lastDisplayKey = key
      onDisplay(display)
    }
    if (isTerminal()) void release()
  }

  function dispatch(event: ViewerSessionEvent): void {
    if (released) return
    state = reduceViewerSession(state, event)
    render()
  }

  function later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)
    timers.add(timer)
  }

  /** Capped exponential backoff with ±50% jitter (random() = 0.5 gives the nominal delay). */
  function retry(token: string, delayMs?: number): void {
    if (stopped || released) return
    const nominal = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures)
    failures += 1
    later(delayMs ?? Math.round(nominal * (0.5 + random())), () => void connect(token))
  }

  /**
   * A listener died (the SDK stops it) without a terminal explanation. The
   * whole transport is discarded — a denied target can stall the client's other
   * listeners — and one reconnect is scheduled on a fresh transport; a refused
   * resolve then says whether the session ended. Repeated reconnects that never
   * deliver data end access instead of looping.
   */
  function reconnect(token: string): void {
    if (stopped || released || isTerminal() || reconnectPending) return
    void disposeTransport()
    emptyReconnects += 1
    if (emptyReconnects > MAX_EMPTY_RECONNECTS) {
      dispatch({ type: 'access-ended' })
      return
    }
    reconnectPending = true
    retry(token)
  }

  /** Real data arrived: the connection is healthy, so backoff and the reconnect budget reset. */
  function delivered(): void {
    failures = 0
    emptyReconnects = 0
  }

  async function connect(token: string): Promise<void> {
    reconnectPending = false
    if (stopped || released) return
    transport ??= createTransport()
    const current = transport
    const sentLocalMs = now()
    let resolved: ResolveResult
    try {
      resolved = await current.resolve(sessionId, token)
    } catch (error) {
      const { code, details } = error as CallableError
      if (code === 'functions/resource-exhausted') {
        const hinted = typeof details?.retryAfterMs === 'number' ? details.retryAfterMs : undefined
        retry(token, hinted === undefined ? undefined : clamp(hinted, RETRY_AFTER_MIN_MS, BACKOFF_CAP_MS))
      } else if (code !== undefined && RETRYABLE_RESOLVE.has(code)) {
        retry(token)
      } else {
        const reason = (details as { reason?: unknown } | undefined)?.reason
        dispatch({ type: reason === 'session-ended' ? 'session-ended' : 'access-ended' })
      }
      return
    }
    if (stopped || released) return
    clock = createServerClock({ sentLocalMs, receivedLocalMs: now(), serverNowMs: resolved.serverNowMs })
    windowExpiresAtMs = resolved.activeWindowExpiresAtMs
    try {
      await current.signIn(resolved.customToken)
    } catch (error) {
      if (RETRYABLE_SIGN_IN.has((error as { code?: string }).code ?? '')) {
        retry(token)
      } else {
        console.error('[session-viewer] viewer sign-in failed permanently', (error as { code?: string }).code)
        dispatch({ type: 'access-ended' })
      }
      return
    }
    if (stopped || released || transport !== current) return
    detachListeners()
    unsubscribeState = current.onViewerState(
        sessionId,
        (viewerState) => {
          if (viewerState === null) return
          delivered()
          windowExpiresAtMs = viewerState.activeWindowExpiresAtMs
          if (viewerState.status === 'ended') dispatch({ type: 'session-ended' })
          else render()
        },
        // Denial means this generation lost access (revoke/rotate); anything else is transient.
        (code) => (code === 'permission-denied' ? dispatch({ type: 'access-ended' }) : reconnect(token)),
    )
    unsubscribeSnapshot = current.onSnapshot(
        sessionId,
        (doc) => {
          if (doc === null) return
          delivered()
          dispatch({ type: 'snapshot', data: unwrapSnapshot(doc) })
        },
        // An ended session or revoked link denies the snapshot; the reconnect's resolve says which.
        () => reconnect(token),
    )
    if (ticker === null) ticker = setInterval(render, PROJECTION_TICK_MS)
    render()
  }

  return {
    start(): void {
      render()
      if (options.token === null) dispatch({ type: 'access-ended' })
      else void connect(options.token)
    },
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      await release()
    },
  }
}
