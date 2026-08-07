import { resolveVideoStatus, type PresentationVideo } from '@ontime/presentation-core'

/** The shortest contradictory pause evidence accepted by the standalone host. */
export const VIDEO_PAUSE_CONFIRMATION_MS = 350

/** A seek larger than this cannot be explained by the elapsed wall clock. */
const LARGE_TIMING_DISCONTINUITY_MS = 1_500

type VideoStatus = ReturnType<typeof resolveVideoStatus>

type VideoStatusRecord = {
  acceptedStatus: VideoStatus
  observedStatus: VideoStatus
  observedAtMs: number
  observedElapsed?: number
  name?: string
  duration?: number
  pendingNonPlayingSinceMs: number | null
}

export type VideoStatusStabilizerState = {
  instanceId: number | null
  slideNumber: number | null
  records: ReadonlyMap<number, VideoStatusRecord>
}

export function initVideoStatusStabilizer(): VideoStatusStabilizerState {
  return { instanceId: null, slideNumber: null, records: new Map() }
}

function hasMediaIdentityChanged(previous: VideoStatusRecord, video: PresentationVideo): boolean {
  const nameChanged = previous.name !== undefined && video.name !== undefined && previous.name !== video.name
  const durationChanged =
    previous.duration !== undefined && video.duration !== undefined && previous.duration !== video.duration
  return nameChanged || durationChanged
}

function hasLargeTimingDiscontinuity(
  previous: VideoStatusRecord,
  video: PresentationVideo,
  nowMs: number,
): boolean {
  if (previous.observedElapsed === undefined || video.elapsed === undefined) return false
  const observedMovement = video.elapsed - previous.observedElapsed
  const wallClockMovement = Math.max(0, nowMs - previous.observedAtMs)
  const expectedMovement = previous.observedStatus === 'playing' ? wallClockMovement : 0
  return Math.abs(observedMovement - expectedMovement) > LARGE_TIMING_DISCONTINUITY_MS
}

function heldPlayingVideo(video: PresentationVideo): PresentationVideo {
  // Deliberately override only the two fields consumed by the canonical
  // resolver. Timing, identity, and every other raw field remain untouched.
  return { ...video, status: 'playing', playing: true }
}

/**
 * Preserve the provenance carried by the native `status` field. Canonical
 * normalization may infer `playing: true` from elapsed movement, but it never
 * synthesizes `status`; therefore an explicit paused/playing state outranks
 * that inferred boolean. End evidence remains the highest precedence.
 */
function classifyVideoStatus(video: PresentationVideo): VideoStatus {
  const canonical = resolveVideoStatus(video)
  if (canonical === 'ended') return 'ended'
  if (video.status === 'playing' || video.status === 'paused') return video.status
  return canonical
}

function applyExplicitStatus(video: PresentationVideo, status: VideoStatus): PresentationVideo {
  if (status === 'ended') return { ...video, status: 'ended', playing: false }
  if (video.status === 'playing') return { ...video, playing: true }
  if (video.status === 'paused') return { ...video, playing: false }
  return { ...video }
}

/**
 * Stabilize the per-video status boundary used by the standalone projection.
 * The input is a normalized observation; the returned array and map are fresh.
 */
export function stabilizeVideoStatuses(
  previous: VideoStatusStabilizerState,
  instanceId: number,
  slideNumber: number | undefined,
  videos: readonly PresentationVideo[],
  nowMs: number,
): { state: VideoStatusStabilizerState; videos: PresentationVideo[] } {
  const normalizedSlideNumber = slideNumber ?? null
  const scopeChanged = previous.instanceId !== instanceId || previous.slideNumber !== normalizedSlideNumber
  const previousRecords = scopeChanged ? new Map<number, VideoStatusRecord>() : previous.records
  const records = new Map<number, VideoStatusRecord>()
  const stabilizedVideos: PresentationVideo[] = []

  for (const video of videos) {
    const resolvedStatus = classifyVideoStatus(video)
    const normalizedOutput = applyExplicitStatus(video, resolvedStatus)
    if (video.id === undefined) {
      stabilizedVideos.push(normalizedOutput)
      continue
    }

    const prior = previousRecords.get(video.id)
    let acceptedStatus = resolvedStatus
    let pendingNonPlayingSinceMs: number | null = null
    let output = normalizedOutput

    if (prior !== undefined && !hasMediaIdentityChanged(prior, video) && !hasLargeTimingDiscontinuity(prior, video, nowMs)) {
      acceptedStatus = prior.acceptedStatus
      if (resolvedStatus === 'ended') {
        acceptedStatus = 'ended'
      } else if (acceptedStatus === 'playing') {
        if (resolvedStatus === 'playing') {
          pendingNonPlayingSinceMs = null
        } else {
          pendingNonPlayingSinceMs = prior.pendingNonPlayingSinceMs ?? nowMs
          if (nowMs - pendingNonPlayingSinceMs >= VIDEO_PAUSE_CONFIRMATION_MS) {
            acceptedStatus = resolvedStatus
            pendingNonPlayingSinceMs = null
          } else {
            output = heldPlayingVideo(output)
          }
        }
      } else {
        acceptedStatus = resolvedStatus
      }
    }

    records.set(video.id, {
      acceptedStatus,
      observedStatus: resolvedStatus,
      observedAtMs: nowMs,
      observedElapsed: video.elapsed,
      // Keep identity continuity across sparse COM samples, but never copy
      // these remembered values back into the raw video returned to callers.
      name: video.name ?? prior?.name,
      duration: video.duration ?? prior?.duration,
      pendingNonPlayingSinceMs,
    })
    stabilizedVideos.push(output)
  }

  return {
    state: { instanceId, slideNumber: normalizedSlideNumber, records },
    videos: stabilizedVideos,
  }
}
