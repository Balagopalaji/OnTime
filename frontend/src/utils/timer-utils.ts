import {
  computeCompanionElapsed as computeCompanionElapsedCore,
  computeElapsed as computeElapsedCore,
  computeProgress as computeProgressCore,
  computeRemaining,
  mergeProgress,
  resolveTimerElapsed as resolveTimerElapsedCore,
} from '../../../packages/timer-core/src'
import type {
  CompanionTimerState,
  FirebaseTimerState,
} from '../../../packages/timer-core/src'

export type {
  CompanionTimerState,
  FirebaseTimerState,
} from '../../../packages/timer-core/src'
export {
  computeRemaining,
  mergeProgress,
}

export function computeElapsed(
  state: Pick<FirebaseTimerState, 'isRunning' | 'startedAt' | 'elapsedOffset'>,
  now: number = Date.now(),
): number {
  return computeElapsedCore(state, now)
}

export function computeCompanionElapsed(
  state: Pick<CompanionTimerState, 'isRunning' | 'currentTime' | 'lastUpdate'>,
  now: number = Date.now(),
): number {
  return computeCompanionElapsedCore(state, now)
}

export function resolveTimerElapsed(
  state: FirebaseTimerState,
  timerId: string,
  now: number = Date.now(),
): number {
  return resolveTimerElapsedCore(state, timerId, now)
}

export function computeProgress(
  state: FirebaseTimerState,
  now: number = Date.now(),
): Record<string, number> {
  return computeProgressCore(state, now)
}
