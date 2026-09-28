import { describe, expect, it } from 'vitest'
import { activeCandidate, playingRow, presentationPayload, readyRow } from '../test/fixtures'
import { MATERIAL_TIMING_DELTA_MS, compareSnapshotOrder, isMaterialChange } from './ordering'
import { parseRemoteSnapshotCandidateV1 } from './parse-snapshot'
import type { RemoteSnapshotCandidateV1 } from './snapshot-types'

describe('compareSnapshotOrder', () => {
  const last = { epoch: 3, sequence: 10 }

  it.each([
    [null, { epoch: 1, sequence: 1 }, 'apply'],
    [null, { epoch: 4, sequence: 57 }, 'apply'],
    [last, { epoch: 3, sequence: 11 }, 'apply'],
    // Viewers may miss intermediate listener events; any newer same-epoch sequence applies.
    [last, { epoch: 3, sequence: 15 }, 'apply'],
    [last, { epoch: 3, sequence: 10 }, 'duplicate'],
    [last, { epoch: 3, sequence: 9 }, 'regression'],
    // Defect: a restarted host's sequence 1 is rejected as a regression.
    [last, { epoch: 4, sequence: 1 }, 'reset'],
    // Defect: an older session epoch resumes over the current one.
    [last, { epoch: 2, sequence: 99 }, 'regression'],
  ] as const)('last=%j incoming=%j → %s', (previous, incoming, expected) => {
    expect(compareSnapshotOrder(previous, incoming)).toBe(expected)
  })
})

function candidate(overrides: Record<string, unknown> = {}): RemoteSnapshotCandidateV1 {
  const parsed = parseRemoteSnapshotCandidateV1(activeCandidate(overrides))
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function withPayload(payloadOverrides: Record<string, unknown>, observedAtMs = 1_000_000): RemoteSnapshotCandidateV1 {
  return candidate({ observedAtMs, payload: presentationPayload(payloadOverrides) })
}

describe('isMaterialChange', () => {
  const base = withPayload({})

  it('publishes the first candidate', () => {
    expect(isMaterialChange(null, base)).toBe(true)
  })

  it('treats a playing row that advanced exactly with host time as non-material', () => {
    // Defect: every poll publishes, blowing the 5/s budget and Firestore cost.
    const next = withPayload(
      { videos: [playingRow({ elapsedMsAtObservation: 32_000, remainingMsAtObservation: 88_000 }), readyRow()] },
      1_002_000,
    )
    expect(isMaterialChange(base, next)).toBe(false)
  })

  it('publishes a playing timing correction beyond the threshold', () => {
    // Defect: a seek/scrub is hidden until the next heartbeat.
    const drift = MATERIAL_TIMING_DELTA_MS + 1
    const next = withPayload(
      { videos: [playingRow({ elapsedMsAtObservation: 32_000 + drift, remainingMsAtObservation: 88_000 - drift }), readyRow()] },
      1_002_000,
    )
    expect(isMaterialChange(base, next)).toBe(true)
  })

  it('ignores a correction at exactly the threshold', () => {
    const next = withPayload(
      {
        videos: [
          playingRow({
            elapsedMsAtObservation: 32_000 + MATERIAL_TIMING_DELTA_MS,
            remainingMsAtObservation: 88_000 - MATERIAL_TIMING_DELTA_MS,
          }),
          readyRow(),
        ],
      },
      1_002_000,
    )
    expect(isMaterialChange(base, next)).toBe(false)
  })

  it.each([
    ['availability/reason', candidate({ availability: 'source-unavailable', payload: { reason: 'no-slideshow' } })],
    ['slide number', withPayload({ slideNumber: 4 })],
    ['slide count', withPayload({ slideCount: 13 })],
    ['presentation state', withPayload({ presentationState: 'paused', videos: [playingRow({ status: 'paused' }), readyRow()] })],
    ['title', withPayload({ displayTitle: 'Evening Service' })],
    ['headline mode', withPayload({ headline: { focusedOrdinal: 0, mode: 'latest-started', timingMode: 'remaining' } })],
    ['timing mode', withPayload({ headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'elapsed' } })],
    [
      'focus',
      withPayload({
        headline: { focusedOrdinal: 1, mode: 'longest-remaining', timingMode: 'remaining' },
        videos: [playingRow({ isFocus: false }), readyRow({ isFocus: true })],
      }),
    ],
    ['video set', withPayload({ videos: [playingRow()] })],
    ['video order/ordinal', withPayload({ videos: [playingRow(), readyRow({ ordinal: 2 })] })],
    ['row status', withPayload({ videos: [playingRow(), readyRow({ status: 'ended' })] })],
    ['row duration', withPayload({ videos: [playingRow(), readyRow({ durationMs: 46_000 })] })],
    ['label', withPayload({ videos: [playingRow({ label: 'Other clip' }), readyRow()] })],
  ])('treats a %s change as material', (_label, next) => {
    expect(isMaterialChange(base, next)).toBe(true)
  })

  it('publishes a remaining-time correction even when elapsed tracks', () => {
    // Defect: the helper moves the end point and a remaining-mode headline stays wrong.
    const next = withPayload(
      { videos: [playingRow({ elapsedMsAtObservation: 32_000, remainingMsAtObservation: 80_000 }), readyRow()] },
      1_002_000,
    )
    expect(isMaterialChange(base, next)).toBe(true)
  })

  function pausedSlide(row: Record<string, unknown>, observedAtMs = 1_000_000): RemoteSnapshotCandidateV1 {
    const headline = { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' }
    const videos = [readyRow({ ordinal: 0, status: 'paused', remainingMsAtObservation: null, ...row })]
    return withPayload({ presentationState: 'paused', headline, videos }, observedAtMs)
  }

  it.each([
    // Defect: a scrub while paused (shown directly, never interpolated) waits for the heartbeat.
    ['scrub', { elapsedMsAtObservation: 10_000 }, { elapsedMsAtObservation: 70_000 }, true],
    // Defect: sub-threshold position noise on a paused video publishes every poll.
    ['jitter', { elapsedMsAtObservation: 10_000 }, { elapsedMsAtObservation: 10_040 }, false],
    ['timing appearing', { elapsedMsAtObservation: null }, { elapsedMsAtObservation: 0 }, true],
  ] as const)('handles a paused-row %s', (_label, before, after, expected) => {
    expect(isMaterialChange(pausedSlide(before), pausedSlide(after, 1_003_000))).toBe(expected)
  })

  it('detects drift that accumulates across polls when compared with the last published candidate', () => {
    // Defect: comparing against each previous poll hides slow drift below the threshold forever.
    const lastPublished = base
    let latest = base
    for (let tick = 1; tick <= 5; tick += 1) {
      const elapsed = 30_000 + tick * 1_000 + tick * 200 // 200 ms extra per 1 s poll
      latest = withPayload(
        { videos: [playingRow({ elapsedMsAtObservation: elapsed, remainingMsAtObservation: 120_000 - elapsed }), readyRow()] },
        1_000_000 + tick * 1_000,
      )
    }
    expect(isMaterialChange(lastPublished, latest)).toBe(true)
  })

  it('treats a connecting → connecting repeat as non-material', () => {
    const connecting = candidate({ availability: 'connecting', payload: null })
    expect(isMaterialChange(connecting, candidate({ availability: 'connecting', payload: null, observedAtMs: 9 }))).toBe(false)
  })
})
