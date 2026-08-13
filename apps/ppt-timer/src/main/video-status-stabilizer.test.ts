import { describe, expect, it } from 'vitest'
import { resolveVideoStatus, type PresentationVideo } from '@ontime/presentation-core'
import {
  initVideoStatusStabilizer,
  stabilizeVideoStatuses,
  VIDEO_PAUSE_CONFIRMATION_MS,
} from './video-status-stabilizer'

const playing = (id: number, elapsed = 1_000, name = 'video.mp4', duration = 10_000): PresentationVideo => ({
  id,
  name,
  duration,
  elapsed,
  remaining: duration - elapsed,
  status: 'playing',
  playing: true,
})

const paused = (id: number, elapsed = 1_000, name = 'video.mp4', duration = 10_000): PresentationVideo => ({
  ...playing(id, elapsed, name, duration),
  status: 'paused',
  playing: false,
})

function step(
  state: ReturnType<typeof initVideoStatusStabilizer>,
  videos: readonly PresentationVideo[],
  nowMs: number,
  instanceId = 1,
  slideNumber = 3,
) {
  return stabilizeVideoStatuses(state, instanceId, slideNumber, videos, nowMs)
}

describe('video status stabilizer', () => {
  it('holds one false pause as playing and cancels it when playing returns', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'held.mp4', 20_000)], 0)
    const rawPaused = paused(1, 1_000, 'held.mp4', 20_000)
    const falsePause = step(first.state, [rawPaused], 100)
    expect(resolveVideoStatus(falsePause.videos[0]!)).toBe('playing')
    expect(falsePause.videos[0]).toEqual({ ...rawPaused, status: 'playing', playing: true })

    const resumed = step(falsePause.state, [playing(1, 1_100)], 200)
    expect(resolveVideoStatus(resumed.videos[0]!)).toBe('playing')
    expect(resumed.videos[0]).toEqual(playing(1, 1_100))
  })

  it('lets explicit paused outrank movement-inferred playing after confirmation', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000)], 0)
    const contradictory = { ...paused(1, 1_100), playing: true }

    const pending = step(first.state, [contradictory], 100)
    expect(resolveVideoStatus(pending.videos[0]!)).toBe('playing')
    expect(pending.videos[0]).toMatchObject({ status: 'playing', playing: true })

    const accepted = step(pending.state, [contradictory], 100 + VIDEO_PAUSE_CONFIRMATION_MS)
    expect(accepted.videos[0]).toMatchObject({ status: 'paused', playing: false })
    expect(resolveVideoStatus(accepted.videos[0]!)).toBe('paused')
  })

  it('cancels a contradictory explicit pause when explicit playing resumes', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000)], 0)
    const contradictory = { ...paused(1, 1_100), playing: true }
    const pending = step(first.state, [contradictory], 100)
    const explicitResume = { ...playing(1, 1_200), playing: false }

    const resumed = step(pending.state, [explicitResume], 200)
    expect(resumed.videos[0]).toMatchObject({ status: 'playing', playing: true })
    expect(resolveVideoStatus(resumed.videos[0]!)).toBe('playing')

    const nextPause = step(resumed.state, [contradictory], 300)
    expect(resolveVideoStatus(nextPause.videos[0]!)).toBe('playing')
  })

  it('holds below 350 ms and accepts a continuous pause at 350 ms', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1)], 0)
    const started = step(first.state, [paused(1)], 0)
    const held = step(started.state, [paused(1)], VIDEO_PAUSE_CONFIRMATION_MS - 1)
    expect(resolveVideoStatus(held.videos[0]!)).toBe('playing')
    const accepted = step(held.state, [paused(1)], VIDEO_PAUSE_CONFIRMATION_MS)
    expect(resolveVideoStatus(accepted.videos[0]!)).toBe('paused')
  })

  it('lets a genuine pause and resume transition exactly once', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1)], 0)
    const startedPause = step(first.state, [paused(1)], 0)
    const acceptedPause = step(startedPause.state, [paused(1)], VIDEO_PAUSE_CONFIRMATION_MS)
    expect(resolveVideoStatus(acceptedPause.videos[0]!)).toBe('paused')
    const resumed = step(acceptedPause.state, [playing(1, 1_400)], 500)
    expect(resolveVideoStatus(resumed.videos[0]!)).toBe('playing')
    const steady = step(resumed.state, [playing(1, 1_500)], 600)
    expect(resolveVideoStatus(steady.videos[0]!)).toBe('playing')
  })

  it('accepts ended immediately', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1)], 0)
    const ended = step(first.state, [{ ...playing(1, 10_000), status: 'ended', playing: false, remaining: 0 }], 10)
    expect(resolveVideoStatus(ended.videos[0]!)).toBe('ended')
  })

  it('accepts the first paused observation immediately after a scope change', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1)], 0)
    const changedScope = step(first.state, [paused(1)], 10, 1, 4)
    expect(resolveVideoStatus(changedScope.videos[0]!)).toBe('paused')
  })

  it('resets a disappeared record so its paused reappearance is accepted immediately', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1), playing(2)], 0)
    const disappeared = step(first.state, [playing(1)], 100)
    const reappearedPaused = step(disappeared.state, [playing(1), paused(2)], 200)
    expect(resolveVideoStatus(reappearedPaused.videos[1]!)).toBe('paused')
  })

  it('accepts a same-name duration change immediately', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'video.mp4', 10_000)], 0)
    const changedDuration = step(first.state, [paused(1, 1_100, 'video.mp4', 20_000)], 100)
    expect(resolveVideoStatus(changedDuration.videos[0]!)).toBe('paused')
  })

  it('accepts a defined-to-defined name change immediately', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'old.mp4')], 0)
    const changedName = step(first.state, [paused(1, 1_100, 'new.mp4')], 100)
    expect(resolveVideoStatus(changedName.videos[0]!)).toBe('paused')
  })

  it('resets immediately for a large seek', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'video.mp4', 20_000)], 0)
    const seek = step(first.state, [paused(1, 8_000, 'video.mp4', 20_000)], 100)
    expect(resolveVideoStatus(seek.videos[0]!)).toBe('paused')
  })

  it('remembers omitted identity metadata without filling it into held raw output', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'old.mp4', 20_000)], 0)
    const rawPausedMissing: PresentationVideo = { ...paused(1, 1_100, 'old.mp4', 20_000) }
    delete rawPausedMissing.name
    delete rawPausedMissing.duration
    const held = step(first.state, [rawPausedMissing], 100)
    expect(held.videos[0]).toEqual({ ...rawPausedMissing, status: 'playing', playing: true })
    expect(held.videos[0]).not.toHaveProperty('name')
    expect(held.videos[0]).not.toHaveProperty('duration')

    const sameMetadataPaused = paused(1, 1_200, 'old.mp4', 20_000)
    const heldAgain = step(held.state, [sameMetadataPaused], 200)
    expect(heldAgain.videos[0]).toEqual({ ...sameMetadataPaused, status: 'playing', playing: true })
  })

  it('recognizes changed metadata after an omitted sample as an immediate media change', () => {
    const first = step(initVideoStatusStabilizer(), [playing(1, 1_000, 'old.mp4', 20_000)], 0)
    const rawPausedMissing: PresentationVideo = { ...paused(1, 1_100, 'old.mp4', 20_000) }
    delete rawPausedMissing.name
    delete rawPausedMissing.duration
    const held = step(first.state, [rawPausedMissing], 100)

    const changedMetadataPaused = paused(1, 1_200, 'new.mp4', 30_000)
    const accepted = step(held.state, [changedMetadataPaused], 200)
    expect(resolveVideoStatus(accepted.videos[0]!)).toBe('paused')
    expect(accepted.videos[0]).toEqual(changedMetadataPaused)
  })

  it('does not record id-less videos but still normalizes their explicit status precedence', () => {
    const pausedInput: PresentationVideo = { name: 'paused', elapsed: 1_000, status: 'paused', playing: true }
    const playingInput: PresentationVideo = { name: 'playing', elapsed: 1_000, status: 'playing', playing: false }
    const endedInput: PresentationVideo = { name: 'ended', elapsed: 1_000, status: 'ended', playing: true }
    const videos = [playing(1), pausedInput, playingInput, endedInput]
    const initial = initVideoStatusStabilizer()
    const result = step(initial, videos, 0)
    expect(result.state).not.toBe(initial)
    expect(result.state.records).not.toBe(initial.records)
    expect(result.videos).not.toBe(videos)
    expect(result.videos[0]).not.toBe(videos[0])
    expect(result.videos[1]).toEqual({ ...pausedInput, playing: false })
    expect(result.videos[2]).toEqual({ ...playingInput, playing: true })
    expect(result.videos[3]).toEqual({ ...endedInput, playing: false })
    expect(result.videos[1]).not.toBe(pausedInput)
    expect(result.videos[2]).not.toBe(playingInput)
    expect(result.videos[3]).not.toBe(endedInput)
    expect(videos).toEqual([playing(1), pausedInput, playingInput, endedInput])
    expect(result.state.records.size).toBe(1)
    expect(initial.records.size).toBe(0)
  })
})
