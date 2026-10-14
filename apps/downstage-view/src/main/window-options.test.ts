import { describe, expect, it } from 'vitest'
import { BROWSER_SECURITY } from './security.js'
import { createWindowOptions, VIEWER_PARTITION } from './window-options.js'

describe('createWindowOptions', () => {
  const options = createWindowOptions({ preloadPath: '/app/dist/preload/preload.js' })

  it('applies the hardened web preferences and the preload', () => {
    expect(options.webPreferences).toMatchObject({ ...BROWSER_SECURITY, preload: '/app/dist/preload/preload.js' })
  })

  it('uses an in-memory (non-persistent) partition so no viewer credential reaches disk', () => {
    expect(VIEWER_PARTITION.startsWith('persist:')).toBe(false)
    expect(options.webPreferences?.partition).toBe(VIEWER_PARTITION)
  })

  it('is an ordinary framed, resizable, non-always-on-top window (a viewer must never cover a show)', () => {
    expect(options).toMatchObject({ title: 'Downstage View', show: false, resizable: true })
    expect(options.alwaysOnTop).not.toBe(true)
    expect(options.fullscreen).not.toBe(true)
    expect(options.kiosk).not.toBe(true)
    expect(options.width).toBeGreaterThanOrEqual(options.minWidth ?? 0)
    expect(options.height).toBeGreaterThanOrEqual(options.minHeight ?? 0)
  })
})
