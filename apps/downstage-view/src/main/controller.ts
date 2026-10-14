import type { LauncherInfo, OpenLinkResult } from '../shared/ipc-contract.js'
import { parseViewerLink } from '../shared/viewer-link.js'
import type { ViewerConfig } from './config.js'

export type ViewerScreen = 'launcher' | 'viewer'

/**
 * Decides what the single window shows. `open` is the only way a link reaches
 * the hosted viewer, and it validates in the main process regardless of who
 * asked (launcher field, menu, or a future OS hand-off).
 */
export function createViewerController(deps: {
  config: ViewerConfig | null
  loadViewer(url: string): Promise<void>
  loadLauncher(): Promise<void>
}) {
  let screen: ViewerScreen = 'launcher'
  let queue: Promise<unknown> = Promise.resolve()

  /** Serialise window loads so overlapping requests apply in order. */
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    screen: (): ViewerScreen => screen,
    launcherInfo: (): LauncherInfo => ({ webOrigin: deps.config?.webOrigin ?? null }),
    open(text: string): Promise<OpenLinkResult> {
      if (deps.config === null) return Promise.resolve({ ok: false, code: 'not-configured' })
      const parsed = parseViewerLink(text, deps.config.webOrigin)
      if (!parsed.ok) return Promise.resolve({ ok: false, code: parsed.reason })
      return enqueue(async (): Promise<OpenLinkResult> => {
        try {
          await deps.loadViewer(parsed.url)
          screen = 'viewer'
          return { ok: true }
        } catch {
          // Never surface the error text: it can contain the link and its token.
          return { ok: false, code: 'load-failed' }
        }
      })
    },
    showLauncher(): Promise<void> {
      return enqueue(async () => {
        await deps.loadLauncher()
        screen = 'launcher'
      })
    },
  }
}

export type ViewerController = ReturnType<typeof createViewerController>
