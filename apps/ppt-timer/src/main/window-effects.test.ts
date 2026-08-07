import { describe, expect, it, vi } from 'vitest'

import { createWindowEffects } from './window-effects'
import type { BrowserWindow } from 'electron'
import type { DisplaySnapshot, Rectangle } from './window-placement'

const primary: Rectangle = { x: 0, y: 0, width: 1920, height: 1080 }
const secondary: DisplaySnapshot = { id: 'secondary', label: 'Secondary', workArea: { x: 1920, y: 0, width: 1280, height: 720 } }

function fakeWindow(): BrowserWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isAlwaysOnTop: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    getBounds: vi.fn(() => ({ x: 10, y: 10, width: 320, height: 180 })),
    minimize: vi.fn(),
    close: vi.fn(),
  } as unknown as BrowserWindow
}

describe('createWindowEffects', () => {
  it('routes local window mutations through its injected shell adapters', () => {
    const window = fakeWindow()
    const setProgrammaticBounds = vi.fn()
    const setDetailsState = vi.fn()
    const pushDiagnostic = vi.fn()
    const effects = createWindowEffects({
      getWindow: () => window,
      getPrimaryWorkArea: () => primary,
      getDisplays: () => [{ id: 'primary', label: 'Primary', workArea: primary }, secondary],
      getDisplayWorkArea: () => primary,
      getDisplayScaleFactor: () => 1.25,
      setProgrammaticBounds,
      setDetailsState,
      pushDiagnostic,
      overlayDebug: false,
      alwaysOnTopSetterMarker: { insideAppSetter: false },
    })

    effects.setAlwaysOnTop(true)
    effects.applyPreset('compact')
    effects.moveToDisplay('secondary')
    effects.setPanelMode('videos', 2)
    effects.setPanelMode('options', 2)
    effects.setPanelMode('closed', 2)
    effects.minimizeWindow()
    effects.closeWindow()

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu')
    expect(setProgrammaticBounds).toHaveBeenNthCalledWith(1, expect.any(Object), 'preset')
    expect(setProgrammaticBounds).toHaveBeenNthCalledWith(2, { x: 2400, y: 270, width: 320, height: 180 }, 'moveToDisplay')
    expect(setProgrammaticBounds).toHaveBeenNthCalledWith(3, { x: 10, y: 10, width: 260, height: 166 }, undefined, true)
    expect(setProgrammaticBounds).toHaveBeenNthCalledWith(4, { x: 10, y: 10, width: 260, height: 196 }, undefined, true)
    expect(setProgrammaticBounds).toHaveBeenNthCalledWith(5, { x: 10, y: 10, width: 320, height: 180 }, undefined, true)
    expect(setDetailsState).toHaveBeenNthCalledWith(1, { x: 10, y: 10, width: 320, height: 180 })
    expect(setDetailsState).toHaveBeenNthCalledWith(2, null)
    expect(pushDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ kind: 'display_change', displayId: 'secondary', scaleFactor: 1.25, displayCount: 2 }))
    expect(window.minimize).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledOnce()
  })

  it('does nothing when no usable main window remains', () => {
    const effects = createWindowEffects({
      getWindow: () => null,
      getPrimaryWorkArea: () => primary,
      getDisplays: () => [],
      getDisplayWorkArea: () => primary,
      getDisplayScaleFactor: () => 1,
      setProgrammaticBounds: vi.fn(),
      setDetailsState: vi.fn(),
      pushDiagnostic: vi.fn(),
      overlayDebug: false,
      alwaysOnTopSetterMarker: { insideAppSetter: false },
    })
    expect(() => effects.setAlwaysOnTop(true)).not.toThrow()
    expect(() => effects.applyPreset('large')).not.toThrow()
    expect(() => effects.moveToDisplay('missing')).not.toThrow()
    expect(() => effects.setPanelMode('videos', 2)).not.toThrow()
    expect(() => effects.minimizeWindow()).not.toThrow()
    expect(() => effects.closeWindow()).not.toThrow()
  })
})
