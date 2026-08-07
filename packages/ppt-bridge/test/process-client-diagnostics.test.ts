import { describe, expect, it } from 'vitest'
import type { BridgeDiagnosticEvent } from '../src/diagnostics.js'
import { PollCompletionDiagnostics } from '../src/process-client-diagnostics.js'
import type { BridgePollOutcome } from '../src/protocol.js'

const outcomeFor = (kind: BridgePollOutcome['kind']): BridgePollOutcome => {
  const base = {
    warnings: [],
    extensions: {
      rootUnknownFieldCount: 0,
      videoUnknownFieldCount: 0,
      editSlideVideoUnknownFieldCount: 0,
    },
  }
  if (kind === 'observation') {
    return {
      ...base,
      kind,
      observation: {
        state: 'foreground',
        title: 'private presentation title',
        filename: 'C:\\private\\presentation.pptx',
      },
    }
  }
  if (kind === 'no_slideshow') {
    return { ...base, kind, observation: { state: 'background' } }
  }
  return { ...base, kind } as BridgePollOutcome
}

const record = (
  diagnostics: PollCompletionDiagnostics,
  kind: BridgePollOutcome['kind'],
  startedAt?: number,
  completedAt?: number,
) => diagnostics.record({ generation: 7, startedAt, completedAt, outcomeKind: outcomeFor(kind).kind })

describe('PollCompletionDiagnostics', () => {
  it('does not emit at or below the slow-poll threshold', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 1_000, 1_250)

    expect(events).toEqual([])
  })

  it('emits one sanitized slow event above the threshold', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 1_000, 1_251)

    expect(events).toEqual([{ kind: 'poll_slow', generation: 7, elapsedMs: 251, outcome: 'observation' }])
    expect(JSON.stringify(events)).not.toContain('private presentation')
    expect(JSON.stringify(events)).not.toContain('presentation.pptx')
  })

  it('suppresses another slow poll in the same generation during cooldown', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 1_000, 1_301)
    record(diagnostics, 'observation', 2_000, 2_302)

    expect(events).toHaveLength(1)
  })

  it('permits another slow event when cooldown expires', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 1_000, 1_301)
    record(diagnostics, 'observation', 6_000, 6_301)

    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ kind: 'poll_slow', generation: 7, elapsedMs: 301, outcome: 'observation' })
  })

  it('permits a new generation during the cooldown', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 1_000, 1_301)
    diagnostics.record({ generation: 8, startedAt: 1_300, completedAt: 1_601, outcomeKind: outcomeFor('observation').kind })

    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ kind: 'poll_slow', generation: 8, elapsedMs: 301, outcome: 'observation' })
  })

  it('treats backward timestamps as zero duration', () => {
    const events: BridgeDiagnosticEvent[] = []
    const diagnostics = new PollCompletionDiagnostics((event) => events.push(event))

    record(diagnostics, 'observation', 2_000, 1_000)

    expect(events).toEqual([])
  })

  it('retains availability and output-failure classification', () => {
    const availability = [
      'powerpoint_not_running',
      'no_slideshow',
      'com_unavailable',
      'helper_missing',
      'timeout',
      'process_exit',
      'closed',
    ] as const
    const outputFailures = ['invalid_json', 'invalid_payload', 'oversized_response'] as const

    for (const kind of availability) {
      const events: BridgeDiagnosticEvent[] = []
      record(new PollCompletionDiagnostics((event) => events.push(event)), kind)
      expect(events).toEqual([{ kind: 'availability', outcome: kind }])
    }
    for (const kind of outputFailures) {
      const events: BridgeDiagnosticEvent[] = []
      record(new PollCompletionDiagnostics((event) => events.push(event)), kind)
      expect(events).toEqual([{ kind: 'output_failure', outcome: kind }])
    }
  })
})
