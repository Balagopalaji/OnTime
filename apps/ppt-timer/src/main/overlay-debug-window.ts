/**
 * Electron binding for the opt-in overlay diagnostics (PPT_TIMER_DEBUG=1),
 * carved out of `main.ts` unchanged. The listener wiring lives in
 * `attachOverlayDebug` (pure module); here we inject the Electron window +
 * screen and a literal-name bind so the per-literal `.on` overloads resolve.
 * Each handler reads passive state and pushes a debug event; none activate
 * the window (see overlay-debug.ts constraints).
 */
import type { BrowserWindow, Screen } from 'electron'
import type { AppDiagEvent } from './diagnostics.js'
import {
  attachAlwaysOnTopChangedDebug,
  attachOverlayDebug,
  attachWindowMessageDebug,
  type AlwaysOnTopSetterMarker,
} from './overlay-debug.js'

export function attachWindowOverlayDebug(
  win0: BrowserWindow,
  screen: Screen,
  logDebug: (event: AppDiagEvent) => void,
  savedAlwaysOnTop: boolean,
  alwaysOnTopSetterMarker: AlwaysOnTopSetterMarker,
): void {
  const disposeOverlayDebug = attachOverlayDebug(win0, screen, (event, listener) => {
    switch (event) {
      case 'ready-to-show': win0.on('ready-to-show', listener); return () => win0.off('ready-to-show', listener)
      case 'show': win0.on('show', listener); return () => win0.off('show', listener)
      case 'hide': win0.on('hide', listener); return () => win0.off('hide', listener)
      case 'focus': win0.on('focus', listener); return () => win0.off('focus', listener)
      case 'blur': win0.on('blur', listener); return () => win0.off('blur', listener)
      case 'restore': win0.on('restore', listener); return () => win0.off('restore', listener)
      case 'minimize': win0.on('minimize', listener); return () => win0.off('minimize', listener)
      case 'moved': win0.on('moved', listener); return () => win0.off('moved', listener)
      case 'resized': win0.on('resized', listener); return () => win0.off('resized', listener)
    }
  }, logDebug, savedAlwaysOnTop)
  const disposeAlwaysOnTopChanged = attachAlwaysOnTopChangedDebug(win0, alwaysOnTopSetterMarker, logDebug)
  const disposeWindowMessages = process.platform === 'win32' ? attachWindowMessageDebug(win0, logDebug) : () => undefined
  // `closed` also covers destroy()/app.exit. Native message hooks belong to
  // the HWND, so their destruction-safe disposer deliberately becomes a
  // no-op here; JS listeners are still removed deterministically.
  win0.once('closed', () => {
    disposeWindowMessages()
    disposeAlwaysOnTopChanged()
    disposeOverlayDebug()
  })
}
