import {
  derivePowerPointRemainingMs,
  type PowerPointVideoTile,
  type PowerPointViewState,
} from '@ontime/presentation-core'
import type { AppView } from '../shared/ipc-contract.js'

/** A changed COM sample must exceed this drift before it replaces local time. */
export const PLAYBACK_DRIFT_THRESHOLD_MS = 1_500

// Ready-to-playing detection can legitimately arrive a couple of seconds
// after the click. Only a larger discontinuity is characteristic of the
// previous-run CurrentPosition observed in live PowerPoint testing.
export const READY_START_STALE_THRESHOLD_MS = 5_000
export const READY_START_GUARD_CONFIRM_MS = 3_000
export const READY_START_GUARD_MAX_MS = 5_000
export const READY_START_GUARD_SAMPLES = 4

export type PresentationState = Extract<PowerPointViewState, { videos: PowerPointVideoTile[] }>

export type ClockValue = {
  elapsedMs: number | null
  remainingMs: number | null
}

export type CorrectionEvidence = ClockValue & {
  observedAt: number
}

export type ReadyStartGuard = {
  startedAt: number
  lastEvidence: CorrectionEvidence
  consistentSamples: number
}

export type VideoClock = {
  status: PowerPointVideoTile['status']
  lastKnownName: string | null
  durationMs: number | null
  baseElapsedMs: number | null
  baseRemainingMs: number | null
  anchoredAt: number
  lastObservedAt: number
  pendingCorrection: CorrectionEvidence | null
  readyStartGuard: ReadyStartGuard | null
}

export type ScalarClock = {
  baseMs: number
  anchoredAt: number
  mode: AppView['timingMode']
}

export function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isPresentation(state: PowerPointViewState): state is PresentationState {
  return 'videos' in state
}

export function scopeKey(state: PresentationState): string {
  return JSON.stringify([state.title, state.slideNumber ?? null])
}

export function tileKey(scope: string, tile: PowerPointVideoTile): string {
  return JSON.stringify([scope, tile.id ?? null, tile.id === undefined ? tile.ordinal : null])
}

function observedElapsed(tile: PowerPointVideoTile): number | null {
  const elapsed = finite(tile.elapsedMs)
  if (elapsed !== null) return elapsed
  const duration = finite(tile.durationMs)
  const remaining = finite(tile.remainingMs)
  return duration !== null && remaining !== null ? duration - remaining : null
}

function observedRemaining(tile: PowerPointVideoTile): number | null {
  const remaining = finite(tile.remainingMs)
  if (remaining !== null) return remaining
  const duration = finite(tile.durationMs)
  const elapsed = finite(tile.elapsedMs)
  return duration !== null && elapsed !== null ? duration - elapsed : null
}

export function hasComparableTiming(tile: PowerPointVideoTile): boolean {
  return observedElapsed(tile) !== null || observedRemaining(tile) !== null
}

function advanceFor(clock: Pick<VideoClock, 'anchoredAt'>, now: number): number {
  return Math.max(0, now - clock.anchoredAt)
}

export function clockValue(clock: VideoClock, now: number): ClockValue {
  const advance = clock.status === 'playing' ? advanceFor(clock, now) : 0
  const rawElapsedMs = clock.baseElapsedMs === null ? null : clock.baseElapsedMs + advance
  const elapsedMs =
    rawElapsedMs === null || clock.durationMs === null
      ? rawElapsedMs
      : Math.min(clock.durationMs, rawElapsedMs)
  const remainingMs =
    clock.durationMs !== null && elapsedMs !== null
      ? derivePowerPointRemainingMs(clock.durationMs, elapsedMs)
      : clock.baseRemainingMs === null
        ? null
        : Math.max(0, clock.baseRemainingMs - advance)
  return { elapsedMs, remainingMs }
}

export function clockFromTile(
  tile: PowerPointVideoTile,
  now: number,
  fallback: ClockValue | null = null,
  rememberedName: string | null = null,
): VideoClock {
  const durationMs = finite(tile.durationMs)
  const elapsedMs = observedElapsed(tile) ?? fallback?.elapsedMs ?? null
  const remainingMs =
    durationMs !== null && elapsedMs !== null
      ? derivePowerPointRemainingMs(durationMs, elapsedMs)
      : observedRemaining(tile) ?? fallback?.remainingMs ?? null
  return {
    status: tile.status,
    lastKnownName: tile.name ?? rememberedName,
    durationMs,
    baseElapsedMs: elapsedMs,
    baseRemainingMs: remainingMs,
    anchoredAt: now,
    lastObservedAt: now,
    pendingCorrection: null,
    readyStartGuard: null,
  }
}

export function clockFromFrozen(
  tile: PowerPointVideoTile,
  prior: VideoClock,
  frozen: ClockValue,
  now: number,
  pendingCorrection: CorrectionEvidence | null,
  readyStartGuard: ReadyStartGuard | null = null,
): VideoClock {
  const durationMs = finite(tile.durationMs) ?? prior.durationMs
  const elapsedMs = frozen.elapsedMs
  const remainingMs =
    durationMs !== null && elapsedMs !== null
      ? derivePowerPointRemainingMs(durationMs, elapsedMs)
      : frozen.remainingMs
  return {
    status: tile.status,
    lastKnownName: tile.name ?? prior.lastKnownName,
    durationMs,
    baseElapsedMs: elapsedMs,
    baseRemainingMs: remainingMs,
    anchoredAt: now,
    lastObservedAt: now,
    pendingCorrection,
    readyStartGuard,
  }
}

export function endedClock(
  tile: PowerPointVideoTile,
  prior: VideoClock | undefined,
  frozen: ClockValue | null,
  now: number,
): VideoClock {
  const durationMs = finite(tile.durationMs) ?? prior?.durationMs ?? null
  const elapsedMs = durationMs ?? observedElapsed(tile) ?? frozen?.elapsedMs ?? null
  return {
    status: 'ended',
    lastKnownName: tile.name ?? prior?.lastKnownName ?? null,
    durationMs,
    baseElapsedMs: elapsedMs,
    baseRemainingMs: 0,
    anchoredAt: now,
    lastObservedAt: now,
    pendingCorrection: null,
    readyStartGuard: null,
  }
}

export function driftMs(observed: PowerPointVideoTile, predicted: ClockValue): number | null {
  const elapsed = observedElapsed(observed)
  if (elapsed !== null && predicted.elapsedMs !== null) return Math.abs(elapsed - predicted.elapsedMs)
  const remaining = observedRemaining(observed)
  if (remaining !== null && predicted.remainingMs !== null) return Math.abs(remaining - predicted.remainingMs)
  return null
}

export function scalarValue(clock: ScalarClock, now: number): number {
  const advance = advanceFor(clock, now)
  return clock.mode === 'remaining' ? Math.max(0, clock.baseMs - advance) : clock.baseMs + advance
}

export function correctionEvidence(tile: PowerPointVideoTile, observedAt: number): CorrectionEvidence {
  return {
    elapsedMs: observedElapsed(tile),
    remainingMs: observedRemaining(tile),
    observedAt,
  }
}

export function consistentCorrection(previous: CorrectionEvidence, next: CorrectionEvidence): boolean {
  const wallClockMovement = Math.max(0, next.observedAt - previous.observedAt)
  if (previous.elapsedMs !== null && next.elapsedMs !== null) {
    const observedMovement = next.elapsedMs - previous.elapsedMs
    return observedMovement > 0 &&
      Math.abs(observedMovement - wallClockMovement) <= PLAYBACK_DRIFT_THRESHOLD_MS
  }
  if (previous.remainingMs !== null && next.remainingMs !== null) {
    const observedMovement = previous.remainingMs - next.remainingMs
    return observedMovement > 0 &&
      Math.abs(observedMovement - wallClockMovement) <= PLAYBACK_DRIFT_THRESHOLD_MS
  }
  return false
}

function readyStartMovement(tile: PowerPointVideoTile, ready: ClockValue): number | null {
  const elapsed = observedElapsed(tile)
  if (elapsed !== null && ready.elapsedMs !== null) return elapsed - ready.elapsedMs
  const remaining = observedRemaining(tile)
  if (remaining !== null && ready.remainingMs !== null) return ready.remainingMs - remaining
  return null
}

export function isImplausiblyAheadOfReady(
  tile: PowerPointVideoTile,
  ready: ClockValue,
  readyObservedAt: number,
  now: number,
): boolean {
  const movement = readyStartMovement(tile, ready)
  if (movement === null || movement < 0) return false
  const observationGap = Math.max(0, now - readyObservedAt)
  return movement > READY_START_STALE_THRESHOLD_MS &&
    movement > observationGap + PLAYBACK_DRIFT_THRESHOLD_MS
}

export function agreeingNonPlayingCorrection(previous: CorrectionEvidence, next: CorrectionEvidence): boolean {
  if (previous.elapsedMs !== null && next.elapsedMs !== null) {
    return Math.abs(next.elapsedMs - previous.elapsedMs) <= PLAYBACK_DRIFT_THRESHOLD_MS
  }
  if (previous.remainingMs !== null && next.remainingMs !== null) {
    return Math.abs(next.remainingMs - previous.remainingMs) <= PLAYBACK_DRIFT_THRESHOLD_MS
  }
  return false
}

export function scalarDrift(clock: ScalarClock, observed: number, now: number): number {
  return Math.abs(observed - scalarValue(clock, now))
}

export function asPresentation(state: PowerPointViewState): PresentationState {
  return state as PresentationState
}
