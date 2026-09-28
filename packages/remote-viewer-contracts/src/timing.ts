import type { RemoteVideoRowV1 } from './snapshot-types'

/**
 * Observation-truth timing (Deep Plan "Observation-truth timing"). Numeric row
 * values are host measurements at `observedAtMs`; every duration here stays in
 * one clock domain and no function reads a wall clock.
 */

/** Tolerated future skew of a sidecar's server-time estimate before rejection. */
export const MAX_CLOCK_UNCERTAINTY_MS = 2_000

export type ServerClock = { offsetMs: number }

export type PreCommitTransit =
  | { kind: 'measured' | 'clamped' | 'no-offset'; transitMs: number }
  | { kind: 'future' }

export type RemoteVideoRowView = RemoteVideoRowV1 & {
  elapsedMsNow: number | null
  remainingMsNow: number | null
}

/** Sidecar: host-clock duration from observation to publish handoff, never negative. */
export function computeObservationAgeMs(observedAtMs: number, hostNowMs: number): number {
  return hostNowMs > observedAtMs ? hostNowMs - observedAtMs : 0
}

/** Sidecar: server-minus-local offset from one round trip's midpoint. */
export function estimateServerOffsetMs(sample: { sentLocalMs: number; receivedLocalMs: number; serverNowMs: number }): number {
  return sample.serverNowMs - (sample.sentLocalMs + sample.receivedLocalMs) / 2
}

/**
 * Server: bounded network-ingress + function time. A null estimate means the
 * sidecar had no reliable offset, so transit is conservatively zero.
 */
export function computePreCommitTransit(input: {
  sentAtEstimatedServerMs: number | null
  publishedAtMs: number
  staleAfterMs: number
}): PreCommitTransit {
  if (input.sentAtEstimatedServerMs === null) return { kind: 'no-offset', transitMs: 0 }
  const transitMs = input.publishedAtMs - input.sentAtEstimatedServerMs
  if (transitMs < -MAX_CLOCK_UNCERTAINTY_MS) return { kind: 'future' }
  if (transitMs > input.staleAfterMs) return { kind: 'clamped', transitMs: input.staleAfterMs }
  return { kind: 'measured', transitMs: transitMs > 0 ? transitMs : 0 }
}

/** Viewer: anchor a monotonic clock to link resolution's `serverNowMs` using the same midpoint model. */
export function createServerClock(sample: { sentLocalMs: number; receivedLocalMs: number; serverNowMs: number }): ServerClock {
  return { offsetMs: estimateServerOffsetMs(sample) }
}

export function estimateServerNow(clock: ServerClock, monotonicNowMs: number): number {
  return monotonicNowMs + clock.offsetMs
}

type SnapshotTiming = { observationAgeMs: number; preCommitTransitMs: number; publishedAtMs: number; staleAfterMs: number }

/**
 * Viewer: age of the host observation at an estimated server instant —
 * observation-to-handoff + pre-commit transit + time since commit (never
 * negative). Freshness is judged on this, so re-publishing an old cached
 * observation cannot look live.
 */
export function computeObservationAgeAtMs(snapshot: SnapshotTiming, estimatedServerNowMs: number): number {
  const sinceCommitMs = Math.max(0, estimatedServerNowMs - snapshot.publishedAtMs)
  return snapshot.observationAgeMs + snapshot.preCommitTransitMs + sinceCommitMs
}

/**
 * Viewer: interpolation advance, capped at `staleAfterMs` so it stops exactly
 * when the observation becomes stale. (Refines the plan's since-commit clamp to
 * also bound observation age and transit.)
 */
export function computeAdvanceMs(snapshot: SnapshotTiming, estimatedServerNowMs: number): number {
  return Math.min(snapshot.staleAfterMs, computeObservationAgeAtMs(snapshot, estimatedServerNowMs))
}

/**
 * Viewer: current values for one row. Only a measured playing row advances;
 * reaching zero does not invent `ended` — only a fresh host observation does.
 */
export function interpolateRow(row: RemoteVideoRowV1, advanceMs: number): RemoteVideoRowView {
  const { durationMs, elapsedMsAtObservation: observedElapsed, remainingMsAtObservation: observedRemaining } = row
  if (row.status !== 'playing' || durationMs === null || observedElapsed === null || observedRemaining === null) {
    return { ...row, elapsedMsNow: observedElapsed, remainingMsNow: observedRemaining }
  }
  return {
    ...row,
    elapsedMsNow: Math.min(durationMs, observedElapsed + advanceMs),
    remainingMsNow: observedRemaining > advanceMs ? observedRemaining - advanceMs : 0,
  }
}
