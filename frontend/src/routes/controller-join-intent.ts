export const buildControllerJoinIntentKey = (roomId: string): string => `${roomId}::controller`
export const ACTIVITY_FORCE_REJOIN_COOLDOWN_MS = 5 * 60_000

type ForcedJoinThrottleArgs = {
  lastForcedJoinAt?: number
  reason?: string
  now?: number
  cooldownMs?: number
}

const isActivityDrivenForcedJoin = (reason?: string): boolean =>
  reason === 'idle-move' || reason?.startsWith('activity:') === true

export const shouldIssueForcedControllerJoin = ({
  lastForcedJoinAt,
  reason,
  now = Date.now(),
  cooldownMs = ACTIVITY_FORCE_REJOIN_COOLDOWN_MS,
}: ForcedJoinThrottleArgs): { shouldJoin: boolean; nextForcedJoinAt: number } => {
  if (!isActivityDrivenForcedJoin(reason)) {
    return { shouldJoin: true, nextForcedJoinAt: now }
  }
  if (typeof lastForcedJoinAt === 'number' && now - lastForcedJoinAt < cooldownMs) {
    return { shouldJoin: false, nextForcedJoinAt: lastForcedJoinAt }
  }
  return { shouldJoin: true, nextForcedJoinAt: now }
}

export const resolveControllerJoinIntent = (
  lastJoinKey: string | null,
  roomId: string,
  options?: { force?: boolean },
): { shouldJoin: boolean; nextKey: string } => {
  const nextKey = buildControllerJoinIntentKey(roomId)
  if (options?.force) {
    return { shouldJoin: true, nextKey }
  }
  return { shouldJoin: lastJoinKey !== nextKey, nextKey }
}
