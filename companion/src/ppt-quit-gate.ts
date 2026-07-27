// rebuild-target: app-internal (local-companion)
//
// Quit gate + shutdown sequence for the persistent PowerPoint bridge helper.
// The native STA helper (packages/ppt-bridge) is a spawned child whose close is
// asynchronous: the bridge writes `exit`, waits a short grace, then force-kills
// (SIGKILL). If Electron's before-quit returns before that settles, the child
// can be orphaned mid-COM-call and outlive the app. The gate intercepts the
// first before-quit, runs shutdown once, awaits the helper close (bounded by a
// timeout so a hung/rejected close never blocks quit), and then exits.
//
// Contract (pinned by ppt-quit-gate.test.ts):
// - quit is prevented until shutdown's close promise settles (or the timeout);
// - idempotent under repeated before-quit (shutdown + exitApp run at most once);
// - a rejected, thrown, or hung shutdown never blocks quit (catch + timeout race);
// - exitApp fires exactly once.

/** Closeable server/socket handle (structural — accepts Node/Socket.IO servers). */
type Closeable = { close(): unknown } | null

export interface CompanionShutdownHandles {
  /** Stops the PowerPoint polling timer; called first so no new poll spawns a client during quit. */
  stopPowerPointDetectionTimer: () => void
  ioServers: ReadonlyArray<{ close(): unknown }>
  httpServer: Closeable
  httpsServer: Closeable
  tokenServerV4: Closeable
  tokenServerV6: Closeable
  tokenServerTlsV4: Closeable
  tokenServerTlsV6: Closeable
  flushRoomCache(): Promise<void> | void
  stopPowerPointHelper(reason: string): void
  stopPptProbeHelper(reason: string): Promise<void>
}

/**
 * Runs the Companion shutdown sequence (stop polling first, then io servers,
 * http/https, token servers, cache flush, helpers) and returns the persistent
 * helper close promise so the caller can gate quit on it. Late-bound server
 * handles are read at call time, so pass them from inside the before-quit handler.
 */
export function runCompanionShutdown(handles: CompanionShutdownHandles, reason: string): Promise<void> {
  try {
    // Stop PowerPoint polling FIRST so no queued/new poll can enter
    // ensurePptProbeHelper and spawn a client during the gated quit window.
    handles.stopPowerPointDetectionTimer();
    handles.ioServers.forEach((server) => server.close());
    handles.httpServer?.close();
    handles.httpsServer?.close();
    handles.tokenServerV4?.close();
    handles.tokenServerV6?.close();
    handles.tokenServerTlsV4?.close();
    handles.tokenServerTlsV6?.close();
    void handles.flushRoomCache();
    handles.stopPowerPointHelper(reason);
  } catch (error) {
    // A preliminary cleanup step threw (e.g. closing a never-listened server).
    // The persistent helper must still close so it is not orphaned; the gate
    // awaits the returned close promise before exiting.
    console.warn('[companion] shutdown cleanup step threw; still closing helper', error);
  }
  return handles.stopPptProbeHelper(reason);
}

/** Injectable timer sink so tests can drive the shutdown timeout deterministically. */
export type PptQuitSetTimer = (handler: () => void, ms: number) => unknown

export type PptQuitGateOptions = {
  /** Runs exactly once, with exit code 0, once shutdown settles or times out. */
  exitApp: (exitCode: number) => void
  /** Hard upper bound the gate waits on the helper close before exiting anyway. */
  shutdownTimeoutMs?: number
  /** Defaults to the global setTimeout when omitted. */
  setTimeout?: PptQuitSetTimer
}

export type PptQuitGate = {
  /** True once intercept has been called and shutdown is in flight. */
  isRunning(): boolean
  /**
   * Intercept a before-quit. Idempotent: a call while shutdown is already in
   * flight is a no-op. Runs shutdown() once, awaits its returned close promise
   * (rejection/throw swallowed, hung bounded by shutdownTimeoutMs), then calls
   * exitApp(0). Always resolves and never rejects.
   */
  intercept(shutdown: () => Promise<unknown>): Promise<void>
}

export function createPptQuitGate(options: PptQuitGateOptions): PptQuitGate {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2000
  const setTimer: PptQuitSetTimer = options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms))
  let running = false

  return {
    isRunning: () => running,
    intercept: async (shutdown) => {
      if (running) return
      running = true
      let closePromise: Promise<unknown>
      try {
        closePromise = shutdown()
      } catch {
        closePromise = Promise.resolve()
      }
      const timeout = new Promise<void>((resolve) => setTimer(resolve, shutdownTimeoutMs))
      await Promise.race([Promise.resolve(closePromise).catch(() => undefined), timeout])
      options.exitApp(0)
    },
  }
}
