import { describe, expect, it } from 'vitest'
import type { BridgePollOutcome } from '@ontime/ppt-bridge'
import {
  createPlaybackPollPolicy,
  POWERPOINT_ARMED_POLL_INTERVAL_MS,
  POWERPOINT_MOVEMENT_REARM_STABLE_MS,
  POWERPOINT_POLL_INTERVAL_MS,
  POWERPOINT_START_BURST_INTERVAL_MS,
  POWERPOINT_START_BURST_WINDOW_MS,
} from './playback-poll-policy.js'

const base = { warnings: [], extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 } }

const observation = (extra: Record<string, unknown> = {}): BridgePollOutcome => ({
  kind: 'observation',
  observation: {
    state: 'foreground',
    instanceId: 1,
    slideNumber: 1,
    inSlideshow: true,
    title: 'Deck',
    ...extra,
  },
  ...base,
})

const video = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  duration: 10_000,
  elapsed: 0,
  status: 'paused' as const,
  playing: false,
  ...extra,
})

describe('createPlaybackPollPolicy', () => {
  it('bursts when B starts while A is already playing', () => {
    const policy = createPlaybackPollPolicy()
    const aPlayingBPaused = [video(10, { status: 'playing', playing: true }), video(20)]
    const bothPlaying = [video(10, { status: 'playing', playing: true }), video(20, { status: 'playing', playing: true })]

    expect(policy(observation({ videos: aPlayingBPaused }), 0)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: aPlayingBPaused }), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(observation({ videos: bothPlaying }), POWERPOINT_START_BURST_WINDOW_MS + 1))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('stays armed at 500 ms while a playing video has a paused sibling', () => {
    const policy = createPlaybackPollPolicy()
    const videos = [video(10, { status: 'playing', playing: true }), video(20)]

    policy(observation({ videos }), 0)
    expect(policy(observation({ videos }), POWERPOINT_START_BURST_WINDOW_MS))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
  })

  it('returns one playing video to 1,000 ms after the burst', () => {
    const policy = createPlaybackPollPolicy()
    const videos = [video(10, { status: 'playing', playing: true })]

    policy(observation({ videos }), 0)
    expect(policy(observation({ videos }), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('does not use elapsed movement from a video already reporting playing', () => {
    const policy = createPlaybackPollPolicy()

    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true, elapsed: 0 })] }), 0))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true, elapsed: 200 })] }), 200))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true, elapsed: 2_000 })] }), 2_000))
      .toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true, elapsed: 3_000 })] }), 3_000))
      .toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('confirms contradictory non-playing evidence with a 200 ms burst', () => {
    const policy = createPlaybackPollPolicy()
    const playing = [video(10, { status: 'playing', playing: true })]
    const paused = [video(10)]

    policy(observation({ videos: playing }), 0)
    expect(policy(observation({ videos: paused }), POWERPOINT_START_BURST_WINDOW_MS + 1))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('bursts once for B movement while A plays, then returns to armed cadence', () => {
    const policy = createPlaybackPollPolicy()
    const baseline = [video(10, { status: 'playing', playing: true }), video(20)]
    const moved = [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 300 })]
    const movedAgain = [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 600 })]

    policy(observation({ videos: baseline }), 0)
    policy(observation({ videos: baseline }), POWERPOINT_START_BURST_WINDOW_MS)
    expect(policy(observation({ videos: moved }), POWERPOINT_START_BURST_WINDOW_MS + 1))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: movedAgain }), POWERPOINT_START_BURST_WINDOW_MS + 201))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 900 })] }), POWERPOINT_START_BURST_WINDOW_MS * 2 + 1))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
  })

  it('does not extend a burst for ordinary continued elapsed movement', () => {
    const policy = createPlaybackPollPolicy()
    const initial = [video(10, { status: 'playing', playing: true }), video(20)]

    policy(observation({ videos: initial }), 0)
    policy(observation({ videos: initial }), POWERPOINT_START_BURST_WINDOW_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 300 })] }), 2_001))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 600 })] }), 4_001))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true }), video(20, { elapsed: 900 })] }), 5_001))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
  })

  it('keeps one non-playing movement episode across 200, 500, and 1,000 ms samples', () => {
    const policy = createPlaybackPollPolicy()
    const sample = (elapsed: number) => observation({ videos: [video(10, { elapsed })] })

    expect(policy(sample(0), 0)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(0), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(300), 2_500)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(600), 3_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(900), 4_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(1_200), 4_500)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(2_200), 5_500)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
  })

  it('accumulates unconfirmed per-video movement before opening one burst', () => {
    const policy = createPlaybackPollPolicy()
    const sample = (elapsed: number) => observation({ videos: [video(10, { elapsed })] })

    policy(sample(0), 0)
    expect(policy(sample(0), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(100), 2_500)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(600), 3_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(1_100), 4_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(1_600), 5_000)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(2_600), 6_000)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)

    // A stable stop clears the active episode; later movement can open one
    // fresh burst after the bounded stationary interval.
    expect(policy(sample(2_600), 7_000)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(2_600), 8_000)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(2_900), 8_500)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('uses the same cumulative movement semantics for scalar-only observations', () => {
    const policy = createPlaybackPollPolicy()
    const sample = (elapsed: number) => observation({
      videoDetected: true,
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: elapsed,
    })

    policy(sample(0), 0)
    expect(policy(sample(0), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(sample(100), 2_500)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(sample(600), 3_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(1_100), 4_000)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(1_600), 5_000)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(sample(2_600), 6_000)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('re-arms movement only after a stable stationary pause', () => {
    const policy = createPlaybackPollPolicy()
    const sample = (elapsed: number) => observation({ videos: [video(10, { elapsed })] })

    policy(sample(0), 0)
    expect(policy(sample(0), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(300), POWERPOINT_START_BURST_WINDOW_MS + 500)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(sample(300), POWERPOINT_START_BURST_WINDOW_MS + 2_500)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(300), POWERPOINT_START_BURST_WINDOW_MS + 2_500 + POWERPOINT_MOVEMENT_REARM_STABLE_MS - 1))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(300), POWERPOINT_START_BURST_WINDOW_MS + 2_500 + POWERPOINT_MOVEMENT_REARM_STABLE_MS))
      .toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(sample(600), POWERPOINT_START_BURST_WINDOW_MS + 2_500 + POWERPOINT_MOVEMENT_REARM_STABLE_MS + 1))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('returns 1,000 ms immediately for an observation containing only ended videos', () => {
    const policy = createPlaybackPollPolicy()
    const ended = [video(10, { status: 'ended', playing: false, elapsed: 10_000 })]

    expect(policy(observation({ videos: ended }), 0)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('cancels confirmation polling when the last playing video ends', () => {
    const policy = createPlaybackPollPolicy()
    const playing = [video(10, { status: 'playing', playing: true })]
    const ended = [video(10, { status: 'ended', playing: false, elapsed: 10_000 })]

    expect(policy(observation({ videos: playing }), 0)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation({ videos: ended }), 100)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('uses the 500 ms armed cadence when a sibling remains playable after another ends', () => {
    const policy = createPlaybackPollPolicy()
    const playingAndPaused = [video(10, { status: 'playing', playing: true }), video(20)]
    const endedAndPaused = [
      video(10, { status: 'ended', playing: false, elapsed: 10_000 }),
      video(20),
    ]

    policy(observation({ videos: playingAndPaused }), 0)
    expect(policy(observation({ videos: endedAndPaused }), 100)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
  })

  it('cancels an outstanding burst when media disappears', () => {
    const policy = createPlaybackPollPolicy()

    expect(policy(observation({ videos: [video(10, { status: 'playing', playing: true })] }), 0))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(observation(), 100)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('bursts when a new video identity appears', () => {
    const policy = createPlaybackPollPolicy()
    const a = [video(10)]
    const aAndB = [video(10), video(20)]

    policy(observation({ videos: a }), 0)
    expect(policy(observation({ videos: a }), POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_ARMED_POLL_INTERVAL_MS)
    expect(policy(observation({ videos: aAndB }), POWERPOINT_START_BURST_WINDOW_MS + 1))
      .toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('resets all state after failure and no-slideshow outcomes', () => {
    const policy = createPlaybackPollPolicy()
    const playing = observation({ videos: [video(10, { status: 'playing', playing: true })] })

    expect(policy(playing, 0)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy({ kind: 'timeout', ...base }, 100)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(playing, 200)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy({ kind: 'no_slideshow', observation: { state: 'foreground', inSlideshow: false }, ...base }, 300))
      .toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(playing, 400)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
  })

  it('preserves scalar-only legacy playing transitions', () => {
    const policy = createPlaybackPollPolicy()
    const paused = observation({ videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 0 })
    const playing = observation({ videoDetected: true, videoPlaying: true, videoDuration: 10_000, videoElapsed: 0 })

    expect(policy(paused, 0)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(paused, POWERPOINT_START_BURST_WINDOW_MS)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy(playing, POWERPOINT_START_BURST_WINDOW_MS + 1)).toBe(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(policy(playing, POWERPOINT_START_BURST_WINDOW_MS * 2 + 1)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })

  it('returns the normal cadence for no media and terminal outcomes', () => {
    const policy = createPlaybackPollPolicy()

    expect(policy(observation(), 0)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy({ kind: 'powerpoint_not_running', ...base }, 1_000)).toBe(POWERPOINT_POLL_INTERVAL_MS)
    expect(policy({ kind: 'timeout', ...base }, 2_000)).toBe(POWERPOINT_POLL_INTERVAL_MS)
  })
})
