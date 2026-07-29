// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mountApp, patchTimers, renderApp } from './main'
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

describe('renderApp per-video rows', () => {
  it('renders one row per video with label, status text, and an independent timer', () => {
    const root = document.createElement('div')
    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn())
    const rows = Array.from(root.querySelectorAll('.video-row'))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.querySelector('.video-row-name')?.textContent).toBe('1. A.mp4')
    expect(rows[0]?.querySelector('.video-row-status')?.textContent).toBe('Playing')
    expect(rows[1]?.querySelector('.video-row-name')?.textContent).toBe('2. B.mp4')
    expect(rows[1]?.querySelector('.video-row-status')?.textContent).toBe('Paused')
    expect(rowTimes(root)).toEqual(['00:48', '00:39'])
  })

  it('highlights exactly the focus row and aligns it with the large timer', () => {
    const root = document.createElement('div')
    renderApp(root, twoVideoView([focusPlaying, secondPaused]), vi.fn())
    const focused = Array.from(root.querySelectorAll('.video-row[data-focus="true"]'))
    expect(focused).toHaveLength(1)
    expect(focused[0]?.querySelector('.video-row-name')?.textContent).toBe('1. A.mp4')
    expect(focused[0]?.classList.contains('focus')).toBe(true)
    // 999_000 ms (16:39) would appear if the headline fell back to the scalar.
    expect(root.querySelector('#time')?.textContent).toBe('00:48')
    expect(root.querySelector('#time')?.textContent).toBe(focused[0]?.querySelector('.video-row-time')?.textContent)
  })

  it('renders each row in elapsed mode when the timing mode is elapsed', () => {
    const root = document.createElement('div')
    renderApp(root, { ...twoVideoView([focusPlaying, secondPaused]), timingMode: 'elapsed' }, vi.fn())
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
    renderApp(root, view, vi.fn())

    const timeNode = root.querySelector('#time')
    const statusNode = root.querySelector('.video-row .video-row-status')
    const nameNode = root.querySelector('.video-row .video-row-name')
    const rowNode = root.querySelector('.video-row')

    patchTimers(root, view, 3_000)

    expect(rowTimes(root)).toEqual(['00:45', '00:39'])
    expect(root.querySelector('#time')?.textContent).toBe('00:45')
    // Same nodes, untouched status/name text, and controls still wired.
    expect(root.querySelector('#time')).toBe(timeNode)
    expect(root.querySelector('.video-row')).toBe(rowNode)
    expect(statusNode?.textContent).toBe('Playing')
    expect(nameNode?.textContent).toBe('1. A.mp4')
    expect(root.querySelector('#settings-toggle')).not.toBeNull()
  })

  it('advances two concurrent playing rows independently', () => {
    const root = document.createElement('div')
    const view = twoVideoView([
      focusPlaying,
      tile({ ordinal: 1, name: 'B.mp4', status: 'playing', playing: true, durationMs: 20_000, elapsedMs: 5_000, remainingMs: 15_000 }),
    ])
    renderApp(root, view, vi.fn())
    expect(rowTimes(root)).toEqual(['00:48', '00:15'])
    patchTimers(root, view, 2_000)
    expect(rowTimes(root)).toEqual(['00:46', '00:13'])
  })

  it('freezes paused and ended rows at any advance', () => {
    const root = document.createElement('div')
    const view = twoVideoView([
      tile({ ordinal: 0, name: 'A.mp4', status: 'paused', durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'ended', durationMs: 30_000, elapsedMs: 30_000, remainingMs: 0 }),
    ])
    renderApp(root, view, vi.fn())
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
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      expect(rowTimes(h.root)).toEqual(['00:48', '00:39'])

      h.setClock(1_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:47')
      expect(rowTimes(h.root)).toEqual(['00:47', '00:39'])

      h.setClock(1_500)
      vi.advanceTimersByTime(250)
      expect(rowTimes(h.root)).toEqual(['00:46', '00:39'])
      h.stop()
    })
  })

  it('stops advancing after 2 seconds without a fresh observation', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))

      h.setClock(2_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // 30 s of silence: the display freezes at the capped value rather than
      // counting on, and never invents Paused or Ended.
      h.setClock(30_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      h.setClock(600_000)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      expect(h.root.querySelector('.video-row .video-row-status')?.textContent).toBe('Playing')
      expect(h.root.querySelector('#message')).toBeNull()
      h.stop()
    })
  })

  it('snaps to a fresh observation instead of blending across a discontinuity', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(1_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')

      // A replay/seek observation arrives at t=1500 with remaining back at 58 s.
      h.push({
        ...twoVideoView([{ ...focusPlaying, elapsedMs: 2_000, remainingMs: 58_000 }, secondPaused]),
        revision: 6,
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:58')

      // And it becomes the new anchor: the next tick counts down from 58 s.
      h.setClock(2_500)
      vi.advanceTimersByTime(250)
      expect(h.root.querySelector('#time')?.textContent).toBe('00:57')
      h.stop()
    })
  })

  it('does not let a stale revision replace newer timing or rewind the anchor', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      h.setClock(1_000)
      h.push({
        ...twoVideoView([{ ...focusPlaying, elapsedMs: 30_000, remainingMs: 30_000 }, secondPaused]),
        revision: 9,
      })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:30')

      // A late, lower-revision view carrying older timing must be dropped.
      h.setClock(1_500)
      h.push({ ...twoVideoView([focusPlaying, secondPaused]), revision: 4 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:30')

      // The revision-9 anchor still stands: 500 ms after it, remaining is 29 s.
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

      // A real discontinuity still snaps immediately.
      h.setClock(2_000)
      h.push({ ...twoVideoView([{ ...focusPlaying, remainingMs: 58_000, elapsedMs: 2_000 }, secondPaused]), revision: 7 })
      expect(h.root.querySelector('#time')?.textContent).toBe('00:58')
      h.stop()
    })
  })

  it('freezes at the cap through a run of identical re-emissions', () => {
    withFakeTimers(() => {
      const h = mount(twoVideoView([focusPlaying, secondPaused]))
      // Helper stuck on one value: five identical re-emissions, one per second.
      for (let index = 1; index <= 5; index += 1) {
        h.setClock(index * 1_000)
        h.push({ ...twoVideoView([{ ...focusPlaying }, { ...secondPaused }]), revision: 5 + index })
        vi.advanceTimersByTime(250)
      }
      // Advanced to the 2 s cap and froze there — no per-second sawtooth back
      // to 00:48, and no invented Paused/Ended.
      expect(h.root.querySelector('#time')?.textContent).toBe('00:46')
      expect(h.root.querySelector('.video-row .video-row-status')?.textContent).toBe('Playing')
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
  it('opens settings, closes them with the same toggle and Escape', () => {
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
      listener?.(twoVideoView([focusPlaying, secondPaused]))

      const toggle = root.querySelector('#settings-toggle') as HTMLButtonElement
      expect(root.querySelector('#timing-mode')).toBeNull()
      toggle.click()
      expect(root.querySelector('#timing-mode')).not.toBeNull()
      expect(root.querySelector('#settings-toggle')?.getAttribute('aria-expanded')).toBe('true')
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()
      expect(root.querySelector('#timing-mode')).toBeNull()
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(root.querySelector('#timing-mode')).toBeNull()
      stop()
    } finally {
      root.remove()
      vi.useRealTimers()
    }
  })

  it('keeps settings controls and focus across a timing-only view push', () => {
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
      listener?.(twoVideoView([focusPlaying, secondPaused]))
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()

      const controls = root.querySelector('.controls')
      const checkbox = root.querySelector('#always-on-top') as HTMLInputElement
      expect(checkbox.checked).toBe(true)
      checkbox.focus()
      expect(document.activeElement).toBe(checkbox)

      listener?.({ ...twoVideoView([{ ...focusPlaying, remainingMs: 47_000 }, secondPaused]), revision: 6 })

      expect(root.querySelector('.controls')).toBe(controls)
      expect(root.querySelector('#always-on-top')).toBe(checkbox)
      expect(document.activeElement).toBe(checkbox)
      expect(root.querySelector('#time')?.textContent).toBe('00:47')
      stop()
      root.remove()
    } finally {
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
      listener?.(twoVideoView([focusPlaying, secondPaused]))
      ;(root.querySelector('#settings-toggle') as HTMLButtonElement).click()
      ;(root.querySelector('#timing-mode') as HTMLButtonElement).click()
      const checkbox = root.querySelector('#always-on-top') as HTMLInputElement
      checkbox.checked = false
      checkbox.dispatchEvent(new Event('change'))
      ;(root.querySelector('#copy-diagnostics') as HTMLButtonElement).click()
      expect(dispatched).toEqual([
        { type: 'setTimingMode', mode: 'elapsed' },
        { type: 'setAlwaysOnTop', enabled: false },
        { type: 'copyDiagnostics' },
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
      const warning = root.querySelector('#multi-instance')
      expect(warning?.textContent).toBe('Multiple PowerPoint instances detected; verify the deck')
      // The visible warning must NOT be its own live region: the status section
      // is replaced every poll, and re-inserting a role="alert" node re-announces
      // it assertively each time.
      expect(warning?.getAttribute('role')).toBeNull()
      expect(writes).toEqual([
        'Multiple PowerPoint instances detected; verify the deck — Playing — 1. A.mp4: Playing, 2. B.mp4: Paused',
      ])

      // Three more polls with the warning still active: announced once, total.
      listener?.(warned(6, 47_000))
      listener?.(warned(7, 46_000))
      listener?.(warned(8, 45_000))
      expect(root.querySelector('#multi-instance')?.textContent).toBe(
        'Multiple PowerPoint instances detected; verify the deck',
      )
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
