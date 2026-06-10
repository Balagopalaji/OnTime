export type {
  ArbitrationDecision,
  ArbitrationDomain,
  ArbitrationInput,
  ArbitrationOptions,
} from '../../../packages/local-sync-arbitration/src'
export { ARBITRATION_FLAGS } from '../../../packages/local-sync-arbitration/src'
import {
  arbitrate as arbitrateCore,
  type ArbitrationDecision,
  type ArbitrationInput,
} from '../../../packages/local-sync-arbitration/src'

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
  arbitrateCore(input, { onDecision: logDecision })
