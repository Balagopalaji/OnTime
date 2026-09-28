import { describe, expect, it } from 'vitest'
import { activeSnapshot, playingRow, presentationPayload, readyRow } from '../test/fixtures'
import {
  createViewerSession,
  projectViewerSession,
  reduceViewerSession,
  type ViewerSessionEvent,
  type ViewerSessionState,
} from './viewer-session'

const SESSION = 'sess_Abc123'
const PUBLISHED = 1_790_000_000_300

function snap(overrides: Record<string, unknown> = {}): ViewerSessionEvent {
  return { type: 'snapshot', data: activeSnapshot(overrides) }
}

function run(events: ViewerSessionEvent[]): ViewerSessionState {
  return events.reduce(reduceViewerSession, createViewerSession(SESSION))
}

describe('reduceViewerSession ordering', () => {
  it('starts connecting and becomes receiving on the first complete snapshot', () => {
    const initial = createViewerSession(SESSION)
    expect(projectViewerSession(initial, PUBLISHED)).toEqual({ connection: 'connecting' })
    const state = reduceViewerSession(initial, snap())
    expect(state.lastOutcome).toBe('applied')
    expect(state.snapshot?.sequence).toBe(7)
  })

  it('rejects duplicate and older same-epoch snapshots without changing state', () => {
    // Defect: a delayed listener event rolls the display back.
    const applied = run([snap({ sequence: 8 })])
    const duplicate = reduceViewerSession(applied, snap({ sequence: 8, observedAtMs: 1 }))
    expect(duplicate.lastOutcome).toBe('duplicate')
    expect(duplicate.snapshot).toBe(applied.snapshot)
    const older = reduceViewerSession(applied, snap({ sequence: 7 }))
    expect(older.lastOutcome).toBe('regression')
    expect(older.snapshot).toBe(applied.snapshot)
  })

  it('resets to a higher epoch starting at sequence one', () => {
    // Defect: host restart (new epoch, sequence 1) is rejected, freezing the viewer.
    const state = run([snap({ epoch: 2, sequence: 40 }), snap({ epoch: 3, sequence: 1, payload: presentationPayload({ slideNumber: 9 }) })])
    expect(state.lastOutcome).toBe('reset')
    expect(state.snapshot?.epoch).toBe(3)
    expect(state.snapshot?.sequence).toBe(1)
    const projection = projectViewerSession(state, PUBLISHED)
    expect(projection.connection === 'live' && projection.payload?.reason === 'presentation' && projection.payload.slideNumber).toBe(9)
  })

  it('rejects a lower epoch after reset', () => {
    const state = run([snap({ epoch: 3, sequence: 1 }), snap({ epoch: 2, sequence: 90 })])
    expect(state.lastOutcome).toBe('regression')
    expect(state.snapshot?.epoch).toBe(3)
  })

  it('rejects a snapshot for another session', () => {
    // Defect: a mis-scoped listener renders another show's timer.
    const state = run([snap({ sessionId: 'other_session' })])
    expect(state.lastOutcome).toBe('wrong-session')
    expect(state.snapshot).toBeNull()
  })

  it('ignores an invalid snapshot and keeps the previous one', () => {
    const applied = run([snap()])
    const state = reduceViewerSession(applied, { type: 'snapshot', data: { ...activeSnapshot({ sequence: 9 }), leaked: 'C:\\deck.pptx' } })
    expect(state.lastOutcome).toBe('invalid')
    expect(state.snapshot).toBe(applied.snapshot)
  })

  it.each([
    ['schemaMajor', 2],
    ['sourceKind', 'stage-timer'],
    ['sourceMajor', 2],
  ])('fails visibly on incompatible %s = %j', (key, value) => {
    // Defect: an unknown source or future major renders as PowerPoint v1.
    const state = run([snap(), { type: 'snapshot', data: { ...activeSnapshot({ sequence: 9 }), [key]: value } }])
    expect(state.lastOutcome).toBe('incompatible')
    expect(projectViewerSession(state, PUBLISHED)).toEqual({ connection: 'incompatible' })
  })

  it('treats ended and access-ended as terminal and drops timing', () => {
    // Defect: an ended session keeps showing or accepting a countdown.
    const ended = run([snap(), { type: 'session-ended' }, snap({ sequence: 99 })])
    expect(ended.lastOutcome).toBe('ignored')
    expect(projectViewerSession(ended, PUBLISHED)).toEqual({ connection: 'ended' })

    const revoked = run([snap(), { type: 'access-ended' }, snap({ sequence: 99 })])
    expect(projectViewerSession(revoked, PUBLISHED)).toEqual({ connection: 'access-ended' })
    expect(revoked.snapshot).toBeNull()
  })
})

describe('projectViewerSession freshness and interpolation', () => {
  // Fixture: observationAgeMs 40, preCommitTransitMs 180, publishedAtMs PUBLISHED.
  const state = run([snap()])

  function focusRow(now: number) {
    const projection = projectViewerSession(state, now)
    if (projection.connection !== 'live' && projection.connection !== 'stale' && projection.connection !== 'disconnected') {
      throw new Error(`unexpected ${projection.connection}`)
    }
    const payload = projection.payload
    if (payload?.reason !== 'presentation') throw new Error('expected presentation')
    return { connection: projection.connection, row: payload.videos[0], other: payload.videos[1] }
  }

  it('is live before the stale window and advances playing rows from the observation instant', () => {
    expect(focusRow(PUBLISHED + 1_000)).toEqual({
      connection: 'live',
      row: { ...playingRow(), elapsedMsNow: 31_220, remainingMsNow: 88_780 },
      other: { ...readyRow(), elapsedMsNow: null, remainingMsNow: null },
    })
  })

  // Freshness is measured from the host observation: age 40 + transit 180 + since commit.
  it('becomes stale 25 s after the observation and freezes the countdown at the boundary', () => {
    // Defect: a stale viewer keeps counting down as if PowerPoint were authoritative.
    expect(focusRow(PUBLISHED + 24_779).connection).toBe('live')
    const atStale = focusRow(PUBLISHED + 24_780)
    const later = focusRow(PUBLISHED + 40_000)
    expect(atStale.connection).toBe('stale')
    expect(later.connection).toBe('stale')
    expect(later.row.remainingMsNow).toBe(atStale.row.remainingMsNow)
    expect(atStale.row.remainingMsNow).toBe(90_000 - 25_000)
  })

  it('becomes disconnected 60 s after the observation', () => {
    expect(focusRow(PUBLISHED + 59_779).connection).toBe('stale')
    expect(focusRow(PUBLISHED + 59_780).connection).toBe('disconnected')
  })

  it('shows a freshly committed but stale-old observation as stale, not live', () => {
    // Defect: heartbeats re-sending a hung host's cached observation look live.
    const old = run([snap({ observationAgeMs: 30_000 })])
    expect(projectViewerSession(old, PUBLISHED).connection).toBe('stale')
  })

  it('returns to live on a newer heartbeat', () => {
    // Defect: a heartbeat with unchanged state is ignored, leaving the viewer stale.
    const refreshed = reduceViewerSession(state, snap({ sequence: 8, publishedAtMs: PUBLISHED + 30_000 }))
    expect(projectViewerSession(refreshed, PUBLISHED + 31_000).connection).toBe('live')
  })

  it('does not advance an unavailable source', () => {
    const unavailable = run([snap({ availability: 'source-unavailable', payload: { reason: 'helper-unavailable' } })])
    expect(projectViewerSession(unavailable, PUBLISHED + 1_000)).toEqual({
      connection: 'live',
      availability: 'source-unavailable',
      payload: { reason: 'helper-unavailable' },
    })
  })

  it('produces identical projections for identical snapshots regardless of transport or arrival order of duplicates', () => {
    // RPV-009: the same validated events reduce and project identically.
    const cloud = run([snap({ sequence: 7 }), snap({ sequence: 8, publishedAtMs: PUBLISHED + 500 })])
    const lan = run([snap({ sequence: 7 }), snap({ sequence: 7 }), snap({ sequence: 8, publishedAtMs: PUBLISHED + 500 })])
    expect(projectViewerSession(lan, PUBLISHED + 2_000)).toEqual(projectViewerSession(cloud, PUBLISHED + 2_000))
  })
})
