import { emitDiagnostic, type BridgeDiagnosticSink } from './diagnostics.js'
import type { BridgePollOutcome } from './protocol.js'

type BridgePollOutcomeKind = BridgePollOutcome['kind']

const SLOW_POLL_DIAGNOSTIC_THRESHOLD_MS = 250
const SLOW_POLL_DIAGNOSTIC_COOLDOWN_MS = 5_000

export type PollCompletion = {
  generation?: number
  startedAt?: number
  completedAt?: number
  outcomeKind: BridgePollOutcomeKind
}

export class PollCompletionDiagnostics {
  private lastSlowPollDiagnosticAt = Number.NEGATIVE_INFINITY
  private lastSlowPollDiagnosticGeneration = -1

  constructor(private readonly diagnostics?: BridgeDiagnosticSink) {}

  record(completion: PollCompletion): void {
    const { generation = 0, startedAt, completedAt, outcomeKind } = completion
    if (startedAt !== undefined && completedAt !== undefined) {
      const pollDurationMs = completedAt >= startedAt ? completedAt - startedAt : 0
      const cooldownExpired = completedAt - this.lastSlowPollDiagnosticAt >= SLOW_POLL_DIAGNOSTIC_COOLDOWN_MS
      const generationChanged = generation !== this.lastSlowPollDiagnosticGeneration
      if (pollDurationMs > SLOW_POLL_DIAGNOSTIC_THRESHOLD_MS && (cooldownExpired || generationChanged)) {
        this.lastSlowPollDiagnosticAt = completedAt
        this.lastSlowPollDiagnosticGeneration = generation
        emitDiagnostic(this.diagnostics, { kind: 'poll_slow', generation, elapsedMs: pollDurationMs, outcome: outcomeKind })
      }
    }

    if (isAvailabilityOutcome(outcomeKind)) {
      emitDiagnostic(this.diagnostics, { kind: 'availability', outcome: outcomeKind })
    } else if (isOutputFailureOutcome(outcomeKind)) {
      emitDiagnostic(this.diagnostics, { kind: 'output_failure', outcome: outcomeKind })
    }
  }
}

function isAvailabilityOutcome(kind: BridgePollOutcomeKind): kind is 'powerpoint_not_running' | 'no_slideshow' | 'com_unavailable' | 'helper_missing' | 'timeout' | 'process_exit' | 'closed' {
  return kind === 'powerpoint_not_running' || kind === 'no_slideshow' || kind === 'com_unavailable' || kind === 'helper_missing' || kind === 'timeout' || kind === 'process_exit' || kind === 'closed'
}

function isOutputFailureOutcome(kind: BridgePollOutcomeKind): kind is 'invalid_json' | 'invalid_payload' | 'oversized_response' {
  return kind === 'invalid_json' || kind === 'invalid_payload' || kind === 'oversized_response'
}
