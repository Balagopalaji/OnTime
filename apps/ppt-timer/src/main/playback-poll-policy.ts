import {
  POWERPOINT_PLAYING_DELTA_MS,
  resolveVideoStatus,
  type PresentationVideo,
} from '@ontime/presentation-core'
import type { BridgePollOutcome, PowerPointObservation } from '@ontime/ppt-bridge'

/** Keep ordinary PowerPoint reads at the existing low-cost cadence. */
export const POWERPOINT_POLL_INTERVAL_MS = 1_000
/** Cadence for a deck that has a present, nonterminal video ready to start. */
export const POWERPOINT_ARMED_POLL_INTERVAL_MS = 500
/** Short burst cadence used while a play/start transition is settling. */
export const POWERPOINT_START_BURST_INTERVAL_MS = 200
/** A burst is deliberately finite so a paused deck does not cause permanent high-rate COM reads. */
export const POWERPOINT_START_BURST_WINDOW_MS = 2_000
/** Require a bounded stationary interval before a movement episode can re-arm. */
export const POWERPOINT_MOVEMENT_REARM_STABLE_MS = 1_000
/** Do not flash an ambiguous initial pause before a fast follow-up can confirm it. */
export const POWERPOINT_STARTUP_PAUSE_GATE_MS = 350

type RawVideoSample = {
  playing: boolean
  terminal: boolean
  armed: boolean
  elapsed?: number
  movementEpisode: boolean
  movementAccumulatedMs: number
  stationarySinceMs?: number
}

type PriorSample = {
  mediaKey: string | null
  scalarPlaying: boolean
  scalarElapsed?: number
  scalarMovementEpisode: boolean
  scalarMovementAccumulatedMs: number
  scalarStationarySinceMs?: number
  videos: ReadonlyMap<string, RawVideoSample>
}

function emptyPriorSample(): PriorSample {
  return {
    mediaKey: null,
    scalarPlaying: false,
    scalarMovementEpisode: false,
    scalarMovementAccumulatedMs: 0,
    videos: new Map(),
  }
}

function asObservation(outcome: BridgePollOutcome | null): PowerPointObservation | null {
  if (!outcome) return null
  if (outcome.kind === 'observation' || outcome.kind === 'no_slideshow') return outcome.observation
  return null
}

function videoKey(video: PresentationVideo, index: number): string {
  return video.id !== undefined
    ? `id:${video.id}`
    : `index:${index}:${video.name ?? ''}`
}

function observationMediaKey(observation: PowerPointObservation, videos: readonly PresentationVideo[]): string | null {
  const hasMedia = observation.videoDetected === true ||
    videos.length > 0 ||
    observation.videoDuration !== undefined ||
    observation.videoElapsed !== undefined ||
    observation.videoRemaining !== undefined ||
    observation.videoPlaying !== undefined
  if (!hasMedia) return null
  return JSON.stringify([
    observation.instanceId ?? null,
    observation.slideNumber ?? null,
    videos.map((video, index) => videoKey(video, index)),
  ])
}

function videosFor(observation: PowerPointObservation): readonly PresentationVideo[] {
  if (observation.videos && observation.videos.length > 0) return observation.videos
  return observation.editSlideVideos ?? []
}

function scalarIsPlaying(observation: PowerPointObservation): boolean {
  return observation.videoPlaying === true
}

function updateMovementEpisode(
  currentElapsed: number | undefined,
  previousElapsed: number | undefined,
  previousEpisode: boolean,
  previousAccumulatedMs: number,
  previousStationarySinceMs: number | undefined,
  nowMs: number,
): { episode: boolean; accumulatedMs: number; stationarySinceMs?: number; burstStarted: boolean } {
  if (currentElapsed === undefined || previousElapsed === undefined) {
    return {
      episode: previousEpisode,
      accumulatedMs: previousAccumulatedMs,
      stationarySinceMs: previousStationarySinceMs,
      burstStarted: false,
    }
  }

  const delta = currentElapsed - previousElapsed
  if (delta > 0) {
    // Keep small positive deltas as an unconfirmed movement baseline. The
    // episode becomes active only when cumulative movement strictly exceeds
    // the canonical threshold, so 100 ms + 500 ms can confirm movement even
    // though neither sample needs to be interpreted as a fresh edge.
    const accumulatedMs = previousEpisode
      ? Math.max(previousAccumulatedMs, POWERPOINT_PLAYING_DELTA_MS + 1)
      : previousAccumulatedMs + delta
    const episode = previousEpisode || accumulatedMs > POWERPOINT_PLAYING_DELTA_MS
    return {
      episode,
      accumulatedMs,
      stationarySinceMs: undefined,
      burstStarted: !previousEpisode && episode,
    }
  }

  const stationarySinceMs = previousStationarySinceMs ?? nowMs
  if (nowMs - stationarySinceMs >= POWERPOINT_MOVEMENT_REARM_STABLE_MS) {
    return { episode: false, accumulatedMs: 0, stationarySinceMs: undefined, burstStarted: false }
  }
  return { episode: previousEpisode, accumulatedMs: previousAccumulatedMs, stationarySinceMs, burstStarted: false }
}

function sampleVideos(
  videos: readonly PresentationVideo[],
  priorVideos: ReadonlyMap<string, RawVideoSample>,
  nowMs: number,
): {
  samples: ReadonlyMap<string, RawVideoSample>
  burstStarted: boolean
  armed: boolean
  allTerminal: boolean
  endedTransition: boolean
} {
  const samples = new Map<string, RawVideoSample>()
  let burstStarted = false
  let armed = false
  let allTerminal = videos.length > 0
  let endedTransition = false

  videos.forEach((video, index) => {
    const key = videoKey(video, index)
    const previous = priorVideos.get(key)
    const status = resolveVideoStatus(video)
    const elapsed = typeof video.elapsed === 'number' && Number.isFinite(video.elapsed) ? video.elapsed : undefined
    const terminal = status === 'ended'
    const playing = status === 'playing'
    const movement = terminal || playing
      ? { episode: false, accumulatedMs: 0, stationarySinceMs: undefined, burstStarted: false }
      : updateMovementEpisode(
          elapsed,
          previous?.elapsed,
          previous?.movementEpisode ?? false,
          previous?.movementAccumulatedMs ?? 0,
          previous?.stationarySinceMs,
          nowMs,
        )
    const sample: RawVideoSample = {
      playing,
      terminal,
      armed: status === 'ready' || status === 'paused',
      elapsed,
      movementEpisode: movement.episode,
      movementAccumulatedMs: movement.accumulatedMs,
      ...(movement.stationarySinceMs !== undefined ? { stationarySinceMs: movement.stationarySinceMs } : {}),
    }
    samples.set(key, sample)

    if (terminal) allTerminal = allTerminal && true
    else allTerminal = false
    if (terminal && previous !== undefined && !previous.terminal) endedTransition = true
    if (!terminal && sample.playing !== (previous?.playing ?? false)) {
      burstStarted = true
    }
    if (movement.burstStarted) burstStarted = true
    if (!sample.terminal && sample.armed) armed = true
  })

  return { samples, burstStarted, armed, allTerminal, endedTransition }
}

/**
 * Select the next session delay from raw bridge observations. Per-video
 * transitions are keyed by the existing id-first identity rule. A movement
 * edge opens a finite burst; continued movement stays in that same burst and
 * cannot renew it on every poll.
 */
export function createPlaybackPollPolicy(): (outcome: BridgePollOutcome | null, nowMs: number) => number {
  let prior = emptyPriorSample()
  let burstUntil = 0

  return (outcome, nowMs) => {
    const observation = asObservation(outcome)
    if (!observation || outcome?.kind === 'no_slideshow') {
      prior = emptyPriorSample()
      burstUntil = 0
      return POWERPOINT_POLL_INTERVAL_MS
    }

    const videos = videosFor(observation)
    const mediaKey = observationMediaKey(observation, videos)
    if (mediaKey === null) {
      prior = emptyPriorSample()
      burstUntil = 0
      return POWERPOINT_POLL_INTERVAL_MS
    }

    const firstOrNewMedia = mediaKey !== null && mediaKey !== prior.mediaKey
    const hasPerVideoEvidence = videos.length > 0
    const sampled = sampleVideos(videos, prior.videos, nowMs)
    const scalarPlayingNow = scalarIsPlaying(observation)
    const scalarMovement = !hasPerVideoEvidence && !scalarPlayingNow
      ? updateMovementEpisode(
          observation.videoElapsed,
          prior.scalarElapsed,
          prior.scalarMovementEpisode,
          prior.scalarMovementAccumulatedMs,
          prior.scalarStationarySinceMs,
          nowMs,
        )
        : { episode: false, accumulatedMs: 0, stationarySinceMs: undefined, burstStarted: false }
    const scalarMovementStarted = scalarMovement.burstStarted
    const scalarStarted = !hasPerVideoEvidence && scalarPlayingNow && !prior.scalarPlaying

    if (sampled.allTerminal) {
      burstUntil = 0
    } else if (sampled.endedTransition && !sampled.burstStarted && !scalarMovementStarted && !scalarStarted) {
      // An ended transition is a settled terminal/armed state, not a reason to
      // keep confirmation polling alive from an earlier burst.
      burstUntil = 0
    } else if (firstOrNewMedia || sampled.burstStarted || scalarMovementStarted || scalarStarted) {
      burstUntil = Math.max(burstUntil, nowMs + POWERPOINT_START_BURST_WINDOW_MS)
    }

    prior = {
      mediaKey,
      scalarPlaying: scalarPlayingNow,
      scalarElapsed: observation.videoElapsed,
      scalarMovementEpisode: scalarMovement.episode,
      scalarMovementAccumulatedMs: scalarMovement.accumulatedMs,
      ...(scalarMovement.stationarySinceMs !== undefined
        ? { scalarStationarySinceMs: scalarMovement.stationarySinceMs }
        : {}),
      videos: sampled.samples,
    }

    if (nowMs < burstUntil) return POWERPOINT_START_BURST_INTERVAL_MS
    if (sampled.armed) return POWERPOINT_ARMED_POLL_INTERVAL_MS
    return POWERPOINT_POLL_INTERVAL_MS
  }
}
