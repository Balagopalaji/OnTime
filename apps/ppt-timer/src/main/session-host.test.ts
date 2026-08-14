import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validatePowerPointResponse, type BridgePollOutcome, type PptBridgeClient, type PptBridgeClientOptions } from '@ontime/ppt-bridge'
import {
  createSessionHost,
  deriveMultipleInstanceWarning,
  deriveObservationMeta,
  projectHostView,
  type SessionHost,
} from './session-host'
import { DiagnosticsBuffer, type DiagMeta } from './diagnostics'
import { DEFAULT_SETTINGS } from './settings-schema'
import { createSettingsStore, type SettingsFs } from './settings-store'
import {
  POWERPOINT_ARMED_POLL_INTERVAL_MS,
  POWERPOINT_START_BURST_INTERVAL_MS,
  POWERPOINT_START_BURST_WINDOW_MS,
} from './playback-poll-policy'

const ext = { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 }

const meta: DiagMeta = {
  appVersion: '0.1.0-beta.1',
  helperVersion: '0.1.0-beta.1',
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
    expect(deriveObservationMeta(outcome)).toEqual({ selectedMediaId: 501, selectedMediaIndex: null, protocolVersion: 2, productVersion: null })
  })

  it('does not choose a video itself: no primaryVideoId means null even when video timing is present', () => {
    // playingOutcome carries videoPlaying/duration/elapsed but no primaryVideoId.
    expect(deriveObservationMeta(playingOutcome)).toEqual({ selectedMediaId: null, selectedMediaIndex: null, protocolVersion: null, productVersion: null })
  })

  it('keeps a reported protocol version through no_slideshow while the media id clears', () => {
    const outcome: BridgePollOutcome = {
      kind: 'no_slideshow',
      warnings: [],
      extensions: ext,
      observation: { state: 'foreground', inSlideshow: false, protocolVersion: 3 },
    }
    expect(deriveObservationMeta(outcome)).toEqual({ selectedMediaId: null, selectedMediaIndex: null, protocolVersion: 3, productVersion: null })
  })

  it('clears both on terminal / no-signal outcomes that carry no observation', () => {
    const cleared = { selectedMediaId: null, selectedMediaIndex: null, protocolVersion: null, productVersion: null }
    expect(deriveObservationMeta(null)).toEqual(cleared)
    expect(deriveObservationMeta({ kind: 'powerpoint_not_running', warnings: [], extensions: ext })).toEqual(cleared)
    expect(deriveObservationMeta({ kind: 'com_unavailable', warnings: [], extensions: ext })).toEqual(cleared)
    expect(deriveObservationMeta(failureOutcome)).toEqual(cleared)
    expect(deriveObservationMeta({ kind: 'closed', warnings: [], extensions: ext })).toEqual(cleared)
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

  it('P1-07 starts a restarted saved elapsed setting before the first view/poll', async () => {
    // Actual settings-store save/load (restart boundary) feeds the host option
    // that main.ts supplies before calling host.start().
    const files = new Map<string, string>()
    const fs: SettingsFs = {
      readFile: async (path) => files.get(path) ?? '',
      writeFile: async (path, data) => { files.set(path, data) },
      rename: async (from, to) => { files.set(to, files.get(from) ?? ''); files.delete(from) },
    }
    const beforeRestart = createSettingsStore({ filePath: '/settings.json', fs, now: () => 1 })
    await beforeRestart.save({ ...DEFAULT_SETTINGS, timingMode: 'elapsed' })
    const restarted = await createSettingsStore({ filePath: '/settings.json', fs, now: () => 2 }).load()
    expect(restarted.settings.timingMode).toBe('elapsed')

    const fake = makeFakeClient([playingOutcome])
    const host = createSessionHost({
      candidates: [],
      createClient: fake.create,
      pollIntervalMs: 1_000,
      timingMode: restarted.settings.timingMode,
    })
    host.start()
    expect(host.getView().state.kind).toBe('connecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getView().state).toMatchObject({ kind: 'playing', timeMs: 12_000 })
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

  it('holds one ambiguous startup pause until playing is confirmed', async () => {
    const paused: BridgePollOutcome = {
      ...playingOutcome,
      observation: {
        ...playingOutcome.observation,
        videoPlaying: false,
      },
    }
    const onView = vi.fn()
    const fake = makeFakeClient([paused, playingOutcome])
    const host = createSessionHost({
      candidates: [],
      createClient: fake.create,
      pollIntervalMs: 1_000,
      adaptivePolling: true,
      onView,
    })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getView().state.kind).toBe('connecting')

    await vi.advanceTimersByTimeAsync(200)
    expect(host.getView().state.kind).toBe('playing')
    expect(onView.mock.calls.map(([view]) => view.state.kind)).toEqual(['connecting', 'playing'])
    await host.shutdown()
  })

  it('uses the bounded burst and armed cadence through the session callback', async () => {
    const armed: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: {
        state: 'foreground',
        inSlideshow: true,
        instanceId: 1234,
        slideNumber: 3,
        title: 'Deck.pptx',
        videoDetected: true,
        videos: [
          { id: 10, duration: 10_000, elapsed: 0, status: 'playing', playing: true },
          { id: 20, duration: 10_000, elapsed: 0, status: 'paused', playing: false },
        ],
      },
    }
    const fake = makeFakeClient(Array.from({ length: 12 }, () => armed))
    const host = createSessionHost({ candidates: [], createClient: fake.create })
    host.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(fake.calls.poll).toBe(1)
    await vi.advanceTimersByTimeAsync(POWERPOINT_START_BURST_INTERVAL_MS)
    expect(fake.calls.poll).toBe(2)
    await vi.advanceTimersByTimeAsync(POWERPOINT_START_BURST_WINDOW_MS - POWERPOINT_START_BURST_INTERVAL_MS)
    expect(fake.calls.poll).toBe(11)
    await vi.advanceTimersByTimeAsync(POWERPOINT_ARMED_POLL_INTERVAL_MS - 1)
    expect(fake.calls.poll).toBe(11)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.calls.poll).toBe(12)
    await host.shutdown()
  })

  it('P0-01 publishes unavailable with no numeric time in the same poll as a critical partial-COM failure', async () => {
    const partialCom = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      instanceId: 1234,
      protocolVersion: 1,
      pptActive: true,
      inSlideshow: true,
      pptError: 'slideshow_state_unavailable',
    }))
    expect(partialCom.kind).toBe('com_unavailable')
    const fake = makeFakeClient([playingOutcome, partialCom])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getView().state).toMatchObject({ kind: 'playing', timeMs: 48_000 })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(host.getView().state.kind).toBe('unavailable')
    expect('timeMs' in host.getView().state).toBe(false)
  })

  it('P0-02 invalidates a live view when a running native payload has no positive instanceId', async () => {
    const missingIdentity = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      pptActive: true,
      inSlideshow: true,
      videoElapsed: 99_999,
    }))
    expect(missingIdentity.kind).toBe('invalid_payload')
    const fake = makeFakeClient([playingOutcome, missingIdentity])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getView().state.kind).toBe('playing')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(host.getView().state.kind).toBe('unavailable')
    expect('timeMs' in host.getView().state).toBe(false)
  })

  it('P0-03 keeps helper-selected label, status, scalar time, and diagnostics identity aligned', async () => {
    const raw = (videoBElapsed: number) => validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      instanceId: 1234,
      protocolVersion: 1,
      pptActive: true,
      inSlideshow: true,
      slideNumber: 3,
      title: 'Deck.pptx',
      videoDetected: true,
      primaryVideoId: 10,
      primaryVideoIndex: 0,
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videoRemaining: 9_000,
      videos: [
        { id: 10, name: 'helper-primary.mp4', duration: 10_000, elapsed: 1_000, remaining: 9_000, status: 'paused', playing: false },
        // No explicit status: elapsed movement is intentionally the only
        // playing evidence for this fixture.
        { id: 20, name: 'delta-inferred.mp4', duration: 10_000, elapsed: videoBElapsed, remaining: 10_000 - videoBElapsed, playing: false },
      ],
    }))
    const baseline = raw(1_000)
    const noPayload = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      instanceId: 1234,
      protocolVersion: 1,
      pptActive: true,
      inSlideshow: true,
      slideNumber: 3,
      title: 'Deck.pptx',
    }))
    const delta = raw(1_500)
    expect(baseline.kind).toBe('observation')
    expect(noPayload.kind).toBe('observation')
    expect(delta.kind).toBe('observation')

    const diagnostics = new DiagnosticsBuffer()
    const fake = makeFakeClient([baseline, noPayload, delta])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, diagnostics })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    // Baseline + no-payload polls: nothing is playing yet, so the helper primary
    // (id 10) is the focus and the legacy label/status/scalar are aligned.
    expect(host.getView().state).toMatchObject({
      kind: 'paused',
      selectedVideoId: 10,
      selectedVideoName: 'helper-primary.mp4',
      timeMs: 9_000,
    })
    await vi.advanceTimersByTimeAsync(1_000)

    // Delta poll: the delta-inferred video (id 20) is now the only playing video.
    // ISSUE-001 focus tracking selects the most-recently-started still-playing
    // video over a stale helper primary, and the large-timer scalar comes from
    // THAT video's own observed values (not the helper scalar which still names
    // id 10). Diagnostics identity is unaffected: it forwards the helper primary
    // verbatim and never the raw video names.
    expect(host.getView().state).toMatchObject({
      kind: 'playing',
      selectedVideoId: 20,
      selectedVideoName: 'delta-inferred.mp4',
      timeMs: 8_500, // focus video's own remaining (10_000 - 1_500), not helper scalar 9_000
      durationMs: 10_000,
    })
    const report = diagnostics.buildReport(meta)
    expect(report).toContain('selectedMediaId=10 selectedMediaIndex=0')
    expect(report).not.toContain('helper-primary.mp4')
    expect(report).not.toContain('delta-inferred.mp4')
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

  it('P2-04 surfaces a processCount warning even when COM HWND/PID is unavailable', async () => {
    const noComPid: BridgePollOutcome = {
      ...mismatchOutcome,
      observation: { ...mismatchOutcome.observation, comPid: undefined },
    }
    const fake = makeFakeClient([noComPid])
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
        primaryVideoIndex: 0,
        protocolVersion: 2,
        videos: [{ id: 501, name: 'intro.mp4', duration: 60_000, elapsed: 12_000, remaining: 48_000, status: 'playing', playing: true }],
      },
    }
    const fake = makeFakeClient([observed])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, diagnostics })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    const report = diagnostics.buildReport(meta)
    expect(report).toContain('slide=3 mediaCount=1 selectedMediaId=501 selectedMediaIndex=0')
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

  it('uses the helper-emitted product version for diagnostics metadata', async () => {
    const observed: BridgePollOutcome = {
      kind: 'observation',
      warnings: [],
      extensions: ext,
      observation: { ...playingOutcome.observation, protocolVersion: 1, productVersion: '0.1.0-beta.1' },
    }
    const fake = makeFakeClient([observed])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(host.getProtocolVersion()).toBe(1)
    expect(host.getHelperVersion()).toBe('0.1.0-beta.1')
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
    expect(report).toContain('slide=4 mediaCount=0 selectedMediaId=-- selectedMediaIndex=--')
  })
})

// ---------------------------------------------------------------------------
// ISSUE-001 — focus tracking through the live host (integration)
// ---------------------------------------------------------------------------
// Pure tracker rules live in focus-tracker.test.ts; this block covers the host
// wiring (transport poll -> tracker update -> focus-aware projection) and the
// end-to-end focus behavior across polls.
describe('createSessionHost multi-video focus (ISSUE-001)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** Build a protocol-v1 observation with explicit per-video entries. */
  const videoOutcome = (
    instanceId: number,
    slideNumber: number,
    videos: Array<{ id: number; name: string; duration: number; elapsed: number; status: 'playing' | 'paused' | 'ended'; playing: boolean }>,
  ): BridgePollOutcome => ({
    kind: 'observation',
    warnings: [],
    extensions: ext,
    observation: {
      state: 'foreground',
      inSlideshow: true,
      instanceId,
      slideNumber,
      totalSlides: 10,
      title: 'Deck.pptx',
      filename: 'Deck.pptx',
      protocolVersion: 1,
      videoDetected: true,
      primaryVideoId: videos[0]?.id,
      videos: videos.map((v) => ({ ...v, remaining: v.duration - v.elapsed })),
    },
  })

  it('focus follows the most-recently-started still-playing video', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 0, status: 'paused', playing: false },
    ])
    const poll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
      // b just started -> more recent -> becomes focus
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1, poll2])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(10)

    await vi.advanceTimersByTimeAsync(1_000)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
  })

  it('defaults to longest remaining and toggles to latest without polling', async () => {
    const fake = makeFakeClient([videoOutcome(1234, 3, [
      { id: 10, name: 'long', duration: 20_000, elapsed: 5_000, status: 'playing', playing: true },
      { id: 20, name: 'latest', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
    ])])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(10)
    expect(fake.calls.poll).toBe(1)

    host.setHeadlineMode('latest-started')
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
    expect(fake.calls.poll).toBe(1)
  })

  it('focus advances to the next still-playing video when the focus video ends', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 9_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
    ])
    const poll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 10_000, status: 'ended', playing: false },
      { id: 20, name: 'b', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1, poll2])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    const state = host.getView().state as { selectedVideoId?: number; kind: string; timeMs: number | null }
    expect(state.kind).toBe('playing')
    expect(state.selectedVideoId).toBe(20) // 10 ended -> 20 (still playing) takes over
    expect(state.timeMs).toBe(8_000)
  })

  it('returns to the helper-primary next-to-play video when nothing is playing', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    // Both paused now; the helper-primary id 10 is the next-to-play fallback.
    const poll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'paused', playing: false },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    const poll3 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'paused', playing: false },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    const fake = makeFakeClient([poll1, poll2, poll3])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, headlineMode: 'latest-started' })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((host.getView().state as { kind: string }).kind).toBe('playing')
    await vi.advanceTimersByTimeAsync(1_000)
    const state = host.getView().state as { selectedVideoId?: number; kind: string }
    expect(state.kind).toBe('paused')
    expect(state.selectedVideoId).toBe(10)
  })

  it('resets focus history when the slide changes', async () => {
    const slide3 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
    ])
    const slide4 = videoOutcome(1234, 4, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 5_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([slide3, slide4])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000, headlineMode: 'latest-started' })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    // New slide cold-start: lowest-elapsed wins -> id 20 (elapsed 1_000) over id 10 (5_000).
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
  })

  it('cold start with multiple already-playing videos picks lowest elapsed', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 7_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
  })

  it('keeps the focus stable across a timing-mode toggle without polling', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    const focusBefore = (host.getView().state as { selectedVideoId?: number }).selectedVideoId
    const pollsBefore = fake.calls.poll

    host.setTimingMode('elapsed')
    expect(fake.calls.poll).toBe(pollsBefore) // no new poll
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(focusBefore)
  })

  it('ended outranks a contradictory playing flag for focus selection', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 10_000, status: 'ended', playing: true }, // contradictory
    ])
    const fake = makeFakeClient([poll1])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(10)
  })

  // P0-1: focus history must reset on EVERY non-presentation transition, not
  // only on an instance/slide scope change. Slideshow stop/restart, unavailable,
  // and helper crash/recovery all return to the SAME instance + slide, so the
  // tracker's own scope-change check never fires and stale ranks would otherwise
  // survive the interruption.
  //
  // The script below is built so it can ONLY pass with the reset in place. Both
  // videos are already playing when the interlude begins, so both sit in the
  // tracker's `prevPlayingIds`. Without a reset neither counts as "newly
  // playing" afterwards, nothing re-ranks, and the pre-interlude focus (id 20)
  // survives; with the reset the next observation re-enters the cold-start path
  // and the lowest-elapsed rule picks id 10.
  //
  // TRAP (do not "simplify" this): a script whose eventual winner is PAUSED
  // before the interlude does NOT discriminate — its later playing transition
  // re-ranks it to the top with or without the reset, so the test passes against
  // the unfixed host. Both videos must stay playing across the interlude.
  const noSlideshowOutcome = (): BridgePollOutcome => ({
    kind: 'no_slideshow',
    warnings: [],
    extensions: ext,
    observation: { state: 'foreground', inSlideshow: false, instanceId: 1234 },
  })

  const focusId = (host: SessionHost): number | undefined =>
    (host.getView().state as { selectedVideoId?: number }).selectedVideoId

  /**
   * Drive the shared reset script up to (but not through) the interlude, so each
   * variant only has to supply the non-presentation outcome under test. Returns
   * the host with id 20 established as the pre-interlude focus.
   */
  const startResetScenario = async (interlude: BridgePollOutcome): Promise<SessionHost> => {
    const fake = makeFakeClient([
      // Poll 1 — cold start: only id 10 is playing, so it is ranked and focused.
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 0, status: 'paused', playing: false },
      ]),
      // Poll 2 — id 20 starts: newly playing, outranks id 10, becomes focus.
      // BOTH are now playing, which is what makes the script discriminating.
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
      ]),
      // Poll 3 — the non-presentation interlude under test.
      interlude,
      // Poll 4 — restart on the SAME instance + slide, both still playing, with
      // id 10 now the lowest-elapsed. Reset => cold start => id 10.
      // Stale ranks => id 20.
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 200, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 4_000, status: 'playing', playing: true },
      ]),
    ])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0) // poll 1
    expect(focusId(host)).toBe(10)
    await vi.advanceTimersByTimeAsync(1_000) // poll 2
    return host
  }

  /** Assert the interlude reset the history: the cold-start rule re-ran. */
  const expectFocusResetAfter = async (host: SessionHost): Promise<void> => {
    expect(focusId(host)).toBe(20) // pre-interlude focus (most recently started)
    await vi.advanceTimersByTimeAsync(1_000) // poll 3: interlude -> reset
    await vi.advanceTimersByTimeAsync(1_000) // poll 4: cold start re-runs
    // id 10 is the lowest-elapsed; a surviving id 20 rank would mean no reset.
    expect(focusId(host)).toBe(10)
  }

  it('P0-1 resets focus history on a same-instance/same-slide slideshow stop+restart', async () => {
    await expectFocusResetAfter(await startResetScenario(noSlideshowOutcome()))
  })

  it('P0-1 resets focus history on an unavailable (helper failure) interlude', async () => {
    await expectFocusResetAfter(await startResetScenario(failureOutcome))
  })

  it('P0-1 resets focus history on a powerpoint_not_running interlude (helper recovery)', async () => {
    const notRunning: BridgePollOutcome = { kind: 'powerpoint_not_running', warnings: [], extensions: ext }
    await expectFocusResetAfter(await startResetScenario(notRunning))
  })

  // P2-4: pin the intended pause->resume behavior. A genuine pause->resume (the
  // SAME video goes playing -> paused -> playing) re-ranks the video to the top
  // because the tracker treats the resume as a fresh "newly playing" transition.
  // This is the intended behavior: a resumed video is the most-recently-started
  // still-playing video. Standalone per-video false-pause stabilization now
  // lives at the host's normalized-state/focus projection boundary.
  it('P2-4 a paused-then-resumed video re-ranks as the most recent on resume', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
    ])
    // At poll1 both are seeded by the cold-start rule and id 20 (lowest elapsed)
    // takes focus. Now id 20 pauses and id 10 stays playing.
    const poll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    // The second contradictory sample crosses the standalone 350 ms pause
    // confirmation window, so this is a genuine pause rather than a false one.
    const poll3 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 3_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    // id 20 resumes -> it newly transitions to playing -> top rank -> focus again.
    const poll4 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 3_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 600, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1, poll2, poll3, poll4])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20) // cold lowest-elapsed
    await vi.advanceTimersByTimeAsync(1_000) // poll2: pause evidence starts, so 20 stays focused
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
    await vi.advanceTimersByTimeAsync(1_000) // poll3: sustained pause -> 10 is the only playing -> focus 10
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(10)
    await vi.advanceTimersByTimeAsync(1_000) // poll4: 20 resumes -> newly playing -> top rank -> focus 20
    expect((host.getView().state as { selectedVideoId?: number }).selectedVideoId).toBe(20)
  })

  it('holds a false pause on the focused video without changing the view or countdown source', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
    ])
    const poll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
    ])
    const fake = makeFakeClient([poll1, poll2])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    const state = host.getView().state as { kind: string; selectedVideoId?: number; timeMs?: number; videos?: Array<{ id?: number; status: string }> }
    expect(state).toMatchObject({ kind: 'playing', selectedVideoId: 20, timeMs: 9_500 })
    expect(state.videos?.find((video) => video.id === 20)?.status).toBe('playing')
  })

  it('does not re-rank a focused video after transient name/duration omission', async () => {
    const poll1 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 20_000, elapsed: 500, status: 'playing', playing: true },
    ])
    const completePoll2 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 20_000, elapsed: 500, status: 'paused', playing: false },
      { id: 30, name: 'c', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
    ])
    const poll2: BridgePollOutcome = completePoll2.kind === 'observation'
      ? {
          ...completePoll2,
          observation: {
            ...completePoll2.observation,
            videos: completePoll2.observation.videos?.map((video) =>
              video.id === 20 ? { ...video, name: undefined, duration: undefined } : video,
            ),
          },
        }
      : completePoll2
    const poll3 = videoOutcome(1234, 3, [
      { id: 10, name: 'a', duration: 10_000, elapsed: 3_000, status: 'playing', playing: true },
      { id: 20, name: 'b', duration: 20_000, elapsed: 600, status: 'playing', playing: true },
      { id: 30, name: 'c', duration: 10_000, elapsed: 1_500, status: 'playing', playing: true },
    ])
    const fake = makeFakeClient([poll1, poll2, poll3])
    const host = createSessionHost({
      candidates: [],
      createClient: fake.create,
      pollIntervalMs: 1_000,
      headlineMode: 'latest-started',
    })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(focusId(host)).toBe(20)
    await vi.advanceTimersByTimeAsync(1_000)
    const held = host.getView().state as { selectedVideoId?: number; videos?: Array<{ id?: number; status: string }> }
    expect(held.selectedVideoId).toBe(30)
    expect(held.videos?.find((video) => video.id === 20)?.status).toBe('playing')
    await vi.advanceTimersByTimeAsync(1_000)
    // If the omitted fields reset identity, id 20 looks newly started here and
    // incorrectly steals focus from id 30.
    expect(focusId(host)).toBe(30)
  })

  it('does not let a false pause on another video make its next raw playing sample steal focus', async () => {
    const polls = [
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 1_500, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 1_000, status: 'paused', playing: false },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 2_500, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 1_100, status: 'playing', playing: true },
      ]),
    ]
    const fake = makeFakeClient(polls)
    const host = createSessionHost({
      candidates: [],
      createClient: fake.create,
      pollIntervalMs: 1_000,
      headlineMode: 'latest-started',
    })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(focusId(host)).toBe(10)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(10)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(10)
  })

  it('moves focus after sustained pause evidence and re-ranks once on genuine resume', async () => {
    const polls = [
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 3_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 4_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 600, status: 'playing', playing: true },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 5_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 700, status: 'playing', playing: true },
      ]),
    ]
    const fake = makeFakeClient(polls)
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(focusId(host)).toBe(20)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(20) // below confirmation only
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(10) // genuine pause accepted
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(20) // one genuine resume re-rank
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(20) // steady playing does not re-rank again
  })

  it('reprojects a held pause from stableSource when timing mode changes', async () => {
    const fake = makeFakeClient([
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
      ]),
    ])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    host.setTimingMode('elapsed')
    const state = host.getView().state as { kind: string; selectedVideoId?: number; timeMs?: number; videos?: Array<{ id?: number; status: string }> }
    expect(state).toMatchObject({ kind: 'playing', selectedVideoId: 20, timeMs: 500 })
    expect(state.videos?.find((video) => video.id === 20)?.status).toBe('playing')
  })

  it('resets stabilization with focus across a non-presentation interlude', async () => {
    const fake = makeFakeClient([
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 0, status: 'paused', playing: false },
      ]),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 2_000, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'playing', playing: true },
      ]),
      noSlideshowOutcome(),
      videoOutcome(1234, 3, [
        { id: 10, name: 'a', duration: 10_000, elapsed: 200, status: 'playing', playing: true },
        { id: 20, name: 'b', duration: 10_000, elapsed: 500, status: 'paused', playing: false },
      ]),
    ])
    const host = createSessionHost({ candidates: [], createClient: fake.create, pollIntervalMs: 1_000 })
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(20)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(host.getView().state.kind).toBe('no_slideshow')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(focusId(host)).toBe(10)
  })
})
