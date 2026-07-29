import type { AppDiagEvent } from './diagnostics.js'
import { attachWindowMessageDebug, type WindowMessageDebugWindow } from './overlay-debug.js'

export type WindowMessageLifecycleWindow = WindowMessageDebugWindow & {
  on(event: 'close', listener: (event: { defaultPrevented: boolean }) => void): unknown
  off(event: 'close', listener: (event: { defaultPrevented: boolean }) => void): unknown
  once(event: 'closed', listener: () => void): unknown
}

/** Keep native hooks alive if Electron cancels a close, but never unhook after destruction. */
export function attachWindowMessageDebugLifecycle(
  window: WindowMessageLifecycleWindow,
  push: (event: AppDiagEvent) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
): () => void {
  let closed = false
  let disposeMessages = attachWindowMessageDebug(window, push)
  const closeListener = (event: { defaultPrevented: boolean }): void => {
    disposeMessages()
    schedule(() => {
      if (!closed && event.defaultPrevented && !window.isDestroyed()) disposeMessages = attachWindowMessageDebug(window, push)
    })
  }
  window.on('close', closeListener)
  window.once('closed', () => {
    closed = true
    disposeMessages()
    window.off('close', closeListener)
  })
  return () => {
    if (closed) return
    closed = true
    disposeMessages()
    window.off('close', closeListener)
  }
}
