import { describe, expect, it } from 'vitest'
import { createInitialPowerPointMachineState, reducePowerPointMachine } from './powerpoint-machine'
import { normalizePowerPointPoll } from './powerpoint-normalize'
import { projectPowerPointView } from './powerpoint-view'
import type { PowerPointVideoTile, PowerPointViewState } from './powerpoint-view'
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
    primaryCache: new Map(),
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

  it.each([
    ['C:\\Users\\operator\\Decks\\show.pptx', 'show.pptx'],
    ['\\\\stage-server\\shows\\opening\\show.pptx', 'show.pptx'],
  ])('uses only the basename as the standalone title when Name is missing: %s', (filename, expectedTitle) => {
    // `presentationFrom` exercises the legacy normalizer fallback (title <-
    // filename). The view must sanitize that fallback without changing the
    // snapshot title consumed by Companion cue construction.
    const src = presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      filename,
      videoDetected: true,
      videoDuration: 10_000,
      videoElapsed: 1_000,
    })
    expect(src).toMatchObject({ kind: 'presentation', snapshot: { title: filename, filename } })
    const view = projectPowerPointView(src, remaining)
    expect(view).toMatchObject({ title: expectedTitle, filenameBasename: expectedTitle })
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

  it('P0-03 uses protocol-v1 snapshot primary identity for label, status, and scalar time', () => {
    const v = projectPowerPointView(presentationFrom({
      ...baseResult,
      protocolVersion: 1,
      primaryVideoId: 10,
      primaryVideoIndex: 0,
      videoPlaying: false,
      videoDuration: 5_000,
      videoElapsed: 1_000,
      videoRemaining: 4_000,
    }), remaining)
    expect(v).toMatchObject({
      kind: 'paused',
      selectedVideoId: 10,
      selectedVideoName: 'first',
      timeMs: 4_000,
      durationMs: 5_000,
    })
  })

  it('P0-03 does not heuristically select another video for invalid protocol-v1 metadata', () => {
    const v = projectPowerPointView(presentationFrom({
      ...baseResult,
      protocolVersion: 1,
      primaryVideoId: 999,
    }), remaining) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBeUndefined()
  })

  it('an invalid explicit id falls through to the active video', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), {
      ...remaining,
      primaryVideoId: 999,
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(20)
  })

  it('an invalid explicit index falls through to the active video', () => {
    const v = projectPowerPointView(presentationFrom(baseResult), {
      ...remaining,
      primaryVideoIndex: 99,
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

  it('selects the first video when no video is active', () => {
    const src = presentationFrom({
      ...baseResult,
      videos: [
        { id: 30, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000 },
        { id: 40, name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000 },
      ],
    })
    const v = projectPowerPointView(src, remaining) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Exact 250 ms ended threshold
// ---------------------------------------------------------------------------
describe('ended threshold boundary', () => {
  const source = (remainingMs: number) =>
    presentationFrom({
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videoDuration: 10_000,
      videoElapsed: 10_000 - remainingMs,
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 10_000 - remainingMs, remaining: remainingMs }],
    })

  it('ends at exactly 250 ms remaining', () => {
    expect(projectPowerPointView(source(250), remaining).kind).toBe('ended')
  })

  it('does not infer ended at 251 ms remaining without another end signal', () => {
    expect(projectPowerPointView(source(251), remaining).kind).toBe('paused')
  })
})

// ---------------------------------------------------------------------------
// ISSUE-001 — multi-video focus projection + per-video tiles
// ---------------------------------------------------------------------------
//
// `playOrder` is host-owned recency metadata (video id -> monotonic start
// rank). These tests pin the pure projection rules: focus follows the highest-
// ranked still-playing video, the large-timer scalar uses the focus row's own
// observed values, a resolved `ended` outranks a contradictory `playing` flag,
// and a resolved row is surfaced for every slide video. When `playOrder` is
// absent/empty, the legacy helper-primary / first-playing behavior is intact
// (already covered by S-011 and the `primary-video resolution` block above).
describe('ISSUE-001 multi-video focus', () => {
  const twoPlaying: PowerPointPollResult = {
    state: 'foreground',
    inSlideshow: true,
    instanceId: 1,
    slideNumber: 1,
    title: 'Deck',
    videoDetected: true,
    // Helper still names the FIRST video as its primary (stale) — the focus
    // projection must NOT honor this when playOrder names a different video.
    protocolVersion: 1,
    primaryVideoId: 10,
    primaryVideoIndex: 0,
    videoPlaying: true,
    videoDuration: 5_000,
    videoElapsed: 1_000,
    videoRemaining: 4_000,
    videos: [
      { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'playing', playing: true },
      { id: 20, name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'playing', playing: true },
    ],
  }

  it('focuses the highest-ranked (most-recently-started) still-playing video', () => {
    const v = projectPowerPointView(presentationFrom(twoPlaying), {
      ...remaining,
      playOrder: new Map([[10, 1], [20, 2]]), // id 20 started more recently
    }) as PowerPointViewState & { selectedVideoId?: number; selectedVideoName?: string; timeMs: number | null }
    expect(v.kind).toBe('playing')
    expect(v.selectedVideoId).toBe(20)
    expect(v.selectedVideoName).toBe('second')
  })

  it('uses the focus row own observed values for the large-timer scalar, not the helper scalar', () => {
    // Helper scalar (video*) names id 10 (remaining 4_000). Focus is id 20
    // (remaining 6_000). The projected scalar must be id 20's value.
    const v = projectPowerPointView(presentationFrom(twoPlaying), {
      ...remaining,
      playOrder: new Map([[10, 1], [20, 2]]),
    }) as PowerPointViewState & { timeMs: number | null; durationMs: number | null }
    expect(v.timeMs).toBe(6_000)
    expect(v.durationMs).toBe(8_000)
  })

  it('elapsed mode reflects the focus row own elapsed, not the helper scalar', () => {
    const v = projectPowerPointView(presentationFrom(twoPlaying), {
      ...elapsed,
      playOrder: new Map([[10, 1], [20, 2]]),
    }) as PowerPointViewState & { timeMs: number | null }
    expect(v.timeMs).toBe(2_000) // id 20 elapsed, not helper scalar 1_000
  })

  it('advances focus to the next still-playing video when the focused one ends', () => {
    // id 20 (was focus) has now ended; id 10 still playing.
    const endedFocus: PowerPointPollResult = {
      ...twoPlaying,
      videos: [
        { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'playing', playing: true },
        { id: 20, name: 'second', duration: 8_000, elapsed: 8_000, remaining: 0, status: 'ended', playing: false },
      ],
    }
    const v = projectPowerPointView(presentationFrom(endedFocus), {
      ...remaining,
      playOrder: new Map([[10, 1], [20, 2]]),
    }) as PowerPointViewState & { selectedVideoId?: number; timeMs: number | null }
    expect(v.kind).toBe('playing')
    expect(v.selectedVideoId).toBe(10) // only remaining playing video
    expect(v.timeMs).toBe(4_000)
  })

  it('retains the most-recently-started paused/ended video when nothing is playing', () => {
    const nonePlaying: PowerPointPollResult = {
      ...twoPlaying,
      videoPlaying: false,
      videos: [
        { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'paused', playing: false },
        { id: 20, name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'paused', playing: false },
      ],
    }
    // id 20 has the higher rank -> retained as focus even though paused.
    const v = projectPowerPointView(presentationFrom(nonePlaying), {
      ...remaining,
      playOrder: new Map([[10, 1], [20, 2]]),
    }) as PowerPointViewState & { selectedVideoId?: number; kind: string }
    expect(v.kind).toBe('paused')
    expect(v.selectedVideoId).toBe(20)
  })

  it('ended outranks a contradictory playing flag for focus eligibility', () => {
    // id 20 reports BOTH status:ended AND playing:true (contradictory). It must
    // NOT be eligible as a playing focus; id 10 wins.
    const contradictory: PowerPointPollResult = {
      ...twoPlaying,
      videos: [
        { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'playing', playing: true },
        { id: 20, name: 'second', duration: 8_000, elapsed: 8_000, remaining: 0, status: 'ended', playing: true },
      ],
    }
    const v = projectPowerPointView(presentationFrom(contradictory), {
      ...remaining,
      playOrder: new Map([[10, 1], [20, 2]]),
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(10)
  })

  it('legacy/helper-primary behavior is the fallback when playOrder is unavailable', () => {
    // No playOrder -> legacy helper primary (id 10) wins despite id 20 also playing.
    const v = projectPowerPointView(presentationFrom(twoPlaying), remaining) as PowerPointViewState & {
      selectedVideoId?: number
      timeMs: number | null
    }
    expect(v.selectedVideoId).toBe(10)
    // Legacy scalar-preferred: helper scalar (4_000), not id 20's own (6_000).
    expect(v.timeMs).toBe(4_000)
  })

  it('legacy fallback also applies when playOrder is empty', () => {
    const v = projectPowerPointView(presentationFrom(twoPlaying), {
      ...remaining,
      playOrder: new Map(),
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(10)
  })

  it('an unranked video is never chosen by the focus branch', () => {
    // id 20 is playing and ranked; id 30 is playing but UNRANKED. Focus must be
    // the ranked playing video (id 20), never the unranked one.
    const src: PowerPointPollResult = {
      ...twoPlaying,
      videos: [
        { id: 10, name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'paused', playing: false },
        { id: 20, name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'playing', playing: true },
        { id: 30, name: 'third', duration: 9_000, elapsed: 3_000, remaining: 6_000, status: 'playing', playing: true },
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), {
      ...remaining,
      playOrder: new Map([[20, 1]]), // only id 20 ranked
    }) as PowerPointViewState & { selectedVideoId?: number }
    expect(v.selectedVideoId).toBe(20)
  })

  it('surfaces a resolved tile for every slide video with status, timing, and focus marker', () => {
    const src: PowerPointPollResult = {
      ...twoPlaying,
      videos: [
        { id: 10, name: 'first', duration: 5_000, elapsed: 0, remaining: 5_000 }, // ready
        { id: 20, name: 'second', duration: 8_000, elapsed: 8_000, remaining: 0, status: 'ended' }, // ended
        { id: 30, name: 'third', duration: 9_000, elapsed: 3_000, remaining: 6_000, status: 'paused' }, // paused
        { id: 40, name: 'fourth', duration: 7_000, elapsed: 2_000, remaining: 5_000, status: 'playing', playing: true }, // playing (focus)
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), {
      ...remaining,
      playOrder: new Map([[40, 1]]),
    }) as PowerPointViewState & { videos?: PowerPointVideoTile[] }
    const tiles = v.videos ?? []
    expect(tiles).toHaveLength(4)
    // Shape order preserved, statuses resolved to the 4 canonical states.
    expect(tiles.map((t) => ({ id: t.id, status: t.status }))).toEqual([
      { id: 10, status: 'ready' },
      { id: 20, status: 'ended' },
      { id: 30, status: 'paused' },
      { id: 40, status: 'playing' },
    ])
    // Independent observed timing per row.
    const byId = new Map(tiles.map((t) => [t.id, t]))
    expect(byId.get(30)?.remainingMs).toBe(6_000)
    expect(byId.get(40)?.remainingMs).toBe(5_000)
    // Only the focus row is marked.
    expect(tiles.filter((t) => t.isFocus).map((t) => t.id)).toEqual([40])
    // Ordinal reflects shape order for name/identity fallback.
    expect(tiles.map((t) => t.ordinal)).toEqual([0, 1, 2, 3])
  })

  it('derives remainingMs from duration-elapsed when observed remaining is absent', () => {
    const src: PowerPointPollResult = {
      ...twoPlaying,
      videos: [{ id: 10, name: 'first', duration: 5_000, elapsed: 1_200 }], // no remaining field
    }
    const v = projectPowerPointView(presentationFrom(src), remaining) as PowerPointViewState & {
      videos?: PowerPointVideoTile[]
    }
    expect(v.videos?.[0]?.remainingMs).toBe(3_800)
  })

  it('tiles are absent on non-presentation kinds (connecting/unavailable)', () => {
    const connecting = projectPowerPointView({ kind: 'connecting' }, remaining) as PowerPointViewState & {
      videos?: PowerPointVideoTile[]
    }
    const unavailable = projectPowerPointView({ kind: 'unavailable' }, remaining) as PowerPointViewState & {
      videos?: PowerPointVideoTile[]
    }
    expect(connecting.videos).toBeUndefined()
    expect(unavailable.videos).toBeUndefined()
  })

  // P1-1: when focus comes from playOrder, the headline kind/status is derived
  // from the focus row ONLY. The helper-primary scalar `videoPlaying` cannot
  // override it, so tile.status and headline kind can never disagree.
  it('P1-1 headline status ignores the helper-primary scalar when focus is from playOrder', () => {
    const src: PowerPointPollResult = {
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      protocolVersion: 1,
      primaryVideoId: 10,
      // Helper-primary scalar claims playing, but the focus row (id 20) is paused.
      videoPlaying: true,
      videoDuration: 5_000,
      videoElapsed: 1_000,
      videoRemaining: 4_000,
      videos: [
        { id: 10, name: 'helper', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'ended', playing: true },
        { id: 20, name: 'focus', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'paused', playing: false },
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), {
      ...remaining,
      playOrder: new Map([[20, 1]]),
    }) as PowerPointViewState & { kind: string; selectedVideoId?: number; videos?: PowerPointVideoTile[] }
    expect(v.kind).toBe('paused') // focus row status, NOT 'playing' from the helper scalar
    const focusTile = v.videos?.find((t) => t.isFocus)
    expect(focusTile?.status).toBe('paused')
    expect(focusTile?.id).toBe(20)
  })

  it('P1-1 invariant: whenever a tile isFocus, its status maps to the headline kind', () => {
    const cases: Array<{ status: 'playing' | 'paused' | 'ended'; playOrder: Map<number, number> }> = [
      { status: 'playing', playOrder: new Map([[20, 1]]) },
      { status: 'paused', playOrder: new Map([[20, 1]]) },
      { status: 'ended', playOrder: new Map([[20, 1]]) },
    ]
    for (const c of cases) {
      const src: PowerPointPollResult = {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        title: 'Deck',
        videoDetected: true,
        protocolVersion: 1,
        primaryVideoId: 10,
        videoPlaying: true, // contradictory; must be ignored under focus
        videoDuration: 8_000,
        videoElapsed: 2_000,
        videoRemaining: 6_000,
        videos: [
          { id: 10, name: 'other', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'playing', playing: true },
          { id: 20, name: 'focus', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: c.status, playing: c.status === 'playing' },
        ],
      }
      const v = projectPowerPointView(presentationFrom(src), { ...remaining, playOrder: c.playOrder }) as PowerPointViewState & {
        kind: string
        videos?: PowerPointVideoTile[]
      }
      expect(v.kind).toBe(c.status)
    }
  })

  // P1-2: focus timing fallback is all-or-nothing at the ROW level. A focus row
  // with partial timing never borrows the missing fields from another video's
  // scalar — it degrades (null / derived from its own duration-elapsed) instead.
  it('P1-2 a focus row with elapsed only does not borrow another video scalar fields', () => {
    const src: PowerPointPollResult = {
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      protocolVersion: 1,
      primaryVideoId: 10,
      // Helper-primary scalar is fully populated for id 10 — must NOT leak into id 20.
      videoDuration: 5_000,
      videoElapsed: 1_000,
      videoRemaining: 4_000,
      videos: [
        { id: 10, name: 'helper', duration: 5_000, elapsed: 1_000, remaining: 4_000, status: 'playing', playing: true },
        { id: 20, name: 'focus', elapsed: 2_000, status: 'paused', playing: false }, // no duration/remaining
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), {
      ...remaining,
      playOrder: new Map([[20, 1]]),
    }) as PowerPointViewState & { timeMs: number | null; durationMs: number | null }
    // No borrowed scalar: durationMs is null (focus row had no duration), and
    // timeMs is NOT the helper's 4_000.
    expect(v.durationMs).toBeNull()
    expect(v.timeMs).not.toBe(4_000)
  })

  // P1-3: focus is marked by ORDINAL, not id. An id-less or duplicate-id focus
  // video produces exactly one isFocus row.
  it('P1-3 marks exactly one focus tile for id-less videos (legacy path)', () => {
    const src: PowerPointPollResult = {
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videos: [
        { name: 'first', duration: 5_000, elapsed: 1_000, remaining: 4_000 }, // no id
        { name: 'second', duration: 8_000, elapsed: 2_000, remaining: 6_000 },
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), remaining) as PowerPointViewState & {
      selectedVideoName?: string
      videos?: PowerPointVideoTile[]
    }
    // Legacy first-video fallback selects the id-less first video.
    expect(v.selectedVideoName).toBe('first')
    const focusTiles = v.videos?.filter((t) => t.isFocus) ?? []
    expect(focusTiles).toHaveLength(1)
    expect(focusTiles[0]?.name).toBe('first')
  })

  it('P1-3 marks exactly one focus tile when ids are duplicated (focus branch)', () => {
    // Two videos share id 99; focus selects the higher-ranked one. Both would
    // match under an id-based marker — only the selected ORDINAL is marked.
    const src: PowerPointPollResult = {
      state: 'foreground',
      inSlideshow: true,
      instanceId: 1,
      slideNumber: 1,
      title: 'Deck',
      videoDetected: true,
      videos: [
        { id: 99, name: 'first-dup', duration: 8_000, elapsed: 5_000, remaining: 3_000, status: 'playing', playing: true },
        { id: 99, name: 'second-dup', duration: 8_000, elapsed: 2_000, remaining: 6_000, status: 'playing', playing: true },
      ],
    }
    const v = projectPowerPointView(presentationFrom(src), {
      ...remaining,
      // Rank the second duplicate higher (more recent) so it becomes focus.
      // playOrder keys by id, so both share rank 2 here; the focus resolver
      // still picks a single ordinal — the first one encountered at max rank.
      playOrder: new Map([[99, 2]]),
    }) as PowerPointViewState & { videos?: PowerPointVideoTile[] }
    const focusTiles = v.videos?.filter((t) => t.isFocus) ?? []
    expect(focusTiles).toHaveLength(1)
  })
})
