/**
 * Pure PowerPoint presentation-domain types shared by the standalone view
 * projection and the candidate/commit state machine. Graduated verbatim from
 * `companion/src/presentation-snapshot.ts` (H3, ISSUE-001).
 *
 * These types carry NO transport, room, LiveCue, Electron, or Node concerns.
 * The host (Companion today; the standalone PowerPoint timer in H4) owns
 * emission, scheduling, and platform behavior. The package boundary guardrail
 * enforces that no production file here imports Node builtins, Electron,
 * process, timers, shared wire contracts, or app internals.
 */

/**
 * Per-video timing record. The historical Companion `VideoTiming` shape, with
 * `status` typed (it already appears in H1 helper fixtures and is needed by the
 * view projection). `videoListsEqual` intentionally ignores `status` to
 * preserve the Companion emission contract.
 */
export type PresentationVideo = {
  id?: number
  name?: string
  duration?: number
  elapsed?: number
  remaining?: number
  playing?: boolean
  status?: 'playing' | 'paused' | 'ended'
}

/** PowerPoint process foreground/affinity state reported by the native helper. */
export type PowerPointPollState = 'foreground' | 'background' | 'none'

/**
 * Raw poll result from the canonical PowerPoint helper. Verbatim Companion
 * contract (H1 provenance); `videos`/`editSlideVideos` use PresentationVideo.
 * Protocol and primary-selection metadata are carried unchanged from the
 * canonical helper so every host projects the same media identity.
 */
export type PowerPointPollResult = {
  state: PowerPointPollState
  inSlideshow?: boolean
  instanceId?: number
  slideNumber?: number
  totalSlides?: number
  protocolVersion?: number
  primaryVideoId?: number
  primaryVideoIndex?: number
  title?: string
  filename?: string
  editSlideVideos?: PresentationVideo[]
  videoDetected?: boolean
  videoPlaying?: boolean
  videoDuration?: number
  videoElapsed?: number
  videoRemaining?: number
  videos?: PresentationVideo[]
  videoTimingUnavailable?: boolean
}

/**
 * Normalized presentation snapshot fed to the candidate/commit machine and
 * projected to the standalone view. Replaces the local Companion snapshot.
 */
export type PresentationSnapshot = {
  instanceId: number
  slideNumber?: number
  totalSlides?: number
  protocolVersion?: number
  primaryVideoId?: number
  primaryVideoIndex?: number
  title: string
  filename?: string
  videoPlaying?: boolean
  videoDuration?: number
  videoElapsed?: number
  videoRemaining?: number
  videos?: PresentationVideo[]
  videoTimingUnavailable?: boolean
}

/**
 * Presentation-only mirror of the active cue. The full LiveCue, its
 * `startedAt`, ended payload, and `activeLiveCueId` side effects stay
 * host-owned; the shared machine tracks only which presentation instance
 * (if any) it considers active.
 */
export type ActivePresentationRef = { instanceId: number }

/**
 * Downstream display observation. Decoupled from the debounced Companion
 * commit so the standalone view can react immediately to availability changes
 * (no slideshow, not running, operational failure) while Companion's live-cue
 * clear still debounces. The `presentation` variant carries the latest
 * normalized snapshot; every other variant is free of numeric timing.
 */
export type PresentationSourceState =
  | { kind: 'connecting' }
  | { kind: 'unavailable' }
  | { kind: 'powerpoint_not_running' }
  | { kind: 'no_slideshow' }
  | { kind: 'presentation'; snapshot: PresentationSnapshot }
