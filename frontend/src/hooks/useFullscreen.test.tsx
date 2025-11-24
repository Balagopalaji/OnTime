import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFullscreen } from './useFullscreen'

declare global {
  interface Document {
    fullscreenElement: Element | null
    exitFullscreen: () => Promise<void>
  }
}

describe('useFullscreen', () => {
  let exitSpy: ReturnType<typeof vi.fn>
  let fullscreenElementRef: Element | null

  beforeEach(() => {
    fullscreenElementRef = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElementRef,
      set: (value: Element | null) => {
        fullscreenElementRef = value
      },
    })

    exitSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: exitSpy,
    })
  })

  it('enters and exits fullscreen while tracking state', async () => {
    const element = document.createElement('div') as HTMLElement & {
      requestFullscreen: ReturnType<typeof vi.fn>
    }
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const ref = { current: element }

    const { result } = renderHook(() => useFullscreen(ref))
    expect(result.current.isFullscreen).toBe(false)

    await act(async () => {
      await result.current.enterFullscreen()
    })
    expect(element.requestFullscreen).toHaveBeenCalledTimes(1)

    await act(() => {
      ;(document as Document).fullscreenElement = element
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(true)

    await act(async () => {
      await result.current.exitFullscreen()
    })
    expect(exitSpy).toHaveBeenCalledTimes(1)

    await act(() => {
      ;(document as Document).fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(false)
  })

  it('toggleFullscreen switches between enter and exit actions', async () => {
    const element = document.createElement('div') as HTMLElement & {
      requestFullscreen: ReturnType<typeof vi.fn>
    }
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const ref = { current: element }

    const { result } = renderHook(() => useFullscreen(ref))

    await act(async () => {
      await result.current.toggleFullscreen()
    })
    expect(element.requestFullscreen).toHaveBeenCalledTimes(1)

    await act(() => {
      ;(document as Document).fullscreenElement = element
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(true)

    await act(async () => {
      await result.current.toggleFullscreen()
    })
    expect(exitSpy).toHaveBeenCalledTimes(1)
  })
})
