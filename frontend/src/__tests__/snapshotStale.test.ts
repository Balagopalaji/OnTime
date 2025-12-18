import { describe, it, expect } from 'vitest'
import type { Room } from '../types'
import { isSnapshotStale } from '../context/UnifiedDataContext'

const baseState: Room['state'] = {
  activeTimerId: null,
  isRunning: false,
  startedAt: null,
  elapsedOffset: 0,
  progress: {},
  showClock: false,
  clockMode: '24h',
  message: { text: '', visible: false, color: 'green' },
  currentTime: 0,
  lastUpdate: 0,
}

describe('isSnapshotStale', () => {
  it('treats running timers as stale after 30s', () => {
    const running: Room['state'] = { ...baseState, isRunning: true, elapsedOffset: 1_000, startedAt: Date.now() - 1_000 }
    const now = 1_000_000
    expect(isSnapshotStale(running, now - 10_000, now)).toBe(false)
    expect(isSnapshotStale(running, now - 31_000, now)).toBe(true)
  })

  it('allows paused timers with progress up to 24h', () => {
    const paused: Room['state'] = { ...baseState, isRunning: false, elapsedOffset: 5_000 }
    const now = 1_000_000
    expect(isSnapshotStale(paused, now - 1_000, now)).toBe(false)
    expect(isSnapshotStale(paused, now - 23 * 60 * 60 * 1000, now)).toBe(false)
    expect(isSnapshotStale(paused, now - 25 * 60 * 60 * 1000, now)).toBe(true)
  })

  it('never marks fresh timers without progress as stale', () => {
    const fresh: Room['state'] = { ...baseState }
    const now = 1_000_000
    expect(isSnapshotStale(fresh, now - 100_000_000, now)).toBe(false)
  })
})
