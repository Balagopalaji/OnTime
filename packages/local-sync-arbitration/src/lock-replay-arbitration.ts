// rebuild-target: packages/local-sync-arbitration
export const resolveQueuedCompanionLockReplayState = <T,>(
  queuedPayload: T | undefined,
  holdActive: boolean,
  isSubscribed = true,
): {
  queuedPayload: T | null
  replayPayload: T | null
  shouldRequeue: boolean
} => {
  if (!queuedPayload || !isSubscribed) {
    return {
      queuedPayload: null,
      replayPayload: null,
      shouldRequeue: false,
    }
  }
  if (holdActive) {
    return {
      queuedPayload,
      replayPayload: null,
      shouldRequeue: true,
    }
  }
  return {
    queuedPayload,
    replayPayload: queuedPayload,
    shouldRequeue: false,
  }
}

export const resolveQueuedCompanionLockReplayCallbackState = <T,>(
  replayState: {
    queuedPayload: T | null
    replayPayload: T | null
    shouldRequeue: boolean
  },
  isSubscribed = true,
): {
  queuedPayload: T | null
  replayPayload: T | null
  shouldRequeue: boolean
} => {
  if (!replayState.replayPayload && !replayState.shouldRequeue) return replayState
  if (isSubscribed) return replayState
  return {
    queuedPayload: null,
    replayPayload: null,
    shouldRequeue: false,
  }
}
