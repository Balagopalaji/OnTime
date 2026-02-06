type CanonicalTimerTuple = {
  activeTimerId: string | null
  isRunning: boolean
  startedAt: number | null
  elapsedOffset: number
  currentTime: number
  lastUpdate: number
  progress: Record<string, number>
}

const sanitizeProgressMap = (progress: Record<string, unknown>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(progress).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>

export const buildMigrationTimerTuple = (legacyState: Record<string, unknown>, now: number): CanonicalTimerTuple => {
  const activeTimerId = typeof legacyState.activeTimerId === 'string' ? legacyState.activeTimerId : null
  const isRunning = Boolean(legacyState.isRunning)
  const startedAt = typeof legacyState.startedAt === 'number' ? legacyState.startedAt : null
  const legacyElapsedOffset = typeof legacyState.elapsedOffset === 'number' ? legacyState.elapsedOffset : 0
  const progress = sanitizeProgressMap((legacyState.progress ?? {}) as Record<string, unknown>)
  const activeProgress = activeTimerId ? progress[activeTimerId] : undefined
  const pausedBaseline = typeof activeProgress === 'number' ? activeProgress : legacyElapsedOffset
  const elapsedOffset = pausedBaseline
  const elapsedMs = activeTimerId && isRunning && startedAt ? now - startedAt + elapsedOffset : elapsedOffset
  const currentTime = Math.round(elapsedMs)
  return {
    activeTimerId,
    isRunning,
    startedAt,
    elapsedOffset,
    currentTime,
    lastUpdate: now,
    progress,
  }
}

export const buildDurationEditStateUpdates = (
  version: number,
  timerId: string,
  isActiveTimer: boolean,
  isRunning: boolean,
  now: number,
): Record<string, unknown> => {
  const updates: Record<string, unknown> =
    version === 2
      ? {
          [`progress.${timerId}`]: 0,
        }
      : {
          [`state.progress.${timerId}`]: 0,
        }
  if (!isActiveTimer) return updates
  if (version === 2) {
    updates['elapsedOffset'] = 0
    updates['startedAt'] = isRunning ? now : null
    updates['currentTime'] = 0
    updates['lastUpdate'] = now
    return updates
  }
  updates['state.elapsedOffset'] = 0
  updates['state.startedAt'] = isRunning ? now : null
  updates['state.currentTime'] = 0
  updates['state.lastUpdate'] = now
  return updates
}

export const buildResetTimerProgressStateUpdates = (
  version: number,
  timerId: string,
  isActiveTimer: boolean,
  now: number,
): Record<string, unknown> => {
  const updates: Record<string, unknown> =
    version === 2
      ? { [`progress.${timerId}`]: 0 }
      : { [`state.progress.${timerId}`]: 0 }
  if (!isActiveTimer) return updates
  if (version === 2) {
    updates['elapsedOffset'] = 0
    updates['startedAt'] = null
    updates['isRunning'] = false
    updates['currentTime'] = 0
    updates['lastUpdate'] = now
    return updates
  }
  updates['state.elapsedOffset'] = 0
  updates['state.startedAt'] = null
  updates['state.isRunning'] = false
  updates['state.currentTime'] = 0
  updates['state.lastUpdate'] = now
  return updates
}
