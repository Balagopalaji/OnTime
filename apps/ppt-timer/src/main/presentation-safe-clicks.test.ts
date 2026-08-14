import { describe, expect, it } from 'vitest'
import { presentationSafeWindowOptions } from './presentation-safe-clicks.js'

describe('presentationSafeWindowOptions', () => {
  it('preserves the normal focusable taskbar window by default', () => {
    expect(presentationSafeWindowOptions('win32', undefined)).toEqual({
      focusable: true,
      skipTaskbar: false,
    })
  })

  it('creates a non-focusable Windows experiment when explicitly enabled', () => {
    expect(presentationSafeWindowOptions('win32', '1')).toEqual({
      focusable: false,
      skipTaskbar: true,
    })
  })

  it.each(['0', 'true', 'yes'])('does not enable the experiment for %j', (value) => {
    expect(presentationSafeWindowOptions('win32', value).focusable).toBe(true)
  })

  it('does not change non-Windows window behavior', () => {
    expect(presentationSafeWindowOptions('darwin', '1')).toEqual({
      focusable: true,
      skipTaskbar: false,
    })
  })
})
