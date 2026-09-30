/**
 * Main-side privacy allowlist (Deep Plan "Privacy allowlist" and host-state
 * table): reconstructs a strict `RemoteSnapshotCandidateV1` from the projected
 * host view. Only canonical, host-resolved values cross the process boundary —
 * never paths, media IDs, filenames, instance/diagnostic data, or warnings.
 */
import {
  derivePowerPointRemainingMs,
  type PowerPointHeadlineMode,
  type PowerPointTimingMode,
  type PowerPointVideoTile,
  type PowerPointViewState,
} from '@ontime/presentation-core'
import {
  parseRemoteSnapshotCandidateV1,
  sanitizeDisplayText,
  type ParseResult,
  type PowerPointPresentationState,
  type PowerPointUnavailableReason,
  type RemoteSnapshotCandidateV1,
  type RemoteVideoRowV1,
} from '@ontime/remote-viewer-contracts'

const HEADER = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1 } as const

const UNAVAILABLE: Partial<Record<PowerPointViewState['kind'], PowerPointUnavailableReason>> = {
  unavailable: 'helper-unavailable',
  powerpoint_not_running: 'no-presentation',
  no_slideshow: 'no-slideshow',
}

const PRESENTATION_STATE: Partial<Record<PowerPointViewState['kind'], PowerPointPresentationState>> = {
  no_video: 'no-video',
  timing_unavailable: 'timing-unavailable',
  ready: 'ready',
  playing: 'playing',
  paused: 'paused',
  ended: 'ended',
}

const measured = (value: number | null): number | null => (value !== null && Number.isFinite(value) ? Math.max(value, 0) : null)

const positiveInteger = (value: number | undefined): number | null =>
  value !== undefined && Number.isSafeInteger(value) && value >= 1 ? value : null

function toRow(tile: PowerPointVideoTile, isFocus: boolean): RemoteVideoRowV1 {
  const durationMs = measured(tile.durationMs)
  const elapsed = measured(tile.elapsedMs)
  const observedRemaining = tile.remainingMs !== null && Number.isFinite(tile.remainingMs) ? tile.remainingMs : null
  const remaining = observedRemaining ?? derivePowerPointRemainingMs(durationMs, elapsed)
  const label = tile.name === undefined ? undefined : sanitizeDisplayText(tile.name)
  return {
    ordinal: tile.ordinal,
    ...(label === undefined ? {} : { label }),
    status: tile.status,
    durationMs,
    elapsedMsAtObservation: elapsed,
    remainingMsAtObservation: measured(remaining),
    isFocus,
  }
}

const withoutTiming = (row: RemoteVideoRowV1): RemoteVideoRowV1 => ({
  ...row,
  durationMs: null,
  elapsedMsAtObservation: null,
  remainingMsAtObservation: null,
})

const interpolable = (row: RemoteVideoRowV1) =>
  row.durationMs !== null && row.elapsedMsAtObservation !== null && row.remainingMsAtObservation !== null

/**
 * Build and strictly validate the candidate. A slide whose playing row lacks
 * finite timing is published as `timing-unavailable` rather than failing, so
 * viewers see an explicit no-timing state instead of freezing.
 */
export function toSnapshotCandidate(
  state: PowerPointViewState,
  observedAtMs: number,
  modes: { timingMode: PowerPointTimingMode; headlineMode: PowerPointHeadlineMode },
): ParseResult<RemoteSnapshotCandidateV1> {
  if (state.kind === 'connecting') return parseRemoteSnapshotCandidateV1({ ...HEADER, observedAtMs, availability: 'connecting', payload: null })
  const reason = UNAVAILABLE[state.kind]
  if (reason !== undefined) {
    return parseRemoteSnapshotCandidateV1({ ...HEADER, observedAtMs, availability: 'source-unavailable', payload: { reason } })
  }
  const presentation = state as Extract<PowerPointViewState, { videos: PowerPointVideoTile[] }>
  let presentationState = PRESENTATION_STATE[state.kind] as PowerPointPresentationState
  let focusSeen = false
  let rows = presentationState === 'no-video'
    ? []
    : presentation.videos.map((tile) => {
        const isFocus = tile.isFocus && !focusSeen
        focusSeen ||= isFocus
        return toRow(tile, isFocus)
      })
  if (presentationState !== 'timing-unavailable' && rows.some((row) => row.status === 'playing' && !interpolable(row))) {
    presentationState = 'timing-unavailable'
  }
  if (presentationState === 'timing-unavailable') rows = rows.map(withoutTiming)

  const slideNumber = positiveInteger(presentation.slideNumber)
  const totalSlides = positiveInteger(presentation.totalSlides)
  const slideCount = slideNumber !== null && totalSlides !== null && slideNumber > totalSlides ? null : totalSlides
  const displayTitle = sanitizeDisplayText(presentation.title ?? '')
  return parseRemoteSnapshotCandidateV1({
    ...HEADER,
    observedAtMs,
    availability: 'active',
    payload: {
      reason: 'presentation',
      presentationState,
      slideNumber,
      slideCount,
      ...(displayTitle === undefined ? {} : { displayTitle }),
      headline: {
        focusedOrdinal: rows.find((row) => row.isFocus)?.ordinal ?? null,
        mode: modes.headlineMode,
        timingMode: modes.timingMode,
      },
      videos: rows,
    },
  })
}
