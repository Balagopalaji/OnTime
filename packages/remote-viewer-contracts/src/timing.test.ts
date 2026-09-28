import { describe, expect, it } from 'vitest'
import {
  MAX_CLOCK_UNCERTAINTY_MS,
  computeAdvanceMs,
  computeObservationAgeMs,
  computePreCommitTransit,
  createServerClock,
  estimateServerNow,
  estimateServerOffsetMs,
  interpolateRow,
} from './timing'
import type { RemoteVideoRowV1 } from './snapshot-types'

const playing: RemoteVideoRowV1 = {
  ordinal: 0,
  status: 'playing',
  durationMs: 120_000,
  elapsedMsAtObservation: 30_000,
  remainingMsAtObservation: 90_000,
  isFocus: true,
}

describe('host/sidecar timing inputs', () => {
  it('measures observation age in the host clock domain and clamps a backwards host clock to zero', () => {
    // Defect: a negative age (host clock stepped back) makes viewers rewind.
    expect(computeObservationAgeMs(1_000, 1_250)).toBe(250)
    expect(computeObservationAgeMs(1_000, 900)).toBe(0)
  })

  it('estimates the server offset from the round-trip midpoint', () => {
    // Defect: using send or receive time alone biases the offset by the one-way latency.
    expect(estimateServerOffsetMs({ sentLocalMs: 1_000, receivedLocalMs: 1_400, serverNowMs: 51_200 })).toBe(50_000)
  })
})

describe('computePreCommitTransit (server)', () => {
  const policy = { staleAfterMs: 25_000 }

  it('measures transit from the estimated send instant to commit', () => {
    expect(computePreCommitTransit({ ...policy, sentAtEstimatedServerMs: 9_700, publishedAtMs: 10_000 })).toEqual({
      kind: 'measured',
      transitMs: 300,
    })
  })

  it('treats a small future estimate within clock uncertainty as zero transit', () => {
    expect(
      computePreCommitTransit({ ...policy, sentAtEstimatedServerMs: 10_000 + MAX_CLOCK_UNCERTAINTY_MS, publishedAtMs: 10_000 }),
    ).toEqual({ kind: 'measured', transitMs: 0 })
  })

  it('rejects a future estimate beyond clock uncertainty', () => {
    // Defect: a forged or badly skewed sidecar clock makes viewers under-count by seconds.
    expect(
      computePreCommitTransit({ ...policy, sentAtEstimatedServerMs: 10_001 + MAX_CLOCK_UNCERTAINTY_MS, publishedAtMs: 10_000 }),
    ).toEqual({ kind: 'future' })
  })

  it('clamps excessive transit to the stale window', () => {
    // Defect: an unbounded transit advances the countdown by minutes.
    expect(computePreCommitTransit({ ...policy, sentAtEstimatedServerMs: 0, publishedAtMs: 100_000 })).toEqual({
      kind: 'clamped',
      transitMs: 25_000,
    })
  })

  it('uses zero transit when the sidecar has no reliable offset', () => {
    // Defect: inventing transit time without a server-clock estimate over-advances.
    expect(computePreCommitTransit({ ...policy, sentAtEstimatedServerMs: null, publishedAtMs: 100_000 })).toEqual({
      kind: 'no-offset',
      transitMs: 0,
    })
  })
})

describe('viewer server clock', () => {
  it('estimates server now from a monotonic clock regardless of wall-clock skew', () => {
    // Defect: the viewer cross-subtracts its own wall clock from server instants, so a
    // ±5 minute skewed client shows a different countdown.
    const serverNowAtResolve = 1_790_000_000_000
    const skews = [-300_000, 0, 300_000]
    const estimates = skews.map((skew) => {
      const sentLocalMs = 5_000 + skew // arbitrary per-device monotonic origin
      const clock = createServerClock({ sentLocalMs, receivedLocalMs: sentLocalMs + 400, serverNowMs: serverNowAtResolve })
      return estimateServerNow(clock, sentLocalMs + 400 + 7_500)
    })
    // Midpoint model: the server instant maps to the round-trip midpoint (+200 ms before receipt).
    expect(estimates).toEqual([serverNowAtResolve + 7_700, serverNowAtResolve + 7_700, serverNowAtResolve + 7_700])
  })
})

describe('computeAdvanceMs', () => {
  const snapshot = { observationAgeMs: 40, preCommitTransitMs: 160, publishedAtMs: 10_000, staleAfterMs: 25_000 }

  it('sums observation age, pre-commit transit, and time since commit', () => {
    expect(computeAdvanceMs(snapshot, 11_000)).toBe(1_200)
  })

  it('never goes negative when the viewer estimate precedes the commit', () => {
    expect(computeAdvanceMs(snapshot, 9_000)).toBe(200)
  })

  it('stops advancing once the observation is stale-window old', () => {
    // Defect: interpolation keeps running after stale.
    expect(computeAdvanceMs(snapshot, 10_000 + 24_800)).toBe(25_000)
    expect(computeAdvanceMs(snapshot, 10_000 + 90_000)).toBe(25_000)
  })

  it('never advances an old observation beyond the stale window even when freshly committed', () => {
    // Defect: a heartbeat carrying a minutes-old cached observation drives rows to zero.
    expect(computeAdvanceMs({ ...snapshot, observationAgeMs: 90_000 }, 10_000)).toBe(25_000)
  })
})

describe('interpolateRow', () => {
  it('advances a playing row from its observation values', () => {
    expect(interpolateRow(playing, 1_500)).toEqual({ ...playing, elapsedMsNow: 31_500, remainingMsNow: 88_500 })
  })

  it('clamps at zero remaining and full duration without inventing ended', () => {
    // Defect: local interpolation declares the video ended or shows negative time.
    expect(interpolateRow(playing, 200_000)).toEqual({
      ...playing,
      elapsedMsNow: 120_000,
      remainingMsNow: 0,
    })
  })

  it.each(['ready', 'paused', 'ended'] as const)('does not advance a %s row', (status) => {
    const row: RemoteVideoRowV1 = { ...playing, status }
    expect(interpolateRow(row, 5_000)).toEqual({ ...row, elapsedMsNow: 30_000, remainingMsNow: 90_000 })
  })

  it('keeps unmeasured scalars null', () => {
    const row: RemoteVideoRowV1 = { ...playing, status: 'paused', durationMs: null, remainingMsAtObservation: null }
    expect(interpolateRow(row, 5_000)).toEqual({ ...row, elapsedMsNow: 30_000, remainingMsNow: null })
  })

  it('does not advance a playing row whose timing is unavailable', () => {
    const row: RemoteVideoRowV1 = {
      ...playing,
      durationMs: null,
      elapsedMsAtObservation: null,
      remainingMsAtObservation: null,
    }
    expect(interpolateRow(row, 5_000)).toEqual({ ...row, elapsedMsNow: null, remainingMsNow: null })
  })
})
