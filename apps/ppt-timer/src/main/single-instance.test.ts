import { describe, expect, it, vi } from 'vitest'

import {
  acquireSingleInstanceActivation,
  createSingleInstanceActivation,
  type ActivatableWindow,
  type SingleInstanceApp,
} from './single-instance'

function fakeWindow(options: { minimized?: boolean; visible?: boolean; destroyed?: boolean } = {}) {
  let minimized = options.minimized ?? false
  let visible = options.visible ?? true
  let destroyed = options.destroyed ?? false
  const calls: string[] = []
  const window: ActivatableWindow = {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn(() => {
      calls.push('restore')
      minimized = false
      visible = true
    }),
    isVisible: () => visible,
    show: vi.fn(() => {
      calls.push('show')
      visible = true
    }),
    focus: vi.fn(() => calls.push('focus')),
  }
  return { window, calls, destroy: () => { destroyed = true } }
}

describe('single-instance activation', () => {
  it('quits immediately without registering a handler when the lock is unavailable', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const app: SingleInstanceApp = { requestSingleInstanceLock: () => false, quit, on }

    expect(acquireSingleInstanceActivation(app, vi.fn())).toBeNull()
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('registers one second-instance handler after acquiring the lock', () => {
    const listeners: Array<() => void> = []
    const onSecondInstance = vi.fn()
    const app: SingleInstanceApp = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: (_event, listener) => { listeners.push(listener) },
    }

    const activation = acquireSingleInstanceActivation(app, onSecondInstance)
    expect(activation).not.toBeNull()
    expect(listeners).toHaveLength(1)
    listeners[0]!()
    expect(onSecondInstance).toHaveBeenCalledOnce()
  })

  it('restores and focuses the existing minimized window', () => {
    const activation = createSingleInstanceActivation()
    const existing = fakeWindow({ minimized: true, visible: false })
    activation.windowReady(existing.window)

    activation.requestActivation()

    expect(existing.calls).toEqual(['restore', 'focus'])
  })

  it('shows and focuses an existing hidden window', () => {
    const activation = createSingleInstanceActivation()
    const existing = fakeWindow({ visible: false })
    activation.windowReady(existing.window)

    activation.requestActivation()

    expect(existing.calls).toEqual(['show', 'focus'])
  })

  it('focuses an existing visible window without showing it again', () => {
    const activation = createSingleInstanceActivation()
    const existing = fakeWindow()
    activation.windowReady(existing.window)

    activation.requestActivation()

    expect(existing.calls).toEqual(['focus'])
  })

  it('defers an early second launch until the first window is ready', () => {
    const activation = createSingleInstanceActivation()
    const existing = fakeWindow({ visible: false })

    activation.requestActivation()
    expect(existing.calls).toEqual([])

    activation.windowReady(existing.window)
    expect(existing.calls).toEqual(['show', 'focus'])
  })

  it('does not reactivate a closed or destroyed window', () => {
    const activation = createSingleInstanceActivation()
    const first = fakeWindow()
    activation.windowReady(first.window)
    activation.windowClosed(first.window)
    first.destroy()

    activation.requestActivation()

    expect(first.calls).toEqual([])
  })
})
