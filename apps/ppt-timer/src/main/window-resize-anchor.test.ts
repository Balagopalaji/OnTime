import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Event, Rectangle, WillResizeDetails } from 'electron'

import { attachCenteredEdgeResize } from './window-resize-anchor'

describe('centered Windows vertical resizing', () => {
  it('prevents and replaces a compact bottom-edge resize', () => {
    const listeners: Array<(event: Event, bounds: Rectangle, details: WillResizeDetails) => void> = []
    const window = {
      getBounds: () => ({ x: 500, y: 300, width: 190, height: 80 }),
      setBounds: vi.fn(),
      on: vi.fn((_event, next) => { listeners.push(next) }),
      off: vi.fn(),
    } as unknown as BrowserWindow
    const dispose = attachCenteredEdgeResize(window, () => true)
    const event = { preventDefault: vi.fn() } as unknown as Event

    listeners[0]!(event, { x: 500, y: 300, width: 380, height: 160 }, { edge: 'bottom' })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(window.setBounds).toHaveBeenCalledWith({ x: 405, y: 300, width: 380, height: 160 })
    dispose()
    expect(window.off).toHaveBeenCalledWith('will-resize', listeners[0])
  })

  it('leaves drawer-open and corner resizes native', () => {
    const listeners: Array<(event: Event, bounds: Rectangle, details: WillResizeDetails) => void> = []
    let enabled = false
    const window = {
      getBounds: () => ({ x: 500, y: 300, width: 190, height: 80 }),
      setBounds: vi.fn(),
      on: vi.fn((_event, next) => { listeners.push(next) }),
      off: vi.fn(),
    } as unknown as BrowserWindow
    attachCenteredEdgeResize(window, () => enabled)
    const event = { preventDefault: vi.fn() } as unknown as Event
    const proposed = { x: 500, y: 300, width: 380, height: 160 }

    listeners[0]!(event, proposed, { edge: 'bottom' })
    enabled = true
    listeners[0]!(event, proposed, { edge: 'bottom-right' })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.setBounds).not.toHaveBeenCalled()
  })
})
