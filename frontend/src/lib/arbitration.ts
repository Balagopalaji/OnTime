export type {
  ArbitrationDecision,
  ArbitrationDomain,
  ArbitrationInput,
  ArbitrationLastAcceptedCache,
  ArbitrationOptions,
} from '@ontime/local-sync-arbitration'
export { ARBITRATION_FLAGS, resolveSnapshotTimestamp } from '@ontime/local-sync-arbitration'
export {
  getConfidenceWindowMs,
  isSnapshotStale,
  normalizeRoomAuthoritySource,
  resolveReconciledTimerTargetId,
  shouldBootstrapCachedSubscriptions,
} from '@ontime/local-sync-arbitration'
import {
  arbitrate as arbitrateCore,
  resolveRoomSource as resolveRoomSourceCore,
  type ArbitrationDecision,
  type ArbitrationInput,
  type ArbitrationLastAcceptedCache,
  type ResolveRoomSourceInput,
} from '@ontime/local-sync-arbitration'

const lastAcceptedSource = new Map<string, ArbitrationDecision['acceptSource']>()

const lastAcceptedSourceCache: ArbitrationLastAcceptedCache = {
  get: (key) => lastAcceptedSource.get(key),
  set: (key, source) => {
    lastAcceptedSource.set(key, source)
  },
}

const logDecision = (input: ArbitrationInput, decision: ArbitrationDecision) => {
  if (import.meta.env.VITE_DEBUG_ARBITRATION === 'true') {
    console.info('[arbitration]', {
      domain: input.domain,
      roomId: input.roomId,
      resourceId: input.resourceId,
      decision,
    })
  }
}

export const arbitrate = (input: ArbitrationInput): ArbitrationDecision =>
  arbitrateCore(input, { onDecision: logDecision, lastAcceptedSourceCache })

// resolveRoomSource is bound to the app's wrapped `arbitrate` (core + last-accepted cache +
// decision logging), preserving the pre-carve behavior where it lived in UnifiedDataContext
// and delegated to this wrapped arbitrate. Byte-faithful (Stage 1b U4).
export const resolveRoomSource = (input: ResolveRoomSourceInput): 'cloud' | 'companion' =>
  resolveRoomSourceCore({ ...input, arbitrateFn: arbitrate })
