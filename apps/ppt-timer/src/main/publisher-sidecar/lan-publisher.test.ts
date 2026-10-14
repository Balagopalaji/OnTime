import {
  DISCONNECT_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
  parseRemoteSnapshotV1,
  type RemoteSnapshotCandidateV1,
  type RemoteSnapshotV1,
} from '@ontime/remote-viewer-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanConfig } from './lan-config'
import { createLanPublisher, type LanConnectResult, type LanLink, type LanPublishResult, type LanStatus } from './lan-publisher'
import { MIN_PUBLISH_INTERVAL_MS } from './publisher'
import { retryDelayMs } from './retry'

const config: LanConfig = { companionUrl: 'http://127.0.0.1:4000', roomId: 'room-1' }
const header = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1 } as const
const unavailable = (observedAtMs: number, reason: 'no-presentation' | 'no-slideshow' = 'no-slideshow'): RemoteSnapshotCandidateV1 => ({
  ...header,
  observedAtMs,
  availability: 'source-unavailable',
  payload: { reason },
})

type PendingPublish = { snapshot: RemoteSnapshotV1; resolve: (result: LanPublishResult | null) => void }
type FakeLink = LanLink & { pending: PendingPublish[]; ended: string[]; closed: boolean; drop(): void; accept(index: number, timestamp?: number): Promise<void> }

function fakeLink(): FakeLink {
  const closeListeners: Array<() => void> = []
  const link: FakeLink = {
    pending: [],
    ended: [],
    closed: false,
    publish: (snapshot) => new Promise((resolve) => link.pending.push({ snapshot, resolve })),
    end: async (sessionId) => void link.ended.push(sessionId),
    close: () => {
      if (link.closed) return
      link.closed = true
      for (const pending of link.pending) pending.resolve(null)
      for (const listener of closeListeners) listener()
    },
    onClose: (listener) => void closeListeners.push(listener),
    drop: () => link.close(),
    accept: async (index, timestamp = Date.now()) => {
      const { snapshot, resolve } = link.pending[index]
      resolve({ accepted: true, order: 'apply', epoch: snapshot.epoch, sequence: snapshot.sequence, timestamp })
      await vi.advanceTimersByTimeAsync(0)
    },
  }
  return link
}

function harness(options: { connects?: Array<LanConnectResult | 'link'> } = {}) {
  const links: FakeLink[] = []
  const statuses: LanStatus[] = []
  const script = [...(options.connects ?? [])]
  const connect = vi.fn(async (_config: LanConfig): Promise<LanConnectResult> => {
    const next = script.shift() ?? 'link'
    if (next !== 'link') return next
    const link = fakeLink()
    links.push(link)
    return { ok: true, link }
  })
  let ids = 0
  const lan = createLanPublisher({
    config,
    connect,
    onStatus: (status) => statuses.push(status),
    random: () => 1,
    newSessionId: () => `lan_session_${++ids}`,
  })
  return { lan, links, statuses, connect }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
})
afterEach(() => vi.useRealTimers())

describe('LAN publisher: the same publish engine, a LAN wire', () => {
  it('connects, then publishes a strictly valid RemoteSnapshotV1 built from the cloud-path request fields', async () => {
    // Defect: a forked snapshot builder (own ages/limits) or an unvalidated payload reaches the hub.
    const { lan, links, statuses } = harness()
    lan.start()
    lan.offer(unavailable(99_400))
    await flush()
    expect(statuses).toEqual(['connecting'])
    const [link] = links
    expect(link.pending).toHaveLength(1)
    const sent = link.pending[0].snapshot
    expect(sent).toEqual({
      ...unavailable(99_400),
      sessionId: 'lan_session_1',
      epoch: 1,
      sequence: 1,
      observationAgeMs: 600,
      preCommitTransitMs: 0,
      publishedAtMs: 100_000,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      staleAfterMs: STALE_AFTER_MS,
      disconnectAfterMs: DISCONNECT_AFTER_MS,
    })
    expect(parseRemoteSnapshotV1(sent).ok).toBe(true)
    expect(sent).not.toHaveProperty('sentAtEstimatedServerMs')
    await link.accept(0)
    expect(statuses).toEqual(['connecting', 'live'])
  })

  it('reuses the publish engine policy: one in flight, spacing, latest material candidate, heartbeat', async () => {
    // Defect: LAN sends every poll or two sequences race, unlike the cloud path.
    const { lan, links } = harness()
    lan.start()
    lan.offer(unavailable(100_000, 'no-slideshow'))
    await flush()
    const [link] = links
    lan.offer(unavailable(100_010, 'no-presentation'))
    lan.offer(unavailable(100_020, 'no-slideshow'))
    lan.offer(unavailable(100_030, 'no-presentation'))
    expect(link.pending).toHaveLength(1)
    await link.accept(0)
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(link.pending.map((p) => p.snapshot.sequence)).toEqual([1, 2])
    expect(link.pending[1].snapshot.observedAtMs).toBe(100_030)
    await link.accept(1)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(link.pending.map((p) => p.snapshot.sequence)).toEqual([1, 2, 3])
  })

  it('uses the Companion result timestamp for the clock-offset sample, not a LAN-specific clock', async () => {
    // Defect: acceptance without a timestamp breaks the shared engine's offset estimate.
    const { lan, links } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0, 100_000)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(links[0].pending[1].snapshot.sequence).toBe(2)
  })
})

describe('LAN publisher: connection, reconnect, and end', () => {
  it('retries the connection with bounded backoff and a fresh connect attempt each time', async () => {
    // Defect: a failed connect is terminal, hot-loops, or reuses a spent one-time token.
    const { lan, links, statuses, connect } = harness({ connects: [{ ok: false, permanent: false }, { ok: false, permanent: false }] })
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(retryDelayMs(1, 1) - 1)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(retryDelayMs(2, 1))
    expect(connect).toHaveBeenCalledTimes(3)
    expect(links).toHaveLength(1)
    expect(statuses[0]).toBe('connecting')
    expect(statuses).toContain('retrying')
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS + 30_000)
    expect(links[0].pending.length).toBeGreaterThan(0)
  })

  it('caps the reconnect delay', async () => {
    // Defect: unbounded exponential backoff leaves LAN dark for minutes after a Companion restart.
    const failures = Array.from({ length: 12 }, () => ({ ok: false as const, permanent: false }))
    const { lan, connect } = harness({ connects: failures })
    lan.start()
    await flush()
    for (let attempt = 1; attempt <= 11; attempt += 1) await vi.advanceTimersByTimeAsync(retryDelayMs(attempt, 1))
    expect(connect).toHaveBeenCalledTimes(12)
    expect(retryDelayMs(12, 1)).toBeLessThanOrEqual(30_000)
  })

  it('reconnects after the socket drops, keeps the session and sequence, and does not re-announce a new session', async () => {
    // Defect: a drop restarts the epoch/sequence (viewers reset) or never reconnects.
    const { lan, links, statuses, connect } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0)
    links[0].drop()
    await flush()
    expect(statuses.at(-1)).toBe('retrying')
    await vi.advanceTimersByTimeAsync(retryDelayMs(1, 1))
    expect(connect).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('live')
    lan.offer(unavailable(100_500, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    const resumed = links[1].pending[0].snapshot
    expect(resumed).toMatchObject({ sessionId: 'lan_session_1', epoch: 1, sequence: 2 })
  })

  it('a publish whose socket drops mid-flight is retried on the new link, same sequence', async () => {
    // Defect: the lost response is treated as accepted (skipped sequence) or as a hard failure.
    const { lan, links } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    links[0].drop()
    await flush()
    await vi.advanceTimersByTimeAsync(retryDelayMs(1, 1) + MIN_PUBLISH_INTERVAL_MS)
    expect(links[1].pending[0].snapshot).toMatchObject({ sequence: 1, epoch: 1 })
  })

  it('a permanent admission refusal reports unavailable and stops retrying', async () => {
    // Defect: a wrong room / non-loopback refusal retries forever against Companion.
    const { lan, statuses, connect } = harness({ connects: [{ ok: false, permanent: true }] })
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe('unavailable')
  })

  it('pause closes the link, keeps the session, and a restart publishes a higher epoch in the same session', async () => {
    // Defect: Stop ends the LAN session, or Share again reuses the epoch (hub rejects as duplicate/regression).
    const { lan, links, statuses } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0)
    lan.pause()
    expect(links[0].closed).toBe(true)
    expect(links[0].ended).toEqual([])
    expect(statuses.at(-1)).toBe('paused')
    lan.start()
    lan.offer(unavailable(100_100))
    await flush()
    expect(links).toHaveLength(2)
    expect(links[1].pending[0].snapshot).toMatchObject({ sessionId: 'lan_session_1', epoch: 2, sequence: 1 })
  })

  it('end sends REMOTE_SNAPSHOT_END for the published session, then forgets it', async () => {
    // Defect: End leaves viewers waiting for staleness, or a later Share reuses the ended session ID.
    const { lan, links, statuses } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0)
    await lan.end()
    expect(links[0].ended).toEqual(['lan_session_1'])
    expect(links[0].closed).toBe(true)
    expect(statuses.at(-1)).toBe('ended')
    lan.start()
    lan.offer(unavailable(100_100))
    await flush()
    expect(links[1].pending[0].snapshot).toMatchObject({ sessionId: 'lan_session_2', epoch: 1, sequence: 1 })
  })

  it('end while disconnected makes one bounded attempt to deliver END', async () => {
    // Defect: End silently skips LAN when the socket happened to be down at that moment.
    const { lan, links, connect } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0)
    links[0].drop()
    await flush()
    await lan.end()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(links[1].ended).toEqual(['lan_session_1'])
  })

  it('end does not hang when the Companion is unreachable', async () => {
    // Defect: an unreachable Companion blocks End (and the shared shutdown) indefinitely.
    const { lan, links, statuses, connect } = harness()
    lan.start()
    lan.offer(unavailable(100_000))
    await flush()
    await links[0].accept(0)
    links[0].drop()
    await flush()
    connect.mockImplementation(() => new Promise(() => undefined))
    const ended = lan.end()
    await vi.advanceTimersByTimeAsync(10_000)
    await ended
    expect(statuses.at(-1)).toBe('ended')
  })

  it('end with nothing published sends nothing', async () => {
    // Defect: a hub END for an unknown session, or a connection opened just to say nothing.
    const { lan, connect, statuses } = harness()
    await lan.end()
    expect(connect).not.toHaveBeenCalled()
    expect(statuses.at(-1)).toBe('ended')
  })
})

describe('LAN publisher: hub rejections', () => {
  const rejected = (code: string, extra: Record<string, number> = {}) =>
    ({ accepted: false, code, timestamp: Date.now(), ...extra }) as LanPublishResult

  async function started() {
    const h = harness()
    h.lan.start()
    h.lan.offer(unavailable(100_000))
    await flush()
    return h
  }

  it('a same-epoch duplicate/regression resynchronises the next sequence from the hub', async () => {
    // Defect: the publisher repeats the rejected sequence forever.
    const { links } = await started()
    links[0].pending[0].resolve(rejected('REGRESSION', { lastEpoch: 1, lastSequence: 7 }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(links[0].pending[1].snapshot).toMatchObject({ epoch: 1, sequence: 8 })
  })

  it('a hub already at a higher epoch makes the publisher resume into a strictly higher epoch', async () => {
    // Defect: restart after a sidecar crash keeps losing to the cached epoch.
    const { links } = await started()
    links[0].pending[0].resolve(rejected('REGRESSION', { lastEpoch: 5, lastSequence: 40 }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(links[0].pending[1].snapshot).toMatchObject({ epoch: 6, sequence: 1 })
  })

  it('UNAUTHORIZED_ROLE drops the link and re-admits with a fresh connection', async () => {
    // Defect: a hub that forgot the admission (restart race) is retried on the same dead role.
    const { links, connect } = await started()
    links[0].pending[0].resolve(rejected('UNAUTHORIZED_ROLE'))
    await vi.advanceTimersByTimeAsync(0)
    expect(links[0].closed).toBe(true)
    await vi.advanceTimersByTimeAsync(retryDelayMs(2, 1) + MIN_PUBLISH_INTERVAL_MS)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it.each(['INVALID_SNAPSHOT', 'INVALID_PAYLOAD', 'ROOM_MISMATCH', 'NOT_LOOPBACK', 'SESSION_BOUND_TO_OTHER_ROOM'])('%s is not retried and reports unavailable', async (code) => {
    // Defect: a deterministic refusal is hammered at the hub every backoff tick.
    const { links, statuses } = await started()
    links[0].pending[0].resolve(rejected(code))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(links[0].pending).toHaveLength(1)
    expect(statuses.at(-1)).toBe('unavailable')
  })

  it('SESSION_ENDED reports ended', async () => {
    // Defect: a tombstoned session keeps publishing into the void and shows live.
    const { links, statuses } = await started()
    links[0].pending[0].resolve(rejected('SESSION_ENDED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe('ended')
  })

  it('a publish with no answer (null) drops the link instead of wedging', async () => {
    // Defect: one lost ack stalls LAN publication permanently.
    const { links, connect } = await started()
    links[0].pending[0].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(links[0].closed).toBe(true)
    await vi.advanceTimersByTimeAsync(retryDelayMs(2, 1) + MIN_PUBLISH_INTERVAL_MS)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
