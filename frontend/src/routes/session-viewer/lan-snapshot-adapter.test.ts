import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimerDisplayModel } from '@ontime/timer-face'
import { createLanSnapshotController, type LanSnapshotTransport } from './lan-snapshot-adapter'
import { createPresentationSessionController, type PresentationTransport } from './presentation-session-controller'

const ROOM = 'room-1'
const SESSION = 'sess_Abc123'
const COMPANION_T0 = 1_790_000_000_000

const row = { ordinal: 0, label: 'Walk-in', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true }
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: SESSION, epoch: 1, sequence: 1,
  observedAtMs: COMPANION_T0 - 100, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: COMPANION_T0,
  heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability: 'active',
  payload: {
    reason: 'presentation', presentationState: 'playing', slideNumber: 1, slideCount: 3,
    headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [row],
  },
  ...overrides,
})
const envelope = (snap: unknown, timestamp = COMPANION_T0, roomId = ROOM) => ({ type: 'REMOTE_SNAPSHOT', roomId, snapshot: snap, timestamp })

/** Fake Socket.IO boundary: the test drives connect/envelope/access events. */
function fakeLan() {
  const connect = new Set<() => void>()
  const envelopes = new Set<(value: unknown) => void>()
  const access = new Set<() => void>()
  const transport: LanSnapshotTransport = {
    onConnect: (handler) => (connect.add(handler), () => void connect.delete(handler)),
    onEnvelope: (handler) => (envelopes.add(handler), () => void envelopes.delete(handler)),
    onAccessEnded: (handler) => (access.add(handler), () => void access.delete(handler)),
    close: vi.fn(),
  }
  return {
    transport,
    connect: () => connect.forEach((handler) => handler()),
    send: (value: unknown) => envelopes.forEach((handler) => handler(value)),
    endAccess: () => access.forEach((handler) => handler()),
    listeners: () => connect.size + envelopes.size + access.size,
  }
}

describe('LAN snapshot adapter', () => {
  let monotonic = 0
  let displays: TimerDisplayModel[] = []
  const last = () => displays[displays.length - 1]

  beforeEach(() => {
    vi.useFakeTimers()
    monotonic = 5_000
    displays = []
  })
  afterEach(() => vi.useRealTimers())

  const start = (fake = fakeLan()) => {
    const controller = createLanSnapshotController({
      roomId: ROOM,
      sessionId: SESSION,
      transport: fake.transport,
      now: () => monotonic,
      onDisplay: (display) => displays.push(display),
    })
    controller.start()
    return { controller, fake }
  }
  const advance = async (ms: number) => {
    monotonic += ms
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('shows connecting until the bootstrap snapshot arrives, then runs on the Companion clock', async () => {
    const { fake } = start()
    await advance(500)
    expect(last()).toMatchObject({ connection: 'connecting', statusText: 'Connecting' })
    fake.send(envelope(snapshot()))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live', statusText: 'Playing', timeText: '01:29' })
  })

  it('reduces identical snapshots to the same display models as the cloud adapter (RPV-009)', async () => {
    const cloudDisplays: TimerDisplayModel[] = []
    let snapshotListener: ((doc: unknown) => void) | null = null
    const cloud: PresentationTransport = {
      resolve: async () => ({ customToken: 'c', serverNowMs: COMPANION_T0, activeWindowExpiresAtMs: COMPANION_T0 + 86_400_000 }),
      signIn: async () => {},
      onViewerState: (_id, next) => {
        next({ status: 'active', viewerGeneration: 1, activeWindowExpiresAtMs: COMPANION_T0 + 86_400_000 })
        return () => {}
      },
      onSnapshot: (_id, next) => {
        snapshotListener = next
        return () => {}
      },
      close: async () => {},
    }
    createPresentationSessionController({
      sessionId: SESSION,
      token: 'T'.repeat(43),
      createTransport: () => cloud,
      now: () => monotonic,
      random: () => 0.5,
      onDisplay: (display) => cloudDisplays.push(display),
    }).start()
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)

    const snap = snapshot({ epoch: 2, sequence: 4 })
    snapshotListener!({ snapshot: snap, cleanupAfterMs: COMPANION_T0 + 1 })
    fake.send(envelope(snap))
    const checkpoints = [0, 250, 10_000, 15_000, 1_000, 34_000]
    for (const ms of checkpoints) {
      await advance(ms)
      expect(last(), `after +${ms} ms`).toEqual(cloudDisplays[cloudDisplays.length - 1])
    }
    // The sequence crossed live -> stale -> disconnected on both adapters.
    expect(last().connection).toBe('disconnected')
  })

  it('applies the shared ordering rules: duplicates and regressions are ignored, higher epochs reset', async () => {
    const { fake } = start()
    fake.send(envelope(snapshot({ epoch: 2, sequence: 5 })))
    await advance(250)
    const before = last()
    fake.send(envelope(snapshot({ epoch: 2, sequence: 5, payload: { reason: 'no-slideshow' }, availability: 'source-unavailable' })))
    fake.send(envelope(snapshot({ epoch: 1, sequence: 99, payload: { reason: 'no-slideshow' }, availability: 'source-unavailable' })))
    await advance(250)
    expect(last().connection).toBe('live')
    expect(last().statusText).toBe(before.statusText)
    fake.send(envelope(snapshot({ epoch: 3, sequence: 1, payload: { reason: 'no-slideshow' }, availability: 'source-unavailable' })))
    await advance(250)
    expect(last().statusText).not.toBe(before.statusText)
  })

  it('ignores other rooms, other sessions, malformed envelopes, and snapshots the strict parser rejects', async () => {
    const { fake } = start()
    fake.send(envelope(snapshot(), COMPANION_T0, 'room-2'))
    fake.send(envelope(snapshot({ sessionId: 'sess_other' })))
    fake.send(envelope(snapshot({ fullName: 'C:\\Shows\\a.pptx' })))
    fake.send(envelope({ snapshot: snapshot() }))
    fake.send({ type: 'REMOTE_SNAPSHOT', roomId: ROOM, snapshot: snapshot() })
    fake.send({ type: 'PRESENTATION_UPDATE', roomId: ROOM, cue: {}, timestamp: COMPANION_T0 })
    fake.send(null)
    fake.send('REMOTE_SNAPSHOT')
    await advance(500)
    expect(last().connection).toBe('connecting')
  })

  it('moves to stale and disconnected on its own when the socket goes quiet, with no interpolation after stale', async () => {
    const { fake } = start()
    fake.send(envelope(snapshot()))
    await advance(24_000)
    expect(last().connection).toBe('live')
    await advance(2_000)
    expect(last().connection).toBe('stale')
    const frozen = last().timeText
    await advance(10_000)
    expect(last().timeText).toBe(frozen)
    await advance(30_000)
    expect(last().connection).toBe('disconnected')
  })

  it('re-anchors on reconnect: the fresh bootstrap timestamp replaces the old clock offset', async () => {
    const { fake } = start()
    fake.send(envelope(snapshot()))
    await advance(20_000)
    // The socket dropped and the local monotonic clock ran 280 s further than Companion's reported time.
    await advance(280_000)
    expect(last().connection).toBe('disconnected')
    fake.connect()
    const resumed = snapshot({ sequence: 2, observedAtMs: COMPANION_T0 + 64_900, publishedAtMs: COMPANION_T0 + 65_000 })
    fake.send(envelope(resumed, COMPANION_T0 + 65_000))
    await advance(250)
    expect(last().connection).toBe('live')
  })

  it('ends on a REMOTE_SNAPSHOT_ENDED for its session and releases its listeners', async () => {
    const { fake } = start()
    fake.send(envelope(snapshot()))
    await advance(250)
    fake.send({ type: 'REMOTE_SNAPSHOT_ENDED', roomId: ROOM, sessionId: 'sess_other', timestamp: COMPANION_T0 })
    await advance(250)
    expect(last().connection).toBe('live')
    fake.send({ type: 'REMOTE_SNAPSHOT_ENDED', roomId: ROOM, sessionId: SESSION, timestamp: COMPANION_T0 })
    expect(last().connection).toBe('ended')
    expect(fake.listeners()).toBe(0)
    expect(fake.transport.close).toHaveBeenCalledTimes(1)
    const shown = displays.length
    await advance(5_000)
    expect(displays.length).toBe(shown)
  })

  it('ends on revoked access, and stop() detaches everything exactly once', async () => {
    const revoked = start()
    revoked.fake.send(envelope(snapshot()))
    await advance(250)
    revoked.fake.endAccess()
    expect(last()).toMatchObject({ connection: 'ended', statusText: 'Access ended' })
    expect(revoked.fake.listeners()).toBe(0)

    displays = []
    const stopped = start()
    stopped.fake.send(envelope(snapshot()))
    await advance(250)
    await stopped.controller.stop()
    await stopped.controller.stop()
    expect(stopped.fake.listeners()).toBe(0)
    expect(stopped.fake.transport.close).toHaveBeenCalledTimes(1)
    const shown = displays.length
    await advance(5_000)
    expect(displays.length).toBe(shown)
  })
})
