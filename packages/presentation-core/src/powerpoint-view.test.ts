import { describe, expect, it } from 'vitest'
import { createInitialPowerPointMachineState, reducePowerPointMachine } from './powerpoint-machine'
import { normalizePowerPointPoll } from './powerpoint-normalize'
import { projectPowerPointView } from './powerpoint-view'
import type { PowerPointViewState } from './powerpoint-view'
import type { PresentationSourceState, PowerPointPollResult } from './powerpoint-types'
import observations from '../test/fixtures/powerpoint-observations.json'

/**
 * Standalone view-projection scenarios S-001..S-017 (spec:
 * docs/spec/standalone-powerpoint-video-timer.spec.md) driven by the package-
 * local H1 observations (test/fixtures/powerpoint-observations.json). The
 * projection is pure: no clock input, no extrapolation, deterministic output.
 */

const T0 = 1_000_000

const fixture = (key: 'playing' | 'paused' | 'ended' | 'multipleVideo'): PowerPointPollResult =>
  observations.observations[key] as unknown as PowerPointPollResult

/** Normalize a running-slideshow poll result into a presentation source state. */
const presentationFrom = (result: PowerPointPollResult): PresentationSourceState => {
  const { snapshot } = normalizePowerPointPoll({
    result: result as PowerPointPollResult & { instanceId: number },
    announced: null,
    videoCache: new Map(),
    noVideoKey: null,
    noVideoCount: 0,
    explicitNoVideoKey: null,
    explicitNoVideoCount: 0,
  })
  return { kind: 'presentation', snapshot }
}

const remaining = { timingMode: 'remaining' as const }
const elapsed = { timingMode: 'elapsed' as const }

// ---------------------------------------------------------------------------
// S-001 — initial connecting state, no time
// ---------------------------------------------------------------------------
describe('S-001 connecting', () => {
  it('projects to connecting with no numeric time', () => {
    const v = projectPowerPointView({ kind: 'connecting' }, remaining)
    expect(v.kind).toBe('connecting')
    expect(v.multipleVideos).toBe(false)
    expect(v.videoCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S-002 — operational failure -> unavailable, no numeric timing
// ---------------------------------------------------------------------------
describe('S-002 unavailable', () => {
  it('projects to unavailable with no numeric time', () => {
    const v = projectPowerPointView({ kind: 'unavailable' }, remaining)
    expect(v.kind).toBe('unavailable')
    expect((v as { timeMs?: number }).timeMs ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S-003 — PowerPoint not running
// ---------------------------------------------------------------------------
describe('S-003 powerpoint_not_running', () => {
  it('projects the none observation to powerpoint_not_running', () => {
    // The reducer maps state:'none' to this source state; assert the projection.
    const v = projectPowerPointView({ kind: 'powerpoint_not_running' }, remaining)
    expect(v.kind).toBe('powerpoint_not_running')
  })
})

// ---------------------------------------------------------------------------
// S-004 — running but not in a slideshow
// ---------------------------------------------------------------------------
describe('S-004 no_slideshow', () => {
  it('projects the no-slideshow observation to no_slideshow', () => {
    const v = projectPowerPointView({ kind: 'no_slideshow' }, remaining)
    expect(v.kind).toBe('no_slideshow')
  })
})

// ---------------------------------------------------------------------------
// S-005 — canonically cleared snapshot -> no_video
// ---------------------------------------------------------------------------
describe('S-005 no_video', () => {
  it('a cleared snapshot (no videos, no scalar timing) projects to no_video', () => {
    const cleared = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 2,
      title: 'Deck',
      filename: 'deck.pptx',
      // explicit no-video -> normalization clears to no payload
      videoDetected: false,
    })
    const v = projectPowerPointView(cleared, remaining)
    expect(v.kind).toBe('no_video')
    expect((v as { timeMs: number | null }).timeMs).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S-006 — media with unavailable/absent timing -> timing_unavailable
// ---------------------------------------------------------------------------
describe('S-006 timing_unavailable', () => {
  it('videoTimingUnavailable true projects to timing_unavailable', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000 }],
      videoTimingUnavailable: true,
    })
    const v = projectPowerPointView(src, remaining)
    expect(v.kind).toBe('timing_unavailable')
    expect((v as { timeMs: number | null }).timeMs).toBeNull()
  })

  it('media with no duration/elapsed/remaining and no playback signal projects to timing_unavailable', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videos: [{ id: 1, name: 'clip' }],
    })
    const v = projectPowerPointView(src, remaining)
    expect(v.kind).toBe('timing_unavailable')
  })
})

// ---------------------------------------------------------------------------
// S-007 — playing fixture -> playing with latest observed time
// ---------------------------------------------------------------------------
describe('S-007 playing', () => {
  it('the playing fixture projects to playing with the observed remaining', () => {
    const v = projectPowerPointView(presentationFrom(fixture('playing')), remaining)
    expect(v.kind).toBe('playing')
    expect((v as { timeMs: number | null }).timeMs).toBe(23_000)
    expect((v as { durationMs: number | null }).durationMs).toBe(30_000)
    expect((v as { selectedVideoId?: number }).selectedVideoId).toBe(501)
  })
})

// ---------------------------------------------------------------------------
// S-008 — paused fixture; repeated projection does not advance time
// ---------------------------------------------------------------------------
describe('S-008 paused', () => {
  it('the paused fixture projects to paused; re-projecting keeps the same time', () => {
    const src = presentationFrom(fixture('paused'))
    const v1 = projectPowerPointView(src, remaining)
    const v2 = projectPowerPointView(src, remaining)
    expect(v1.kind).toBe('paused')
    expect((v1 as { timeMs: number | null }).timeMs).toBe(23_000)
    expect(v2).toEqual(v1)
  })
})

// ---------------------------------------------------------------------------
// S-009 — ended: explicit status, remaining zero, and the 250ms threshold
// ---------------------------------------------------------------------------
describe('S-009 ended', () => {
  it('the ended fixture projects to ended with 0 remaining', () => {
    const v = projectPowerPointView(presentationFrom(fixture('ended')), remaining)
    expect(v.kind).toBe('ended')
    expect((v as { timeMs: number | null }).timeMs).toBe(0)
  })

  it('duration-elapsed within the 250ms threshold infers ended', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videoDuration: 10_000,
      videoElapsed: 9_800, // 200ms remaining -> within 250ms threshold
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 9_800, remaining: 200 }],
    })
    expect(projectPowerPointView(src, remaining).kind).toBe('ended')
  })
})

// ---------------------------------------------------------------------------
// S-010 — ready: video with no play/pause/end evidence; duration fallback
// ---------------------------------------------------------------------------
describe('S-010 ready', () => {
  it('a video with duration but no play/pause/end evidence projects to ready', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videoDuration: 12_000,
      videoElapsed: 0,
      videos: [{ id: 1, name: 'clip', duration: 12_000, elapsed: 0, remaining: 12_000 }],
    })
    const v = projectPowerPointView(src, remaining)
    expect(v.kind).toBe('ready')
    expect((v as { timeMs: number | null }).timeMs).toBeNull()
    expect((v as { durationMs: number | null }).durationMs).toBe(12_000)
  })
})

// ---------------------------------------------------------------------------
// S-011 — multiple videos select the active one and expose the count
// ---------------------------------------------------------------------------
describe('S-011 multiple videos', () => {
  it('the multiple-video fixture selects the active second video and reports count', () => {
    const v = projectPowerPointView(presentationFrom(fixture('multipleVideo')), remaining)
    expect(v.kind).toBe('playing')
    expect(v.multipleVideos).toBe(true)
    expect(v.videoCount).toBe(2)
    expect((v as { selectedVideoId?: number }).selectedVideoId).toBe(503)
    expect((v as { timeMs: number | null }).timeMs).toBe(17_000)
  })
})

// ---------------------------------------------------------------------------
// S-012 — multiple-instance warning overlay is orthogonal
// ---------------------------------------------------------------------------
describe('S-012 multiple-instance warning', () => {
  it('the option adds the warning without changing the main kind', () => {
    const src = presentationFrom(fixture('playing'))
    const without = projectPowerPointView(src, { ...remaining })
    const withWarn = projectPowerPointView(src, { ...remaining, multipleInstanceWarning: true })
    expect(withWarn.kind).toBe(without.kind)
    expect(withWarn.multipleInstanceWarning).toBe(true)
    expect(without.multipleInstanceWarning).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S-013 — a playing state followed by one failure removes numeric time
// ---------------------------------------------------------------------------
describe('S-013 failure removes numeric time in the same update', () => {
  it('playing projects a time; one operational_failure projects unavailable with no time', () => {
    let state = createInitialPowerPointMachineState()
    state = reducePowerPointMachine(state, { type: 'poll', result: fixture('playing'), nowMs: T0 }).state
    const playingView = projectPowerPointView(state.sourceState, remaining) as PowerPointViewState & {
      timeMs?: number | null
    }
    expect(playingView.kind).toBe('playing')
    expect(playingView.timeMs).toBe(23_000)

    state = reducePowerPointMachine(state, { type: 'operational_failure' }).state
    const failedView = projectPowerPointView(state.sourceState, remaining) as PowerPointViewState & {
      timeMs?: number | null
    }
    expect(failedView.kind).toBe('unavailable')
    expect(failedView.timeMs ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S-014 — remaining/elapsed toggle changes only the projection
// ---------------------------------------------------------------------------
describe('S-014 timing-mode toggle', () => {
  it('remaining and elapsed project different timeMs from the same source', () => {
    const src = presentationFrom(fixture('playing')) // elapsed 7000, remaining 23000
    const rem = projectPowerPointView(src, remaining) as PowerPointViewState & { timeMs?: number | null }
    const el = projectPowerPointView(src, elapsed) as PowerPointViewState & { timeMs?: number | null }
    expect(rem.kind).toBe('playing')
    expect(el.kind).toBe('playing')
    expect(rem.timeMs).toBe(23_000)
    expect(el.timeMs).toBe(7_000)
  })
})

// ---------------------------------------------------------------------------
// S-015 — missing total stays absent (renderer formats '--')
// ---------------------------------------------------------------------------
describe('S-015 missing total', () => {
  it('a snapshot without totalSlides leaves totalSlides absent', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 8,
      title: 'Deck',
      videoDetected: true,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000 }],
    })
    const v = projectPowerPointView(src, remaining) as PowerPointViewState & { totalSlides?: number }
    // No explicit status/playing/videoPlaying signal is present, so per the
    // ported precedence (§3.4 step 6) this is 'paused' (positive elapsed,
    // below the end threshold, no playing evidence) — not 'playing'. The
    // load-bearing assertion for S-015 is totalSlides/slideNumber below.
    expect(v.kind).toBe('paused')
    expect(v.totalSlides).toBeUndefined()
    expect((v as { slideNumber?: number }).slideNumber).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// S-016 — basename for both Windows and POSIX full paths
// ---------------------------------------------------------------------------
describe('S-016 basename', () => {
  it('Windows backslash path reduces to basename', () => {
    const v = projectPowerPointView(presentationFrom(fixture('playing')), remaining) as PowerPointViewState & {
      filenameBasename?: string
    }
    expect(v.filenameBasename).toBe('deck.pptx')
  })

  it('POSIX forward-slash path reduces to basename', () => {
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      filename: '/home/user/decks/show.pptx',
      videoDetected: true,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000 }],
    })
    const v = projectPowerPointView(src, remaining) as PowerPointViewState & { filenameBasename?: string }
    expect(v.filenameBasename).toBe('show.pptx')
  })
})

// ---------------------------------------------------------------------------
// S-017 — no clock input; stable until a new observation
// ---------------------------------------------------------------------------
describe('S-017 no extrapolation', () => {
  it('repeated projection of the same observation is byte-identical (no clock)', () => {
    const src = presentationFrom(fixture('playing'))
    const a = projectPowerPointView(src, remaining)
    const b = projectPowerPointView(src, remaining)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Primary-video resolution order (§3.4)
// ---------------------------------------------------------------------------
describe('primary-video resolution', () => {
  const baseResult: PowerPointPollResult = {
    state: 'foreground',
    inSlideshow: true,
    instanceId: 1,
    slideNumber: 1,
    title: 'Deck',
    videoDetected: true,
    videos: [
      { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'paused' },
      { id: 20, name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'playing', playing: true },
    ],
  }

  it('falls back to the active playing video when no explicit reference is given', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), remaining) as PowerPointViewState & {
      selectedVideoId?: number
    }
    expect(v.selectedVideoId).toBe(20)
  })

  it('an explicit id wins over the active video', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), {
      ...remaining,
      primaryVideoId: 10,
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(10)
  })

  it('an invalid explicit id falls through to the active video', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), {
      ...remaining,
      primaryVideoId: 999,
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(20)
  })

  it('an explicit index wins over the active video', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), {
      ...remaining,
      primaryVideoIndex: 0,
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(10)
  })
})
