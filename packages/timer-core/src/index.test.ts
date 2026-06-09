import { describe, expect, it } from 'vitest'
import {
  computeElapsed,
  computeCompanionElapsed,
  computeProgress,
  mergeProgress,
  computeRemaining,
} from './index'

// Stage 1a characterization suite copied with the allowlisted timer-core logic.
// It locks the Stage 0 regressions: no elapsed clamping and fresh progress wins.

describe('timer-core: negative elapsed (bonus time) is never clamped', () => {
  it('computeElapsed preserves a negative elapsedOffset when paused', () => {
    expect(
      computeElapsed({ isRunning: false, startedAt: null, elapsedOffset: -5_000 }, 100_000),
    ).toBe(-5_000)
  })

  it('computeElapsed preserves negative net elapsed while running', () => {
    const now = 100_000
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
    const progress = computeProgress(
      {
        isRunning: false,
        startedAt: null,
        elapsedOffset: -4_000,
        activeTimerId: 't1',
        progress: { t1: 0 },
      },
      100_000,
    )
    expect(progress.t1).toBe(-4_000)
  })

  it('computeRemaining reports overtime past duration without clamping', () => {
    expect(computeRemaining(300_000, 305_000)).toBe(-5_000)
  })
})

describe('timer-core: mergeProgress priority (fresh wins, cache fills gaps)', () => {
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
