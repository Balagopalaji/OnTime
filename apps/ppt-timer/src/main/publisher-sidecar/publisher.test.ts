import { HEARTBEAT_INTERVAL_MS, type PublishSnapshotRequestV1, type RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_PUBLISH_INTERVAL_MS, createPublisher, type PublishResponse, type PublisherStatus, type ResumeResponse } from './publisher'
import { retryDelayMs } from './retry'

const header = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1 } as const
const unavailable = (observedAtMs: number, reason: 'no-presentation' | 'no-slideshow' = 'no-slideshow'): RemoteSnapshotCandidateV1 => ({
  ...header,
  observedAtMs,
  availability: 'source-unavailable',
  payload: { reason },
})

type Call = { request: PublishSnapshotRequestV1; resolve: (response: PublishResponse) => void }

function harness(options: { resume?: () => Promise<ResumeResponse> } = {}) {
  const calls: Call[] = []
  const statuses: PublisherStatus[] = []
  const resume = vi.fn(options.resume ?? (async (): Promise<ResumeResponse> => ({ ok: true, epoch: 2 })))
  const publisher = createPublisher({
    sessionId: 'session_1',
    epoch: 1,
    send: (request) => new Promise<PublishResponse>((resolve) => calls.push({ request, resolve })),
    resume,
    onStatus: (status) => statuses.push(status),
    now: () => Date.now(),
    random: () => 0.5,
  })
  const accept = async (index: number, publishedAtMs = Date.now()) => {
    calls[index].resolve({ ok: true, acceptedSequence: calls[index].request.sequence, publishedAtMs })
    await vi.advanceTimersByTimeAsync(0)
  }
  return { calls, statuses, resume, publisher, accept }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
})
afterEach(() => vi.useRealTimers())

describe('publisher send policy', () => {
  it('publishes the first candidate as a full snapshot with sequence 1 and a host-clock age', async () => {
    // Defect: the first event after connect is skipped or carries a restamped observation.
    const { calls, publisher } = harness()
    publisher.offer(unavailable(99_400))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.map((c) => c.request)).toEqual([
      { ...unavailable(99_400), sessionId: 'session_1', epoch: 1, sequence: 1, observationAgeMs: 600, sentAtEstimatedServerMs: null },
    ])
  })

  it('keeps one publish in flight and sends only the latest material candidate afterwards', async () => {
    // Defect: queued deltas (or every poll) are sent, or two publishes race for one sequence.
    const { calls, publisher, accept } = harness()
    publisher.offer(unavailable(100_000, 'no-slideshow'))
    await vi.advanceTimersByTimeAsync(0)
    publisher.offer(unavailable(100_010, 'no-presentation'))
    publisher.offer(unavailable(100_020, 'no-slideshow'))
    publisher.offer(unavailable(100_030, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    await accept(0)
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(calls.map((c) => [c.request.sequence, c.request.observedAtMs])).toEqual([
      [1, 100_000],
      [2, 100_030],
    ])
  })

  it('holds non-material polls for the heartbeat, which sends the latest real observation', async () => {
    // Defect: every poll publishes, or the heartbeat restamps the last cloud-sent numbers.
    const { calls, publisher, accept } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    await accept(0)
    publisher.offer(unavailable(101_000))
    publisher.offer(unavailable(102_000))
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS - 1)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls[1].request).toMatchObject({ sequence: 2, observedAtMs: 102_000, observationAgeMs: 110_000 - 102_000 })
  })

  it('spaces back-to-back material publishes under the server rate limit', async () => {
    // Defect: rapid slide changes exceed 5 calls/second and the limiter rejects the show's publishes.
    const { calls, publisher, accept } = harness()
    publisher.offer(unavailable(100_000, 'no-slideshow'))
    await vi.advanceTimersByTimeAsync(0)
    await accept(0)
    publisher.offer(unavailable(100_001, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS - 1)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
  })

  it('estimates the server offset from each accepted round trip for the next send', async () => {
    // Defect: transit uses an uncorrected local clock (or none), so viewers misjudge freshness.
    const { calls, publisher, accept } = harness()
    publisher.offer(unavailable(100_000, 'no-slideshow'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(200)
    await accept(0, 500_100) // midpoint 100_100 → offset +400_000
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    publisher.offer(unavailable(100_300, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[1].request.sentAtEstimatedServerMs).toBe(Date.now() + 400_000)
  })
})

describe('publisher rejection policy (server details.reason)', () => {
  it('advances past a sequence the server already committed', async () => {
    // Defect: a lost response followed by a newer body loops on the same sequence forever.
    const { calls, publisher } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason: 'sequence-conflict', acceptedSequence: 7 })
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(calls[1].request.sequence).toBe(8)
  })

  it('resyncs the clock offset from serverNowMs after clock-future', async () => {
    const { calls, publisher } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason: 'clock-future', serverNowMs: 40_000 })
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(calls[1].request.sentAtEstimatedServerMs).toBe(Date.now() - 60_000)
  })

  it.each(['sequence-gap', 'epoch-mismatch', 'window-expired'] as const)('resumes after %s into a new epoch at sequence 1', async (reason) => {
    // Defect: the sidecar keeps publishing into a dead epoch/window and viewers disconnect.
    const { calls, publisher, resume } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason })
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(calls[1].request).toMatchObject({ epoch: 2, sequence: 1 })
  })

  it.each([
    ['session-ended', 'ended'],
    ['denied', 'signed-out'],
  ] as const)('stops for good on %s', async (reason, status) => {
    const { calls, statuses, publisher } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason })
    publisher.offer(unavailable(100_001, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_INTERVAL_MS)
    expect(calls).toHaveLength(1)
    expect(statuses).toEqual([status])
  })

  it('retries transient failures with capped backoff, then reports live again', async () => {
    // Defect: an outage hot-loops the callable or never recovers.
    const { calls, statuses, publisher, accept } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason: 'transient' })
    await vi.advanceTimersByTimeAsync(retryDelayMs(1, 0.5) - 1)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    calls[1].resolve({ ok: false, reason: 'transient' })
    await vi.advanceTimersByTimeAsync(retryDelayMs(2, 0.5))
    expect(calls).toHaveLength(3)
    await accept(2)
    expect(statuses).toEqual(['retrying', 'live'])
    expect(calls.map((c) => c.request.sequence)).toEqual([1, 1, 1])
  })

  it('backs off repeated non-transient rejections instead of hot-looping', async () => {
    const { calls, publisher } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    calls[0].resolve({ ok: false, reason: 'sequence-conflict', acceptedSequence: 1 })
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    calls[1].resolve({ ok: false, reason: 'sequence-conflict', acceptedSequence: 2 })
    await vi.advanceTimersByTimeAsync(MIN_PUBLISH_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(retryDelayMs(2, 0.5))
    expect(calls).toHaveLength(3)
  })

  it('stop() cancels heartbeat and retry and ignores the in-flight result', async () => {
    // Defect: a stopped share keeps publishing (timers survive teardown).
    const { calls, statuses, publisher } = harness()
    publisher.offer(unavailable(100_000))
    await vi.advanceTimersByTimeAsync(0)
    publisher.stop()
    calls[0].resolve({ ok: false, reason: 'transient' })
    publisher.offer(unavailable(100_001, 'no-presentation'))
    await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_INTERVAL_MS)
    expect(calls).toHaveLength(1)
    expect(statuses).toEqual([])
  })
})

describe('retry backoff', () => {
  it('doubles from 1 s, caps at 30 s, and jitters within [50%, 100%]', () => {
    expect([1, 2, 3, 6, 20].map((n) => retryDelayMs(n, 1))).toEqual([1_000, 2_000, 4_000, 30_000, 30_000])
    expect(retryDelayMs(3, 0)).toBe(2_000)
  })
})
