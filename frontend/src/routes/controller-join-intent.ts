export const buildControllerJoinIntentKey = (roomId: string): string => `${roomId}::controller`

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
