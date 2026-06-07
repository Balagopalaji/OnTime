import { describe, expect, it } from 'vitest'
import {
  computeElapsed,
  computeCompanionElapsed,
  computeProgress,
  mergeProgress,
  computeRemaining,
} from './timer-utils'

// Stage 0 regression suite — locks the rules that recurring bugs have violated:
//  1. elapsed is never clamped (negative = bonus time)
//  2. cached progress merge: fresh data wins, cache only fills missing keys

describe('timer-utils: negative elapsed (bonus time) is never clamped', () => {
  it('computeElapsed preserves a negative elapsedOffset when paused', () => {
    expect(
      computeElapsed({ isRunning: false, startedAt: null, elapsedOffset: -5_000 }),
    ).toBe(-5_000)
  })

  it('computeElapsed preserves negative net elapsed while running', () => {
    const now = 100_000
    // bonus time: 8s of credit, only 3s elapsed since start => net -5s
    expect(
      computeElapsed(
        { isRunning: true, startedAt: now - 3_000, elapsedOffset: -8_000 },
        now,
      ),
    ).toBe(-5_000)
  })

  it('computeCompanionElapsed preserves negative currentTime', () => {
    const now = 100_000
    expect(
      computeCompanionElapsed(
        { isRunning: true, currentTime: -6_000, lastUpdate: now - 1_000 },
        now,
      ),
    ).toBe(-5_000)
  })

  it('computeProgress keeps the active timer negative (no clamp)', () => {
    const progress = computeProgress({
      isRunning: false,
      startedAt: null,
      elapsedOffset: -4_000,
      activeTimerId: 't1',
      progress: { t1: 0 },
    })
    expect(progress.t1).toBe(-4_000)
  })

  it('computeRemaining reports overtime past duration without clamping', () => {
    expect(computeRemaining(300_000, 305_000)).toBe(-5_000)
  })
})

describe('timer-utils: mergeProgress priority (fresh wins, cache fills gaps)', () => {
  // mergeProgress(base, priority) => priority overrides base on key conflicts.
  // Call site contract: mergeProgress(cachedProgress, freshProgress) so FRESH wins.
  it('fresh value overrides stale cached value for the same timer', () => {
    const cached = { t1: 999, t2: 50 }
    const fresh = { t1: 100 }
    expect(mergeProgress(cached, fresh)).toEqual({ t1: 100, t2: 50 })
  })

  it('cache only fills timers missing from fresh data', () => {
    const cached = { t2: 50, t3: 70 }
    const fresh = { t1: 100 }
    expect(mergeProgress(cached, fresh)).toEqual({ t1: 100, t2: 50, t3: 70 })
  })

  it('fresh negative (bonus) value wins over stale cached positive', () => {
    const cached = { t1: 1_000 }
    const fresh = { t1: -2_000 }
    expect(mergeProgress(cached, fresh)).toEqual({ t1: -2_000 })
  })
})

// TODO(rebuild/presentation-core): add a regression test for the live-cue `videos[]`
// empty-overwrite bug (edge-cases.md §7) once `mergeCueVideos` is extracted from
// UnifiedDataContext into a testable presentation-core module. It is the same
// merge-priority defect class as the progress merge above.
