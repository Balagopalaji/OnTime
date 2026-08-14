import { describe, expect, it } from 'vitest'
import { selectPlayingHeadline } from './powerpoint-headline'
import type { PresentationVideo } from './powerpoint-types'

const playing = (id: number, remaining?: number, elapsed = 1_000): PresentationVideo => ({
  id,
  duration: remaining === undefined ? undefined : remaining + elapsed,
  elapsed,
  remaining,
  status: 'playing',
  playing: true,
})

describe('selectPlayingHeadline (S-011)', () => {
  it('selects the greatest remaining playing video regardless of start rank', () => {
    expect(selectPlayingHeadline(
      [playing(10, 8_000), playing(20, 3_000)],
      'longest-remaining',
      new Map([[10, 1], [20, 2]]),
    )).toEqual({ kind: 'selected', index: 0 })
  })

  it('selects the latest-started still-playing video by rank', () => {
    expect(selectPlayingHeadline(
      [playing(10, 8_000), playing(20, 3_000)],
      'latest-started',
      new Map([[10, 1], [20, 2]]),
    )).toEqual({ kind: 'selected', index: 1 })
  })

  it('excludes paused, ended, and ready videos while one is playing', () => {
    const videos: PresentationVideo[] = [
      { ...playing(10, 4_000), status: 'paused', playing: false },
      { id: 20, duration: 20_000, elapsed: 20_000, remaining: 0, status: 'ended' },
      { id: 30, duration: 30_000, elapsed: 0 },
      playing(40, 2_000),
    ]
    expect(selectPlayingHeadline(videos, 'longest-remaining')).toEqual({ kind: 'selected', index: 3 })
  })

  it('delegates to canonical next-to-play fallback when nothing is playing', () => {
    expect(selectPlayingHeadline([
      { id: 10, duration: 10_000, elapsed: 0 },
      { id: 20, duration: 20_000, elapsed: 4_000, status: 'paused' },
    ], 'longest-remaining')).toEqual({ kind: 'fallback' })
  })

  it('reports unavailable if any playing candidate has no usable remaining time', () => {
    expect(selectPlayingHeadline([playing(10, 4_000), playing(20)], 'longest-remaining'))
      .toEqual({ kind: 'timing-unavailable' })
  })

  it('derives remaining and breaks ties by start rank then shape order', () => {
    const videos = [playing(10, 5_000), { ...playing(20, 5_000), remaining: undefined }]
    expect(selectPlayingHeadline(videos, 'longest-remaining', new Map([[10, 1], [20, 2]])))
      .toEqual({ kind: 'selected', index: 1 })
    expect(selectPlayingHeadline(videos, 'longest-remaining', new Map([[10, 2], [20, 2]])))
      .toEqual({ kind: 'selected', index: 0 })
  })
})
