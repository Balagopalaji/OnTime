import { describe, expect, it } from 'vitest'
import type { PowerPointViewState } from '@ontime/presentation-core'
import { describeView, formatTime } from './view'

const ortho = { multipleVideos: false, videoCount: 0, multipleInstanceWarning: false }

const state = (partial: PowerPointViewState): PowerPointViewState => partial

describe('formatTime', () => {
  it('renders null and non-finite as --:-- and zero as 00:00', () => {
    expect(formatTime(null)).toBe('--:--')
    expect(formatTime(Number.NaN)).toBe('--:--')
    expect(formatTime(Infinity)).toBe('--:--')
    expect(formatTime(0)).toBe('00:00')
  })

  it('renders MM:SS under an hour and H:MM:SS at/above an hour, rounding', () => {
    expect(formatTime(12_000)).toBe('00:12')
    expect(formatTime(48_000)).toBe('00:48')
    expect(formatTime(60_000)).toBe('01:00')
    expect(formatTime(3_661_000)).toBe('1:01:01')
    expect(formatTime(1_500)).toBe('00:02') // rounds to nearest second
  })

  it('never renders a negative number', () => {
    expect(formatTime(-5_000)).toBe('00:00')
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
