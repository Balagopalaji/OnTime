import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimerDisplayModel } from '@ontime/timer-face'
import type { LanSnapshotTransport } from './lan-snapshot-adapter'
import { createLanSessionFollower } from './lan-session-follower'

const ROOM = 'room-1'
const T0 = 1_790_000_000_000

const row = { ordinal: 0, label: 'Walk-in', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true }
const snapshot = (sessionId: string, overrides: Record<string, unknown> = {}) => ({
  schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId, epoch: 1, sequence: 1,
  observedAtMs: T0 - 100, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: T0,
  heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability: 'active',
  payload: {
    reason: 'presentation', presentationState: 'playing', slideNumber: 1, slideCount: 3,
    headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [row],
  },
  ...overrides,
})
const labelled = (label: string) => ({ ...snapshot('x').payload, videos: [{ ...row, label }] })
const envelope = (snap: unknown, timestamp = T0, roomId = ROOM) => ({ type: 'REMOTE_SNAPSHOT', roomId, snapshot: snap, timestamp })
const ended = (sessionId: string) => ({ type: 'REMOTE_SNAPSHOT_ENDED', roomId: ROOM, sessionId, timestamp: T0 })

function fakeRaw() {
  const connect = new Set<() => void>()
  const envelopes = new Set<(value: unknown) => void>()
  const access = new Set<() => void>()
  const close = vi.fn()
  const transport: LanSnapshotTransport = {
    onConnect: (handler) => (connect.add(handler), () => void connect.delete(handler)),
    onEnvelope: (handler) => (envelopes.add(handler), () => void envelopes.delete(handler)),
    onAccessEnded: (handler) => (access.add(handler), () => void access.delete(handler)),
    close,
  }
  return {
    transport,
    close,
    connect: () => connect.forEach((handler) => handler()),
    send: (value: unknown) => envelopes.forEach((handler) => handler(value)),
    endAccess: () => access.forEach((handler) => handler()),
    listeners: () => connect.size + envelopes.size + access.size,
  }
}

describe('LAN session follower', () => {
  let monotonic = 0
  let displays: TimerDisplayModel[] = []
  const last = () => displays[displays.length - 1]

  beforeEach(() => {
    vi.useFakeTimers()
    monotonic = 5_000
    displays = []
  })
  afterEach(() => vi.useRealTimers())

  const start = (raw = fakeRaw(), onAccessEnded = vi.fn()) => {
    const follower = createLanSessionFollower({ roomId: ROOM, transport: raw.transport, now: () => monotonic, onDisplay: (d) => displays.push(d), onAccessEnded })
    follower.start()
    return { follower, raw, onAccessEnded }
  }
  const advance = async (ms: number) => {
    monotonic += ms
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('shows connecting until a session is announced, then follows the session it announces', async () => {
    // Defect: the LAN viewer needs the session ID in the URL, which only the sidecar knows.
    const { raw } = start()
    expect(last()).toMatchObject({ connection: 'connecting', statusText: 'Connecting' })
    raw.send(envelope(snapshot('lan_aaaa')))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live', statusText: 'Playing', timeText: '01:29' })
  })

  it('ignores envelopes for other rooms and malformed session IDs', async () => {
    // Defect: another room's (or a forged-ID) snapshot becomes the display.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_aaaa'), T0, 'other-room'))
    raw.send(envelope(snapshot('../escape')))
    raw.send(envelope(snapshot('lan_aaaa', { publishedAtMs: 'soon' })))
    raw.send({ type: 'REMOTE_SNAPSHOT', roomId: ROOM })
    raw.send(null)
    await advance(500)
    expect(last()).toMatchObject({ connection: 'connecting' })
  })

  it('moves to the newest session when a bootstrap burst replays older cached sessions first', async () => {
    // Defect: the viewer sticks to a stale cached session that the hub still holds.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_old', { publishedAtMs: T0 - 30_000, observedAtMs: T0 - 30_100 }), T0))
    raw.send(envelope(snapshot('lan_new', { payload: labelled('Newest') }), T0))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live' })
    expect(last().disclosureRows[0]?.nameText).toBe('Newest')
  })

  it('does not flip back to an older session whose late envelope arrives afterwards', async () => {
    // Defect: two sessions in one room alternate on every message.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_new', { payload: labelled('Newest') })))
    raw.send(envelope(snapshot('lan_old', { publishedAtMs: T0 - 30_000, observedAtMs: T0 - 30_100, payload: labelled('Old') })))
    await advance(500)
    expect(last().disclosureRows[0]?.nameText).toBe('Newest')
  })

  it('shows ended when the followed session ends, keeps the socket open, and follows a later new session', async () => {
    // Defect: End closes the viewer's socket for good, so the next Share on the same room is never seen.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_aaaa')))
    raw.send(ended('lan_aaaa'))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'ended' })
    expect(raw.close).not.toHaveBeenCalled()
    monotonic += 10_000
    raw.send(envelope(snapshot('lan_bbbb', { publishedAtMs: T0 + 10_000, observedAtMs: T0 + 9_900 }), T0 + 10_000))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live' })
  })

  it('ignores an ended envelope for a session it is not following', async () => {
    // Defect: an old session ending blanks the live display.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_aaaa')))
    raw.send(ended('lan_zzzz'))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live' })
  })

  it('re-anchors the clock on reconnect and degrades on its own while silent', async () => {
    // Defect: a reconnect keeps a stale clock anchor, or silence never goes stale.
    const { raw } = start()
    raw.send(envelope(snapshot('lan_aaaa')))
    await advance(500)
    await advance(30_000)
    expect(last()).toMatchObject({ connection: 'stale' })
    raw.connect()
    raw.send(envelope(snapshot('lan_aaaa', { sequence: 2, publishedAtMs: T0 + 30_500, observedAtMs: T0 + 30_400 }), T0 + 30_500))
    await advance(500)
    expect(last()).toMatchObject({ connection: 'live' })
  })

  it('reports revoked access once, shows it, and closes the socket', async () => {
    // Defect: a revoked viewer keeps a dead socket and no way back to the pairing prompt.
    const { raw, onAccessEnded } = start()
    raw.send(envelope(snapshot('lan_aaaa')))
    raw.endAccess()
    await advance(500)
    expect(onAccessEnded).toHaveBeenCalledTimes(1)
    expect(raw.close).toHaveBeenCalled()
    expect(last()).toMatchObject({ connection: expect.not.stringMatching(/^live$/) })
  })

  it('access ending before any session still reaches the page', async () => {
    // Defect: a refused handshake with no snapshot yet leaves "Connecting" forever.
    const { raw, onAccessEnded } = start()
    raw.endAccess()
    expect(onAccessEnded).toHaveBeenCalledTimes(1)
    expect(raw.close).toHaveBeenCalled()
  })

  it('stop releases every listener, the ticker, and the socket exactly once', async () => {
    // Defect: StrictMode remount or route change leaks listeners/timers/sockets.
    const { follower, raw } = start()
    raw.send(envelope(snapshot('lan_aaaa')))
    await follower.stop()
    await follower.stop()
    expect(raw.listeners()).toBe(0)
    expect(raw.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const before = displays.length
    raw.send(envelope(snapshot('lan_aaaa', { sequence: 2 })))
    await advance(1_000)
    expect(displays.length).toBe(before)
  })
})
