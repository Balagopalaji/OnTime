import { describe, expect, it } from 'vitest'
import type { PowerPointVideoTile, PowerPointViewState } from '@ontime/presentation-core'
import {
  announcementFor,
  describeView,
  formatTime,
  localAdvanceMs,
  SMOOTHING_STALE_MS,
  tileRemainingMs,
} from './view'

const ortho = { multipleVideos: false, videoCount: 0, multipleInstanceWarning: false }

const state = (partial: PowerPointViewState): PowerPointViewState => partial

const tile = (partial: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile => ({
  status: 'ready',
  playing: false,
  durationMs: null,
  elapsedMs: null,
  remainingMs: null,
  isFocus: false,
  ...partial,
})

describe('formatTime', () => {
  it('renders null and non-finite as --:-- and zero as 00:00', () => {
    expect(formatTime(null)).toBe('--:--')
    expect(formatTime(Number.NaN)).toBe('--:--')
    expect(formatTime(Infinity)).toBe('--:--')
    expect(formatTime(0)).toBe('00:00')
  })

  it('renders MM:SS under an hour and H:MM:SS at/above an hour', () => {
    expect(formatTime(12_000)).toBe('00:12')
    expect(formatTime(48_000)).toBe('00:48')
    expect(formatTime(60_000)).toBe('01:00')
    expect(formatTime(3_661_000)).toBe('1:01:01')
  })

  it('floors to whole seconds, matching the Controller (never rounds up)', () => {
    expect(formatTime(1_500)).toBe('00:01')
    expect(formatTime(1_999)).toBe('00:01')
    expect(formatTime(999)).toBe('00:00')
    expect(formatTime(59_999)).toBe('00:59')
    expect(formatTime(3_599_999)).toBe('59:59')
    expect(formatTime(3_600_000)).toBe('1:00:00')
  })

  it('never renders a negative number', () => {
    expect(formatTime(-5_000)).toBe('00:00')
    expect(formatTime(-1)).toBe('00:00')
  })
})

describe('tileRemainingMs', () => {
  it('prefers the observed remaining value', () => {
    expect(tileRemainingMs(tile({ ordinal: 0, remainingMs: 5_000, durationMs: 60_000, elapsedMs: 10_000 }))).toBe(5_000)
  })

  it('derives duration minus elapsed only when no remaining was observed', () => {
    expect(tileRemainingMs(tile({ ordinal: 0, durationMs: 60_000, elapsedMs: 10_000 }))).toBe(50_000)
    expect(tileRemainingMs(tile({ ordinal: 0, durationMs: 60_000 }))).toBeNull()
    expect(tileRemainingMs(tile({ ordinal: 0 }))).toBeNull()
  })
})

describe('localAdvanceMs', () => {
  it('is the elapsed local time between observation and now', () => {
    expect(localAdvanceMs(1_000, 1_750)).toBe(750)
  })

  it('never advances backwards or on a non-finite clock', () => {
    expect(localAdvanceMs(1_000, 1_000)).toBe(0)
    expect(localAdvanceMs(1_000, 900)).toBe(0)
    expect(localAdvanceMs(Number.NaN, 1_000)).toBe(0)
    expect(localAdvanceMs(1_000, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('caps at the 2 second staleness bound instead of counting indefinitely', () => {
    expect(SMOOTHING_STALE_MS).toBe(2_000)
    expect(localAdvanceMs(0, 1_999)).toBe(1_999)
    expect(localAdvanceMs(0, 2_000)).toBe(2_000)
    expect(localAdvanceMs(0, 30_000)).toBe(2_000)
  })
})

describe('describeView — non-presentation states', () => {
  it('S-001 connecting shows the connecting message and no time', () => {
    const m = describeView(state({ kind: 'connecting', ...ortho }))
    expect(m.messageText).toBe('Connecting to PowerPoint…')
    expect(m.timeText).toBe('--:--')
    expect(m.badge).toBeNull()
    expect(m.slideText).toBeNull()
    expect(m.multiInstanceWarning).toBeNull()
  })

  it('S-002 unavailable shows the unavailable message, a retry badge, and no numeric time', () => {
    const m = describeView(state({ kind: 'unavailable', ...ortho }))
    expect(m.messageText).toBe('PowerPoint timing unavailable')
    expect(m.badge).toBe('retry')
    expect(m.timeText).toBe('--:--')
  })

  it('S-003 powerpoint_not_running shows the not-running message', () => {
    const m = describeView(state({ kind: 'powerpoint_not_running', ...ortho }))
    expect(m.messageText).toBe('PowerPoint is not running')
    expect(m.timeText).toBe('--:--')
    expect(m.slideText).toBeNull()
  })

  it('S-004 no_slideshow shows the no-slideshow message', () => {
    const m = describeView(state({ kind: 'no_slideshow', ...ortho }))
    expect(m.messageText).toBe('No slideshow running')
  })
})

describe('describeView — presentation states', () => {
  const presentation = {
    slideNumber: 3,
    totalSlides: 10,
    title: 'Deck.pptx',
    filenameBasename: 'Deck.pptx',
    selectedVideoId: 502,
    selectedVideoName: 'Intro.mp4',
    ...ortho,
    multipleVideos: false,
    videoCount: 1,
    videos: [],
  }

  it('S-005 no_video shows slide/title and the no-video message with no time', () => {
    const m = describeView(state({ kind: 'no_video', ...presentation, timeMs: null, durationMs: null }))
    expect(m.messageText).toBe('No video on this slide')
    expect(m.slideText).toBe('Slide 3 of 10')
    expect(m.titleText).toBe('Deck.pptx')
    expect(m.videoText).toBeNull()
    expect(m.timeText).toBe('--:--')
  })

  it('S-006 timing_unavailable shows slide/title/video and --:--', () => {
    const m = describeView(state({ kind: 'timing_unavailable', ...presentation, timeMs: null, durationMs: null }))
    expect(m.slideText).toBe('Slide 3 of 10')
    expect(m.videoText).toBe('Intro.mp4')
    expect(m.timeText).toBe('--:--')
    expect(m.messageText).toBeNull()
  })

  it('S-007 playing shows a playing badge and the formatted remaining time', () => {
    const m = describeView(state({ kind: 'playing', ...presentation, timeMs: 48_000, durationMs: 60_000 }))
    expect(m.badge).toBe('playing')
    expect(m.timeText).toBe('00:48')
    expect(m.slideText).toBe('Slide 3 of 10')
  })

  it('S-008 paused shows a paused badge with the frozen value (not advancing)', () => {
    const m = describeView(state({ kind: 'paused', ...presentation, timeMs: 12_000, durationMs: 60_000 }))
    expect(m.badge).toBe('paused')
    expect(m.timeText).toBe('00:12')
  })

  it('S-009 ended shows Ended with 00:00 in remaining mode', () => {
    const m = describeView(state({ kind: 'ended', ...presentation, timeMs: 0, durationMs: 60_000 }))
    expect(m.messageText).toBe('Ended')
    expect(m.timeText).toBe('00:00')
  })

  it('S-009 ended shows the final elapsed value in elapsed mode', () => {
    const m = describeView(state({ kind: 'ended', ...presentation, timeMs: 60_000, durationMs: 60_000 }))
    expect(m.messageText).toBe('Ended')
    expect(m.timeText).toBe('01:00')
  })

  it('S-010 ready shows Ready with the duration when known', () => {
    const m = describeView(state({ kind: 'ready', ...presentation, timeMs: null, durationMs: 60_000 }))
    expect(m.messageText).toBe('Ready')
    expect(m.timeText).toBe('01:00')
  })

  it('S-010 ready shows Ready with --:-- when duration is unknown', () => {
    const m = describeView(state({ kind: 'ready', ...presentation, timeMs: null, durationMs: null }))
    expect(m.messageText).toBe('Ready')
    expect(m.timeText).toBe('--:--')
  })
})

describe('describeView — indicators and overlays', () => {
  it('S-011 multiple videos renders an "N videos" indicator and keeps single-video text otherwise', () => {
    const multi = describeView(state({
      kind: 'playing',
      slideNumber: 1, totalSlides: 2, title: 'D', filenameBasename: 'D',
      selectedVideoId: 502, selectedVideoName: 'Intro.mp4',
      timeMs: 1000, durationMs: 2000,
      multipleVideos: true, videoCount: 3, multipleInstanceWarning: false,
      videos: [],
    }))
    expect(multi.videoText).toBe('3 videos')
  })

  it('S-012 multiple-instance warning renders the overlay text alongside any state', () => {
    const m = describeView(state({ kind: 'playing', slideNumber: 1, totalSlides: 1, title: 'D', filenameBasename: 'D', timeMs: 1000, durationMs: 2000, multipleVideos: false, videoCount: 1, multipleInstanceWarning: true, videos: [] }))
    expect(m.multiInstanceWarning).toBe('Multiple PowerPoint instances detected; verify the deck')
    expect(m.badge).toBe('playing')
  })

  it('S-015 missing total slide count renders "Slide X of --"', () => {
    const m = describeView(state({ kind: 'playing', slideNumber: 8, totalSlides: undefined, title: 'D', filenameBasename: 'D', timeMs: 1000, durationMs: 2000, multipleVideos: false, videoCount: 1, multipleInstanceWarning: false, videos: [] }))
    expect(m.slideText).toBe('Slide 8 of --')
  })

  it('S-016 hides the full path, showing title/basename only', () => {
    const m = describeView(state({ kind: 'no_video', slideNumber: 1, totalSlides: 1, title: 'Secret Deck.pptx', filenameBasename: 'Secret Deck.pptx', timeMs: null, durationMs: null, multipleVideos: false, videoCount: 0, multipleInstanceWarning: false, videos: [] }))
    expect(m.titleText).toBe('Secret Deck.pptx')
    expect(m.titleText).not.toContain('/')
    expect(m.titleText).not.toContain('\\')
  })

  it('S-013 failure removes numeric timing: unavailable never carries a stale number', () => {
    const m = describeView(state({ kind: 'unavailable', ...ortho }))
    expect(m.timeText).toBe('--:--')
    expect(m.badge).toBe('retry')
  })
})

// ---------------------------------------------------------------------------
// Multi-video rows and bounded local interpolation.
// ---------------------------------------------------------------------------

const deck = {
  slideNumber: 2,
  totalSlides: 9,
  title: 'Deck.pptx',
  filenameBasename: 'Deck.pptx',
  multipleInstanceWarning: false,
}

/** A presentation view with the given rows; `timeMs` is deliberately bogus so a
 * test fails if the large timer falls back to the helper-primary scalar. */
const withVideos = (
  kind: 'playing' | 'paused' | 'ended' | 'ready' | 'timing_unavailable',
  videos: PowerPointVideoTile[],
): PowerPointViewState =>
  state({
    kind,
    ...deck,
    timeMs: 999_000,
    durationMs: 999_000,
    multipleVideos: videos.length > 1,
    videoCount: videos.length,
    videos,
  })

const rowByOrdinal = (m: ReturnType<typeof describeView>, ordinal: number) =>
  m.videoRows.find((row) => row.ordinal === ordinal)

describe('describeView — per-video rows', () => {
  const twoVideos = [
    tile({ ordinal: 0, id: 11, name: 'Intro.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
    tile({ ordinal: 1, id: 12, name: ' Outro.mp4 ', status: 'paused', durationMs: 30_000, elapsedMs: 9_000, remainingMs: 21_000 }),
  ]

  it('renders one row per video with ordinal/name, status text, and an independent timer', () => {
    const m = describeView(withVideos('playing', twoVideos), { timingMode: 'remaining' })
    expect(m.videoRows).toHaveLength(2)
    expect(m.videoRows[0]?.nameText).toBe('Intro.mp4')
    expect(m.videoRows[0]?.label).toBe('1. Intro.mp4')
    expect(m.videoRows[0]?.statusText).toBe('Playing')
    expect(m.videoRows[0]?.timeText).toBe('00:48')
    expect(m.videoRows[1]?.label).toBe('2. Outro.mp4')
    expect(m.videoRows[1]?.statusText).toBe('Paused')
    expect(m.videoRows[1]?.timeText).toBe('00:21')
  })

  it('falls back to a positional name and renders all four status words', () => {
    const m = describeView(
      withVideos('ready', [
        tile({ ordinal: 0, status: 'ready', durationMs: 5_000, isFocus: true }),
        tile({ ordinal: 1, name: '   ', status: 'playing', playing: true, remainingMs: 4_000 }),
        tile({ ordinal: 2, status: 'paused', remainingMs: 3_000 }),
        tile({ ordinal: 3, status: 'ended', remainingMs: 0 }),
      ]),
    )
    expect(m.videoRows.map((row) => row.label)).toEqual(['1. Video 1', '2. Video 2', '3. Video 3', '4. Video 4'])
    expect(m.videoRows.map((row) => row.nameText)).toEqual(['Video 1', 'Video 2', 'Video 3', 'Video 4'])
    expect(m.videoRows.map((row) => row.statusText)).toEqual(['Ready', 'Playing', 'Paused', 'Ended'])
  })

  it('highlights exactly the isFocus row', () => {
    const m = describeView(withVideos('playing', twoVideos))
    expect(m.videoRows.filter((row) => row.isFocus)).toHaveLength(1)
    expect(rowByOrdinal(m, 0)?.isFocus).toBe(true)
    expect(rowByOrdinal(m, 1)?.isFocus).toBe(false)
  })

  it('renders no rows for non-presentation states, so no countdown survives them', () => {
    for (const kind of ['connecting', 'unavailable', 'powerpoint_not_running', 'no_slideshow'] as const) {
      const m = describeView(state({ kind, ...ortho }))
      expect(m.videoRows).toEqual([])
      expect(m.timeText).toBe('--:--')
    }
  })

  it('renders --:-- for rows with null/non-finite timing and keeps the state message', () => {
    const m = describeView(
      withVideos('timing_unavailable', [
        tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, isFocus: true }),
        tile({ ordinal: 1, name: 'B.mp4', status: 'paused', remainingMs: Number.NaN }),
      ]),
    )
    expect(m.videoRows[0]?.timeText).toBe('--:--')
    expect(m.videoRows[1]?.timeText).toBe('--:--')
    // timing_unavailable still shows no numeric headline time.
    expect(m.timeText).toBe('--:--')
  })

  it('suppresses row timing under timing_unavailable even when tiles carry stale values', () => {
    // Normalization can carry a cached/prior video list into a state that
    // declares timing unavailable, so rows must not show (or advance) numbers
    // the headline is refusing to show.
    const staleButPlaying = withVideos('timing_unavailable', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'paused', durationMs: 30_000, elapsedMs: 9_000, remainingMs: 21_000 }),
    ])
    for (const advanceMs of [0, 250, 2_000]) {
      for (const timingMode of ['remaining', 'elapsed'] as const) {
        const m = describeView(staleButPlaying, { timingMode, advanceMs })
        expect(m.timeText).toBe('--:--')
        expect(m.videoRows.map((row) => row.timeText)).toEqual(['--:--', '--:--'])
      }
    }
    // Identity and status are still useful, so the rows themselves remain.
    const m = describeView(staleButPlaying)
    expect(m.videoRows.map((row) => row.label)).toEqual(['1. A.mp4', '2. B.mp4'])
    expect(m.videoRows.map((row) => row.statusText)).toEqual(['Playing', 'Paused'])
  })

  it('never renders a negative remaining value on a row', () => {
    const m = describeView(
      withVideos('playing', [
        tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 10_000, elapsedMs: 13_000, remainingMs: -3_000, isFocus: true }),
      ]),
    )
    expect(m.videoRows[0]?.timeText).toBe('00:00')
  })
})

describe('describeView — large timer follows the focus tile', () => {
  it('takes the headline number from the focus row, not the helper-primary scalar', () => {
    const m = describeView(
      withVideos('playing', [
        tile({ ordinal: 0, name: 'A.mp4', status: 'paused', durationMs: 60_000, elapsedMs: 5_000, remainingMs: 55_000 }),
        tile({ ordinal: 1, name: 'B.mp4', status: 'playing', playing: true, durationMs: 40_000, elapsedMs: 10_000, remainingMs: 30_000, isFocus: true }),
      ]),
      { timingMode: 'remaining' },
    )
    // state.timeMs is 999_000 (16:39); the focus row is authoritative.
    expect(m.timeText).toBe('00:30')
    expect(m.timeText).toBe(rowByOrdinal(m, 1)?.timeText)
  })

  it('keeps the focus row and the large timer aligned in both timing modes and while interpolating', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 30_000, remainingMs: 30_000 }),
    ])
    for (const timingMode of ['remaining', 'elapsed'] as const) {
      for (const advanceMs of [0, 250, 999, 1_500, 2_000]) {
        const m = describeView(view, { timingMode, advanceMs })
        const focus = m.videoRows.find((row) => row.isFocus)
        expect(focus).toBeDefined()
        expect(m.timeText).toBe(focus?.timeText)
      }
    }
  })

  it('keeps aligned when the focus row is ended or ready', () => {
    const ended = describeView(
      withVideos('ended', [tile({ ordinal: 0, name: 'A.mp4', status: 'ended', durationMs: 60_000, elapsedMs: 60_000, remainingMs: 0, isFocus: true })]),
      { timingMode: 'remaining' },
    )
    expect(ended.timeText).toBe('00:00')
    expect(ended.timeText).toBe(ended.videoRows[0]?.timeText)
    expect(ended.messageText).toBe('Ended')

    const ready = describeView(
      withVideos('ready', [tile({ ordinal: 0, name: 'A.mp4', status: 'ready', durationMs: 90_000, isFocus: true })]),
    )
    expect(ready.timeText).toBe('01:30')
    expect(ready.timeText).toBe(ready.videoRows[0]?.timeText)
    expect(ready.messageText).toBe('Ready')
  })
})

describe('describeView — bounded local interpolation', () => {
  const playingAndPaused = [
    tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
    tile({ ordinal: 1, name: 'B.mp4', status: 'paused', durationMs: 60_000, elapsedMs: 21_000, remainingMs: 39_000 }),
  ]

  it('advances the playing row and freezes the paused row', () => {
    const view = withVideos('playing', playingAndPaused)
    const m = describeView(view, { timingMode: 'remaining', advanceMs: 3_000 })
    expect(rowByOrdinal(m, 0)?.timeText).toBe('00:45')
    expect(rowByOrdinal(m, 1)?.timeText).toBe('00:39')
    const elapsed = describeView(view, { timingMode: 'elapsed', advanceMs: 3_000 })
    expect(rowByOrdinal(elapsed, 0)?.timeText).toBe('00:15')
    expect(rowByOrdinal(elapsed, 1)?.timeText).toBe('00:21')
  })

  it('advances two concurrent playing rows independently from their own values', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 10_000, remainingMs: 50_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'playing', playing: true, durationMs: 20_000, elapsedMs: 5_000, remainingMs: 15_000 }),
    ])
    const m = describeView(view, { timingMode: 'remaining', advanceMs: 1_000 })
    expect(rowByOrdinal(m, 0)?.timeText).toBe('00:49')
    expect(rowByOrdinal(m, 1)?.timeText).toBe('00:14')
    const later = describeView(view, { timingMode: 'remaining', advanceMs: 2_000 })
    expect(rowByOrdinal(later, 0)?.timeText).toBe('00:48')
    expect(rowByOrdinal(later, 1)?.timeText).toBe('00:13')
  })

  it('renders a ready row as its duration in BOTH timing modes (pinned decision)', () => {
    // A ready video's meaningful number is its length, so the row shows the
    // duration even in elapsed mode. This keeps the pre-existing S-010 headline
    // contract and the focus-row/large-timer alignment invariant; the cost is
    // that the row column mixes a duration with elapsed values. Changing this
    // requires a spec decision on S-010, not just a renderer edit.
    const view = withVideos('ready', [
      tile({ ordinal: 0, name: 'Ready.mp4', status: 'ready', durationMs: 90_000, isFocus: true }),
      tile({ ordinal: 1, name: 'Live.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000 }),
    ])
    const remaining = describeView(view, { timingMode: 'remaining' })
    const elapsed = describeView(view, { timingMode: 'elapsed' })
    expect(rowByOrdinal(remaining, 0)?.timeText).toBe('01:30')
    expect(rowByOrdinal(elapsed, 0)?.timeText).toBe('01:30')
    // The playing row does honour the mode, which is where the units differ.
    expect(rowByOrdinal(remaining, 1)?.timeText).toBe('00:48')
    expect(rowByOrdinal(elapsed, 1)?.timeText).toBe('00:12')
    // The headline stays aligned with the ready focus row in both modes.
    expect(remaining.timeText).toBe('01:30')
    expect(elapsed.timeText).toBe('01:30')
  })

  it('never advances ready or ended rows', () => {
    const view = withVideos('ready', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'ready', durationMs: 45_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'ended', durationMs: 30_000, elapsedMs: 30_000, remainingMs: 0 }),
    ])
    for (const advanceMs of [0, 1_000, 2_000]) {
      const m = describeView(view, { timingMode: 'remaining', advanceMs })
      expect(rowByOrdinal(m, 0)?.timeText).toBe('00:45')
      expect(rowByOrdinal(m, 1)?.timeText).toBe('00:00')
    }
    const elapsedMode = describeView(view, { timingMode: 'elapsed', advanceMs: 2_000 })
    expect(rowByOrdinal(elapsedMode, 1)?.timeText).toBe('00:30')
  })

  it('snaps to the observed truth at zero advance, including a corrected/seek value', () => {
    const seeked = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 2_000, remainingMs: 58_000, isFocus: true }),
    ])
    // A backwards seek arrives; zero advance renders it verbatim with no blend.
    expect(describeView(seeked, { timingMode: 'remaining', advanceMs: 0 }).timeText).toBe('00:58')
    expect(describeView(seeked, { timingMode: 'elapsed', advanceMs: 0 }).timeText).toBe('00:02')
    // A negative advance (clock went backwards) is likewise inert.
    expect(describeView(seeked, { timingMode: 'remaining', advanceMs: -5_000 }).timeText).toBe('00:58')
  })

  it('caps remaining at zero and elapsed at duration, keeping the Playing status', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 59_500, remainingMs: 500, isFocus: true }),
    ])
    const m = describeView(view, { timingMode: 'remaining', advanceMs: 2_000 })
    expect(m.videoRows[0]?.timeText).toBe('00:00')
    // Reaching 00:00 locally must NOT invent Ended before the helper confirms it.
    expect(m.videoRows[0]?.statusText).toBe('Playing')
    expect(m.stateKind).toBe('playing')
    expect(m.messageText).toBeNull()
    const elapsed = describeView(view, { timingMode: 'elapsed', advanceMs: 2_000 })
    expect(elapsed.videoRows[0]?.timeText).toBe('01:00')
  })

  it('derives an interpolated remaining from duration minus elapsed when none was observed', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 10_000, isFocus: true }),
    ])
    expect(describeView(view, { timingMode: 'remaining', advanceMs: 0 }).timeText).toBe('00:50')
    expect(describeView(view, { timingMode: 'remaining', advanceMs: 4_000 }).timeText).toBe('00:46')
  })

  it('leaves null timing null while interpolating (no invented numbers)', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, isFocus: true }),
    ])
    expect(describeView(view, { timingMode: 'remaining', advanceMs: 1_000 }).timeText).toBe('--:--')
    expect(describeView(view, { timingMode: 'elapsed', advanceMs: 1_000 }).timeText).toBe('--:--')
  })
})

describe('announcementFor', () => {
  it('does not change as timers tick, so the live region stays quiet', () => {
    const view = withVideos('playing', [
      tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 1_000, remainingMs: 59_000, isFocus: true }),
      tile({ ordinal: 1, name: 'B.mp4', status: 'paused', durationMs: 60_000, elapsedMs: 30_000, remainingMs: 30_000 }),
    ])
    const first = announcementFor(describeView(view, { advanceMs: 0 }))
    const later = announcementFor(describeView(view, { advanceMs: 1_900 }))
    expect(later).toBe(first)
    expect(first).toBe('Playing — 1. A.mp4: Playing, 2. B.mp4: Paused')
    expect(first).not.toMatch(/\d\d:\d\d/)
  })

  it('changes when a video status changes', () => {
    const rows = (secondStatus: PowerPointVideoTile['status']) =>
      announcementFor(
        describeView(
          withVideos('playing', [
            tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, remainingMs: 10_000, isFocus: true }),
            tile({ ordinal: 1, name: 'B.mp4', status: secondStatus, remainingMs: 10_000 }),
          ]),
        ),
      )
    expect(rows('ready')).not.toBe(rows('playing'))
    expect(rows('ended')).toContain('2. B.mp4: Ended')
  })

  it('leads with the multi-instance warning so it is spoken once, not per poll', () => {
    const warnedView = state({
      kind: 'playing',
      ...deck,
      multipleInstanceWarning: true,
      timeMs: 1_000,
      durationMs: 2_000,
      multipleVideos: false,
      videoCount: 1,
      videos: [
        tile({ ordinal: 0, name: 'A.mp4', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 12_000, remainingMs: 48_000, isFocus: true }),
      ],
    })
    expect(announcementFor(describeView(warnedView))).toBe(
      'Multiple PowerPoint instances detected; verify the deck — Playing — 1. A.mp4',
    )
    // Unchanged as timers tick, so the change-gated announcer stays silent
    // instead of re-announcing the warning on every repaint.
    expect(announcementFor(describeView(warnedView, { advanceMs: 1_900 }))).toBe(
      announcementFor(describeView(warnedView, { advanceMs: 0 })),
    )
  })

  it('announces non-presentation and single-video states without timer values', () => {
    expect(announcementFor(describeView(state({ kind: 'connecting', ...ortho })))).toBe('Connecting to PowerPoint…')
    expect(announcementFor(describeView(state({ kind: 'unavailable', ...ortho })))).toBe('PowerPoint timing unavailable')
    expect(announcementFor(describeView(state({ kind: 'no_slideshow', ...ortho })))).toBe('No slideshow running')
    const single = describeView(
      withVideos('paused', [tile({ ordinal: 0, name: 'A.mp4', status: 'paused', remainingMs: 12_000, isFocus: true })]),
    )
    expect(announcementFor(single)).toBe('Paused — 1. A.mp4')
  })
})
