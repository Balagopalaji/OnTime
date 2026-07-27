import { describe, expect, it } from 'vitest'
import {
  POWERPOINT_DEBOUNCE_MS,
  POWERPOINT_PLAYING_DELTA_MS,
  POWERPOINT_VIDEO_CLEAR_POLLS,
  normalizePowerPointPoll,
  snapshotsIdentityEqual,
  snapshotsTimingEqual,
  videoListsEqual,
} from './powerpoint-normalize'
import type { PresentationSnapshot, PresentationVideo } from './powerpoint-types'

/**
 * Parity tests for the pure comparators (C1-C3) and the running-slideshow
 * normalization (D3-D12 normalization aspects), ported from the Companion
 * characterization oracles `main.presentation.test.ts` (C1-C3) and
 * `main.ppt-status.test.ts` (D). These exercise the pure helper directly — no
 * debounce, no candidate decision, no host I/O. The debounce/candidate/guard
 * behavior is covered by `powerpoint-machine.test.ts`.
 */

type Snapshot = PresentationSnapshot
type Video = PresentationVideo

const emptyCache = () => ({
  videoCache: new Map<string, PresentationVideo[]>(),
  noVideoKey: null,
  noVideoCount: 0,
  explicitNoVideoKey: null,
  explicitNoVideoCount: 0,
})

// ---------------------------------------------------------------------------
// C1 — snapshotsIdentityEqual: identity fields only, timing ignored
// ---------------------------------------------------------------------------
describe('C1 snapshotsIdentityEqual', () => {
  const eq = snapshotsIdentityEqual
  const base = (): Snapshot => ({
    instanceId: 7,
    slideNumber: 2,
    totalSlides: 9,
    title: 'Deck',
    filename: 'deck.pptx',
    videoElapsed: 100,
  })

  it('null handling', () => {
    expect(eq(null, null)).toBe(true)
    expect(eq(base(), null)).toBe(false)
    expect(eq(null, base())).toBe(false)
  })

  it('each identity field differing alone is false', () => {
    expect(eq(base(), { ...base(), instanceId: 8 })).toBe(false)
    expect(eq(base(), { ...base(), slideNumber: 3 })).toBe(false)
    expect(eq(base(), { ...base(), totalSlides: 10 })).toBe(false)
    expect(eq(base(), { ...base(), title: 'Other' })).toBe(false)
    expect(eq(base(), { ...base(), filename: 'other.pptx' })).toBe(false)
  })

  it('all identity fields equal is true (distinct refs)', () => {
    expect(eq(base(), base())).toBe(true)
  })

  it('equal with optional identity fields undefined on both sides is true', () => {
    expect(eq({ instanceId: 7, title: 'Deck' }, { instanceId: 7, title: 'Deck' })).toBe(true)
  })

  it('timing fields differing is still true (identity ignores timing)', () => {
    expect(
      eq(base(), {
        ...base(),
        videoPlaying: true,
        videoDuration: 5_000,
        videoElapsed: 999,
        videoRemaining: 1,
        videos: [{ id: 1 }],
        videoTimingUnavailable: true,
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C2 — snapshotsTimingEqual: timing fields only, identity ignored
// ---------------------------------------------------------------------------
describe('C2 snapshotsTimingEqual', () => {
  const eq = snapshotsTimingEqual
  const base = (): Snapshot => ({
    instanceId: 7,
    title: 'Deck',
    videoPlaying: true,
    videoDuration: 10_000,
    videoElapsed: 4_000,
    videoRemaining: 6_000,
    videoTimingUnavailable: false,
    videos: [{ id: 1, name: 'v', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }],
  })

  it('null handling mirrors identityEqual', () => {
    expect(eq(null, null)).toBe(true)
    expect(eq(base(), null)).toBe(false)
  })

  it('each timing field differing alone is false', () => {
    expect(eq(base(), { ...base(), videoPlaying: false })).toBe(false)
    expect(eq(base(), { ...base(), videoDuration: 10_001 })).toBe(false)
    expect(eq(base(), { ...base(), videoElapsed: 4_001 })).toBe(false)
    expect(eq(base(), { ...base(), videoRemaining: 5_999 })).toBe(false)
    expect(eq(base(), { ...base(), videoTimingUnavailable: true })).toBe(false)
  })

  it('videos list difference is false', () => {
    expect(
      eq(base(), {
        ...base(),
        videos: [{ id: 2, name: 'v', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }],
      }),
    ).toBe(false)
  })

  it('all timing equal (distinct refs/nested objects) is true', () => {
    expect(eq(base(), base())).toBe(true)
  })

  it('identity differing is still true (timing ignores identity)', () => {
    expect(
      eq(base(), { ...base(), instanceId: 99, slideNumber: 5, totalSlides: 50, title: 'X', filename: 'x.pptx' }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C3 — videoListsEqual: undefined/length handling, per-field per-index compare
// ---------------------------------------------------------------------------
describe('C3 videoListsEqual', () => {
  const eq = videoListsEqual
  const v = (): Video => ({ id: 1, name: 'v', duration: 100, elapsed: 40, remaining: 60, playing: true })
  const w = (): Video => ({ id: 2, name: 'w', duration: 200, elapsed: 50, remaining: 150, playing: false })

  it('undefined handling', () => {
    expect(eq(undefined, undefined)).toBe(true)
    expect(eq([v()], undefined)).toBe(false)
    expect(eq(undefined, [v()])).toBe(false)
  })

  it('length mismatch is false', () => {
    expect(eq([v()], [v(), w()])).toBe(false)
  })

  it('each field differing at index 1 (not 0) is false', () => {
    expect(eq([v(), w()], [v(), { ...w(), id: 3 }])).toBe(false)
    expect(eq([v(), w()], [v(), { ...w(), name: 'x' }])).toBe(false)
    expect(eq([v(), w()], [v(), { ...w(), duration: 201 }])).toBe(false)
    expect(eq([v(), w()], [v(), { ...w(), elapsed: 51 }])).toBe(false)
    expect(eq([v(), w()], [v(), { ...w(), remaining: 151 }])).toBe(false)
    expect(eq([v(), w()], [v(), { ...w(), playing: true }])).toBe(false)
  })

  it('equal non-empty lists with distinct refs is true', () => {
    expect(eq([v(), w()], [v(), w()])).toBe(true)
  })

  it('two distinct empty arrays is true', () => {
    expect(eq([], [])).toBe(true)
  })

  it('status is ignored (C3 emission-contract preservation)', () => {
    // Differing only by status must still be equal — a status-only poll must
    // not become a new Companion update emission.
    expect(eq([v()], [{ ...v(), status: 'playing' }])).toBe(true)
    expect(eq([{ ...v(), status: 'paused' }], [{ ...v(), status: 'ended' }])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Constants pinned by the spec's "one canonical capability" constraint
// ---------------------------------------------------------------------------
describe('canonical constants', () => {
  it('matches Companion/spec debounce/clear/delta thresholds', () => {
    expect(POWERPOINT_DEBOUNCE_MS).toBe(600)
    expect(POWERPOINT_VIDEO_CLEAR_POLLS).toBe(2)
    expect(POWERPOINT_PLAYING_DELTA_MS).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// D3 — title fallback chain: title -> filename -> 'PowerPoint'
// ---------------------------------------------------------------------------
describe('D3 title fallback', () => {
  const run = (title: string | undefined, filename: string | undefined): string =>
    normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 1, slideNumber: 1, title, filename },
      announced: null,
      ...emptyCache(),
    }).snapshot.title

  it('whitespace title falls to filename', () => {
    expect(run('  ', 'deck.pptx')).toBe('deck.pptx')
  })
  it('both blank fall to PowerPoint', () => {
    expect(run(undefined, '   ')).toBe('PowerPoint')
  })
  it('title wins', () => {
    expect(run('My Deck', 'deck.pptx')).toBe('My Deck')
  })
})

// ---------------------------------------------------------------------------
// D4 — slide-number persistence: undefined falls back to announced (same instance)
// ---------------------------------------------------------------------------
describe('D4 slideNumber fallback', () => {
  it('undefined slideNumber keeps the announced slide of the same instance', () => {
    // No scalar videoRemaining on the announce: Companion's D4 derives the
    // 8500 inside buildPowerPointCue (local), not in the snapshot, so this
    // unit test asserts only the slide fallback + the carried/updated scalars.
    const announced: Snapshot = {
      instanceId: 5,
      slideNumber: 3,
      title: 'Deck',
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: 1_000,
    }
    const out = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 5,
        slideNumber: undefined,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_500,
      },
      announced,
      ...emptyCache(),
    })
    expect(out.snapshot.slideNumber).toBe(3)
    expect(out.snapshot.videoElapsed).toBe(1_500)
    expect(out.snapshot.videoDuration).toBe(10_000)
  })
})

// ---------------------------------------------------------------------------
// D5 — video source priority: videos > editSlideVideos > per-slide cache
// ---------------------------------------------------------------------------
describe('D5 video source priority', () => {
  const VA: Video = { id: 1, name: 'a', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
  const VB: Video = { id: 2, name: 'b', duration: 5_000, elapsed: 1_000, remaining: 4_000, playing: false }

  it('result.videos wins and is cached', () => {
    const out = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videos: [VA],
        editSlideVideos: [VB],
      },
      announced: null,
      ...emptyCache(),
    })
    expect(out.snapshot.videos).toEqual([VA])
    expect(out.videoCache.get('1:1')).toEqual([VA])
  })

  it('videos absent -> editSlideVideos used and replaces cache', () => {
    const first = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videos: [VA],
        editSlideVideos: [VB],
      },
      announced: null,
      ...emptyCache(),
    })
    const second = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_100,
        editSlideVideos: [VB],
      },
      announced: first.snapshot,
      videoCache: first.videoCache,
      noVideoKey: first.noVideoKey,
      noVideoCount: first.noVideoCount,
      explicitNoVideoKey: first.explicitNoVideoKey,
      explicitNoVideoCount: first.explicitNoVideoCount,
    })
    expect(second.snapshot.videos).toEqual([VB])
    expect(second.videoCache.get('1:1')).toEqual([VB])
  })

  it('both lists absent, not explicit -> cache used', () => {
    const first = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_100,
        editSlideVideos: [VB],
      },
      announced: null,
      ...emptyCache(),
    })
    const cached = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_200,
      },
      announced: first.snapshot,
      videoCache: first.videoCache,
      noVideoKey: first.noVideoKey,
      noVideoCount: first.noVideoCount,
      explicitNoVideoKey: first.explicitNoVideoKey,
      explicitNoVideoCount: first.explicitNoVideoCount,
    })
    expect(cached.snapshot.videos).toEqual([VB])
  })
})

// ---------------------------------------------------------------------------
// D6 — warm cache + no-payload poll: cache refills videos BEFORE
// hasVideoPayload, so the payload stays "present", counters reset, and timing
// carries forward from the announced snapshot (intentional extraction constraint).
// ---------------------------------------------------------------------------
describe('D6 warm cache no-payload retention', () => {
  it('no-payload poll refills from cache and carries announced timing', () => {
    const V: Video = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
    const announce = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videoRemaining: 9_000,
        videos: [V],
      },
      announced: null,
      ...emptyCache(),
    })
    const noPayload = normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 1, slideNumber: 1 },
      announced: announce.snapshot,
      videoCache: announce.videoCache,
      noVideoKey: announce.noVideoKey,
      noVideoCount: announce.noVideoCount,
      explicitNoVideoKey: announce.explicitNoVideoKey,
      explicitNoVideoCount: announce.explicitNoVideoCount,
    })
    expect(noPayload.snapshot.videos).toEqual([V])
    expect(noPayload.snapshot.videoDuration).toBe(10_000)
    expect(noPayload.snapshot.videoRemaining).toBe(9_000)
    // counter reset every poll on the warm-cache path -> never reaches the
    // two-poll clear threshold here.
    expect(noPayload.noVideoCount).toBe(0)
    expect(noPayload.videoCache.get('1:1')).toEqual([V])
  })
})

// ---------------------------------------------------------------------------
// D7 — explicitNoVideo two-poll clear: first keeps videos (timing dropped),
// second clears them.
// ---------------------------------------------------------------------------
describe('D7 explicitNoVideo two-poll clear', () => {
  it('first explicit poll keeps videos with timing dropped; second clears', () => {
    const V: Video = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: true }
    const announce = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: true,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videoRemaining: 9_000,
        videos: [V],
      },
      announced: null,
      ...emptyCache(),
    })
    const explicit1 = normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 1, slideNumber: 1, videoDetected: false },
      announced: announce.snapshot,
      videoCache: announce.videoCache,
      noVideoKey: announce.noVideoKey,
      noVideoCount: announce.noVideoCount,
      explicitNoVideoKey: announce.explicitNoVideoKey,
      explicitNoVideoCount: announce.explicitNoVideoCount,
    })
    expect(explicit1.snapshot.videos).toEqual([V])
    expect(explicit1.snapshot.videoPlaying).toBeUndefined()
    expect(explicit1.snapshot.videoDuration).toBeUndefined()
    expect(explicit1.explicitNoVideoCount).toBe(1)

    const explicit2 = normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 1, slideNumber: 1, videoDetected: false },
      announced: explicit1.snapshot,
      videoCache: explicit1.videoCache,
      noVideoKey: explicit1.noVideoKey,
      noVideoCount: explicit1.noVideoCount,
      explicitNoVideoKey: explicit1.explicitNoVideoKey,
      explicitNoVideoCount: explicit1.explicitNoVideoCount,
    })
    expect(explicit2.snapshot.videos).toBeUndefined()
    expect(explicit2.explicitNoVideoCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// D8 — slide change + explicitNoVideo clears immediately (single poll),
// because slideChanged && explicitNoVideo.
// ---------------------------------------------------------------------------
describe('D8 slide-change explicit clear is immediate', () => {
  it('slide 3 -> 4 explicit clears videos on the first poll', () => {
    const V: Video = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
    const announce = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 3,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videos: [V],
      },
      announced: null,
      ...emptyCache(),
    })
    const slideChange = normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 1, slideNumber: 4, videoDetected: false },
      announced: announce.snapshot,
      videoCache: announce.videoCache,
      noVideoKey: announce.noVideoKey,
      noVideoCount: announce.noVideoCount,
      explicitNoVideoKey: announce.explicitNoVideoKey,
      explicitNoVideoCount: announce.explicitNoVideoCount,
    })
    expect(slideChange.snapshot.slideNumber).toBe(4)
    expect(slideChange.snapshot.videos).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// D9 — playing-detection enrichment: strict >200 delta, forced false on the
// rest when any delta fires, id -> name -> index matching.
// ---------------------------------------------------------------------------
describe('D9 enrichment', () => {
  // Each sub-case states its own prior explicitly (companion's prior evolves
  // across polls; here we control it directly to pin the enrichment rule).
  const priorWith = (videos: Video[], elapsed: number): Snapshot => ({
    instanceId: 1,
    slideNumber: 1,
    title: 'Deck',
    videoPlaying: false,
    videoDuration: 10_000,
    videoElapsed: elapsed,
    videos,
  })

  it('delta>threshold marks playing and forces others false; exactly the threshold does not', () => {
    const announced = priorWith(
      [
        { id: 1, name: 'one', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false },
        { id: 2, name: 'two', duration: 8_000, elapsed: 5_000, remaining: 3_000, playing: false },
      ],
      1_000,
    )
    // Deltas 250 / 50 against the same prior -> one playing, two forced false.
    const delta250 = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_250,
        videos: [
          { id: 1, name: 'one', duration: 10_000, elapsed: 1_250, remaining: 8_750 },
          { id: 2, name: 'two', duration: 8_000, elapsed: 5_050, remaining: 2_950 },
        ],
      },
      announced,
      ...emptyCache(),
    })
    expect(delta250.snapshot.videos).toEqual([
      { id: 1, name: 'one', duration: 10_000, elapsed: 1_250, remaining: 8_750, playing: true },
      { id: 2, name: 'two', duration: 8_000, elapsed: 5_050, remaining: 2_950, playing: false },
    ])

    // Exactly the threshold (delta 200) on both -> not playing; no delta fired
    // -> entries pass through untouched (prior playing flags NOT carried).
    const deltaThreshold = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_200,
        videos: [
          { id: 1, name: 'one', duration: 10_000, elapsed: 1_200, remaining: 8_800 },
          { id: 2, name: 'two', duration: 8_000, elapsed: 5_200, remaining: 2_800 },
        ],
      },
      announced,
      ...emptyCache(),
    })
    expect(deltaThreshold.snapshot.videos).toEqual([
      { id: 1, name: 'one', duration: 10_000, elapsed: 1_200, remaining: 8_800 },
      { id: 2, name: 'two', duration: 8_000, elapsed: 5_200, remaining: 2_800 },
    ])
  })

  it('name match beats index (reversed order, no ids)', () => {
    // Prior matches companion's evolved state at poll 3 (elapsed advanced,
    // playing flags dropped). Incoming reversed, no ids.
    const announced = priorWith(
      [
        { id: 1, name: 'one', duration: 10_000, elapsed: 1_450, remaining: 8_550 },
        { id: 2, name: 'two', duration: 8_000, elapsed: 5_250, remaining: 2_750 },
      ],
      1_450,
    )
    const out = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_750,
        videos: [
          { name: 'two', duration: 8_000, elapsed: 5_350, remaining: 2_650 },
          { name: 'one', duration: 10_000, elapsed: 1_750, remaining: 8_250 },
        ],
      },
      announced,
      ...emptyCache(),
    })
    // By name: 'two' delta 100 (-> forced false), 'one' delta 300 (-> playing).
    // By index the pairing would invert and 'two' would be playing instead.
    expect(out.snapshot.videos).toEqual([
      { name: 'two', duration: 8_000, elapsed: 5_350, remaining: 2_650, playing: false },
      { name: 'one', duration: 10_000, elapsed: 1_750, remaining: 8_250, playing: true },
    ])
  })
})

// ---------------------------------------------------------------------------
// D10 — scalar timing fallback to the prior announced snapshot: undefined
// duration/playing/remaining keep announced values, elapsed updates; the prior
// remaining stays stale (fallback wins over duration-elapsed derivation).
// ---------------------------------------------------------------------------
describe('D10 scalar timing fallback', () => {
  it('keeps announced duration/playing/remaining; elapsed updates; remaining stale', () => {
    const V: Video = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: true }
    const announce = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: true,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videoRemaining: 9_000,
        videos: [V],
      },
      announced: null,
      ...emptyCache(),
    })
    const out = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoElapsed: 1_500,
      },
      announced: announce.snapshot,
      videoCache: announce.videoCache,
      noVideoKey: announce.noVideoKey,
      noVideoCount: announce.noVideoCount,
      explicitNoVideoKey: announce.explicitNoVideoKey,
      explicitNoVideoCount: announce.explicitNoVideoCount,
    })
    expect(out.snapshot.videoPlaying).toBe(true)
    expect(out.snapshot.videoDuration).toBe(10_000)
    expect(out.snapshot.videoElapsed).toBe(1_500)
    expect(out.snapshot.videoRemaining).toBe(9_000)
    expect(out.snapshot.videos).toEqual([V])
  })
})

// ---------------------------------------------------------------------------
// D11 — videoTimingUnavailable gating on videoDetected
// ---------------------------------------------------------------------------
describe('D11 videoTimingUnavailable gate', () => {
  it('true only with a video payload; false (not undefined) without one', () => {
    const withPayload = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: true,
        videoPlaying: false,
        videoDuration: 10_000,
        videoElapsed: 1_000,
        videoTimingUnavailable: true,
      },
      announced: null,
      ...emptyCache(),
    })
    expect(withPayload.snapshot.videoTimingUnavailable).toBe(true)

    const noPayload = normalizePowerPointPoll({
      result: { state: 'foreground', inSlideshow: true, instanceId: 2, slideNumber: 1 },
      announced: null,
      ...emptyCache(),
    })
    expect(noPayload.snapshot.videoTimingUnavailable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D12 — explicitNoVideo poll that still claims videoTimingUnavailable:true
// commits false (gate is `videoDetected && result.videoTimingUnavailable === true`).
// ---------------------------------------------------------------------------
describe('D12 explicitNoVideo with timing-unavailable flag commits false', () => {
  it('videoDetected false -> videoTimingUnavailable false even when raw flag is true', () => {
    const out = normalizePowerPointPoll({
      result: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1,
        slideNumber: 1,
        videoDetected: false,
        videoTimingUnavailable: true,
      },
      announced: null,
      ...emptyCache(),
    })
    expect(out.snapshot.videoTimingUnavailable).toBe(false)
  })
})
