import { describe, expect, it, vi } from 'vitest'
import type { PowerPointMachineResult } from '@ontime/presentation-core'
import { PowerPointSession } from '../src/index.js'
import type { BridgePollOutcome } from '../src/protocol.js'

const base = () => ({ warnings: [], extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 } })
const observation = (extra: Record<string, unknown> = {}): BridgePollOutcome => ({
  kind: 'observation', observation: { state: 'foreground', instanceId: 1, inSlideshow: true, title: 'Deck', ...extra }, ...base(),
})

describe('PowerPointSession', () => {
  it('maps outcomes and dispatches transitions synchronously with state stored first', () => {
    const transitions: PowerPointMachineResult[] = []
    const session = new PowerPointSession({ transport: { poll: vi.fn() }, onTransition: (result) => {
      expect(session.state).toBe(result.state)
      transitions.push(result)
    } })
    expect(session.acceptOutcome(observation()).state.sourceState.kind).toBe('presentation')
    expect(session.acceptOutcome({ kind: 'powerpoint_not_running', ...base() }).state.sourceState.kind).toBe('powerpoint_not_running')
    expect(session.acceptOutcome({ kind: 'no_slideshow', observation: { state: 'foreground', instanceId: 1, inSlideshow: false }, ...base() }).state.sourceState.kind).toBe('no_slideshow')
    expect(session.acceptOutcome({ kind: 'com_unavailable', ...base() }).state.sourceState.kind).toBe('unavailable')
    expect(transitions).toHaveLength(4)
  })

  it('P0-03 carries protocol and helper-owned primary identity into the normalized source snapshot', () => {
    const session = new PowerPointSession({ transport: { poll: vi.fn() } })
    const result = session.acceptOutcome(observation({
      protocolVersion: 1,
      primaryVideoId: 20,
      primaryVideoIndex: 1,
      videoDuration: 8_000,
      videoElapsed: 2_000,
      videoRemaining: 6_000,
      videos: [
        { id: 10, name: 'first', status: 'paused' },
        { id: 20, name: 'second', status: 'playing', playing: true },
      ],
    }))
    expect(result.state.sourceState).toMatchObject({
      kind: 'presentation',
      snapshot: { protocolVersion: 1, primaryVideoId: 20, primaryVideoIndex: 1 },
    })
  })

  it('maps every operational failure to unavailable and null/closed to inert', () => {
    const session = new PowerPointSession({ transport: { poll: vi.fn() } })
    for (const kind of ['helper_missing', 'timeout', 'process_exit', 'invalid_json', 'invalid_payload', 'oversized_response'] as const) {
      const result = session.acceptOutcome({ kind, ...base() })
      expect(result.action).toBeNull()
      expect(result.state.sourceState.kind).toBe('unavailable')
    }
    const before = session.state
    expect(session.acceptOutcome(null).state).toBe(before)
    expect(session.acceptOutcome({ kind: 'closed', ...base() }).state).toBe(before)
  })

  it('shares an in-flight transport poll and schedules only after the first interval', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (outcome: BridgePollOutcome) => void
      const poll = vi.fn(() => new Promise<BridgePollOutcome>((res) => { resolve = res }))
      const session = new PowerPointSession({ transport: { poll }, pollIntervalMs: 100, now: () => 42 })
      session.start()
      expect(poll).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(poll).toHaveBeenCalledTimes(1)
      const first = session.pollNow()
      expect(session.pollNow()).toBe(first)
      expect(poll).toHaveBeenCalledTimes(1)
      resolve(observation())
      await first
      vi.advanceTimersByTime(100)
      expect(poll).toHaveBeenCalledTimes(2)
      session.stopPolling()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses an adaptive delay after a completed poll without overlapping requests', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (outcome: BridgePollOutcome) => void
      const poll = vi.fn(() => new Promise<BridgePollOutcome>((res) => { resolve = res }))
      const session = new PowerPointSession({
        transport: { poll },
        pollIntervalMs: 100,
        pollIntervalFor: vi.fn(() => 20),
        now: () => 42,
      })
      session.start()
      vi.advanceTimersByTime(100)
      expect(poll).toHaveBeenCalledTimes(1)
      const first = session.pollNow()
      expect(session.pollNow()).toBe(first)
      resolve(observation())
      await first

      await vi.advanceTimersByTimeAsync(19)
      expect(poll).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(poll).toHaveBeenCalledTimes(2)
      session.stopPolling()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets an immediate poll schedule its adaptive follow-up', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (outcome: BridgePollOutcome) => void
      const poll = vi.fn(() => new Promise<BridgePollOutcome>((res) => { resolve = res }))
      const session = new PowerPointSession({
        transport: { poll },
        pollIntervalMs: 1_000,
        pollIntervalFor: vi.fn(() => 200),
      })
      const first = session.pollNow()
      session.start()
      resolve(observation())
      await first

      await vi.advanceTimersByTimeAsync(199)
      expect(poll).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(poll).toHaveBeenCalledTimes(2)
      session.stopPolling()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets adaptive policy state through null after a rejected poll before recovery', async () => {
    vi.useFakeTimers()
    try {
      let nowMs = 0
      const media = observation({
        videos: [{ id: 10, duration: 10_000, elapsed: 0, status: 'paused', playing: false }],
      })
      const poll = vi.fn()
        .mockResolvedValueOnce(media)
        .mockRejectedValueOnce(new Error('transport failed'))
        .mockResolvedValue(media)
      let hasObservedMedia = false
      const pollIntervalFor = vi.fn((outcome: BridgePollOutcome | null, _receivedNowMs: number) => {
        if (outcome === null) {
          hasObservedMedia = false
          return 30
        }
        const delay = hasObservedMedia ? 100 : 20
        hasObservedMedia = true
        return delay
      })
      const session = new PowerPointSession({
        transport: { poll },
        pollIntervalMs: 1_000,
        pollIntervalFor,
        now: () => nowMs,
      })

      const first = session.pollNow()
      session.start()
      await first
      expect(pollIntervalFor).toHaveBeenCalledWith(media, 0)

      nowMs = 20
      await vi.advanceTimersByTimeAsync(20)
      expect(poll).toHaveBeenCalledTimes(2)
      expect(pollIntervalFor.mock.calls[1]?.[0]).toBeNull()
      expect(pollIntervalFor.mock.calls[1]?.[1]).toBe(20)
      expect(session.state.sourceState.kind).toBe('unavailable')

      nowMs = 50
      await vi.advanceTimersByTimeAsync(29)
      expect(poll).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(poll).toHaveBeenCalledTimes(3)
      expect(pollIntervalFor.mock.calls[2]?.[0]).toBe(media)

      // The recovery used the reset/cold delay (20 ms), not the stale 100 ms
      // continuation delay that the first observation would otherwise set.
      nowMs = 70
      await vi.advanceTimersByTimeAsync(19)
      expect(poll).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(poll).toHaveBeenCalledTimes(4)
      await session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows stop/start, but close is terminal and closes transport once', async () => {
    const close = vi.fn()
    const poll = vi.fn(() => Promise.resolve<BridgePollOutcome>(observation()))
    const session = new PowerPointSession({ transport: { poll, close } })
    session.start()
    expect(session.isPolling()).toBe(true)
    session.stopPolling()
    expect(session.isPolling()).toBe(false)
    session.start()
    await session.close()
    await session.close()
    expect(close).toHaveBeenCalledTimes(1)
    expect(session.isPolling()).toBe(false)
    await expect(session.pollNow()).resolves.toBeUndefined()
    session.start()
    expect(session.isPolling()).toBe(false)
  })

  it('exposes compatibility candidate and synchronize events', () => {
    const session = new PowerPointSession({ transport: { poll: vi.fn() } })
    const snapshot = { instanceId: 8, title: 'Deck' }
    expect(session.acceptCandidate(snapshot, 0).action).toBeNull()
    expect(session.synchronizeCommittedSnapshot(snapshot).action).toBeNull()
    expect(session.state.announcedSnapshot).toEqual(snapshot)
    expect(session.synchronizeCommittedSnapshot(null).state.activePresentation).toBeNull()
  })
})
