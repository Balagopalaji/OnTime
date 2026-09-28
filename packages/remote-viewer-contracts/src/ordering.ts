import type { PowerPointPresentationPayloadV1, RemoteSnapshotCandidateV1, RemoteVideoRowV1 } from './snapshot-types'

/** A playing row whose observed elapsed drifts beyond this from its host-domain prediction is material. */
export const MATERIAL_TIMING_DELTA_MS = 750

export type SnapshotOrder = 'apply' | 'reset' | 'duplicate' | 'regression'

/**
 * Viewer ordering: a higher epoch resets, a lower epoch is rejected, and a
 * same-epoch sequence must exceed the last applied one (gaps are allowed
 * because a listener may coalesce intermediate documents).
 */
export function compareSnapshotOrder(
  last: { epoch: number; sequence: number } | null,
  incoming: { epoch: number; sequence: number },
): SnapshotOrder {
  if (last === null) return 'apply'
  if (incoming.epoch > last.epoch) return 'reset'
  if (incoming.epoch < last.epoch) return 'regression'
  if (incoming.sequence === last.sequence) return 'duplicate'
  return incoming.sequence > last.sequence ? 'apply' : 'regression'
}

function rowIdentityChanged(previous: RemoteVideoRowV1, next: RemoteVideoRowV1): boolean {
  return (
    previous.ordinal !== next.ordinal ||
    previous.label !== next.label ||
    previous.status !== next.status ||
    previous.durationMs !== next.durationMs ||
    previous.isFocus !== next.isFocus
  )
}

function scalarDrifted(before: number | null, after: number | null, predictedDeltaMs: number): boolean {
  if (before === null || after === null) return before !== after
  return Math.abs(after - (before + predictedDeltaMs)) > MATERIAL_TIMING_DELTA_MS
}

/**
 * Elapsed/remaining differ from their host-domain prediction by more than the
 * threshold (or appear/disappear). Playing rows are predicted to move with host
 * time; non-playing rows are displayed directly, so they are predicted static.
 */
function timingDrifted(previous: RemoteVideoRowV1, next: RemoteVideoRowV1, hostDeltaMs: number): boolean {
  const moving = next.status === 'playing' ? hostDeltaMs : 0
  return (
    scalarDrifted(previous.elapsedMsAtObservation, next.elapsedMsAtObservation, moving) ||
    scalarDrifted(previous.remainingMsAtObservation, next.remainingMsAtObservation, -moving)
  )
}

function presentationChanged(
  previous: PowerPointPresentationPayloadV1,
  next: PowerPointPresentationPayloadV1,
  hostDeltaMs: number,
): boolean {
  if (
    previous.presentationState !== next.presentationState ||
    previous.slideNumber !== next.slideNumber ||
    previous.slideCount !== next.slideCount ||
    previous.displayTitle !== next.displayTitle ||
    previous.headline.focusedOrdinal !== next.headline.focusedOrdinal ||
    previous.headline.mode !== next.headline.mode ||
    previous.headline.timingMode !== next.headline.timingMode ||
    previous.videos.length !== next.videos.length
  ) {
    return true
  }
  return next.videos.some((row, index) => {
    const before = previous.videos[index] as RemoteVideoRowV1
    return rowIdentityChanged(before, row) || timingDrifted(before, row, hostDeltaMs)
  })
}

/**
 * Sidecar publish policy: true when `next` differs materially from
 * `lastPublished` — the last candidate actually published, not the previous
 * poll, so slow drift accumulates to the threshold. `observedAtMs` must come
 * from one monotonic-consistent host clock. Non-material polls only replace
 * the pending candidate and wait for the heartbeat.
 */
export function isMaterialChange(lastPublished: RemoteSnapshotCandidateV1 | null, next: RemoteSnapshotCandidateV1): boolean {
  const previous = lastPublished
  if (previous === null || previous.availability !== next.availability) return true
  if (previous.availability === 'connecting' || next.availability === 'connecting') return false
  if (previous.availability === 'source-unavailable' && next.availability === 'source-unavailable') {
    return previous.payload.reason !== next.payload.reason
  }
  if (previous.availability === 'active' && next.availability === 'active') {
    return presentationChanged(previous.payload, next.payload, next.observedAtMs - previous.observedAtMs)
  }
  return true
}
