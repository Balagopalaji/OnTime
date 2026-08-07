import { describe, expect, it } from 'vitest'
import { derivePowerPointRemainingMs } from './powerpoint-timing'

describe('derivePowerPointRemainingMs', () => {
  it('derives video remaining time without applying rundown overtime policy', () => {
    expect(derivePowerPointRemainingMs(33_000, 9_000)).toBe(24_000)
    expect(derivePowerPointRemainingMs(33_000, 34_000)).toBe(-1_000)
  })

  it('requires finite duration and elapsed observations', () => {
    expect(derivePowerPointRemainingMs(null, 1_000)).toBeNull()
    expect(derivePowerPointRemainingMs(33_000, undefined)).toBeNull()
    expect(derivePowerPointRemainingMs(Number.NaN, 1_000)).toBeNull()
  })
})
