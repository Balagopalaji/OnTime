// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mountApp, renderApp } from './main'
import type { AppView, PreloadApi } from '../shared/ipc-contract'
import type { PowerPointViewState } from '@ontime/presentation-core'

const playing: PowerPointViewState = {
  kind: 'playing',
  slideNumber: 3,
  totalSlides: 10,
  title: 'Deck.pptx',
  filenameBasename: 'Deck.pptx',
  selectedVideoId: 502,
  selectedVideoName: 'Intro.mp4',
  timeMs: 48_000,
  durationMs: 60_000,
  multipleVideos: false,
  videoCount: 1,
  multipleInstanceWarning: false,
  videos: [],
}

const baseView: AppView = {
  revision: 1,
  ctaAvailable: false,
  state: playing,
  timingMode: 'remaining',
  alwaysOnTop: true,
  preset: 'compact',
  displays: [
    { id: '1', label: 'Display 1' },
    { id: '2', label: 'Display 2' },
  ],
  selectedDisplayId: '1',
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('renderApp status', () => {
  it('renders the playing badge, formatted time, slide, and video for a playing view', () => {
    const root = document.createElement('div')
    renderApp(root, baseView, vi.fn())
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('playing')
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
    expect(root.querySelector('#slide')?.textContent).toBe('Slide 3 of 10')
    expect(root.querySelector('#video')?.textContent).toBe('Intro.mp4')
  })

  it('removes numeric time and shows a retry badge on an unavailable view (S-013)', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, state: { kind: 'unavailable', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } }, vi.fn())
    expect(root.querySelector('#time')?.textContent).toBe('--:--')
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('retry')
    expect(root.querySelector('#slide')).toBeNull()
  })

  it('renders the multiple-instance warning overlay (S-012)', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, state: { ...playing, multipleInstanceWarning: true } }, vi.fn())
    expect(root.querySelector('#multi-instance')?.textContent).toBe('Multiple PowerPoint instances detected; verify the deck')
  })
})

describe('renderApp controls dispatch closed-union actions', () => {
  it('timing toggle dispatches setTimingMode', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, baseView, dispatch)
    ;(root.querySelector('button[data-mode="elapsed"]') as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: 'setTimingMode', mode: 'elapsed' })
  })

  it('always-on-top checkbox reflects state and dispatches on change', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, baseView, dispatch)
    const checkbox = root.querySelector('#always-on-top') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'setAlwaysOnTop', enabled: false })
  })

  it('preset button dispatches applyPreset', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, baseView, dispatch)
    ;(root.querySelector('button[data-preset="large"]') as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: 'applyPreset', preset: 'large' })
  })

  it('display select dispatches moveToDisplay with the chosen id', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, baseView, dispatch)
    const select = root.querySelector('#display-select') as HTMLSelectElement
    select.value = '2'
    select.dispatchEvent(new Event('change'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveToDisplay', displayId: '2' })
  })

  it('copy diagnostics dispatches copyDiagnostics', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, baseView, dispatch)
    ;(root.querySelector('#copy-diagnostics') as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: 'copyDiagnostics' })
  })
})

describe('upsell CTA visibility (S-033)', () => {
  it('omits the CTA entirely when no URL is configured', () => {
    const root = document.createElement('div')
    renderApp(root, baseView, vi.fn())
    expect(root.querySelector('#cta')).toBeNull()
  })

  it('renders the CTA and dispatches openUpsell (no URL) when available', () => {
    const root = document.createElement('div')
    const dispatch = vi.fn()
    renderApp(root, { ...baseView, ctaAvailable: true }, dispatch)
    ;(root.querySelector('#cta') as HTMLButtonElement).click()
    expect(dispatch).toHaveBeenCalledWith({ type: 'openUpsell' })
  })

  it('uses the exact spec CTA copy (S-033 D-3)', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, ctaAvailable: true }, vi.fn())
    expect(root.querySelector('#cta')?.textContent).toBe('Need full show control? Try OnTime')
  })
})

describe('mountApp', () => {
  it('renders the initial view and re-renders on each pushed view', async () => {
    let listener: ((view: AppView) => void) | undefined
    const unsubscribe = vi.fn()
    const api: PreloadApi = {
      getView: vi.fn(async () => baseView),
      subscribe: vi.fn((fn) => {
        listener = fn
        return unsubscribe
      }),
      dispatch: vi.fn(async () => undefined),
    }
    const root = document.createElement('div')

    const returned = mountApp({ root, api })
    await flush()

    expect(api.subscribe).toHaveBeenCalledOnce()
    expect(root.querySelector('#time')?.textContent).toBe('00:48')

    listener?.({ ...baseView, revision: 2, state: { ...playing, kind: 'paused', timeMs: 12_000 } })
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('paused')
    expect(root.querySelector('#time')?.textContent).toBe('00:12')
    expect(returned).toBe(unsubscribe)
  })

  it('drops a stale (lower-revision) view so it cannot restore timing after unavailable (S-013)', async () => {
    let listener: ((view: AppView) => void) | undefined
    const api: PreloadApi = {
      // getView resolves late with the stale revision-1 playing view.
      getView: vi.fn(async () => baseView),
      subscribe: vi.fn((fn) => {
        listener = fn
        return () => {}
      }),
      dispatch: vi.fn(async () => undefined),
    }
    const root = document.createElement('div')
    mountApp({ root, api })

    // A newer revision-2 unavailable view arrives before getView() resolves.
    listener?.({ ...baseView, revision: 2, state: { kind: 'unavailable', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } })
    expect(root.querySelector('#time')?.textContent).toBe('--:--')

    // The late revision-1 playing view must be ignored, not restore 00:48.
    await flush()
    expect(root.querySelector('#time')?.textContent).toBe('--:--')
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('retry')
  })
})
