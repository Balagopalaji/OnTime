import { describe, expect, it } from 'vitest'
import type { PowerPointVideoTile, PowerPointViewState } from '@ontime/presentation-core'
import type { AppView } from '../shared/ipc-contract'
import { createPlaybackClock, PLAYBACK_DRIFT_THRESHOLD_MS } from './playback-clock'

const tile = (partial: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile => ({
  status: 'ready',
  playing: false,
  durationMs: null,
  elapsedMs: null,
  remainingMs: null,
  isFocus: false,
  ...partial,
})

const state = (videos: PowerPointVideoTile[], kind: PowerPointViewState['kind'] = 'playing'): PowerPointViewState => ({
  kind: kind as 'playing',
  title: 'Deck.pptx',
  slideNumber: 3,
  totalSlides: 10,
  timeMs: videos.find((video) => video.isFocus)?.remainingMs ?? null,
  durationMs: videos.find((video) => video.isFocus)?.durationMs ?? null,
  videos,
  multipleVideos: videos.length > 1,
  videoCount: videos.length,
  multipleInstanceWarning: false,
})

const view = (videos: PowerPointVideoTile[], revision = 1, timingMode: 'remaining' | 'elapsed' = 'remaining'): AppView => ({
  revision,
  ctaAvailable: false,
  state: state(videos),
  timingMode,
  alwaysOnTop: true,
  autoOpenVideoList: false,
  preset: 'compact',
  displays: [],
  selectedDisplayId: null,
})

const playing = (partial: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile =>
  tile({
    status: 'playing',
    playing: true,
    durationMs: 60_000,
    elapsedMs: 12_000,
    remainingMs: 48_000,
    isFocus: true,
    ...partial,
  })

const focusTime = (result: AppView): number | null => {
  if (!('videos' in result.state)) return null
  const focus = result.state.videos.find((video) => video.isFocus)
  return focus?.remainingMs ?? null
}

describe('PlaybackClock', () => {
  it.each([2, 5])('keeps %i independent playing videos continuous through long helper silence', (count) => {
    const videos = Array.from({ length: count }, (_, ordinal) =>
      playing({
        id: 100 + ordinal,
        ordinal,
        isFocus: ordinal === count - 1,
        durationMs: 120_000 + ordinal * 10_000,
        elapsedMs: 10_000 + ordinal * 1_000,
        remainingMs: 110_000 + ordinal * 9_000,
      }),
    )
    const clock = createPlaybackClock()
    clock.accept(view(videos), 0)

    for (const silenceMs of [4_000, 4_500, 5_000, 12_000]) {
      const result = clock.current(silenceMs)!
      expect('videos' in result.state ? result.state.videos : []).toEqual(
        videos.map((video) => ({
          ...video,
          elapsedMs: video.elapsedMs! + silenceMs,
          remainingMs: video.remainingMs! - silenceMs,
        })),
      )
    }
  })

  it('continues until the known media end and then stays at zero', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)

    expect(focusTime(clock.current(47_999)!)).toBe(1)
    expect(focusTime(clock.current(48_000)!)).toBe(0)
    expect(focusTime(clock.current(48_001)!)).toBe(0)
    expect(focusTime(clock.current(600_000)!)).toBe(0)
    const endedNaturally = clock.current(600_000)!
    expect('videos' in endedNaturally.state ? endedNaturally.state.videos[0]?.elapsedMs : null).toBe(60_000)
  })

  it('ignores one noisy out-of-threshold playing measurement', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)

    const noisy = playing({ ordinal: 0, elapsedMs: 30_000, remainingMs: 30_000 })
    expect(focusTime(clock.accept(view([noisy], 2), 1_000))).toBe(47_000)

    const normal = playing({ ordinal: 0, elapsedMs: 14_000, remainingMs: 46_000 })
    expect(focusTime(clock.accept(view([normal], 3), 2_000))).toBe(46_000)
    expect(focusTime(clock.current(12_000)!)).toBe(36_000)
  })

  it('keeps a trusted local countdown through normal COM jitter', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    expect(focusTime(clock.current(1_000)!)).toBe(47_000)

    // The helper is 500 ms behind the local prediction. This is confirmation,
    // not a correction, so the clock remains continuous at 47 seconds.
    const jittered = playing({ ordinal: 0, elapsedMs: 12_500, remainingMs: 47_500 })
    clock.accept(view([jittered], 2), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(47_000)
    expect(focusTime(clock.current(1_500)!)).toBe(46_500)
  })

  it('preserves two-sample confirmation for a playing seek beyond the drift threshold', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)

    const atBoundary = playing({ ordinal: 0, elapsedMs: 11_500, remainingMs: 48_500 })
    clock.accept(view([atBoundary], 2), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(47_000)

    const firstCorrection = playing({ ordinal: 0, elapsedMs: 30_000, remainingMs: 30_000 })
    clock.accept(view([firstCorrection], 3), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(47_000)

    const confirmedCorrection = playing({ ordinal: 0, elapsedMs: 31_000, remainingMs: 29_000 })
    clock.accept(view([confirmedCorrection], 4), 2_000)
    expect(focusTime(clock.current(2_000)!)).toBe(29_000)
    expect(PLAYBACK_DRIFT_THRESHOLD_MS).toBe(1_500)
  })

  it('does not anchor a ready-to-playing transition to an advancing stale position stream', () => {
    const clock = createPlaybackClock()
    const ready = playing({
      id: 9,
      ordinal: 0,
      status: 'ready',
      playing: false,
      durationMs: 33_000,
      elapsedMs: 0,
      remainingMs: 33_000,
    })
    clock.accept(view([ready]), 0)

    // PowerPoint can report the previous run's position on the first poll that
    // changes Player.State to playing. Trusting this sample produces the live
    // 00:24 -> 00:30 backwards jump once fresh positions arrive.
    const staleStart = {
      ...ready,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 9_000,
      remainingMs: 24_000,
    }
    expect(focusTime(clock.accept(view([staleStart], 2), 1_000))).toBe(33_000)
    expect(focusTime(clock.current(2_000)!)).toBe(32_000)

    // The old position can itself advance coherently for multiple polls. Two
    // samples alone therefore do not prove that this is the new play run.
    const staleAgain = { ...staleStart, elapsedMs: 10_000, remainingMs: 23_000 }
    expect(focusTime(clock.accept(view([staleAgain], 3), 2_000))).toBe(32_000)
    const staleThird = { ...staleStart, elapsedMs: 11_000, remainingMs: 22_000 }
    expect(focusTime(clock.accept(view([staleThird], 4), 3_000))).toBe(31_000)

    // Once PowerPoint's position returns to the new run it agrees with the
    // deterministic clock, which continues without a backwards jump.
    const fresh = { ...staleStart, elapsedMs: 4_000, remainingMs: 29_000 }
    expect(focusTime(clock.accept(view([fresh], 5), 4_000))).toBe(30_000)
    expect(focusTime(clock.current(5_000)!)).toBe(29_000)
  })

  it('anchors a normal pause-to-playing resume to its matching position', () => {
    const clock = createPlaybackClock()
    const paused = playing({
      ordinal: 0,
      status: 'paused',
      playing: false,
      elapsedMs: 12_000,
      remainingMs: 48_000,
    })
    clock.accept(view([paused]), 0)

    const resumed = { ...paused, status: 'playing' as const, playing: true }
    expect(focusTime(clock.accept(view([resumed], 2), 5_000))).toBe(48_000)
    expect(focusTime(clock.current(6_000)!)).toBe(47_000)
  })

  it('accepts a plausible delayed ready-to-playing position immediately', () => {
    const clock = createPlaybackClock()
    const ready = playing({
      ordinal: 0,
      status: 'ready',
      playing: false,
      durationMs: 33_000,
      elapsedMs: 0,
      remainingMs: 33_000,
    })
    clock.accept(view([ready]), 0)

    const detectedLate = {
      ...ready,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 2_500,
      remainingMs: 30_500,
    }
    expect(focusTime(clock.accept(view([detectedLate], 2), 2_500))).toBe(30_500)
    expect(focusTime(clock.current(3_500)!)).toBe(29_500)
  })

  it('accepts a ready-to-playing transition detected more than five seconds late', () => {
    const clock = createPlaybackClock()
    const ready = playing({
      ordinal: 0,
      status: 'ready',
      playing: false,
      durationMs: 33_000,
      elapsedMs: 0,
      remainingMs: 33_000,
    })
    clock.accept(view([ready]), 0)

    const detectedLate = {
      ...ready,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 7_000,
      remainingMs: 26_000,
    }
    expect(focusTime(clock.accept(view([detectedLate], 2), 7_000))).toBe(26_000)
    expect(focusTime(clock.current(8_000)!)).toBe(25_000)
  })

  it('uses a nonzero ready cue as the baseline for a legitimately late start', () => {
    const clock = createPlaybackClock()
    const ready = playing({
      ordinal: 0,
      status: 'ready',
      playing: false,
      elapsedMs: 10_000,
      remainingMs: 50_000,
    })
    clock.accept(view([ready]), 0)

    const detectedLate = {
      ...ready,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 17_000,
      remainingMs: 43_000,
    }
    expect(focusTime(clock.accept(view([detectedLate], 2), 7_000))).toBe(43_000)
    expect(focusTime(clock.current(8_000)!)).toBe(42_000)
  })

  it('bounds a suspicious ready-start guard when an offset stream never converges', () => {
    const clock = createPlaybackClock()
    const ready = playing({
      ordinal: 0,
      status: 'ready',
      playing: false,
      durationMs: 33_000,
      elapsedMs: 0,
      remainingMs: 33_000,
    })
    clock.accept(view([ready]), 0)

    const stale = {
      ...ready,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 9_000,
      remainingMs: 24_000,
    }
    expect(focusTime(clock.accept(view([stale], 2), 1_000))).toBe(33_000)
    expect(focusTime(clock.accept(view([{ ...stale, elapsedMs: 10_000, remainingMs: 23_000 }], 3), 2_000))).toBe(32_000)
    expect(focusTime(clock.accept(view([{ ...stale, elapsedMs: 11_000, remainingMs: 22_000 }], 4), 3_000))).toBe(31_000)

    // Four coherent samples over the quarantine window prove that this is a
    // real offset stream rather than a brief previous-run CurrentPosition.
    expect(focusTime(clock.accept(view([{ ...stale, elapsedMs: 12_000, remainingMs: 21_000 }], 5), 4_000))).toBe(21_000)
    expect(focusTime(clock.current(5_000)!)).toBe(20_000)
  })

  it('starts an immediate replay from zero after an ended sample', () => {
    const clock = createPlaybackClock()
    const sample = playing({
      ordinal: 0,
      durationMs: 33_000,
      elapsedMs: 32_000,
      remainingMs: 1_000,
    })
    clock.accept(view([sample]), 0)
    clock.accept(view([{ ...sample, status: 'ended', playing: false }], 2), 1_000)

    const replayReady = {
      ...sample,
      status: 'ready' as const,
      playing: false,
      elapsedMs: 0,
      remainingMs: 33_000,
    }
    expect(focusTime(clock.accept(view([replayReady], 3), 1_100))).toBe(33_000)

    const replaying = {
      ...replayReady,
      status: 'playing' as const,
      playing: true,
      elapsedMs: 500,
      remainingMs: 32_500,
    }
    expect(focusTime(clock.accept(view([replaying], 4), 1_600))).toBe(32_500)
    expect(focusTime(clock.current(2_600)!)).toBe(31_500)
  })

  it('continues deterministically without newer playing views', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    clock.accept(view([playing({ ordinal: 0, elapsedMs: 13_000, remainingMs: 47_000 })], 2), 1_000)
    clock.accept(view([playing({ ordinal: 0, elapsedMs: 14_000, remainingMs: 46_000 })], 3), 2_000)
    expect(focusTime(clock.current(4_000)!)).toBe(44_000)

    expect(focusTime(clock.current(20_000)!)).toBe(28_000)
  })

  it.each(['paused', 'ready'] as const)('changes to %s immediately but requires agreeing timing before correcting', (status) => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)

    const first = playing({
      ordinal: 0,
      status,
      playing: false,
      elapsedMs: 20_000,
      remainingMs: 40_000,
    })
    const transitioned = clock.accept(view([first], 2), 1_000)
    expect('videos' in transitioned.state ? transitioned.state.videos[0]?.status : null).toBe(status)
    expect(focusTime(transitioned)).toBe(47_000)

    const agreeing = { ...first, elapsedMs: 20_100, remainingMs: 39_900 }
    expect(focusTime(clock.accept(view([agreeing], 3), 2_000))).toBe(39_900)
    expect(focusTime(clock.current(20_000)!)).toBe(39_900)
  })

  it.each([
    { label: 'omitted', elapsedMs: null, remainingMs: null },
    { label: 'contradictory', elapsedMs: 20_000, remainingMs: 40_000 },
  ])('normalizes ended timing when the final sample is $label', ({ elapsedMs, remainingMs }) => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    const ended = playing({
      ordinal: 0,
      status: 'ended',
      playing: false,
      elapsedMs,
      remainingMs,
    })

    const result = clock.accept(view([ended], 2), 1_000)
    expect(focusTime(result)).toBe(0)
    expect('videos' in result.state ? result.state.videos[0]?.elapsedMs : null).toBe(60_000)
  })

  it('preserves per-video clocks across a timing-mode change', () => {
    const clock = createPlaybackClock()
    const sample = playing({ ordinal: 0 })
    clock.accept(view([sample]), 0)

    const toggled = clock.accept(view([sample], 2, 'elapsed'), 5_000)
    expect('videos' in toggled.state ? toggled.state.videos[0]?.elapsedMs : null).toBe(17_000)
    expect(focusTime(toggled)).toBe(43_000)
    const later = clock.current(10_000)!
    expect('videos' in later.state ? later.state.videos[0]?.elapsedMs : null).toBe(22_000)
    expect(focusTime(later)).toBe(38_000)
  })

  it('keeps an id-less ordinal clock through name enrichment/omission and replaces it on a defined name change', () => {
    const clock = createPlaybackClock()
    const unnamed = playing({ id: undefined, name: undefined, ordinal: 0 })
    clock.accept(view([unnamed]), 0)

    const named = { ...unnamed, name: 'A.mp4' }
    expect(focusTime(clock.accept(view([named], 2), 5_000))).toBe(43_000)
    expect(focusTime(clock.accept(view([unnamed], 3), 6_000))).toBe(42_000)
    expect(focusTime(clock.accept(view([named], 4), 7_000))).toBe(41_000)

    const replacement = { ...named, name: 'B.mp4', elapsedMs: 30_000, remainingMs: 30_000 }
    expect(focusTime(clock.accept(view([replacement], 5), 8_000))).toBe(30_000)
  })

  it('replaces a same-ID clock immediately when its defined media name changes', () => {
    const clock = createPlaybackClock()
    const first = playing({ id: 42, name: 'A.mp4', ordinal: 0 })
    clock.accept(view([first]), 0)
    expect(focusTime(clock.current(8_000)!)).toBe(40_000)

    const replacement = {
      ...first,
      name: 'B.mp4',
      elapsedMs: 30_000,
      remainingMs: 30_000,
    }
    expect(focusTime(clock.accept(view([replacement], 2), 8_000))).toBe(30_000)
  })

  it('does not infer pause or freeze from repeated static samples explicitly marked playing', () => {
    const clock = createPlaybackClock()
    const sample = playing({ ordinal: 0 })
    clock.accept(view([sample]), 0)
    clock.accept(view([sample], 2), 5_000)
    const result = clock.accept(view([sample], 3), 10_000)

    expect('videos' in result.state ? result.state.videos[0]?.status : null).toBe('playing')
    expect(focusTime(result)).toBe(38_000)
  })

  it('freezes the locally predicted position when pause omits the final COM position', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: null, remainingMs: null })
    clock.accept(view([paused], 2), 1_500)
    expect(focusTime(clock.current(10_000)!)).toBe(46_500)
  })

  it('keeps the frozen anchor through repeated paused samples with small timing variations', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    clock.accept(view([playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 13_000, remainingMs: 47_000 })], 2), 1_000)

    clock.accept(
      view([playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 13_400, remainingMs: 46_600 })], 3),
      2_000,
    )
    expect(focusTime(clock.current(10_000)!)).toBe(47_000)
  })

  it('does not change a frozen video when focus moves away and back', () => {
    const first = playing({ ordinal: 0, id: 11, isFocus: true })
    const second = playing({ ordinal: 1, id: 12, isFocus: false, durationMs: 20_000, elapsedMs: 5_000, remainingMs: 15_000 })
    const clock = createPlaybackClock()
    clock.accept(view([first, second]), 0)

    const pausedFirst = { ...first, status: 'paused' as const, playing: false, elapsedMs: 13_000, remainingMs: 47_000 }
    const pausedSecond = { ...second, status: 'paused' as const, playing: false }
    clock.accept(view([pausedFirst, pausedSecond], 2), 1_000)
    clock.accept(
      view([
        { ...pausedFirst, isFocus: false },
        { ...pausedSecond, isFocus: true, elapsedMs: 5_200, remainingMs: 14_800 },
      ], 3),
      2_000,
    )
    clock.accept(
      view([
        { ...pausedFirst, isFocus: true, elapsedMs: 12_900, remainingMs: 47_100 },
        { ...pausedSecond, isFocus: false },
      ], 4),
      3_000,
    )

    expect(focusTime(clock.current(10_000)!)).toBe(47_000)
  })

  it('tolerates exactly 1,500 ms of paused drift and confirms a larger correction twice', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 12_000, remainingMs: 48_000 })
    clock.accept(view([paused]), 0)

    const atBoundary = { ...paused, elapsedMs: 13_500, remainingMs: 46_500 }
    clock.accept(view([atBoundary], 2), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(48_000)

    const aboveBoundary = { ...paused, elapsedMs: 13_501, remainingMs: 46_499 }
    clock.accept(view([aboveBoundary], 3), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(48_000)

    const agreeing = { ...paused, elapsedMs: 13_600, remainingMs: 46_400 }
    clock.accept(view([agreeing], 4), 2_000)
    expect(focusTime(clock.current(2_000)!)).toBe(46_400)
  })

  it('keeps the playing baseline when pause omits timing before a small timed drift', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    const untimedPaused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: null, remainingMs: null })
    clock.accept(view([untimedPaused], 2), 1_000)

    const timedPaused = { ...untimedPaused, elapsedMs: 12_250, remainingMs: 47_750 }
    clock.accept(view([timedPaused], 3), 2_000)
    expect(focusTime(clock.current(10_000)!)).toBe(47_000)
  })

  it('keeps a timed paused baseline through an omitted sample before a small drift', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 12_000, remainingMs: 48_000 })
    clock.accept(view([paused]), 0)

    const omitted = { ...paused, elapsedMs: null, remainingMs: null }
    clock.accept(view([omitted], 2), 1_000)

    const timedPaused = { ...omitted, elapsedMs: 12_250, remainingMs: 47_750 }
    clock.accept(view([timedPaused], 3), 2_000)
    expect(focusTime(clock.current(10_000)!)).toBe(48_000)
  })

  it('re-anchors a first-ever untimed paused clock when timing becomes available', () => {
    const clock = createPlaybackClock()
    const untimedPaused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: null, remainingMs: null })
    clock.accept(view([untimedPaused]), 0)

    const timedPaused = { ...untimedPaused, elapsedMs: 12_250, remainingMs: 47_750 }
    clock.accept(view([timedPaused], 2), 1_000)
    expect(focusTime(clock.current(10_000)!)).toBe(47_750)
  })

  it('corrects a paused baseline after a second agreeing sample beyond the drift threshold', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 12_000, remainingMs: 48_000 })
    clock.accept(view([paused]), 0)

    const omitted = { ...paused, elapsedMs: null, remainingMs: null }
    clock.accept(view([omitted], 2), 1_000)

    const corrected = { ...omitted, elapsedMs: 13_501, remainingMs: 46_499 }
    clock.accept(view([corrected], 3), 2_000)
    expect(focusTime(clock.current(10_000)!)).toBe(48_000)

    const agreeing = { ...omitted, elapsedMs: 13_600, remainingMs: 46_400 }
    clock.accept(view([agreeing], 4), 3_000)
    expect(focusTime(clock.current(10_000)!)).toBe(46_400)
  })

  it('re-anchors on a duration change even when elapsed drift is below the threshold', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, elapsedMs: 12_000, remainingMs: 48_000 })
    clock.accept(view([paused]), 0)

    const durationChanged = { ...paused, durationMs: 70_000, elapsedMs: 13_000, remainingMs: 57_000 }
    clock.accept(view([durationChanged], 2), 1_000)
    expect(focusTime(clock.current(1_000)!)).toBe(57_000)
  })

  it('re-anchors on paused to ended when elapsed drift is below the threshold', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, durationMs: 70_000, elapsedMs: 69_000, remainingMs: 1_000 })
    clock.accept(view([paused]), 0)

    const ended = { ...paused, status: 'ended' as const, elapsedMs: 70_000, remainingMs: 0 }
    clock.accept(view([ended], 3), 2_000)
    expect(focusTime(clock.current(2_000)!)).toBe(0)
  })

  it('changes paused to ready without replacing its frozen timing', () => {
    const clock = createPlaybackClock()
    const paused = playing({ ordinal: 0, status: 'paused', playing: false, durationMs: 70_000, elapsedMs: 69_000, remainingMs: 1_000 })
    clock.accept(view([paused]), 0)

    const ready = { ...paused, status: 'ready' as const, elapsedMs: 70_000, remainingMs: 0 }
    const result = clock.accept(view([ready], 2), 1_000)
    expect('videos' in result.state ? result.state.videos[0]?.status : null).toBe('ready')
    expect(focusTime(result)).toBe(1_000)
  })

  it('keeps independent clocks when focus changes between concurrently playing videos', () => {
    const first = playing({ ordinal: 0, id: 11, elapsedMs: 10_000, remainingMs: 50_000, isFocus: true })
    const second = playing({ ordinal: 1, id: 12, elapsedMs: 5_000, remainingMs: 15_000, isFocus: false, durationMs: 20_000 })
    const clock = createPlaybackClock()
    clock.accept(view([first, second]), 0)

    const switched = [
      { ...first, isFocus: false, elapsedMs: 11_000, remainingMs: 49_000 },
      { ...second, isFocus: true, elapsedMs: 6_000, remainingMs: 14_000 },
    ]
    const result = clock.accept(view(switched, 2), 1_000)
    expect(focusTime(result)).toBe(14_000)
    expect(result.state.kind).toBe('playing')
    if ('videos' in result.state) {
      expect(result.state.videos.find((video) => video.id === 11)?.remainingMs).toBe(49_000)
      expect(result.state.videos.find((video) => video.id === 12)?.remainingMs).toBe(14_000)
    }
  })

  it('clears clocks on timing loss and starts a new clock when timing returns', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    const timingUnavailable: AppView = {
      ...view([playing({ ordinal: 0 })], 2),
      state: state([playing({ ordinal: 0 })], 'timing_unavailable'),
    }
    expect(clock.accept(timingUnavailable, 1_000).state.kind).toBe('timing_unavailable')

    const resumed = playing({ ordinal: 0, elapsedMs: 20_000, remainingMs: 40_000 })
    expect(focusTime(clock.accept(view([resumed], 3), 2_000))).toBe(40_000)
  })

  it('removes numeric playback immediately on an unavailable transition', () => {
    const clock = createPlaybackClock()
    clock.accept(view([playing({ ordinal: 0 })]), 0)
    expect(focusTime(clock.current(12_000)!)).toBe(36_000)

    const unavailable: AppView = {
      ...view([], 2),
      state: {
        kind: 'unavailable',
        multipleVideos: false,
        videoCount: 0,
        multipleInstanceWarning: false,
      },
    }
    const accepted = clock.accept(unavailable, 12_000)
    expect(accepted.state.kind).toBe('unavailable')
    expect(focusTime(accepted)).toBeNull()
    expect(focusTime(clock.current(120_000)!)).toBeNull()
  })
})
