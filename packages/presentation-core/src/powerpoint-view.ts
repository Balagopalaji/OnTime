/**
 * Pure standalone PowerPoint view projection (H3, ISSUE-001). Maps a
 * `PresentationSourceState` (the machine's immediate display observation) to a
 * `PowerPointViewState` for rendering. This module is a pure MODEL projection
 * only: it does not render text, format HTML, access displays, import Electron,
 * or take a clock — it always reflects the most recently observed measurement
 * and never extrapolates (S-017). Protocol-v1 observations use the helper's
 * explicit primary identity; legacy protocol-v0 observations retain the
 * historical active-playing/first-candidate fallback.
 */
import type { PresentationSourceState, PresentationVideo } from './powerpoint-types'

export type PowerPointTimingMode = 'remaining' | 'elapsed'

export type ProjectPowerPointViewOptions = {
  timingMode: PowerPointTimingMode
  /** Optional explicit primary-video id (projection metadata, not a wire field). */
  primaryVideoId?: number
  /** Optional explicit primary-video zero-based index. */
  primaryVideoIndex?: number
  /** Orthogonal multi-instance warning overlay (S-012). */
  multipleInstanceWarning?: boolean
}

/** Orthogonal fields carried by every view state. */
export type PowerPointViewStateBase = {
  multipleVideos: boolean
  videoCount: number
  multipleInstanceWarning: boolean
}

/** Mutually-exclusive presentation variants (precedence high-to-low). */
export type PowerPointViewPresentation = {
  kind: 'no_video' | 'timing_unavailable' | 'playing' | 'paused' | 'ended' | 'ready'
  slideNumber?: number
  totalSlides?: number
  title: string
  filenameBasename?: string
  selectedVideoId?: number
  selectedVideoName?: string
  timeMs: number | null
  durationMs: number | null
}

export type PowerPointViewState = PowerPointViewStateBase &
  (
    | { kind: 'connecting' }
    | { kind: 'unavailable' }
    | { kind: 'powerpoint_not_running' }
    | { kind: 'no_slideshow' }
    | PowerPointViewPresentation
  )

/** End-inference threshold (spec "one canonical capability" constraint). */
const POWERPOINT_END_INFER_MS = 250

/** Pure separator-based basename supporting both `/` and `\` (no Node `path`). */
function basename(filename: string | undefined): string | undefined {
  if (filename === undefined) return undefined
  const last = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return last === -1 ? filename : filename.slice(last + 1)
}

/**
 * Keep the canonical snapshot title untouched for Companion cue compatibility,
 * but never expose `FullName` as the standalone display title when Name was
 * unavailable. Normalization uses filename as its legacy fallback, so equality
 * identifies precisely that fallback without changing cue payload semantics.
 */
function displayTitle(title: string, filename: string | undefined): string {
  return filename !== undefined && title === filename.trim() ? basename(filename) ?? title : title
}

/**
 * Deterministic primary-video resolution (§3.4):
 *   1. valid explicit id
 *   2. valid explicit index
 *   3. first video with status 'playing' or playing === true
 *   4. first video in the canonical array
 * An invalid explicit reference falls through rather than suppressing the list.
 */
function selectPrimaryVideo(
  videos: readonly PresentationVideo[],
  options: Pick<ProjectPowerPointViewOptions, 'primaryVideoId' | 'primaryVideoIndex'>,
  allowHeuristicFallback: boolean,
): PresentationVideo | undefined {
  if (options.primaryVideoId !== undefined) {
    const byId = videos.find((v) => v.id !== undefined && v.id === options.primaryVideoId)
    if (byId) return byId
  }
  if (
    options.primaryVideoIndex !== undefined &&
    options.primaryVideoIndex >= 0 &&
    options.primaryVideoIndex < videos.length
  ) {
    return videos[options.primaryVideoIndex]
  }
  if (!allowHeuristicFallback) return undefined
  const playing = videos.find((v) => v.status === 'playing' || v.playing === true)
  if (playing) return playing
  return videos.length > 0 ? videos[0] : undefined
}

/**
 * Project a source state to a renderable view state. Pure: same inputs always
 * yield the same output, no clock input, no extrapolation between observations.
 */
export function projectPowerPointView(
  sourceState: PresentationSourceState,
  options: ProjectPowerPointViewOptions,
): PowerPointViewState {
  const ortho = {
    multipleInstanceWarning: options.multipleInstanceWarning === true,
  }

  if (sourceState.kind === 'connecting') {
    return { kind: 'connecting', multipleVideos: false, videoCount: 0, ...ortho }
  }
  if (sourceState.kind === 'unavailable') {
    return { kind: 'unavailable', multipleVideos: false, videoCount: 0, ...ortho }
  }
  if (sourceState.kind === 'powerpoint_not_running') {
    return { kind: 'powerpoint_not_running', multipleVideos: false, videoCount: 0, ...ortho }
  }
  if (sourceState.kind === 'no_slideshow') {
    return { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, ...ortho }
  }

  // sourceState.kind === 'presentation'
  const snap = sourceState.snapshot
  const videos = snap.videos ?? []
  const selected = selectPrimaryVideo(
    videos,
    {
      primaryVideoId: snap.primaryVideoId ?? options.primaryVideoId,
      primaryVideoIndex: snap.primaryVideoIndex ?? options.primaryVideoIndex,
    },
    snap.protocolVersion === undefined || snap.protocolVersion === 0,
  )
  const videoCount = videos.length
  const multipleVideos = videoCount > 1

  // Aggregate timing: scalar snapshot timing preferred (helper canonical primary,
  // preserves D10 scalar fallback); selected-video timing is the fallback.
  const duration = snap.videoDuration ?? selected?.duration
  const elapsed = snap.videoElapsed ?? selected?.elapsed
  const observedRemaining = snap.videoRemaining ?? selected?.remaining
  // Derive remaining only when no observed remaining exists.
  const resolvedRemaining =
    observedRemaining ?? (duration !== undefined && elapsed !== undefined ? duration - elapsed : undefined)

  const hasTiming = duration !== undefined || elapsed !== undefined || resolvedRemaining !== undefined
  const selectedStatus = selected?.status
  const hasPlaybackSignal =
    snap.videoPlaying !== undefined || selected?.playing !== undefined || selectedStatus !== undefined
  const hasAnyVideoSignal =
    videoCount > 0 ||
    snap.videoPlaying !== undefined ||
    snap.videoDuration !== undefined ||
    snap.videoElapsed !== undefined ||
    snap.videoRemaining !== undefined

  const common = {
    slideNumber: snap.slideNumber,
    totalSlides: snap.totalSlides,
    title: displayTitle(snap.title, snap.filename),
    filenameBasename: basename(snap.filename),
    selectedVideoId: selected?.id,
    selectedVideoName: selected?.name,
  }

  // Precedence (§3.4):
  // 2. no selected video and no scalar video evidence -> no_video
  if (!hasAnyVideoSignal) {
    return { kind: 'no_video', ...common, timeMs: null, durationMs: null, multipleVideos, videoCount, ...ortho }
  }
  // 3. videoTimingUnavailable, or media with no timing and no playback signal -> timing_unavailable
  if (snap.videoTimingUnavailable === true || (!hasTiming && !hasPlaybackSignal)) {
    return { kind: 'timing_unavailable', ...common, timeMs: null, durationMs: null, multipleVideos, videoCount, ...ortho }
  }
  // 4. ended: explicit status, remaining zero/below, or duration-elapsed within 250ms
  const isEnded =
    selectedStatus === 'ended' ||
    (resolvedRemaining !== undefined && resolvedRemaining <= 0) ||
    (duration !== undefined && elapsed !== undefined && duration - elapsed <= POWERPOINT_END_INFER_MS)
  // 5. playing
  const isPlaying = selectedStatus === 'playing' || selected?.playing === true || snap.videoPlaying === true
  // 6. paused: explicit status, or non-playing evidence with positive elapsed below end threshold
  const isPaused = selectedStatus === 'paused' || (elapsed !== undefined && elapsed > 0 && !isEnded && !isPlaying)

  let kind: PowerPointViewPresentation['kind']
  let timeMs: number | null
  if (isEnded) {
    kind = 'ended'
    timeMs = options.timingMode === 'remaining' ? 0 : (elapsed ?? 0)
  } else if (isPlaying || isPaused) {
    kind = isPlaying ? 'playing' : 'paused'
    timeMs = options.timingMode === 'remaining' ? (resolvedRemaining ?? null) : (elapsed ?? null)
  } else {
    // 7. ready: duration exposed when known; no time
    kind = 'ready'
    timeMs = null
  }
  const durationMs = duration !== undefined ? duration : null
  return { kind, ...common, timeMs, durationMs, multipleVideos, videoCount, ...ortho }
}
