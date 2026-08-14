import { describe, expect, it } from 'vitest'
import { presentationSafeWindowOptions } from './presentation-safe-clicks.js'

describe('presentationSafeWindowOptions', () => {
  it('creates a pointer-interactive, non-activating Windows overlay', () => {
    expect(presentationSafeWindowOptions('win32')).toEqual({
      focusable: false,
      skipTaskbar: true,
    })
  })

  it('does not change non-Windows window behavior', () => {
    expect(presentationSafeWindowOptions('darwin')).toEqual({
      focusable: true,
      skipTaskbar: false,
    })
  })
})
