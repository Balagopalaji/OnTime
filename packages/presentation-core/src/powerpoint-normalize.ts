/**
 * Pure PowerPoint poll-normalization helpers + snapshot equality comparators.
 * Graduated verbatim from `companion/src/presentation-snapshot.ts` (equality
 * helpers) and the running-slideshow branch of
 * `companion/src/presentation-candidate.ts#handlePowerPointStatus` (H3,
 * ISSUE-001). No debounce, no candidate decision, no host I/O — those live in
 * `powerpoint-machine.ts` and the host adapter.
 *
 * Canonical behavior constants (pinned by the spec's "one canonical capability"
 * constraint): do not redefine these in a host.
 */
export const POWERPOINT_DEBOUNCE_MS = 600
export const POWERPOINT_VIDEO_CLEAR_POLLS = 2
export const POWERPOINT_PLAYING_DELTA_MS = 200

import type {
  PresentationSnapshot,
  PresentationVideo,
  PowerPointPollResult,
} from './powerpoint-types'

/**
 * Identity equality: instanceId / slideNumber / totalSlides / title / filename.
 * Timing and videos are intentionally ignored. Byte-faithful port of the
 * Companion comparator (C1).
 */
export function snapshotsIdentityEqual(
  a: PresentationSnapshot | null,
  b: PresentationSnapshot | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.instanceId === b.instanceId &&
    a.slideNumber === b.slideNumber &&
    a.totalSlides === b.totalSlides &&
    a.title === b.title &&
    a.filename === b.filename
  )
}

/**
 * Timing equality: scalar playing/duration/elapsed/remaining,
 * videoTimingUnavailable, and `videoListsEqual`. Identity is intentionally
 * ignored. Byte-faithful port (C2).
 */
export function snapshotsTimingEqual(
  a: PresentationSnapshot | null,
  b: PresentationSnapshot | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.videoPlaying === b.videoPlaying &&
    a.videoDuration === b.videoDuration &&
    a.videoElapsed === b.videoElapsed &&
    a.videoRemaining === b.videoRemaining &&
    a.videoTimingUnavailable === b.videoTimingUnavailable &&
    videoListsEqual(a.videos, b.videos)
  )
}

/**
 * Positional per-field video-list comparison: id / name / duration / elapsed /
 * remaining / playing at each index. `status` is deliberately ignored to
 * preserve the Companion emission contract (C3).
 */
export function videoListsEqual(
  a?: readonly PresentationVideo[],
  b?: readonly PresentationVideo[],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (
      left?.id !== right?.id ||
      left?.name !== right?.name ||
      left?.duration !== right?.duration ||
      left?.elapsed !== right?.elapsed ||
      left?.remaining !== right?.remaining ||
      left?.playing !== right?.playing
    ) {
      return false
    }
  }
  return true
}

/** Helper-owned primary identity cached with the canonical per-slide video list. */
export type PowerPointPrimaryCacheEntry = {
  protocolVersion?: number
  primaryVideoId?: number
  primaryVideoIndex?: number
}

/** Cache + two no-video counter pairs carried through normalization. */
export type PowerPointNormalizationCache = {
  videoCache: ReadonlyMap<string, PresentationVideo[]>
  primaryCache: ReadonlyMap<string, PowerPointPrimaryCacheEntry>
  noVideoKey: string | null
  noVideoCount: number
  explicitNoVideoKey: string | null
  explicitNoVideoCount: number
}

export type NormalizePowerPointPollInput = {
  /** Running-slideshow result (instanceId present, `inSlideshow !== false`). */
  result: PowerPointPollResult & { instanceId: number }
  announced: PresentationSnapshot | null
} & PowerPointNormalizationCache

export type NormalizePowerPointPollOutput = {
  /** The normalized snapshot (always non-null for the running-slideshow branch). */
  snapshot: PresentationSnapshot
} & PowerPointNormalizationCache

/**
 * Build a normalized `PresentationSnapshot` for a running-slideshow poll and
 * advance the per-slide cache + both no-video counter pairs. Verbatim port of
 * the running-slideshow branch of Companion's `handlePowerPointStatus`
 * (D3-D12), expressed as a pure function: the input cache/counters are not
 * mutated, and a fresh cache map is returned.
 *
 * Intentional extraction constraints preserved exactly (NOT bugs):
 *  - D6: a warm cache refills `videos` BEFORE `hasVideoPayload` is computed, so
 *    a no-payload poll on a warm cache stays "present" and never reaches the
 *    two-poll clear threshold.
 *  - D10: scalar remaining falls back to the prior announced value and stays
 *    stale while elapsed advances.
 */
export function normalizePowerPointPoll(
  input: NormalizePowerPointPollInput,
): NormalizePowerPointPollOutput {
  const { result, announced } = input
  // Fresh copy so the caller's cache map is never mutated in place.
  const videoCache = new Map(input.videoCache)
  const primaryCache = new Map(input.primaryCache)
  let noVideoKey = input.noVideoKey
  let noVideoCount = input.noVideoCount
  let explicitNoVideoKey = input.explicitNoVideoKey
  let explicitNoVideoCount = input.explicitNoVideoCount

  const title = result.title?.trim() || result.filename?.trim() || 'PowerPoint'
  const lastSlideNumber =
    announced?.instanceId === result.instanceId ? announced.slideNumber : undefined
  const resolvedSlideNumber = result.slideNumber ?? lastSlideNumber
  const slideKey = `${result.instanceId}:${resolvedSlideNumber ?? 'unknown'}`
  const slideChanged =
    announced?.instanceId === result.instanceId &&
    announced.slideNumber !== resolvedSlideNumber
  const explicitNoVideo =
    result.videoDetected === false &&
    result.videoDuration === undefined &&
    result.videoElapsed === undefined &&
    result.videoRemaining === undefined &&
    (!result.videos || result.videos.length === 0) &&
    (!result.editSlideVideos || result.editSlideVideos.length === 0)
  const hasFreshVideoList =
    (result.videos?.length ?? 0) > 0 || (result.editSlideVideos?.length ?? 0) > 0
  let videos: PresentationVideo[] | undefined =
    result.videos && result.videos.length > 0 ? result.videos : undefined
  if (!videos && result.editSlideVideos && result.editSlideVideos.length > 0) {
    videos = result.editSlideVideos
  }
  if (!videos && !explicitNoVideo) {
    const cached = videoCache.get(slideKey)
    if (cached) {
      videos = cached
    }
  }
  const hasVideoPayload =
    !explicitNoVideo &&
    (result.videoDetected === true ||
      (videos && videos.length > 0) ||
      result.videoDuration !== undefined ||
      result.videoElapsed !== undefined ||
      result.videoRemaining !== undefined ||
      result.videoPlaying !== undefined ||
      result.videoTimingUnavailable === true)
  if (!hasVideoPayload) {
    if (noVideoKey === slideKey) {
      noVideoCount += 1
    } else {
      noVideoKey = slideKey
      noVideoCount = 1
    }
  } else {
    noVideoKey = null
    noVideoCount = 0
  }
  if (explicitNoVideo) {
    if (explicitNoVideoKey === slideKey) {
      explicitNoVideoCount += 1
    } else {
      explicitNoVideoKey = slideKey
      explicitNoVideoCount = 1
    }
  } else {
    explicitNoVideoKey = null
    explicitNoVideoCount = 0
  }
  if (slideChanged) {
    noVideoKey = slideKey
    noVideoCount = explicitNoVideo ? POWERPOINT_VIDEO_CLEAR_POLLS : 0
    explicitNoVideoKey = slideKey
    explicitNoVideoCount = explicitNoVideo ? POWERPOINT_VIDEO_CLEAR_POLLS : 0
  }
  const shouldClearVideo =
    (slideChanged && explicitNoVideo) ||
    (!hasVideoPayload && noVideoCount >= POWERPOINT_VIDEO_CLEAR_POLLS)
  const shouldClearExplicit =
    explicitNoVideo && explicitNoVideoCount >= POWERPOINT_VIDEO_CLEAR_POLLS
  if (shouldClearVideo || shouldClearExplicit) {
    videoCache.delete(slideKey)
    primaryCache.delete(slideKey)
    videos = undefined
  }
  const priorSnapshot =
    announced?.instanceId === result.instanceId &&
    announced.slideNumber === resolvedSlideNumber
      ? announced
      : null
  const videoDetected = hasVideoPayload && !shouldClearVideo
  if (videos && videoDetected) {
    if (priorSnapshot?.videos && priorSnapshot.videos.length > 0) {
      let hasDelta = false
      videos = videos.map((video, index) => {
        const prior =
          priorSnapshot.videos?.find((entry) => entry.id !== undefined && entry.id === video.id) ??
          priorSnapshot.videos?.find((entry) => entry.name && entry.name === video.name) ??
          priorSnapshot.videos?.[index]
        const currentElapsed = video.elapsed ?? null
        const priorElapsed = prior?.elapsed ?? null
        const delta =
          currentElapsed !== null && priorElapsed !== null ? currentElapsed - priorElapsed : null
        if (delta !== null && delta > POWERPOINT_PLAYING_DELTA_MS) {
          hasDelta = true
          return { ...video, playing: true }
        }
        return video
      })
      if (hasDelta) {
        videos = videos.map((video) => (video.playing ? video : { ...video, playing: false }))
      }
    }
    videoCache.set(slideKey, videos)
    if (hasFreshVideoList) {
      primaryCache.set(slideKey, {
        protocolVersion: result.protocolVersion,
        primaryVideoId: result.primaryVideoId,
        primaryVideoIndex: result.primaryVideoIndex,
      })
    }
  }
  // Resolved AFTER enrichment so the enriched array is what the snapshot sees.
  const resolvedVideos =
    shouldClearVideo || shouldClearExplicit ? undefined : videos ?? priorSnapshot?.videos
  const cachedPrimary = resolvedVideos && !hasFreshVideoList
    ? primaryCache.get(slideKey) ?? (priorSnapshot
      ? {
          protocolVersion: priorSnapshot.protocolVersion,
          primaryVideoId: priorSnapshot.primaryVideoId,
          primaryVideoIndex: priorSnapshot.primaryVideoIndex,
        }
      : undefined)
    : undefined
  const lastVideoDuration = priorSnapshot?.videoDuration
  const lastVideoElapsed = priorSnapshot?.videoElapsed
  const lastVideoRemaining = priorSnapshot?.videoRemaining
  const lastVideoPlaying = priorSnapshot?.videoPlaying
  const snapshot: PresentationSnapshot = {
    instanceId: result.instanceId,
    slideNumber: resolvedSlideNumber,
    totalSlides: result.totalSlides,
    protocolVersion: result.protocolVersion ?? cachedPrimary?.protocolVersion,
    primaryVideoId: result.primaryVideoId ?? cachedPrimary?.primaryVideoId,
    primaryVideoIndex: result.primaryVideoIndex ?? cachedPrimary?.primaryVideoIndex,
    title,
    filename: result.filename,
    videoPlaying: videoDetected ? result.videoPlaying ?? lastVideoPlaying : undefined,
    videoDuration: videoDetected ? result.videoDuration ?? lastVideoDuration : undefined,
    videoElapsed: videoDetected ? result.videoElapsed ?? lastVideoElapsed : undefined,
    videoRemaining: videoDetected ? result.videoRemaining ?? lastVideoRemaining : undefined,
    videos: resolvedVideos,
    videoTimingUnavailable: videoDetected && result.videoTimingUnavailable === true,
  }
  return {
    snapshot,
    videoCache,
    primaryCache,
    noVideoKey,
    noVideoCount,
    explicitNoVideoKey,
    explicitNoVideoCount,
  }
}
