import { describe, expect, it } from 'vitest'
import {
  buildDurationEditStateUpdates,
  buildMigrationTimerTuple,
  buildResetTimerProgressStateUpdates,
} from './firebase-timer-state-utils'

describe('Firebase timer tuple consistency helpers', () => {
  it('buildMigrationTimerTuple writes full tuple with currentTime in milliseconds', () => {
    const now = 5_000
    const tuple = buildMigrationTimerTuple(
      {
        activeTimerId: 'timer-1',
        isRunning: true,
        startedAt: 3_000,
        elapsedOffset: 200,
        progress: { 'timer-1': 150, 'timer-2': 700, bad: 'x' },
      },
      now,
    )

    expect(tuple).toEqual({
      activeTimerId: 'timer-1',
      isRunning: true,
      startedAt: 3_000,
      elapsedOffset: 150,
      currentTime: 2_150,
      lastUpdate: now,
      progress: { 'timer-1': 150, 'timer-2': 700 },
    })
  })

  it('buildMigrationTimerTuple preserves negative elapsed values (bonus time)', () => {
    const tuple = buildMigrationTimerTuple(
      {
        activeTimerId: 'timer-1',
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
        progress: { 'timer-1': -2_500 },
      },
      10_000,
    )

    expect(tuple.currentTime).toBe(-2_500)
    expect(tuple.elapsedOffset).toBe(-2_500)
  })

  it('buildMigrationTimerTuple keeps running tuple coherent when legacy elapsedOffset diverges from active progress', () => {
    const now = 8_000
    const tuple = buildMigrationTimerTuple(
      {
        activeTimerId: 'timer-1',
        isRunning: true,
        startedAt: 3_000,
        elapsedOffset: 99_999,
        progress: { 'timer-1': 250 },
      },
      now,
    )

    expect(tuple.elapsedOffset).toBe(250)
    expect(tuple.currentTime).toBe(5_250)
    expect(tuple.currentTime).toBe((tuple.elapsedOffset ?? 0) + (now - (tuple.startedAt ?? now)))
  })

  it('buildMigrationTimerTuple keeps paused tuple coherent when progress diverges from legacy elapsedOffset', () => {
    const tuple = buildMigrationTimerTuple(
      {
        activeTimerId: 'timer-1',
        isRunning: false,
        startedAt: null,
        elapsedOffset: 9_000,
        progress: { 'timer-1': 1_250 },
      },
      10_000,
    )

    expect(tuple.elapsedOffset).toBe(1_250)
    expect(tuple.currentTime).toBe(1_250)
  })

  it('buildMigrationTimerTuple prefers numeric active progress 0 over legacy elapsedOffset for paused timers', () => {
    const tuple = buildMigrationTimerTuple(
      {
        activeTimerId: 'timer-1',
        isRunning: false,
        startedAt: null,
        elapsedOffset: 7_500,
        progress: { 'timer-1': 0 },
      },
      10_000,
    )

    expect(tuple.elapsedOffset).toBe(0)
    expect(tuple.currentTime).toBe(0)
  })

  it('buildDurationEditStateUpdates resets active timer tuple for both v2 and legacy writes', () => {
    const now = 12_345

    expect(buildDurationEditStateUpdates(2, 'timer-1', true, true, now)).toEqual({
      'progress.timer-1': 0,
      elapsedOffset: 0,
      startedAt: now,
      currentTime: 0,
      lastUpdate: now,
    })

    expect(buildDurationEditStateUpdates(1, 'timer-1', true, false, now)).toEqual({
      'state.progress.timer-1': 0,
      'state.elapsedOffset': 0,
      'state.startedAt': null,
      'state.currentTime': 0,
      'state.lastUpdate': now,
    })
  })

  it('buildResetTimerProgressStateUpdates resets active timer tuple and timestamp for both v2 and legacy writes', () => {
    const now = 54_321

    expect(buildResetTimerProgressStateUpdates(2, 'timer-1', true, now)).toEqual({
      'progress.timer-1': 0,
      elapsedOffset: 0,
      startedAt: null,
      isRunning: false,
      currentTime: 0,
      lastUpdate: now,
    })

    expect(buildResetTimerProgressStateUpdates(1, 'timer-1', true, now)).toEqual({
      'state.progress.timer-1': 0,
      'state.elapsedOffset': 0,
      'state.startedAt': null,
      'state.isRunning': false,
      'state.currentTime': 0,
      'state.lastUpdate': now,
    })
  })
})
