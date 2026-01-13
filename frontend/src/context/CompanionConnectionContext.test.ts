import { describe, expect, it } from 'vitest'
import { getReconnectDelayMs } from './CompanionConnectionContext'

describe('getReconnectDelayMs', () => {
  it('returns immediate for the first attempt', () => {
    expect(getReconnectDelayMs(1)).toBe(0)
  })

  it('uses 2s for attempts 2-5', () => {
    expect(getReconnectDelayMs(2)).toBe(2000)
    expect(getReconnectDelayMs(5)).toBe(2000)
  })

  it('uses 10s for attempts 6 and up', () => {
    expect(getReconnectDelayMs(6)).toBe(10_000)
    expect(getReconnectDelayMs(20)).toBe(10_000)
  })
})
