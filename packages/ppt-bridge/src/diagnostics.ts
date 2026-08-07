import type { BridgePollOutcome, ValidationWarningCode } from './protocol.js'

export type BridgeDiagnosticEvent =
  | { kind: 'helper_start'; generation: number }
  | { kind: 'helper_exit'; generation: number; expected: boolean; code?: number; signal?: 'sigterm' | 'sigkill' | 'other' }
  | { kind: 'helper_timeout'; generation: number; timeoutMs: number }
  | { kind: 'helper_restart'; attempt: number; delayMs: number }
  | { kind: 'helper_close'; phase: 'requested' | 'graceful' | 'forced' }
  | { kind: 'helper_termination'; generation: number; context: 'generation_failure' | 'close'; result: 'confirmed' | 'unconfirmed'; waitMs: number }
  | { kind: 'helper_stderr'; generation: number; byteCount: number }
  | { kind: 'poll_slow'; generation: number; elapsedMs: number; outcome: BridgePollOutcomeKind }
  | { kind: 'validation_warning'; code: ValidationWarningCode; path: string }
  | { kind: 'availability'; outcome: 'powerpoint_not_running' | 'no_slideshow' | 'com_unavailable' | 'helper_missing' | 'timeout' | 'process_exit' | 'closed' }
  | { kind: 'output_failure'; outcome: 'invalid_json' | 'invalid_payload' | 'oversized_response' }

export type BridgePollOutcomeKind = BridgePollOutcome['kind']

export type BridgeDiagnosticSink = (event: BridgeDiagnosticEvent) => void

export function emitDiagnostic(sink: BridgeDiagnosticSink | undefined, event: BridgeDiagnosticEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch {
    // A diagnostic sink is untrusted host code and must never break lifecycle cleanup.
  }
}
