/**
 * App quit lifecycle (S-024, ISSUE-002 S6d), kept free of Electron so it is
 * testable with injected fakes. Closing the last window is the explicit quit
 * path (no tray/background share); minimize/hide never reach here, so they keep
 * the host and any active share running. Quit is held until the PowerPoint
 * helper and the publisher sidecar have closed, bounded by one gate so a hung
 * COM call or sidecar can never wedge exit.
 */

/** Grace period before a hung shutdown is abandoned (S-024). Non-Windows paths resolve within a microtask. */
export const SHUTDOWN_TIMEOUT_MS = 2_000
/** The sidecar's own kill deadline, inside the gate so the helper close and exit still fit. */
export const REMOTE_SHUTDOWN_DEADLINE_MS = SHUTDOWN_TIMEOUT_MS - 500

export type AppLifecycleDeps = {
  host: { shutdown(): Promise<unknown> }
  remoteShare: { shutdown(deadlineMs: number): Promise<unknown> }
  /** `app.quit()`: requests a quit that comes back through `beforeQuit`. */
  quit(): void
  /** `app.exit()`: leaves immediately once shutdown has settled or timed out. */
  exit(code: number): void
  onShutdown?(): void
}

export function createAppLifecycle(deps: AppLifecycleDeps) {
  let quitting = false

  /** A failing side never skips the other or the exit. */
  const settle = (operation: () => Promise<unknown>): Promise<unknown> => {
    try {
      return operation().catch(() => undefined)
    } catch {
      return Promise.resolve()
    }
  }

  const runShutdown = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const gate = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
    })
    try {
      await Promise.race([
        Promise.all([settle(() => deps.host.shutdown()), settle(() => deps.remoteShare.shutdown(REMOTE_SHUTDOWN_DEADLINE_MS))]),
        gate,
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Idempotent: the first caller starts the single bounded shutdown, then exits. */
  const beginShutdown = (): void => {
    if (quitting) return
    quitting = true
    deps.onShutdown?.()
    void runShutdown().finally(() => deps.exit(0))
  }

  return {
    /** Always held until the helper and sidecar settle; a repeated quit must not bypass the gate. */
    beforeQuit: (event: { preventDefault(): void }): void => {
      event.preventDefault()
      beginShutdown()
    },
    /** Closing the only window quits. Hiding or minimizing never emits this. */
    windowAllClosed: (): void => deps.quit(),
    /** Windows logoff/shutdown does not emit `before-quit`; start the same bounded shutdown. */
    sessionEnd: (): void => beginShutdown(),
  }
}

export type AppLifecycle = ReturnType<typeof createAppLifecycle>
