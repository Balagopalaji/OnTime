export type {
  ArbitrationDecision,
  ArbitrationDomain,
  ArbitrationInput,
  ArbitrationLastAcceptedCache,
  ArbitrationOptions,
} from '../../../packages/local-sync-arbitration/src'
export { ARBITRATION_FLAGS } from '../../../packages/local-sync-arbitration/src'
import {
  arbitrate as arbitrateCore,
  type ArbitrationDecision,
  type ArbitrationInput,
  type ArbitrationLastAcceptedCache,
} from '../../../packages/local-sync-arbitration/src'

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
