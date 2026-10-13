/**
 * Sidecar publish engine (Deep Plan "Material transitions, polls, heartbeat,
 * and budget" and "Ordering and epoch"). One publish in flight plus one latest
 * candidate; material changes publish at once (spaced under the server's
 * 5/second limit), otherwise a 10 s heartbeat publishes the latest real host
 * observation. Server `details.reason` rejections drive sequence, clock, and
 * epoch recovery; transient failures back off with jitter.
 */
import {
  HEARTBEAT_INTERVAL_MS,
  computeObservationAgeMs,
  estimateServerOffsetMs,
  isMaterialChange,
  type PublishSnapshotRequestV1,
  type RemoteSnapshotCandidateV1,
} from '@ontime/remote-viewer-contracts'
import { retryDelayMs } from './retry'

/** Spacing between sends: 4/second stays under the 5/second/session limit. */
export const MIN_PUBLISH_INTERVAL_MS = 250

export type PublishResponse =
  | { ok: true; acceptedSequence: number; publishedAtMs: number }
  | { ok: false; reason: 'sequence-conflict'; acceptedSequence: number }
  | { ok: false; reason: 'clock-future'; serverNowMs: number }
  | { ok: false; reason: 'sequence-gap' | 'epoch-mismatch' | 'window-expired' | 'session-ended' | 'denied' | 'transient' }
export type ResumeResponse = { ok: true; epoch: number } | { ok: false; reason: 'session-ended' | 'denied' | 'transient' }
export type PublisherStatus = 'live' | 'retrying' | 'ended' | 'signed-out'

export function createPublisher(options: {
  sessionId: string
  epoch: number
  send(request: PublishSnapshotRequestV1): Promise<PublishResponse>
  /** Resume the session into a new epoch (sequence restarts at 1). */
  resume(): Promise<ResumeResponse>
  onStatus(status: PublisherStatus): void
  /** Host wall clock: the same domain as `observedAtMs`. */
  now?: () => number
  random?: () => number
}) {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  let epoch = options.epoch
  let nextSequence = 1
  let offsetMs: number | null = null
  let latest: RemoteSnapshotCandidateV1 | null = null
  let lastPublished: RemoteSnapshotCandidateV1 | null = null
  let sending: RemoteSnapshotCandidateV1 | null = null
  let due = false
  let needsResume = false
  let failures = 0
  let lastSentAt = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  let backingOff = false
  let stopped = false
  let status: PublisherStatus | null = null

  const setStatus = (next: PublisherStatus) => {
    if (next === status) return
    status = next
    options.onStatus(next)
  }
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    backingOff = false
  }
  /** One timer serves heartbeat, spacing, and retry; when it fires the latest candidate is due. */
  const arm = (delayMs: number, retry: boolean) => {
    clearTimer()
    backingOff = retry
    timer = setTimeout(() => {
      timer = null
      backingOff = false
      due = true
      pump()
    }, delayMs)
  }
  const stop = (final?: PublisherStatus) => {
    stopped = true
    clearTimer()
    if (final) setStatus(final)
  }
  const retry = (transient: boolean) => {
    failures += 1
    arm(!transient && failures === 1 ? 0 : retryDelayMs(failures, random()), true)
  }
  const fail = (reason: 'session-ended' | 'denied' | 'transient') => {
    if (reason !== 'transient') return stop(reason === 'session-ended' ? 'ended' : 'signed-out')
    setStatus('retrying')
    retry(true)
  }

  const pump = () => {
    if (stopped || sending || !due || !latest || backingOff) return
    const wait = lastSentAt + MIN_PUBLISH_INTERVAL_MS - now()
    if (wait > 0) return arm(wait, false)
    clearTimer()
    void publishLatest()
  }

  async function publishLatest() {
    sending = latest
    due = false
    try {
      if (needsResume) {
        const resumed = await options.resume()
        if (stopped) return
        if (!resumed.ok) return fail(resumed.reason)
        epoch = resumed.epoch
        nextSequence = 1
        lastPublished = null
        needsResume = false
        sending = latest
      }
      const candidate = sending as RemoteSnapshotCandidateV1
      const sentLocalMs = now()
      lastSentAt = sentLocalMs
      const response = await options.send({
        ...candidate,
        sessionId: options.sessionId,
        epoch,
        sequence: nextSequence,
        observationAgeMs: computeObservationAgeMs(candidate.observedAtMs, sentLocalMs),
        sentAtEstimatedServerMs: offsetMs === null ? null : sentLocalMs + offsetMs,
      })
      const receivedLocalMs = now()
      if (stopped) return
      if (response.ok) {
        nextSequence = response.acceptedSequence + 1
        lastPublished = candidate
        offsetMs = estimateServerOffsetMs({ sentLocalMs, receivedLocalMs, serverNowMs: response.publishedAtMs })
        failures = 0
        setStatus('live')
        if (!due) arm(HEARTBEAT_INTERVAL_MS, false)
        return
      }
      switch (response.reason) {
        case 'sequence-conflict':
          nextSequence = response.acceptedSequence + 1
          break
        case 'clock-future':
          offsetMs = estimateServerOffsetMs({ sentLocalMs, receivedLocalMs, serverNowMs: response.serverNowMs })
          break
        case 'sequence-gap':
        case 'epoch-mismatch':
        case 'window-expired':
          needsResume = true
          break
        default:
          return fail(response.reason)
      }
      retry(false)
    } finally {
      sending = null
      pump()
    }
  }

  return {
    /** Replace the latest candidate; publish now only if it changed materially. */
    offer(candidate: RemoteSnapshotCandidateV1) {
      if (stopped) return
      latest = candidate
      if (isMaterialChange(sending ?? lastPublished, candidate)) {
        due = true
        pump()
      }
    },
    /** Cancel heartbeat/retry; any in-flight result is ignored. */
    stop: () => stop(),
  }
}
