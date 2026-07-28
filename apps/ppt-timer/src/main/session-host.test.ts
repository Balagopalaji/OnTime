import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgePollOutcome, PptBridgeClient, PptBridgeClientOptions } from '@ontime/ppt-bridge'
import { createSessionHost, deriveMultipleInstanceWarning, deriveObservationMeta, projectHostView, type SessionHost } from './session-host'
import { DiagnosticsBuffer, type DiagMeta } from './diagnostics'

const ext = { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 }

const meta: DiagMeta = {
  appVersion: '0.0.0-beta',
  helperVersion: 'ppt-probe/native',
  protocolVersion: null,
  signingStatus: 'unsigned-beta',
}

const playingOutcome: BridgePollOutcome = {
  kind: 'observation',
  warnings: [],
  extensions: ext,
  observation: {
    state: 'foreground',
    inSlideshow: true,
    instanceId: 1234,
    slideNumber: 3,
    totalSlides: 10,
    title: 'Deck.pptx',
    filename: 'Deck.pptx',
    videoPlaying: true,
    videoDuration: 60_000,
    videoElapsed: 12_000,
    videoRemaining: 48_000,
    processCount: 1,
    selectedPid: 1234,
    comPid: 1234,
    affinityMismatch: false,
  },
}

const mismatchOutcome: BridgePollOutcome = {
  ...playingOutcome,
  observation: { ...playingOutcome.observation, processCount: 2, selectedPid: 1234, comPid: 5678, affinityMismatch: true },
}

const failureOutcome: BridgePollOutcome = { kind: 'process_exit', generation: 1, warnings: [], extensions: ext }

function makeFakeClient(outcomes: BridgePollOutcome[]) {
  const queue = [...outcomes]
  const calls = { poll: 0, close: 0 }
  const received: PptBridgeClientOptions[] = []
  const client: PptBridgeClient = {
    poll: async () => {
      calls.poll += 1
      return queue.shift() ?? ({ kind: 'closed', warnings: [], extensions: ext } as BridgePollOutcome)
    },
    close: async () => {
      calls.close += 1
    },
  }
  return { client, calls, received, create: (opts: PptBridgeClientOptions) => { received.push(opts); return client } }
}

describe('pure helpers', () => {
  it('deriveMultipleInstanceWarning reads the explicit signal and never infers from instanceId', () => {
    expect(deriveMultipleInstanceWarning(null)).toBe(false)
    expect(deriveMultipleInstanceWarning({ kind: 'powerpoint_not_running', warnings: [], extensions: ext })).toBe(false)
    expect(deriveMultipleInstanceWarning({ ...playingOutcome, observation: { ...playingOutcome.observation, affinityMismatch: false } })).toBe(false)
    expect(deriveMultipleInstanceWarning(mismatchOutcome)).toBe(true)
  })

  it('projectHostView never extrapolates: unavailable carries no numeric time (S-013/S-017)', () => {
    const view = projectHostView({ kind: 'unavailable' }, 'remaining', false)
    expect(view.kind).toBe('unavailable')
    expect('timeMs' in view).toBe(false)
  })
})

describe('deriveObservationMeta (S-026 D-1/D-2)', () => {
  it('carries the helper-emitted media id and protocol version from an observation', () => {
    const outcome: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: { ...playingOutcome.observation, primaryVideoId: 501, protocolVersion: 2 },
    }
    expect(deriveObservationMeta(outcome)).toEqual({ selectedMediaId: 501, protocolVersion: 2 })
  })

  it('does not choose a video itself: no primaryVideoId means null even when video timing is present', () => {
    // playingOutcome carries videoPlaying/duration/elapsed but no primaryVideoId.
    expect(deriveObservationMeta(playingOutcome)).toEqual({ selectedMediaId: null, protocolVersion: null })
  })

  it('keeps a reported protocol version through no_slideshow while the media id clears', () => {
    const outcome: BridgePollOutcome = {
      kind: 'no_slideshow',
      warnings: [],
      extensions: ext,
      observation: { state: 'foreground', inSlideshow: false, protocolVersion: 3 },
    }
    expect(deriveObservationMeta(outcome)).toEqual({ selectedMediaId: null, protocolVersion: 3 })
  })

  it('clears both on terminal / no-signal outcomes that carry no observation', () => {
    expect(deriveObservationMeta(null)).toEqual({ selectedMediaId: null, protocolVersion: null })
    expect(deriveObservationMeta({ kind: 'powerpoint_not_running', warnings: [], extensions: ext })).toEqual({ selectedMediaId: null, protocolVersion: null })
    expect(deriveObservationMeta({ kind: 'com_unavailable', warnings: [], extensions: ext })).toEqual({ selectedMediaId: null, protocolVersion: null })
    expect(deriveObservationMeta(failureOutcome)).toEqual({ selectedMediaId: null, protocolVersion: null })
    expect(deriveObservationMeta({ kind: 'closed', warnings: [], extensions: ext })).toEqual({ selectedMediaId: null, protocolVersion: null })
  })
})

describe('createSessionHost lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes the initial connecting view on start (S-001)', () => {
    const onView = vi.fn()
    const fake = makeFakeClient([playingOutcome])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, onView })
    host.start()
    expect(onView).toHaveBeenCalledTimes(1)
    expect(host.getView().state.kind).toBe('connecting')
  })

  it('projects a live state after the first poll and clears timing on failure (S-002/S-013)', async () => {
    const onView = vi.fn()
    const fake = makeFakeClient([playingOutcome, failureOutcome])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, onView })
    host.start()
    await vi.advanceTimersByTimeAsync(0) // resolve the immediate first pollNow

    expect(host.getView().state.kind).toBe('playing')
    expect(host.getView().state).toMatchObject({ kind: 'playing' })
    expect('timeMs' in host.getView().state ? (host.getView().state as { timeMs: number }).timeMs : null).toBe(48_000)

    await vi.advanceTimersByTimeAsync(1_000) // next interval poll -> failure outcome
    expect(host.getView().state.kind).toBe('unavailable')
    expect('timeMs' in host.getView().state).toBe(false) // numeric timing cleared
  })

  it('reprojects on a timing-mode toggle WITHOUT polling (S-014)', async () => {
    const onView = vi.fn()
    const fake = makeFakeClient([playingOutcome])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, onView })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    const pollsBefore = fake.calls.poll

    host.setTimingMode('elapsed')
    expect(fake.calls.poll).toBe(pollsBefore) // no new poll
    const view = host.getView().state as { kind: 'playing'; timeMs: number }
    expect(view.kind).toBe('playing')
    expect(view.timeMs).toBe(12_000) // elapsed, not remaining
  })

  it('surfaces the canonical affinity signal as the multi-instance warning (S-012)', async () => {
    const fake = makeFakeClient([mismatchOutcome])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getView().state.multipleInstanceWarning).toBe(true)
  })

  it('shuts down idempotently, closing the helper exactly once (S-024/S-027)', async () => {
    const fake = makeFakeClient([])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    const first = host.shutdown()
    const second = host.shutdown()
    expect(first).toBe(second)
    await first
    expect(fake.calls.close).toBe(1)
    // Further shutdowns are a no-op.
    await host.shutdown()
    expect(fake.calls.close).toBe(1)
  })

  it('forwards the executable candidates to the client (helper candidate policy)', () => {
    const fake = makeFakeClient([])
    const candidates = [{ executablePath: '/path/to/ppt-probe.exe' }]
    const host: SessionHost = createSessionHost({ candidates, createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    expect(fake.received[0]?.executableCandidates).toBe(candidates)
  })

  it('threads the canonical selected-media id into slide_observed (S-026 D-1)', async () => {
    const diagnostics = new DiagnosticsBuffer()
    const observed: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: {
        ...playingOutcome.observation,
        primaryVideoId: 501,
        protocolVersion: 2,
        videos: [{ id: 501, name: 'intro.mp4', duration: 60_000, elapsed: 12_000, remaining: 48_000, status: 'playing', playing: true }],
      },
    }
    const fake = makeFakeClient([observed])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, diagnostics })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    const report = diagnostics.buildReport(meta)
    expect(report).toContain('slide=3 mediaCount=1 selectedMediaId=501')
    // S-025: the raw video name never reaches diagnostics; only the numeric id.
    expect(report).not.toContain('intro.mp4')
  })

  it('surfaces the validated observation protocol version (S-026 D-2)', async () => {
    const observed: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: { ...playingOutcome.observation, protocolVersion: 2 },
    }
    const fake = makeFakeClient([observed])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getProtocolVersion()).toBe(2)
  })

  it('clears the protocol version on a terminal/no-signal transition (S-026 D-2)', async () => {
    const observed: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: { ...playingOutcome.observation, protocolVersion: 2 },
    }
    const fake = makeFakeClient([observed, failureOutcome])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getProtocolVersion()).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000) // next poll -> failure outcome (no observation)
    expect(host.getProtocolVersion()).toBeNull()
  })

  it('does not leave a stale selected-media id when a later slide emits none (S-026 D-1)', async () => {
    const diagnostics = new DiagnosticsBuffer()
    const slide3withId: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: {
        ...playingOutcome.observation,
        slideNumber: 3,
        primaryVideoId: 501,
        videos: [{ id: 501, name: 'intro.mp4', duration: 60_000, elapsed: 12_000, remaining: 48_000, status: 'playing', playing: true }],
      },
    }
    const slide4noId: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: {
        ...playingOutcome.observation,
        slideNumber: 4,
        videoDetected: false,
        videoPlaying: undefined,
        videoDuration: undefined,
        videoElapsed: undefined,
        videoRemaining: undefined,
      },
    }
    const fake = makeFakeClient([slide3withId, slide4noId])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, diagnostics })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000) // next poll -> slide 4 with no video / no primaryVideoId
    const report = diagnostics.buildReport(meta)
    expect(report).toContain('slide=3 mediaCount=1 selectedMediaId=501')
    expect(report).toContain('slide=4 mediaCount=0 selectedMediaId=--')
  })
})
