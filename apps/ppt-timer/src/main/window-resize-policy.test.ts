import { describe, expect, it } from 'vitest'
import { createWindowResizePolicy, settingsForResizeEvent } from './window-resize-policy'
import { DEFAULT_SETTINGS } from './settings-schema'

describe('window resize event policy (P2-03)', () => {
  const compact = { x: 10, y: 20, width: 360, height: 220 }
  const large = { x: 10, y: 20, width: 520, height: 320 }

  it('consumes the resize emitted by a programmatic preset and leaves the next user resize unsuppressed', () => {
    const policy = createWindowResizePolicy()
    policy.beforeProgrammaticBounds(compact, large)
    expect(policy.consumeResize()).toBe(true) // BrowserWindow resized from applyPreset
    expect(policy.consumeResize()).toBe(false) // later user drag
  })

  it('does not suppress a display move that preserves dimensions', () => {
    const policy = createWindowResizePolicy()
    policy.beforeProgrammaticBounds(compact, { ...compact, x: 800, y: 30 })
    expect(policy.consumeResize()).toBe(false)
  })

  it('persists manual resize as custom but preserves preset for a suppressed programmatic event', () => {
    const bounds = { x: 100, y: 200, width: 444, height: 333 }
    expect(settingsForResizeEvent({ ...DEFAULT_SETTINGS, sizePreset: 'large' }, bounds, false)).toMatchObject({
      sizePreset: 'large', windowBounds: bounds,
    })
    expect(settingsForResizeEvent({ ...DEFAULT_SETTINGS, sizePreset: 'large' }, bounds, true)).toMatchObject({
      sizePreset: 'custom', windowBounds: bounds,
    })
  })
})
