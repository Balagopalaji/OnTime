import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTimerEngine } from './useTimerEngine'

const base = {
  durationSec: 300,
  warningSec: 120,
  criticalSec: 30,
}

describe('useTimerEngine', () => {
  it('derives remaining time from elapsed offset', () => {
    const { result, rerender } = renderHook((props) => useTimerEngine(props), {
      initialProps: {
        ...base,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 60_000,
      },
    })

    expect(result.current.display).toBe('04:00')
    expect(result.current.status).toBe('default')

    rerender({
      ...base,
      isRunning: false,
      startedAt: null,
      elapsedOffset: 230_000,
    })

    expect(result.current.status).toBe('warning')

    rerender({
      ...base,
      isRunning: false,
      startedAt: null,
      elapsedOffset: 275_000,
    })

    expect(result.current.status).toBe('critical')
  })

  it('marks overtime when elapsed exceeds the duration', () => {
    const { result } = renderHook(() =>
      useTimerEngine({
        ...base,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 305_000,
      }),
    )

    expect(result.current.status).toBe('overtime')
    expect(result.current.display.startsWith('-00:')).toBe(true)
    expect(result.current.progress).toBeGreaterThan(1)
  })

  it('treats negative elapsed as bonus time (no clamp): remaining exceeds duration', () => {
    const { result } = renderHook(() =>
      useTimerEngine({
        ...base,
        isRunning: false,
        startedAt: null,
        elapsedOffset: -30_000, // 30s of bonus time
      }),
    )

    // duration 300s + 30s bonus => 5:30 remaining, default status (not clamped to 5:00)
    expect(result.current.remainingMs).toBe(330_000)
    expect(result.current.display).toBe('05:30')
    expect(result.current.status).toBe('default')
  })

  it('keeps progress under control for long-running timers', () => {
    const { result } = renderHook(() =>
      useTimerEngine({
        ...base,
        durationSec: 120,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 600_000,
      }),
    )

    expect(result.current.progress).toBeLessThanOrEqual(2)
  })
})
