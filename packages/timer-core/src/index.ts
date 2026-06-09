/**
 * Timer Core - pure helpers for timer elapsed time calculations.
 *
 * IMPORTANT: Elapsed can be negative (bonus time). Do NOT clamp to >= 0.
 * See docs/timer-logic.md for the complete specification.
 */

/**
 * Firebase room state shape (subset needed for elapsed calculation).
 */
export type FirebaseTimerState = {
  isRunning: boolean
  startedAt: number | null
  elapsedOffset: number
  activeTimerId?: string | null
  progress?: Record<string, number>
}

/**
 * Companion room state shape (subset needed for elapsed calculation).
 */
export type CompanionTimerState = {
  isRunning: boolean
  currentTime: number
  lastUpdate: number
  activeTimerId?: string | null
}

/**
 * Compute live elapsed time for Firebase state.
 * For a running timer: elapsedOffset + (now - startedAt)
 * For a paused timer: elapsedOffset
 *
 * @returns elapsed in ms (can be negative for bonus time)
 */
export function computeElapsed(
  state: Pick<FirebaseTimerState, 'isRunning' | 'startedAt' | 'elapsedOffset'>,
  now: number
): number {
  if (state.isRunning && typeof state.startedAt === 'number') {
    return state.elapsedOffset + (now - state.startedAt)
  }
  return state.elapsedOffset
}

/**
 * Compute live elapsed time for Companion state.
 * For a running timer: currentTime + (now - lastUpdate)
 * For a paused timer: currentTime
 *
 * @returns elapsed in ms (can be negative for bonus time)
 */
export function computeCompanionElapsed(
  state: Pick<CompanionTimerState, 'isRunning' | 'currentTime' | 'lastUpdate'>,
  now: number
): number {
  if (state.isRunning) {
    return state.currentTime + (now - state.lastUpdate)
  }
  return state.currentTime
}

/**
 * Resolve elapsed for a specific timer.
 * - If timer is active: compute live elapsed from state
 * - If timer is not active: read from progress map
 *
 * @returns elapsed in ms (can be negative for bonus time)
 */
export function resolveTimerElapsed(
  state: FirebaseTimerState,
  timerId: string,
  now: number
): number {
  if (state.activeTimerId === timerId) {
    return computeElapsed(state, now)
  }
  return state.progress?.[timerId] ?? 0
}

/**
 * Compute progress map for a room, updating the active timer's progress
 * with the current live elapsed time.
 *
 * @returns Updated progress map with all timers' elapsed times
 */
export function computeProgress(
  state: FirebaseTimerState,
  now: number
): Record<string, number> {
  const progress = { ...(state.progress ?? {}) }
  const activeId = state.activeTimerId
  if (activeId) {
    progress[activeId] = computeElapsed(state, now)
  }
  return progress
}

/**
 * Merge progress maps, with priority values taking precedence.
 * Used to merge cached progress into room progress.
 *
 * @param base - Base progress map
 * @param priority - Priority progress map (values override base)
 * @returns Merged progress map
 */
export function mergeProgress(
  base: Record<string, number>,
  priority: Record<string, number>
): Record<string, number> {
  return { ...base, ...priority }
}

/**
 * Calculate remaining time for a countdown timer.
 * remaining = duration - elapsed
 *
 * @param durationMs - Timer duration in ms
 * @param elapsedMs - Elapsed time in ms (can be negative for bonus time)
 * @returns Remaining time in ms (negative = overtime)
 */
export function computeRemaining(durationMs: number, elapsedMs: number): number {
  return durationMs - elapsedMs
}
