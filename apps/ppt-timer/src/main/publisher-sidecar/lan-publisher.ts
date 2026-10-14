/**
 * LAN snapshot publisher (ISSUE-002 S9c). Publishes the SAME validated
 * candidates the cloud path publishes, through the SAME publish engine
 * (`createPublisher`: one in flight, spacing, material changes, heartbeat,
 * epoch/sequence recovery) — only the wire differs: instead of a callable it
 * sends a full `RemoteSnapshotV1` over a loopback Socket.IO link to the local
 * Companion hub. Nothing here touches timer math or cloud state.
 *
 * Independent of the cloud: its session ID and epoch/sequence are its own, a
 * LAN failure only changes the LAN status, and it never reads cloud results.
 * The socket/token mechanics live behind `LanConnector` (`lan-socket.ts`).
 */
import { randomBytes } from 'node:crypto'
import {
  DISCONNECT_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
  parseRemoteSnapshotV1,
  type PublishSnapshotRequestV1,
  type RemoteSnapshotCandidateV1,
  type RemoteSnapshotV1,
} from '@ontime/remote-viewer-contracts'
import type { LanConfig } from './lan-config'
import type { LanStatus } from './protocol'
import { createPublisher, type PublishResponse, type PublisherStatus, type ResumeResponse } from './publisher'
import { retryDelayMs } from './retry'

export type { LanStatus }

/** Companion's answer to one `REMOTE_SNAPSHOT_PUBLISH` (the fields this client needs). */
export type LanPublishResult = { timestamp: number } & (
  | { accepted: true; order: 'apply' | 'reset'; epoch: number; sequence: number }
  | { accepted: false; code: string; lastEpoch?: number; lastSequence?: number }
)

/** One admitted, loopback publisher connection. All methods settle; none throws. */
export type LanLink = {
  /** `null`: no answer (closed or timed out) — the caller must treat the link as dead. */
  publish(snapshot: RemoteSnapshotV1): Promise<LanPublishResult | null>
  /** Best effort `REMOTE_SNAPSHOT_END`; resolves once handed to the transport. */
  end(sessionId: string): Promise<void>
  close(): void
  onClose(listener: () => void): void
}
/** `permanent`: a refusal that retrying cannot fix (wrong room, not loopback, bad config). */
export type LanConnectResult = { ok: true; link: LanLink } | { ok: false; permanent: boolean }
/** Mints a fresh one-time token, connects, and admits as the publisher; one call per connection. */
export type LanConnector = (config: LanConfig) => Promise<LanConnectResult>

/** How long End waits to reach the Companion when the link happened to be down. */
export const END_CONNECT_TIMEOUT_MS = 3_000

const newSessionIdDefault = () => `lan_${randomBytes(12).toString('hex')}`

/** Pure: the cloud-path request fields plus the LAN's host-clock stamps → a full snapshot. */
export function toLanSnapshot(request: PublishSnapshotRequestV1, publishedAtMs: number): RemoteSnapshotV1 {
  const { sentAtEstimatedServerMs: _estimate, ...fields } = request
  // The sidecar runs on the Companion host: one clock domain, no network transit to subtract.
  return {
    ...fields,
    preCommitTransitMs: 0,
    publishedAtMs,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    staleAfterMs: STALE_AFTER_MS,
    disconnectAfterMs: DISCONNECT_AFTER_MS,
  } as RemoteSnapshotV1
}

/** Hub rejections that no retry can fix. */
const DENIED_CODES = new Set(['INVALID_SNAPSHOT', 'INVALID_PAYLOAD', 'ROOM_MISMATCH', 'NOT_LOOPBACK', 'SESSION_BOUND_TO_OTHER_ROOM'])

export function createLanPublisher(options: {
  config: LanConfig
  connect: LanConnector
  onStatus(status: LanStatus): void
  now?: () => number
  random?: () => number
  newSessionId?: () => string
}) {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const newSessionId = options.newSessionId ?? newSessionIdDefault
  /** A broken connector (throw or rejection) is just a failed attempt, never an unhandled error. */
  const connectSafely = async (): Promise<LanConnectResult> => {
    try {
      return await options.connect(options.config)
    } catch {
      return { ok: false, permanent: false }
    }
  }

  // Session identity survives Stop/Share (epoch+1, like the cloud's resume); End forgets it.
  let sessionId: string | null = null
  let epoch = 0
  let highestEpochSeen = 0
  let sentAny = false

  let run = 0
  let active = false
  let link: LanLink | null = null
  let linkEver = false
  let attempts = 0
  let connectPromise: Promise<void> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let publisher: ReturnType<typeof createPublisher> | null = null
  let publisherStatus: PublisherStatus | null = null
  let latest: RemoteSnapshotCandidateV1 | null = null
  let reported: LanStatus | null = null

  const emit = (status: LanStatus) => {
    if (status === reported) return
    reported = status
    options.onStatus(status)
  }
  /** Status while active, derived from link and engine state (the engine never sees link drops). */
  const report = () => {
    if (!active) return
    if (!link) return emit(attempts > 0 || linkEver ? 'retrying' : 'connecting')
    emit(publisherStatus === 'live' ? 'live' : publisherStatus === 'retrying' ? 'retrying' : 'connecting')
  }

  const clearReconnect = () => {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const halt = () => {
    run += 1
    active = false
    clearReconnect()
    publisher?.stop()
    publisher = null
    publisherStatus = null
    const closing = link
    link = null
    closing?.close()
  }

  function scheduleReconnect(token: number) {
    clearReconnect()
    if (token !== run || !active) return
    attempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connectOnce(token)
    }, retryDelayMs(attempts, random()))
  }

  function connectOnce(token: number): Promise<void> {
    if (connectPromise) return connectPromise
    const attempt = (async () => {
      const outcome = await connectSafely()
      if (token !== run || !active) {
        if (outcome.ok) outcome.link.close()
        return
      }
      if (!outcome.ok) {
        if (outcome.permanent) return failPermanently()
        scheduleReconnect(token)
        return report()
      }
      const connected = outcome.link
      link = connected
      linkEver = true
      attempts = 0
      connected.onClose(() => {
        if (link !== connected) return
        link = null
        scheduleReconnect(token)
        report()
      })
      report()
    })().finally(() => {
      connectPromise = null
    })
    connectPromise = attempt
    return attempt
  }

  function failPermanently() {
    halt()
    emit('unavailable')
  }

  /** Wire the shared engine to the LAN link. */
  async function send(request: PublishSnapshotRequestV1, token: number): Promise<PublishResponse> {
    let current = link
    if (!current && connectPromise) {
      await connectPromise
      current = link
    }
    if (!current || token !== run) return { ok: false, reason: 'transient' }
    const snapshot = toLanSnapshot(request, now())
    if (!parseRemoteSnapshotV1(snapshot).ok) return { ok: false, reason: 'denied' }
    sentAny = true
    const result = await current.publish(snapshot)
    if (token !== run) return { ok: false, reason: 'transient' }
    if (result === null) {
      current.close()
      return { ok: false, reason: 'transient' }
    }
    if (result.accepted) return { ok: true, acceptedSequence: result.sequence, publishedAtMs: result.timestamp }
    return rejection(result, request, current)
  }

  function rejection(result: Extract<LanPublishResult, { accepted: false }>, request: PublishSnapshotRequestV1, current: LanLink): PublishResponse {
    const { code, lastEpoch, lastSequence } = result
    if (typeof lastEpoch === 'number') highestEpochSeen = Math.max(highestEpochSeen, lastEpoch)
    if (code === 'DUPLICATE' || code === 'REGRESSION') {
      if (typeof lastEpoch !== 'number' || typeof lastSequence !== 'number') return { ok: false, reason: 'transient' }
      if (lastEpoch > request.epoch) return { ok: false, reason: 'epoch-mismatch' }
      if (lastEpoch === request.epoch) return { ok: false, reason: 'sequence-conflict', acceptedSequence: lastSequence }
      return { ok: false, reason: 'transient' }
    }
    if (code === 'SESSION_ENDED') return { ok: false, reason: 'session-ended' }
    if (DENIED_CODES.has(code)) return { ok: false, reason: 'denied' }
    // UNAUTHORIZED_ROLE (the hub forgot the admission) and anything unknown: re-admit on a fresh link.
    current.close()
    return { ok: false, reason: 'transient' }
  }

  function onEngineStatus(status: PublisherStatus, token: number) {
    if (token !== run) return
    if (status === 'ended' || status === 'signed-out') {
      const final = status === 'ended' ? 'ended' : 'unavailable'
      if (status === 'ended') forgetSession()
      halt()
      return emit(final)
    }
    publisherStatus = status
    report()
  }

  function forgetSession() {
    sessionId = null
    epoch = 0
    highestEpochSeen = 0
    sentAny = false
  }

  /** One connect attempt with a deadline; a late success is closed. */
  async function connectWithin(timeoutMs: number): Promise<LanLink | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const attempt = connectSafely()
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        resolve(null)
      }, timeoutMs)
    })
    const winner = await Promise.race([attempt, deadline])
    clearTimeout(timer)
    if (winner === null || timedOut) {
      void attempt.then((late) => late.ok && late.link.close())
      return null
    }
    return winner.ok ? winner.link : null
  }

  return {
    /** Begin (or resume after Stop) LAN publishing; idempotent while active. */
    start() {
      if (active) return
      halt()
      active = true
      attempts = 0
      reported = null
      if (sessionId === null) {
        sessionId = newSessionId()
        epoch = 1
      } else {
        epoch = Math.max(epoch, highestEpochSeen) + 1
      }
      const token = run
      const id = sessionId
      publisher = createPublisher({
        sessionId: id,
        epoch,
        random,
        now,
        send: (request) => send(request, token),
        resume: async (): Promise<ResumeResponse> => {
          epoch = Math.max(epoch, highestEpochSeen) + 1
          return { ok: true, epoch }
        },
        onStatus: (status) => onEngineStatus(status, token),
      })
      report()
      if (latest) publisher.offer(latest)
      void connectOnce(token)
    },
    offer(candidate: RemoteSnapshotCandidateV1) {
      latest = candidate
      publisher?.offer(candidate)
    },
    /** Stop publishing but keep the LAN session; viewers go stale. */
    pause() {
      halt()
      latest = null
      emit('paused')
    },
    /**
     * Operator ended the share: tell the hub (viewers move to ended), forget the
     * session, close. Bounded; an unreachable Companion never blocks End.
     */
    async end() {
      const id = sessionId
      const publishedSomething = sentAny
      const held = link
      link = null
      halt()
      latest = null
      let target: LanLink | null = held
      if (id !== null && publishedSomething) {
        if (!target) target = await connectWithin(END_CONNECT_TIMEOUT_MS)
        await target?.end(id)
      }
      target?.close()
      forgetSession()
      emit('ended')
    },
  }
}
