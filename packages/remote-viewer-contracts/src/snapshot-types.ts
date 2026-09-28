/**
 * RemoteSnapshotV1 wire contract (ISSUE-002, Deep Plan "Wire contract").
 *
 * Three shapes deliberately differ so no layer forwards its input object:
 * - `RemoteSnapshotCandidateV1`: ppt-timer main → hidden publisher sidecar.
 * - `PublishSnapshotRequestV1`: sidecar → `publishPresentationSnapshot`.
 * - `RemoteSnapshotV1`: server-stored snapshot read by viewers.
 */

export const REMOTE_SCHEMA_MAJOR = 1 as const
export const POWERPOINT_SOURCE_KIND = 'powerpoint' as const
export const POWERPOINT_SOURCE_MAJOR = 1 as const

/** Freshness policy defaults written by the server (spec: 10 s / 25 s / 60 s). */
export const HEARTBEAT_INTERVAL_MS = 10_000
export const STALE_AFTER_MS = 25_000
export const DISCONNECT_AFTER_MS = 60_000

/** Upper bound on disclosure rows accepted from one slide. */
export const MAX_VIDEO_ROWS = 64
/** Upper bound (Unicode code points) on a sanitized title or label. */
export const MAX_DISPLAY_TEXT_LENGTH = 80
/** Session IDs are Firestore document IDs; restricting the alphabet forbids path injection. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type RemoteAvailability = 'connecting' | 'active' | 'source-unavailable'

export type PowerPointUnavailableReason = 'no-presentation' | 'no-slideshow' | 'helper-unavailable'

export type PowerPointPresentationState =
  | 'no-video'
  | 'timing-unavailable'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'

export type RemoteVideoStatus = 'ready' | 'playing' | 'paused' | 'ended'

export type RemoteVideoRowV1 = {
  ordinal: number
  label?: string
  status: RemoteVideoStatus
  durationMs: number | null
  elapsedMsAtObservation: number | null
  remainingMsAtObservation: number | null
  isFocus: boolean
}

export type PowerPointPresentationPayloadV1 = {
  reason: 'presentation'
  presentationState: PowerPointPresentationState
  slideNumber: number | null
  slideCount: number | null
  displayTitle?: string
  headline: {
    focusedOrdinal: number | null
    mode: 'longest-remaining' | 'latest-started'
    timingMode: 'remaining' | 'elapsed'
  }
  videos: RemoteVideoRowV1[]
}

export type PowerPointUnavailablePayloadV1 = { reason: PowerPointUnavailableReason }

export type PowerPointPayloadV1 = PowerPointPresentationPayloadV1 | PowerPointUnavailablePayloadV1

type SourceHeader = {
  schemaMajor: typeof REMOTE_SCHEMA_MAJOR
  sourceKind: typeof POWERPOINT_SOURCE_KIND
  sourceMajor: typeof POWERPOINT_SOURCE_MAJOR
}

/**
 * Availability and payload are coupled: `connecting` carries no payload,
 * `active` carries the presentation variant, and `source-unavailable` carries
 * only an unavailable reason.
 */
export type RemoteSourceBody =
  | { availability: 'connecting'; payload: null }
  | { availability: 'active'; payload: PowerPointPresentationPayloadV1 }
  | { availability: 'source-unavailable'; payload: PowerPointUnavailablePayloadV1 }

export type RemoteSnapshotCandidateV1 = SourceHeader & { observedAtMs: number } & RemoteSourceBody

export type PublishSnapshotRequestV1 = SourceHeader & {
  sessionId: string
  epoch: number
  sequence: number
  observedAtMs: number
  observationAgeMs: number
  sentAtEstimatedServerMs: number
} & RemoteSourceBody

export type RemoteSnapshotV1 = SourceHeader & {
  sessionId: string
  epoch: number
  sequence: number
  observedAtMs: number
  observationAgeMs: number
  preCommitTransitMs: number
  publishedAtMs: number
  heartbeatIntervalMs: number
  staleAfterMs: number
  disconnectAfterMs: number
} & RemoteSourceBody

export type ParseErrorCode =
  | 'invalid-shape'
  | 'unknown-key'
  | 'incompatible-version'
  | 'unsupported-source'
  | 'invalid-field'
  | 'invalid-combination'

export type ParseError = { code: ParseErrorCode; path: string }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError }
