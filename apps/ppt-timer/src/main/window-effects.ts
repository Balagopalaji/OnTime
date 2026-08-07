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
import {
  applyPreset as placePreset,
  expandPanelBounds,
  moveToDisplay as placeMoveToDisplay,
  restoreCompactBounds,
  type DisplaySnapshot,
  type Rectangle,
} from './window-placement.js'

export type CreateWindowEffectsDeps = {
  getWindow(): BrowserWindow | null
  getPrimaryWorkArea(): Rectangle
  getDisplays(): DisplaySnapshot[]
  getDisplayWorkArea(bounds: Rectangle): Rectangle
  getDisplayScaleFactor(bounds: Rectangle): number
  setProgrammaticBounds(bounds: Rectangle, reason?: ProgrammaticBoundsReason, transient?: boolean): void
  setDetailsState(compactBounds: Rectangle | null): void
  pushDiagnostic(event: AppDiagEvent): void
  overlayDebug: boolean
  alwaysOnTopSetterMarker: AlwaysOnTopSetterMarker
}

function currentWorkArea(deps: CreateWindowEffectsDeps, window: BrowserWindow): Rectangle {
  return window.isDestroyed() ? deps.getPrimaryWorkArea() : deps.getDisplayWorkArea(window.getBounds())
}

/** Creates the small imperative adapter consumed by application controllers. */
export function createWindowEffects(deps: CreateWindowEffectsDeps): WindowEffects {
  let compactBounds: Rectangle | null = null
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
    setPanelMode: (mode, totalVideoCount) => {
      const window = usableWindow()
      if (!window) return
      if (mode !== 'closed') {
        if (!compactBounds) {
          compactBounds = window.getBounds()
          deps.setDetailsState(compactBounds)
        }
        deps.setProgrammaticBounds(
          expandPanelBounds(compactBounds, currentWorkArea(deps, window), mode, totalVideoCount),
          undefined,
          true,
        )
        return
      }
      if (!compactBounds) return
      const restore = restoreCompactBounds(compactBounds, currentWorkArea(deps, window))
      deps.setProgrammaticBounds(restore, undefined, true)
      compactBounds = null
      deps.setDetailsState(null)
    },
    minimizeWindow: () => usableWindow()?.minimize(),
    closeWindow: () => usableWindow()?.close(),
  }
}
