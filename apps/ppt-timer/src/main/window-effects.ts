/**
 * Main-window effects owned by the Electron shell. Keeping these mutations out
 * of the composition root makes controller routing testable without Electron.
 */
import type { BrowserWindow } from 'electron'

import type { WindowEffects } from './controllers.js'
import type { AppDiagEvent } from './diagnostics.js'
import {
  setAlwaysOnTopWithDebug,
  type AlwaysOnTopSetterMarker,
  type ProgrammaticBoundsReason,
} from './overlay-debug.js'
import { applyPreset as placePreset, moveToDisplay as placeMoveToDisplay, type DisplaySnapshot, type Rectangle } from './window-placement.js'

export type CreateWindowEffectsDeps = {
  getWindow(): BrowserWindow | null
  getPrimaryWorkArea(): Rectangle
  getDisplays(): DisplaySnapshot[]
  getDisplayWorkArea(bounds: Rectangle): Rectangle
  getDisplayScaleFactor(bounds: Rectangle): number
  setProgrammaticBounds(bounds: Rectangle, reason: ProgrammaticBoundsReason): void
  pushDiagnostic(event: AppDiagEvent): void
  overlayDebug: boolean
  alwaysOnTopSetterMarker: AlwaysOnTopSetterMarker
}

function currentWorkArea(deps: CreateWindowEffectsDeps, window: BrowserWindow): Rectangle {
  return window.isDestroyed() ? deps.getPrimaryWorkArea() : deps.getDisplayWorkArea(window.getBounds())
}

/** Creates the small imperative adapter consumed by application controllers. */
export function createWindowEffects(deps: CreateWindowEffectsDeps): WindowEffects {
  const usableWindow = (): BrowserWindow | null => {
    const window = deps.getWindow()
    return window && !window.isDestroyed() ? window : null
  }
  return {
    setAlwaysOnTop: (enabled) => {
      const window = usableWindow()
      if (!window) return
      setAlwaysOnTopWithDebug(window, enabled, deps.overlayDebug, deps.pushDiagnostic, deps.alwaysOnTopSetterMarker)
    },
    applyPreset: (preset) => {
      const window = usableWindow()
      if (!window) return
      deps.setProgrammaticBounds(placePreset(window.getBounds(), preset, currentWorkArea(deps, window)), 'preset')
    },
    moveToDisplay: (displayId) => {
      const window = usableWindow()
      if (!window) return
      const target = deps.getDisplays().find((display) => display.id === displayId)
      if (!target) return
      const bounds = window.getBounds()
      deps.setProgrammaticBounds(placeMoveToDisplay(target, { width: bounds.width, height: bounds.height }), 'moveToDisplay')
      deps.pushDiagnostic({
        kind: 'display_change',
        displayId,
        scaleFactor: deps.getDisplayScaleFactor(target.workArea),
        displayCount: deps.getDisplays().length,
      })
    },
    minimizeWindow: () => usableWindow()?.minimize(),
    closeWindow: () => usableWindow()?.close(),
  }
}
