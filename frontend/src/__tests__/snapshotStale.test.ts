import { describe, it, expect } from 'vitest'
import type { Room, Timer } from '../types'
import { isSnapshotStale, resolveSnapshotTimestamp } from '../context/UnifiedDataContext'

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
  it('treats running timers as stale after 30s when duration is unknown', () => {
    const running: Room['state'] = { ...baseState, isRunning: true, elapsedOffset: 1_000, startedAt: Date.now() - 1_000 }
    const now = 1_000_000
    expect(isSnapshotStale(running, now - 10_000, now)).toBe(false)
    expect(isSnapshotStale(running, now - 31_000, now)).toBe(true)
  })

  it('uses 3x duration cap when timer duration is known', () => {
    const running: Room['state'] = { ...baseState, isRunning: true, elapsedOffset: 1_000, startedAt: 0 }
    const timer: Timer = {
      id: 't1',
      roomId: 'r1',
      title: 'Timer',
      duration: 60,
      order: 10,
      type: 'countdown',
    }
    const now = 1_000_000
    expect(isSnapshotStale(running, now - 10_000, now, timer)).toBe(false)
    // 3x duration cap = 180s
    expect(isSnapshotStale(running, now - 200_000, now, timer)).toBe(true)
  })

  it('accounts for adjustment log when evaluating running timers', () => {
    const running: Room['state'] = { ...baseState, isRunning: true, elapsedOffset: 0, startedAt: 0 }
    const timer: Timer = {
      id: 't1',
      roomId: 'r1',
      title: 'Timer',
      duration: 60,
      order: 10,
      type: 'countdown',
      adjustmentLog: [
        { timestamp: 900_000, delta: 60_000, deviceId: 'controller-1', reason: 'manual' },
      ],
    }
    const now = 1_000_000
    expect(isSnapshotStale(running, 900_000, now, timer)).toBe(false)
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

describe('resolveSnapshotTimestamp', () => {
  // Regression for 7th-audit MINOR-1: a never-cached room carries
  // state.lastUpdate = 0 (companion getRoomState sentinel). The live snapshot
  // must anchor on the envelope timestamp, not be dropped as epoch-stale.
  it('uses the envelope timestamp when state.lastUpdate is 0 (never-cached room)', () => {
    expect(resolveSnapshotTimestamp(0, 5_000, 9_999)).toBe(5_000)
  })

  it('prefers a real state.lastUpdate over the envelope timestamp', () => {
    expect(resolveSnapshotTimestamp(2_000, 5_000, 9_999)).toBe(2_000)
  })

  it('falls back to now when both lastUpdate and envelope are 0/missing', () => {
    expect(resolveSnapshotTimestamp(0, 0, 9_999)).toBe(9_999)
    expect(resolveSnapshotTimestamp(undefined, undefined, 9_999)).toBe(9_999)
  })
})
