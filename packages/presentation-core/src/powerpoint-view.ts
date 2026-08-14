/**
 * Pure standalone PowerPoint view projection (H3, ISSUE-001). Maps a
 * `PresentationSourceState` (the machine's immediate display observation) to a
 * `PowerPointViewState` for rendering. This module is a pure MODEL projection
 * only: it does not render text, format HTML, access displays, import Electron,
 * or take a clock — it always reflects the most recently observed measurement
 * and never extrapolates (S-017). Protocol-v1 observations use the helper's
 * explicit primary identity; legacy protocol-v0 observations retain the
 * historical active-playing/first-candidate fallback.
 *
 * The projection also carries a resolved row for every slide video (`videos[]`).
 * Standalone callers may choose longest-remaining or latest-started among only
 * currently playing rows; with none playing, helper-primary selection keeps the
 * established next-to-play behavior. Start order is opaque input metadata and
 * no time is extrapolated here.
 */
import type { PresentationSourceState, PresentationVideo } from './powerpoint-types'
import { selectPlayingHeadline, type PowerPointHeadlineMode } from './powerpoint-headline'
import { POWERPOINT_END_INFER_MS, resolveVideoStatus } from './powerpoint-status'

export type PowerPointTimingMode = 'remaining' | 'elapsed'

export type ProjectPowerPointViewOptions = {
  timingMode: PowerPointTimingMode
  /** Standalone playing-video selection; absent preserves legacy consumers. */
  headlineMode?: PowerPointHeadlineMode
  /** Optional explicit primary-video id (projection metadata, not a wire field). */
  primaryVideoId?: number
  /** Optional explicit primary-video zero-based index. */
  primaryVideoIndex?: number
  /** Orthogonal multi-instance warning overlay (S-012). */
  multipleInstanceWarning?: boolean
  /**
   * Host-owned recency ranking for standalone multi-video focus (video id ->
   * monotonic start rank). When provided and non-empty, focus resolution uses
   * it to pick the most-recently-started video still playing. This is opaque
   * projection metadata, not a clock; the projection never reads wall-clock
   * time. When absent/empty, the legacy helper-primary / first-playing fallback
   * applies unchanged.
   */
  playOrder?: ReadonlyMap<number, number>
}

/**
 * Resolved per-video row projected for every slide video (ISSUE-001). `status`
 * is always resolved to exactly one of the four display states (never
 * undefined); `durationMs`/`elapsedMs`/`remainingMs` carry the observed truth
 * (never extrapolated). `isFocus` marks the row backing the large-timer scalar.
 * `ordinal` is the zero-based shape order used as a name/identity fallback.
 */
export type PowerPointVideoTile = {
  id?: number
  name?: string
  /** Zero-based shape order (fallback identity + name source). */
  ordinal: number
  status: 'ready' | 'playing' | 'paused' | 'ended'
  playing: boolean
  durationMs: number | null
  elapsedMs: number | null
  remainingMs: number | null
  isFocus: boolean
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
  /**
   * Resolved row for every slide video, in shape order (ISSUE-001). Always
   * populated by the projection for presentation-kind states (empty array when
   * the slide has no videos); required on the contract so every consumer can
   * iterate it without a `?? []` guard (P2-3).
   */
  videos: PowerPointVideoTile[]
}

export type PowerPointViewState = PowerPointViewStateBase &
  (
    | { kind: 'connecting' }
    | { kind: 'unavailable' }
    | { kind: 'powerpoint_not_running' }
    | { kind: 'no_slideshow' }
    | PowerPointViewPresentation
  )

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
 * Deterministic primary-video resolution (§3.4), with standalone multi-video
 * headline selection layered on top (S-011). Resolution order:
 *  - explicit headline mode selects only a playing candidate according to its
 *    policy; with none playing, resolution continues to helper-primary.
 *   0. (focus) when `playOrder` ranks ≥1 video, the focus is the
 *      most-recently-started video still playing; if none is playing, the
 *      most-recently-started paused/ended video is retained. Unranked videos
 *      are never chosen by this branch. This branch uses the resolved tile
 *      status so a contradictory `playing` flag never overrides an `ended`
 *      signal.
 *   1. valid explicit id (legacy helper-primary fallback)
 *   2. valid explicit index (legacy helper-primary fallback)
 *   3. first video with status 'playing' or playing === true (legacy heuristic)
 *   4. first video in the canonical array (legacy heuristic)
 * An invalid explicit reference falls through rather than suppressing the list.
 *
 * The retained-rank branch remains for legacy callers that omit headlineMode.
 * `playOrder` is host-owned metadata, not a clock; projection stays pure.
 */
function selectPrimaryVideo(
  videos: readonly PresentationVideo[],
  options: Pick<ProjectPowerPointViewOptions, 'primaryVideoId' | 'primaryVideoIndex' | 'playOrder' | 'headlineMode'>,
  allowHeuristicFallback: boolean,
): { video: PresentationVideo | undefined; index: number; fromFocus: boolean; timingUnavailable?: boolean } {
  if (options.headlineMode !== undefined) {
    const headline = selectPlayingHeadline(videos, options.headlineMode, options.playOrder)
    if (headline.kind === 'selected') {
      return { video: videos[headline.index], index: headline.index, fromFocus: true }
    }
    if (headline.kind === 'timing-unavailable') {
      return { video: undefined, index: -1, fromFocus: true, timingUnavailable: true }
    }
    // With nothing playing, continue into the existing helper-primary / next-
    // to-play resolution below. Retained start ranks must not override it.
  }
  // Focus branch (0): only when the host has ranked at least one present video.
  if (options.headlineMode === undefined && options.playOrder !== undefined && options.playOrder.size > 0) {
    let bestPlayingIndex = -1
    let bestPlayingRank = -1
    let bestRetainedIndex = -1
    let bestRetainedRank = -1
    for (let i = 0; i < videos.length; i += 1) {
      const v = videos[i]
      if (v === undefined || v.id === undefined) continue
      const rank = options.playOrder.get(v.id)
      if (rank === undefined) continue
      const status = resolveVideoStatus(v)
      if (status === 'playing') {
        if (rank > bestPlayingRank) {
          bestPlayingRank = rank
          bestPlayingIndex = i
        }
      } else if (status === 'paused' || status === 'ended') {
        if (rank > bestRetainedRank) {
          bestRetainedRank = rank
          bestRetainedIndex = i
        }
      }
    }
    const focusIndex = bestPlayingIndex !== -1 ? bestPlayingIndex : bestRetainedIndex
    if (focusIndex !== -1) return { video: videos[focusIndex], index: focusIndex, fromFocus: true }
    // No ranked video is playing/paused/ended: fall through to legacy so a
    // ready-only slide still resolves a primary for labels/scalar fallback.
  }

  if (options.primaryVideoId !== undefined) {
    const byIdIndex = videos.findIndex((v) => v.id !== undefined && v.id === options.primaryVideoId)
    if (byIdIndex !== -1) return { video: videos[byIdIndex], index: byIdIndex, fromFocus: false }
  }
  if (
    options.primaryVideoIndex !== undefined &&
    options.primaryVideoIndex >= 0 &&
    options.primaryVideoIndex < videos.length
  ) {
    return { video: videos[options.primaryVideoIndex], index: options.primaryVideoIndex, fromFocus: false }
  }
  if (!allowHeuristicFallback) return { video: undefined, index: -1, fromFocus: false }
  const playingIndex = videos.findIndex((v) => v.status === 'playing' || v.playing === true)
  if (playingIndex !== -1) return { video: videos[playingIndex], index: playingIndex, fromFocus: false }
  return { video: videos.length > 0 ? videos[0] : undefined, index: videos.length > 0 ? 0 : -1, fromFocus: false }
}

/**
 * Map a `PresentationVideo` (plus its shape ordinal) to a resolved tile. The
 * `isFocus` marker is applied by the caller after focus resolution.
 */
function toTile(v: PresentationVideo, ordinal: number, isFocus: boolean): PowerPointVideoTile {
  const status = resolveVideoStatus(v)
  const durationMs = v.duration ?? null
  const elapsedMs = v.elapsed ?? null
  const remainingMs =
    v.remaining ?? (v.duration !== undefined && v.elapsed !== undefined ? v.duration - v.elapsed : null)
  return {
    id: v.id,
    name: v.name,
    ordinal,
    status,
    playing: status === 'playing',
    durationMs,
    elapsedMs,
    remainingMs,
    isFocus,
  }
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
  const selection = selectPrimaryVideo(
    videos,
    {
      primaryVideoId: snap.primaryVideoId ?? options.primaryVideoId,
      primaryVideoIndex: snap.primaryVideoIndex ?? options.primaryVideoIndex,
      playOrder: options.playOrder,
      headlineMode: options.headlineMode,
    },
    snap.protocolVersion === undefined || snap.protocolVersion === 0,
  )
  const selected = selection.video
  const selectedIndex = selection.index
  const fromFocus = selection.fromFocus
  const videoCount = videos.length
  const multipleVideos = videoCount > 1

  // Resolve one row per slide video, marking the focus by ORDINAL (P1-3). The
  // focus is the row the selector returned, matched by position rather than id,
  // so an id-less or duplicate-id focus video is still marked on exactly one
  // row. Tiles always carry the observed truth (no extrapolation); the renderer
  // owns any smoothing tick.
  const tiles: PowerPointVideoTile[] = videos.map((v, ordinal) =>
    toTile(v, ordinal, ordinal === selectedIndex),
  )

  // Aggregate timing for the large-timer scalar.
  // - Focus-selected (ISSUE-001): the focus row's OWN observed values are used
  //   ALL OR NOTHING (P1-2). If the focus row has any usable timing field, none
  //   of its missing fields are borrowed from the helper-primary scalar; the
  //   derived `duration - elapsed` fills gaps from the same row instead. Only
  //   when the focus row has NO timing data does the helper scalar fall back in
  //   (so a focus tile that is timing-only-absent degrades, never mixes).
  // - Legacy/helper-primary: scalar preferred (helper canonical primary,
  //   preserves D10 scalar fallback); selected-video timing is the fallback.
  const focusHasTiming =
    selected !== undefined &&
    (selected.duration !== undefined || selected.elapsed !== undefined || selected.remaining !== undefined)
  const useFocus = fromFocus && focusHasTiming
  const duration = useFocus
    ? selected!.duration
    : snap.videoDuration ?? selected?.duration
  const elapsed = useFocus
    ? selected!.elapsed
    : snap.videoElapsed ?? selected?.elapsed
  const observedRemaining = useFocus
    ? selected!.remaining
    : snap.videoRemaining ?? selected?.remaining
  // Derive remaining only when no observed remaining exists.
  const resolvedRemaining =
    observedRemaining ?? (duration !== undefined && elapsed !== undefined ? duration - elapsed : undefined)

  const hasTiming = duration !== undefined || elapsed !== undefined || resolvedRemaining !== undefined
  const focusStatus = fromFocus && selected !== undefined ? resolveVideoStatus(selected) : undefined
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
    videos: tiles,
  }

  // Precedence (§3.4):
  // 2. no selected video and no scalar video evidence -> no_video
  if (!hasAnyVideoSignal) {
    return { kind: 'no_video', ...common, timeMs: null, durationMs: null, multipleVideos, videoCount, ...ortho }
  }
  // 3. videoTimingUnavailable, or media with no timing and no playback signal -> timing_unavailable
  if (selection.timingUnavailable === true || snap.videoTimingUnavailable === true || (!hasTiming && !hasPlaybackSignal)) {
    return { kind: 'timing_unavailable', ...common, timeMs: null, durationMs: null, multipleVideos, videoCount, ...ortho }
  }
  // 4-6. Resolve the headline kind/status. When the focus row was selected by
  // playOrder (P1-1), the headline status comes ONLY from that row's resolved
  // status — the helper-primary scalar `videoPlaying` and the raw per-video
  // `status` of OTHER videos cannot override it, and the tile and headline can
  // never disagree. Otherwise the historical precedence applies.
  let isEnded: boolean
  let isPlaying: boolean
  let isPaused: boolean
  if (focusStatus !== undefined) {
    isEnded = focusStatus === 'ended'
    isPlaying = focusStatus === 'playing'
    isPaused = focusStatus === 'paused'
  } else {
    isEnded =
      selectedStatus === 'ended' ||
      (resolvedRemaining !== undefined && resolvedRemaining <= 0) ||
      (duration !== undefined && elapsed !== undefined && duration - elapsed <= POWERPOINT_END_INFER_MS)
    isPlaying = selectedStatus === 'playing' || selected?.playing === true || snap.videoPlaying === true
    isPaused = selectedStatus === 'paused' || (elapsed !== undefined && elapsed > 0 && !isEnded && !isPlaying)
  }

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
