// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mountApp, patchTimers, renderApp } from './main'
import { timerFitWidthCqw } from './powerpoint-panel'
import type { AppView, PreloadApi } from '../shared/ipc-contract'
import type { PowerPointVideoTile, PowerPointViewState } from '@ontime/presentation-core'

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
  autoOpenVideoList: false,
  preset: 'compact',
  displays: [
    { id: '1', label: 'Display 1' },
    { id: '2', label: 'Display 2' },
  ],
  selectedDisplayId: '1',
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const tile = (partial: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile => ({
  status: 'ready',
  playing: false,
  durationMs: null,
  elapsedMs: null,
  remainingMs: null,
  isFocus: false,
  ...partial,
})

/** A multi-video presentation view carrying the given rows. */
const twoVideoView = (
  videos: PowerPointVideoTile[],
  kind: 'playing' | 'paused' | 'ended' | 'ready' = 'playing',
): AppView => ({
  ...baseView,
  revision: 5,
  state: {
    ...playing,
    kind,
    // Deliberately bogus scalar: the large timer must come from the focus row.
    timeMs: 999_000,
    multipleVideos: videos.length > 1,
    videoCount: videos.length,
    videos,
  },
})

const focusPlaying = tile({
  ordinal: 0,
  id: 11,
  name: 'A.mp4',
  status: 'playing',
  playing: true,
  durationMs: 60_000,
  elapsedMs: 12_000,
  remainingMs: 48_000,
  isFocus: true,
})

const secondPaused = tile({
  ordinal: 1,
  id: 12,
  name: 'B.mp4',
  status: 'paused',
  durationMs: 60_000,
  elapsedMs: 21_000,
  remainingMs: 39_000,
})

const rowTimes = (root: HTMLElement): (string | null)[] =>
  Array.from(root.querySelectorAll('.video-row .video-row-time')).map((node) => node.textContent)

const openDrawer = { panelMode: 'options' as const, setPanelMode: () => {} }
const autoOpening = (view: AppView): AppView => ({ ...view, autoOpenVideoList: true })

describe('renderApp status', () => {
  it('gives longer hour-formatted timers a narrower responsive width factor', () => {
    expect(timerFitWidthCqw('00:00')).toBeGreaterThan(timerFitWidthCqw('1:00:00'))
    expect(timerFitWidthCqw('1:00:00')).toBeGreaterThan(timerFitWidthCqw('10:00:00'))
  })

  it('renders only the status and focused time on the closed active surface', () => {
    const root = document.createElement('div')
    renderApp(root, baseView, vi.fn())
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('playing')
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
    expect((root.querySelector('#time') as HTMLElement).style.getPropertyValue('--time-fit-width')).toMatch(/cqw$/)
    expect(root.querySelector('#slide')).toBeNull()
    expect(root.querySelector('#video')).toBeNull()
    expect(root.querySelector('#title')).toBeNull()
    expect(root.querySelector('#settings-toggle')?.getAttribute('title')).toBe('Show timer options')
    expect(root.querySelector('#settings-toggle')?.getAttribute('aria-label')).toBe('Show timer options')
  })

  it('removes numeric time and shows a retry badge on an unavailable view (S-013)', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, state: { kind: 'unavailable', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } }, vi.fn())
    expect(root.querySelector('#time')?.textContent).toBe('--:--')
    expect(root.querySelector('#badge')?.getAttribute('data-badge')).toBe('retry')
    expect(root.querySelector('#slide')).toBeNull()
  })

  it('keeps diagnostic metadata out of the compact options tray', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, state: { ...playing, multipleInstanceWarning: true } }, vi.fn(), 0, openDrawer)
    expect(root.querySelector('#multi-instance')).toBeNull()
    expect(root.textContent).not.toContain('Deck.pptx')
  })
})

describe('timer-only controls', () => {
  it('renders timer mode without configuration controls or removed legacy controls', () => {
    const root = document.createElement('div')
    renderApp(root, { ...baseView, ctaAvailable: true }, vi.fn())
    expect(root.querySelector('#settings-toggle')).not.toBeNull()
    expect(root.querySelector('#timing-mode')).toBeNull()
    expect(root.querySelector('#always-on-top')).toBeNull()
    expect(root.querySelector('#copy-diagnostics')).toBeNull()
    expect(root.querySelector('[data-preset], #display-select, #cta')).toBeNull()
  })

  it('renders only the labelled compact operational button strip in options', () => {
    const root = document.createElement('div')
    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn(), 0, openDrawer)
    expect(root.querySelector('#panel-tray')).not.toBeNull()
    expect(root.querySelector('#timing-mode')?.textContent).toBe('Remaining')
    expect(root.querySelector('#always-on-top')?.textContent).toBe('On top')
    expect(root.querySelector('#always-on-top')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#auto-open-video-list')?.textContent).toBe('Auto open')
    expect(root.querySelector('#auto-open-video-list')?.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('#auto-open-video-list')?.getAttribute('title')).toContain('Automatically open')
    expect(root.querySelector('#copy-diagnostics')?.textContent).toBe('Diagnostics')
    expect(root.querySelector('.option-strip')?.children).toHaveLength(4)
    expect(Array.from(root.querySelectorAll('.option-strip > button')).map((node) => node.id)).toEqual([
      'timing-mode',
      'always-on-top',
      'auto-open-video-list',
      'copy-diagnostics',
    ])
    expect(root.querySelector('.option-strip #minimize-window')).toBeNull()
    expect(root.querySelector('.option-strip #close-window')).toBeNull()
    expect(root.querySelector('#minimize-window')?.textContent).toBe('—')
    expect(root.querySelector('#close-window')?.textContent).toBe('×')
    expect(root.querySelector('.window-controls')?.getAttribute('role')).toBe('group')
    expect(root.querySelector('.window-controls')?.getAttribute('aria-label')).toBe('Window controls')
    expect(root.querySelector('#remote-access')).toBeNull()
    for (const id of ['panel-collapse', 'panel-switch', 'timing-mode', 'always-on-top', 'auto-open-video-list', 'copy-diagnostics', 'minimize-window', 'close-window']) {
      const button = root.querySelector(`#${id}`)
      expect(button?.getAttribute('title'), id).toBeTruthy()
      expect(button?.getAttribute('aria-label'), id).toBeTruthy()
    }
  })

  it('uses one accessible gear toggle for videos and options without replacing the tray caret', () => {
    const root = document.createElement('div')
    const setPanelMode = vi.fn()
    const view = twoVideoView([focusPlaying, secondPaused])
    renderApp(root, view, vi.fn(), 0, { panelMode: 'videos', setPanelMode })
    const gear = root.querySelector('#panel-switch') as HTMLButtonElement
    expect(gear.textContent).toBe('⚙')
    expect(gear.title).toBe('Show options')
    expect(gear.getAttribute('aria-expanded')).toBe('false')
    expect(gear.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('#panel-collapse')).not.toBeNull()
    gear.click()
    expect(setPanelMode).toHaveBeenCalledWith('options')

    setPanelMode.mockClear()
    renderApp(root, twoVideoView([focusPlaying]), vi.fn(), 0, {
      panelMode: 'options',
      setPanelMode,
    })
    const singleGear = root.querySelector('#panel-switch') as HTMLButtonElement
    expect(singleGear.title).toBe('Hide options')
    expect(singleGear.getAttribute('aria-expanded')).toBe('true')
    singleGear.click()
    expect(setPanelMode).toHaveBeenCalledWith('closed')
  })

  it('pins the bare disclosure caret bottom-right and keeps the all-row tray scrollbar-free', () => {
    const candidate = ['src/renderer/styles.css', 'apps/ppt-timer/src/renderer/styles.css']
      .map((relative) => resolve(process.cwd(), relative))
      .find((absolute) => existsSync(absolute))
    expect(candidate).toBeDefined()
    const css = readFileSync(candidate as string, 'utf8')
    expect(css).toMatch(/\.controls\[data-panel-mode="closed"\][\s\S]*?right:\s*1px;[\s\S]*?bottom:\s*1px;/)
    expect(css).toMatch(/\.tray-collapse\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*1px;[\s\S]*?bottom:\s*1px;/)
    expect(css).toMatch(/\.tray-switch\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*23px;[\s\S]*?bottom:\s*1px;/)
    expect(css).toMatch(/\.window-controls\s*\{[\s\S]*?top:\s*1px;[\s\S]*?right:\s*1px;[\s\S]*?opacity:\s*0;[\s\S]*?-webkit-app-region:\s*no-drag;/)
    expect(css).toMatch(/\.window-controls:hover,\s*\.window-controls:focus-within\s*\{[\s\S]*?opacity:\s*1;/)
    expect(css).toMatch(/\.window-control-button\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/)
    expect(css).toMatch(/\.option-strip\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-start;/)
    expect(css).toMatch(/\.option-button\s*\{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*auto;/)
    expect(css).not.toMatch(/\.option-strip\s*\{[\s\S]*?grid-template-columns:/)
    const optionCaps = Array.from(css.matchAll(/--option-[a-z-]+-max:\s*(\d+)px;/g), (match) => Number(match[1]))
    expect(optionCaps).toHaveLength(4)
    // Preferred caps remain bounded; flex-shrink/ellipsis now adapts them when
    // the user's timer is narrower than the historical 260px tray.
    expect(optionCaps.reduce((sum, width) => sum + width, 0) + 6).toBeLessThanOrEqual(207)
    expect(css).toMatch(/\.panel-tray \.videos\s*\{[\s\S]*?overflow-y:\s*visible;/)
    expect(css).toMatch(/#app:not\(\[data-panel-mode="closed"\]\) \.status\s*\{[\s\S]*?flex:\s*1 1 auto;/)
    expect(css).toMatch(/\.controls:not\(\[data-panel-mode="closed"\]\)\s*\{[\s\S]*?flex:\s*0 0 auto;/)
    expect(css).toMatch(/\.panel-tray \.video-row-name\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/)
  })

  it('renders independent window controls in every tray state', () => {
    const root = document.createElement('div')
    const view = twoVideoView([focusPlaying, secondPaused])
    for (const panelMode of ['closed', 'videos', 'options'] as const) {
      renderApp(root, view, vi.fn(), 0, { panelMode, setPanelMode: () => {} })
      const cluster = root.querySelector('.window-controls')
      expect(cluster, panelMode).not.toBeNull()
      expect(cluster?.querySelector('#minimize-window')?.getAttribute('title')).toBe('Minimize window')
      expect(cluster?.querySelector('#close-window')?.getAttribute('aria-label')).toBe('Close window')
    }
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

    // The teardown stops the smoothing tick as well as the subscription.
    returned()
    expect(unsubscribe).toHaveBeenCalledOnce()
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

describe('renderApp focused timer and all-video tray', () => {
  it('keeps the closed surface focused and lists every video in the tray', () => {
    const root = document.createElement('div')
    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn())
    expect(root.querySelector('#video')).toBeNull()
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
    expect(root.querySelector('#videos')).toBeNull()

    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn(), 0, openDrawer)
    const rows = Array.from(root.querySelectorAll('.video-row'))
    expect(root.querySelector('#settings-drawer-title')).toBeNull()
    expect(root.querySelector('.drawer-deck')).toBeNull()
    expect(root.querySelector('.drawer-slide')).toBeNull()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.getAttribute('data-ordinal'))).toEqual(['0', '1'])
    expect(rows[0]?.querySelector('.video-row-name')?.textContent).toBe('A.mp4')
    expect(rows[1]?.querySelector('.video-row-name')?.textContent).toBe('B.mp4')
    expect(rows[1]?.querySelector('.video-row-status')?.textContent).toBe('Paused')
    expect(rowTimes(root)).toEqual(['00:48', '00:39'])
    expect(root.querySelector('#panel-tray')?.getAttribute('aria-label')).toBe('Timer options')
    expect(root.querySelector('#panel-collapse')).not.toBeNull()
    expect(root.querySelector('#panel-switch')?.textContent).toBe('⚙')
    expect(root.querySelector('#panel-switch')?.getAttribute('title')).toBe('Hide options')
    expect(root.querySelector('#panel-switch')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('uses the focus row for the headline rather than the helper scalar', () => {
    const root = document.createElement('div')
    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn(), 0, openDrawer)
    // 999_000 ms (16:39) would appear if the headline fell back to the scalar.
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
    expect(root.querySelector('.video-row[data-ordinal="0"] .video-row-name')?.textContent).toBe('A.mp4')
  })

  it('renders the headline and secondary rows in elapsed mode', () => {
    const root = document.createElement('div')
    renderApp(root, { ...twoVideoView([focusPlaying, secondPaused]), timingMode: 'elapsed' }, vi.fn(), 0, openDrawer)
    expect(rowTimes(root)).toEqual(['00:12', '00:21'])
    expect(root.querySelector('#time')?.textContent).toBe('00:12')
  })

  it('renders no row list for a view without videos', () => {
    const root = document.createElement('div')
    renderApp(root, baseView, vi.fn())
    expect(root.querySelector('#videos')).toBeNull()
  })
})

describe('patchTimers', () => {
  it('rewrites only the timer strings, leaving the rest of the DOM in place', () => {
    const root = document.createElement('div')
    const view = twoVideoView([focusPlaying, secondPaused])
    renderApp(root, view, vi.fn(), 0, openDrawer)

    const timeNode = root.querySelector('#time')
    const statusNode = root.querySelector('.video-row[data-ordinal="1"] .video-row-status')
    const nameNode = root.querySelector('.video-row[data-ordinal="1"] .video-row-name')
    const rowNode = root.querySelector('.video-row[data-ordinal="1"]')

    patchTimers(root, view, 3_000)

    expect(rowTimes(root)).toEqual(['00:45', '00:39'])
    expect(root.querySelector('#time')?.textContent).toBe('00:45')
    // Same nodes, untouched status/name text, and controls still wired.
    expect(root.querySelector('#time')).toBe(timeNode)
    expect(root.querySelector('.video-row[data-ordinal="1"]')).toBe(rowNode)
    expect(statusNode?.textContent).toBe('Paused')
    expect(nameNode?.textContent).toBe('B.mp4')
    expect(root.querySelector('#panel-collapse')).not.toBeNull()
  })

  it('advances two concurrent playing rows independently', () => {
    const root = document.createElement('div')
    const view = twoVideoView([
      focusPlaying,
      tile({ ordinal: 1, name: 'B.mp4', status: 'playing', playing: true, durationMs: 20_000, elapsedMs: 5_000, remainingMs: 15_000 }),
    ])
    renderApp(root, view, vi.fn(), 0, openDrawer)
    expect(rowTimes(root)).toEqual(['00:48', '00:15'])
    patchTimers(root, view, 2_000)
    expect(root.querySelector('#time')?.textContent).toBe('00:46')
    expect(rowTimes(root)).toEqual(['00:46', '00:13'])
  })

  it('freezes paused and ended rows at any advance', () => {
    const root = document.createElement('div')
    const view = twoVideoView([
      tile({ ordinal: 0, name: 'A.mp4', status: 'paused', durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'ended', durationMs: 30_000, elapsedMs: 30_000, remainingMs: 0 }),
    ])
    renderApp(root, view, vi.fn(), 0, openDrawer)
    patchTimers(root, view, 2_000)
    expect(rowTimes(root)).toEqual(['00:48', '00:00'])
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
  })
})

describe('mountApp local interpolation', () => {
  type Harness = {
    root: HTMLElement
    announcer: HTMLElement
    push: (view: AppView) => void
    stop: () => void
    setClock: (value: number) => void
  }

  const mount = (initial: AppView): Harness => {
    let clock = 0
    let listener: ((view: AppView) => void) | undefined
    const api: PreloadApi = {
      // Never resolves: the tick tests drive views through the subscription only.
      getView: vi.fn(() => new Promise<AppView>(() => {})),
      subscribe: vi.fn((fn) => {
        listener = fn
        return () => {}
      }),
      dispatch: vi.fn(async () => undefined),
    }
    const root = document.createElement('div')
    const announcer = document.createElement('div')
    const stop = mountApp({ root, api, announcer, now: () => clock })
    listener?.(initial)
    return {
      root,
      announcer,
      push: (view) => listener?.(view),
      stop,
      setClock: (value) => {
        clock = value
      },
    }
  }

  const withFakeTimers = (body: () => void): void => {
    vi.useFakeTimers()
    try {
      body()
    } finally {
      vi.useRealTimers()
    }
  }

  it('ticks roughly every 250 ms and decrements the playing row locally', () => {
    withFakeTimers(() => {
      const h = mount(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      expect(rowTimes(h.root)).toEqual(['00:48', '00:39'])

      h.setClock(1_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')
      expect(rowTimes(h.root)).toEqual(['00:47', '00:39'])

      h.setClock(1_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      expect(rowTimes(h.root)).toEqual(['00:46', '00:39'])
      h.stop()
    })
  })

  it('keeps advancing without a fresh observation until the known media end', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))

      h.setClock(2_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // Helper silence does not make a confirmed playing clock visibly freeze.
      h.setClock(30_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:18')
      h.setClock(600_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:00')
      expect(h.root.querySelector('#badge')?.textContent).toBe('Playing')
      expect(h.root.querySelector('#message')).toBeNull()
      h.stop()
    })
  })

  it('requires two consistent observations before correcting a discontinuity', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(1_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // One replay/seek-shaped measurement is treated as noise.
      h.push({
        ...twoVideoView([{ ...focusPlaying, elapsedMs: 2_000, remainingMs: 58_000 }, secondPaused]),
        revision: 6,
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // A second advancing sample confirms the correction and becomes the new
      // deterministic anchor.
      h.setClock(2_500)
      h.push({
        ...twoVideoView([{ ...focusPlaying, elapsedMs: 3_000, remainingMs: 57_000 }, secondPaused]),
        revision: 7,
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:57')
      h.setClock(3_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:56')
      h.stop()
    })
  })

  it('does not let a stale revision replace newer timing or rewind the anchor', () => {
    withFakeTimers(() => {
      const h = mount({
        ...twoVideoView([{ ...focusPlaying, elapsedMs: 30_000, remainingMs: 30_000 }, secondPaused]),
        revision: 9,
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:30')

      // A late, lower-revision view carrying older timing must be dropped.
      h.setClock(500)
      h.push({ ...twoVideoView([focusPlaying, secondPaused]), revision: 4 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:30')

      // The revision-9 anchor still stands and keeps moving locally.
      h.setClock(1_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:29')
      h.stop()
    })
  })

  it('does not rewind when the SAME revision is re-delivered (display change)', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(1_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')

      // `revalidatePlacement()` pushes the current view on a display change
      // WITHOUT incrementing the revision. It carries no new reading, so it must
      // neither snap the display back to 00:48 nor move the anchor. Pushed at the
      // same instant as the tick, so the repaint value is unambiguous.
      h.push({
        ...twoVideoView([focusPlaying, secondPaused]),
        displays: [
          { id: '1', label: 'Display 1' },
          { id: '2', label: 'Display 2' },
          { id: '3', label: 'Projector' },
        ],
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')

      h.setClock(1_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      h.stop()
    })
  })

  it('does not rewind when a NEW revision re-emits an identical measurement', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(1_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')

      // A dropped/partial poll: normalization re-emits the prior snapshot's
      // timing under a fresh revision. Identical values are not a new
      // observation, so the anchor holds and the countdown keeps going.
      h.push({ ...twoVideoView([{ ...focusPlaying }, { ...secondPaused }]), revision: 6 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')
      h.setClock(1_900)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // A real discontinuity needs two advancing samples.
      h.setClock(2_000)
      h.push({ ...twoVideoView([{ ...focusPlaying, remainingMs: 58_000, elapsedMs: 2_000 }, secondPaused]), revision: 7 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      h.setClock(3_000)
      h.push({ ...twoVideoView([{ ...focusPlaying, remainingMs: 57_000, elapsedMs: 3_000 }, secondPaused]), revision: 8 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:57')
      h.stop()
    })
  })

  it('keeps counting through normal newer COM measurements without re-anchoring', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      // The helper advances normally: each newer reading confirms playback and
      // should not create a one-second snap at the delivery boundary.
      for (let index = 1; index <= 5; index += 1) {
        h.setClock(index * 1_000)
        h.push({
          ...twoVideoView([{ ...focusPlaying, elapsedMs: 12_000 + index * 1_000, remainingMs: 48_000 - index * 1_000 }, { ...secondPaused }]),
          revision: 5 + index,
        })
        vi.advanceTimersByTime(250)
      }
      expect(h.root.querySelector('#time')?.textContent).toBe('00:43')
      expect(h.root.querySelector('#badge')?.textContent).toBe('Playing')
      h.stop()
    })
  })

  it('drops all timing anchors when a non-presentation state arrives', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(500)
      h.push({
        ...baseView,
        revision: 7,
        state: { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false },
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('--:--')
      expect(h.root.querySelector('#videos')).toBeNull()

      h.setClock(5_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('--:--')
      expect(h.root.querySelector('#message')?.textContent).toBe('No slideshow running')
      h.stop()
    })
  })
})

describe('control stability across pushes', () => {
  it('auto-opens without focus, honours dismissal, and resets it on a new slide', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.append(root)
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const stop = mountApp({ root, api, announcer: null, now: () => 0 })
      const outside = document.createElement('button')
      document.body.append(outside)
      outside.focus()
      listener?.(autoOpening(twoVideoView([focusPlaying, secondPaused])))

      expect(document.activeElement).toBe(outside)
      expect(root.querySelector('#videos')).not.toBeNull()
      expect(root.querySelector('#timing-mode')).toBeNull()
      ;(root.querySelector('#panel-switch') as HTMLButtonElement).click()
      expect(root.querySelector('#timing-mode')).not.toBeNull()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(root.querySelector('#timing-mode')).toBeNull()
      expect(root.querySelector('#videos')).not.toBeNull()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(root.querySelector('#panel-tray')).toBeNull()
      expect(document.activeElement).toBe(root.querySelector('#settings-toggle'))
      listener?.({ ...autoOpening(twoVideoView([focusPlaying, secondPaused])), revision: 6 })
      expect(root.querySelector('#panel-tray')).toBeNull()
      const nextSlide = twoVideoView([focusPlaying, secondPaused])
      listener?.({ ...autoOpening(nextSlide), revision: 7, state: { ...nextSlide.state, slideNumber: 4 } as PowerPointViewState })
      expect(root.querySelector('#videos')).not.toBeNull()
      expect(api.dispatch).toHaveBeenCalledTimes(5)
      expect(api.dispatch).toHaveBeenNthCalledWith(1, { type: 'setPanelMode', mode: 'videos', totalVideoCount: 2 })
      expect(api.dispatch).toHaveBeenNthCalledWith(2, { type: 'setPanelMode', mode: 'options', totalVideoCount: 2 })
      expect(api.dispatch).toHaveBeenNthCalledWith(3, { type: 'setPanelMode', mode: 'videos', totalVideoCount: 2 })
      expect(api.dispatch).toHaveBeenNthCalledWith(4, { type: 'setPanelMode', mode: 'closed', totalVideoCount: 2 })
      expect(api.dispatch).toHaveBeenNthCalledWith(5, { type: 'setPanelMode', mode: 'videos', totalVideoCount: 2 })
      outside.remove()
      stop()
    } finally {
      root.remove()
      vi.useRealTimers()
    }
  })

  it('leaves multi-video slides closed by default and closes an auto-owned tray when disabled', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const dispatch = vi.fn(async () => undefined)
      const root = document.createElement('div')
      const stop = mountApp({
        root,
        api: {
          getView: vi.fn(() => new Promise<AppView>(() => {})),
          subscribe: vi.fn((fn) => { listener = fn; return () => {} }),
          dispatch,
        },
        announcer: null,
        now: () => 0,
      })
      const defaultView = twoVideoView([focusPlaying, secondPaused])
      listener?.(defaultView)
      expect(root.querySelector('#panel-tray')).toBeNull()
      expect(dispatch).not.toHaveBeenCalled()

      listener?.({ ...autoOpening(defaultView), revision: 6 })
      expect(root.querySelector('#videos')).not.toBeNull()
      listener?.({ ...defaultView, revision: 7 })
      expect(root.querySelector('#panel-tray')).toBeNull()
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'setPanelMode', mode: 'closed', totalVideoCount: 2 })
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the video stage manually on the first click when auto-open is off', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const dispatch = vi.fn(async () => undefined)
      const root = document.createElement('div')
      const stop = mountApp({
        root,
        api: {
          getView: vi.fn(() => new Promise<AppView>(() => {})),
          subscribe: vi.fn((fn) => { listener = fn; return () => {} }),
          dispatch,
        },
        announcer: null,
        now: () => 0,
      })
      listener?.(twoVideoView([focusPlaying, secondPaused]))
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()
      expect(root.querySelector('#videos')).not.toBeNull()
      expect(root.querySelector('#timing-mode')).toBeNull()
      expect(dispatch).toHaveBeenCalledWith({ type: 'setPanelMode', mode: 'videos', totalVideoCount: 2 })
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('single-video first click skips the empty videos stage', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => { listener = fn; return () => {} }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      const stop = mountApp({ root, api, announcer: null, now: () => 0 })
      listener?.(twoVideoView([focusPlaying]))
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()
      expect(root.querySelector('#timing-mode')).not.toBeNull()
      expect(root.querySelectorAll('.video-row')).toHaveLength(1)
      expect(api.dispatch).toHaveBeenCalledWith({ type: 'setPanelMode', mode: 'options', totalVideoCount: 1 })
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('auto-owned trays collapse at one video while manual options stay open', () => {
    vi.useFakeTimers()
    try {
      const makeHarness = () => {
        let listener: ((view: AppView) => void) | undefined
        const dispatch = vi.fn(async () => undefined)
        const root = document.createElement('div')
        const stop = mountApp({
          root,
          api: {
            getView: vi.fn(() => new Promise<AppView>(() => {})),
            subscribe: vi.fn((fn) => { listener = fn; return () => {} }),
            dispatch,
          },
          announcer: null,
          now: () => 0,
        })
        return { root, dispatch, push: (value: AppView) => listener?.(value), stop }
      }
      const automatic = makeHarness()
      automatic.push(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      automatic.push({ ...autoOpening(twoVideoView([focusPlaying])), revision: 6 })
      expect(automatic.root.querySelector('#panel-tray')).toBeNull()
      expect(automatic.dispatch).toHaveBeenLastCalledWith({ type: 'setPanelMode', mode: 'closed', totalVideoCount: 1 })
      automatic.stop()

      const manual = makeHarness()
      manual.push(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      ;(manual.root.querySelector('#panel-switch') as HTMLButtonElement).click()
      manual.push({ ...twoVideoView([focusPlaying]), revision: 6 })
      expect(manual.root.querySelector('#timing-mode')).not.toBeNull()
      expect(manual.dispatch).toHaveBeenLastCalledWith({ type: 'setPanelMode', mode: 'options', totalVideoCount: 1 })
      manual.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps options controls and focus across a timing-only view push', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      document.body.append(root)
      const stop = mountApp({ root, api, announcer: null, now: () => 0 })
      listener?.(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      ;(root.querySelector('#panel-switch') as HTMLButtonElement).click()

      const controls = root.querySelector('.controls')
      const topButton = root.querySelector('#always-on-top') as HTMLButtonElement
      expect(topButton.getAttribute('aria-pressed')).toBe('true')
      topButton.focus()
      expect(document.activeElement).toBe(topButton)

      listener?.({ ...twoVideoView([{ ...focusPlaying, remainingMs: 47_000 }, secondPaused]), revision: 6 })

      expect(root.querySelector('.controls')).toBe(controls)
      expect(root.querySelector('#always-on-top')).toBe(topButton)
      expect(document.activeElement).toBe(topButton)
      expect(root.querySelector('#auto-open-video-list')?.getAttribute('aria-pressed')).toBe('false')
      // The one-second difference is within the trusted-clock tolerance, so a
      // timing-only push does not rewind the local count at the same instant.
      expect(root.querySelector('#time')?.textContent).toBe('00:48')
      stop()
      root.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores focused always-on-top by stable id when the focus video changes', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.append(root)
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const stop = mountApp({ root, api, announcer: null, now: () => 0 })
      listener?.(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      ;(root.querySelector('#panel-switch') as HTMLButtonElement).click()
      const topButton = root.querySelector('#always-on-top') as HTMLButtonElement
      topButton.focus()

      // Changing the focus swaps the secondary key from ordinal 1 to 0, so the
      // drawer needs a structural redraw rather than its ordinary in-place patch.
      listener?.({
        ...twoVideoView([
          { ...focusPlaying, isFocus: false },
          { ...secondPaused, isFocus: true, status: 'playing', playing: true },
        ]),
        revision: 6,
      })

      expect(root.querySelector('#always-on-top')).not.toBe(topButton)
      expect(document.activeElement).toBe(root.querySelector('#always-on-top'))
      stop()
    } finally {
      root.remove()
      vi.useRealTimers()
    }
  })

  it('dispatches the timing toggle, always-on-top, and diagnostics from settings', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      const dispatched: unknown[] = []
      const stop = mountApp({
        root,
        api: { ...api, dispatch: vi.fn(async (action) => void dispatched.push(action)) },
        announcer: null,
        now: () => 0,
      })
      listener?.(autoOpening(twoVideoView([focusPlaying, secondPaused])))
      ;(root.querySelector('#panel-switch') as HTMLButtonElement).click()
      ;(root.querySelector('#timing-mode') as HTMLButtonElement).click()
      listener?.({ ...autoOpening(twoVideoView([focusPlaying, secondPaused])), revision: 6, timingMode: 'elapsed' })
      ;(root.querySelector('#timing-mode') as HTMLButtonElement).click()
      ;(root.querySelector('#always-on-top') as HTMLButtonElement).click()
      ;(root.querySelector('#auto-open-video-list') as HTMLButtonElement).click()
      ;(root.querySelector('#copy-diagnostics') as HTMLButtonElement).click()
      ;(root.querySelector('#minimize-window') as HTMLButtonElement).click()
      ;(root.querySelector('#close-window') as HTMLButtonElement).click()
      expect(dispatched).toEqual([
        { type: 'setPanelMode', mode: 'videos', totalVideoCount: 2 },
        { type: 'setPanelMode', mode: 'options', totalVideoCount: 2 },
        { type: 'setTimingMode', mode: 'elapsed' },
        { type: 'setTimingMode', mode: 'remaining' },
        { type: 'setAlwaysOnTop', enabled: false },
        { type: 'setAutoOpenVideoList', enabled: false },
        { type: 'copyDiagnostics' },
        { type: 'minimizeWindow' },
        { type: 'closeWindow' },
      ])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

})

describe('accessible announcements', () => {
  it('keeps ticking timers out of the root live region', () => {
    // Resolved from cwd (the app workspace, or the repo root when vitest is run
    // with `--root`); `import.meta` is unavailable under the CJS typecheck and
    // happy-dom resolves `new URL(rel, base)` against the document base.
    const candidate = ['src/renderer/index.html', 'apps/ppt-timer/src/renderer/index.html']
      .map((relative) => resolve(process.cwd(), relative))
      .find((absolute) => existsSync(absolute))
    expect(candidate).toBeDefined()
    const html = readFileSync(candidate as string, 'utf8')
    expect(html).toContain('<main id="app">')
    expect(html).not.toMatch(/<main[^>]*aria-live/)
    expect(html).toMatch(/id="announcer"[^>]*aria-live="polite"/)
  })

  it('does not let the multi-instance warning announce itself on every repaint', () => {
    vi.useFakeTimers()
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      const writes: string[] = []
      const announcer = {
        set textContent(value: string) {
          writes.push(value)
        },
        get textContent(): string | null {
          return writes.length > 0 ? (writes[writes.length - 1] ?? null) : null
        },
      } as unknown as HTMLElement
      const stop = mountApp({ root, api, announcer, now: () => 0 })

      const warned = (revision: number, remainingMs: number): AppView => {
        const view = twoVideoView([{ ...focusPlaying, remainingMs }, secondPaused])
        return { ...view, revision, state: { ...view.state, multipleInstanceWarning: true } }
      }

      listener?.(warned(5, 48_000))
      expect(root.querySelector('#multi-instance')).toBeNull()
      expect(writes).toEqual([
        'Multiple PowerPoint instances detected; verify the deck — Playing — 1. A.mp4: Playing, 2. B.mp4: Paused',
      ])

      // Three more polls with the warning still active: announced once, total.
      listener?.(warned(6, 47_000))
      listener?.(warned(7, 46_000))
      listener?.(warned(8, 45_000))
      expect(root.querySelector('#multi-instance')).toBeNull()
      expect(writes).toHaveLength(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats an explicit announcer: null as disabled, not as auto-detect', () => {
    vi.useFakeTimers()
    // A document-level #announcer exists: an explicit null must NOT fall through
    // to the id lookup and start writing to it.
    const injected = document.createElement('div')
    injected.id = 'announcer'
    document.body.append(injected)
    try {
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      const stop = mountApp({ root, api, announcer: null, now: () => 0 })
      listener?.(twoVideoView([focusPlaying, secondPaused]))
      expect(injected.textContent).toBe('')
      stop()

      // Omitting the key auto-detects it, which is how the real bootstrap wires up.
      const root2 = document.createElement('div')
      let listener2: ((view: AppView) => void) | undefined
      const stop2 = mountApp({
        root: root2,
        api: { ...api, subscribe: vi.fn((fn) => { listener2 = fn; return () => {} }) },
        now: () => 0,
      })
      listener2?.(twoVideoView([focusPlaying, secondPaused]))
      expect(injected.textContent).toBe('Playing — 1. A.mp4: Playing, 2. B.mp4: Paused')
      stop2()
    } finally {
      injected.remove()
      vi.useRealTimers()
    }
  })

  it('announces the status once and stays silent through interpolation ticks', () => {
    vi.useFakeTimers()
    try {
      let clock = 0
      let listener: ((view: AppView) => void) | undefined
      const api: PreloadApi = {
        getView: vi.fn(() => new Promise<AppView>(() => {})),
        subscribe: vi.fn((fn) => {
          listener = fn
          return () => {}
        }),
        dispatch: vi.fn(async () => undefined),
      }
      const root = document.createElement('div')
      // Counting announcer: every assignment is one announcement, so a repeated
      // write of the same string is a failure even though the text is unchanged.
      const writes: string[] = []
      const announcer = {
        set textContent(value: string) {
          writes.push(value)
        },
        get textContent(): string | null {
          return writes.length > 0 ? (writes[writes.length - 1] ?? null) : null
        },
      } as unknown as HTMLElement
      const stop = mountApp({ root, api, announcer, now: () => clock })

      listener?.(twoVideoView([focusPlaying, secondPaused]))
      expect(writes).toEqual(['Playing — 1. A.mp4: Playing, 2. B.mp4: Paused'])

      // Ticks change the timer text but must not touch the live region.
      clock = 1_500
      vi.advanceTimersByTime(250)
      expect(root.querySelector('#time')?.textContent).toBe('00:46')
      expect(writes).toHaveLength(1)

      // A newer view with only new timing must not re-announce.
      listener?.({ ...twoVideoView([{ ...focusPlaying, remainingMs: 40_000 }, secondPaused]), revision: 6 })
      expect(writes).toHaveLength(1)

      // A real status change is announced.
      listener?.({
        ...twoVideoView(
          [{ ...focusPlaying, status: 'ended', playing: false, remainingMs: 0, elapsedMs: 60_000 }, secondPaused],
          'ended',
        ),
        revision: 7,
      })
      expect(writes).toEqual([
        'Playing — 1. A.mp4: Playing, 2. B.mp4: Paused',
        'Ended — 1. A.mp4: Ended, 2. B.mp4: Paused',
      ])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
