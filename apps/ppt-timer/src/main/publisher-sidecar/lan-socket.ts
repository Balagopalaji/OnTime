/**
 * Loopback Socket.IO transport for the LAN publisher (ISSUE-002 S9c). One
 * `connect` = one fresh publisher-token mint (`POST /api/remote-snapshot/
 * publisher-token`, no browser headers), one Socket.IO connection to the local
 * Companion, and one `REMOTE_PUBLISHER_ADMIT`. The result is a `LanLink` that
 * exchanges only `REMOTE_SNAPSHOT_PUBLISH` / `_RESULT` / `_END`; it never joins
 * a room, so it can never receive viewer traffic or room state.
 *
 * This is the only sidecar module that imports `socket.io-client`.
 */
import { io as defaultIo } from 'socket.io-client'
import type { LanConfig } from './lan-config'
import type { LanConnectResult, LanConnector, LanLink, LanPublishResult } from './lan-publisher'

export const PUBLISHER_TOKEN_PATH = '/api/remote-snapshot/publisher-token'
/** Token mint, socket connect, and admit each give up after this long (then transient backoff). */
export const LAN_REQUEST_TIMEOUT_MS = 5_000
/** A publish with no result by now means the link is dead, not slow. */
export const LAN_PUBLISH_TIMEOUT_MS = 5_000
/** After END the socket is closed; give the websocket a moment to write it out first. */
const END_FLUSH_MS = 50

export type LanFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>

type IoFactory = typeof defaultIo
type Outcome<T> = { ok: true; value: T } | { ok: false; permanent: boolean }

/** Admission refusals retrying cannot fix; token states are transient (a fresh token is minted per attempt). */
const PERMANENT_ADMIT_CODES = new Set(['ROOM_MISMATCH', 'NOT_LOOPBACK', 'INVALID_PAYLOAD'])
const PERMANENT_MINT_STATUS = new Set([400, 403, 404, 405, 413])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Strict reader for `REMOTE_SNAPSHOT_PUBLISH_RESULT`; anything else is "no valid answer". */
export function parsePublishResult(raw: unknown): LanPublishResult | null {
  if (!isRecord(raw) || raw.type !== 'REMOTE_SNAPSHOT_PUBLISH_RESULT' || !isTimestamp(raw.timestamp)) return null
  if (raw.accepted === true) {
    const { order, epoch, sequence } = raw
    if ((order !== 'apply' && order !== 'reset') || !Number.isSafeInteger(epoch) || !Number.isSafeInteger(sequence)) return null
    return { accepted: true, order, epoch: epoch as number, sequence: sequence as number, timestamp: raw.timestamp }
  }
  if (raw.accepted !== false || typeof raw.code !== 'string') return null
  const { lastEpoch, lastSequence } = raw
  return {
    accepted: false,
    code: raw.code,
    ...(Number.isSafeInteger(lastEpoch) ? { lastEpoch: lastEpoch as number } : {}),
    ...(Number.isSafeInteger(lastSequence) ? { lastSequence: lastSequence as number } : {}),
    timestamp: raw.timestamp,
  }
}

export function createLanConnector(options: {
  fetch: LanFetch
  io?: IoFactory
  now?: () => number
  requestTimeoutMs?: number
  publishTimeoutMs?: number
}): LanConnector {
  const io = options.io ?? defaultIo
  const now = options.now ?? Date.now
  const requestTimeoutMs = options.requestTimeoutMs ?? LAN_REQUEST_TIMEOUT_MS
  const publishTimeoutMs = options.publishTimeoutMs ?? LAN_PUBLISH_TIMEOUT_MS

  async function mintToken(config: LanConfig): Promise<Outcome<string>> {
    try {
      const response = await options.fetch(new URL(PUBLISHER_TOKEN_PATH, config.companionUrl).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: config.roomId }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      if (response.status !== 200) return { ok: false, permanent: PERMANENT_MINT_STATUS.has(response.status) }
      const body = await response.json()
      if (!isRecord(body) || body.roomId !== config.roomId || typeof body.token !== 'string' || body.token.length === 0 || body.token.length > 256) {
        return { ok: false, permanent: false }
      }
      return { ok: true, value: body.token }
    } catch {
      return { ok: false, permanent: false }
    }
  }

  return async (config: LanConfig): Promise<LanConnectResult> => {
    const minted = await mintToken(config)
    if (!minted.ok) return minted

    const socket = io(config.companionUrl, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: requestTimeoutMs })
    let closed = false
    const closeListeners: Array<() => void> = []
    let settlePublish: ((result: LanPublishResult | null) => void) | null = null

    const markClosed = () => {
      if (closed) return
      closed = true
      settlePublish?.(null)
      socket.removeAllListeners()
      socket.disconnect()
      for (const listener of closeListeners) listener()
    }
    const failed = (permanent: boolean): LanConnectResult => {
      markClosed()
      return { ok: false, permanent }
    }

    /** Resolves on the first of `event`, a close, or the timeout; `null` means no answer. */
    const waitFor = <T>(event: string, map: (payload: unknown) => T | null) =>
      new Promise<T | null>((resolve) => {
        const timer = setTimeout(() => done(null), requestTimeoutMs)
        const onEvent = (payload: unknown) => done(map(payload))
        const onGone = () => done(null)
        const done = (value: T | null) => {
          clearTimeout(timer)
          socket.off(event, onEvent)
          socket.off('connect_error', onGone)
          socket.off('disconnect', onGone)
          resolve(value)
        }
        socket.on(event, onEvent)
        socket.on('connect_error', onGone)
        socket.on('disconnect', onGone)
      })

    if (!socket.connected) {
      const connected = await waitFor('connect', () => true)
      if (!connected) return failed(false)
    }
    const admission = waitFor('REMOTE_PUBLISHER_ADMIT_RESULT', (payload) => (isRecord(payload) && typeof payload.admitted === 'boolean' ? payload : null))
    socket.emit('REMOTE_PUBLISHER_ADMIT', { type: 'REMOTE_PUBLISHER_ADMIT', roomId: config.roomId, token: minted.value, timestamp: now() })
    const admitted = await admission
    if (!admitted) return failed(false)
    if (admitted.admitted !== true) return failed(PERMANENT_ADMIT_CODES.has(String(admitted.code)))

    socket.on('disconnect', markClosed)
    socket.on('REMOTE_SNAPSHOT_PUBLISH_RESULT', (payload: unknown) => settlePublish?.(parsePublishResult(payload)))

    const link: LanLink = {
      publish: (snapshot) =>
        new Promise<LanPublishResult | null>((resolve) => {
          if (closed) return resolve(null)
          const timer = setTimeout(() => {
            settle(null)
            markClosed()
          }, publishTimeoutMs)
          const settle = (result: LanPublishResult | null) => {
            clearTimeout(timer)
            if (settlePublish === settle) settlePublish = null
            resolve(result)
          }
          settlePublish = settle
          socket.emit('REMOTE_SNAPSHOT_PUBLISH', { type: 'REMOTE_SNAPSHOT_PUBLISH', roomId: config.roomId, snapshot, timestamp: now() })
        }),
      end: async (sessionId) => {
        if (closed) return
        socket.emit('REMOTE_SNAPSHOT_END', { type: 'REMOTE_SNAPSHOT_END', roomId: config.roomId, sessionId, timestamp: now() })
        await new Promise((resolve) => setTimeout(resolve, END_FLUSH_MS))
      },
      close: markClosed,
      onClose: (listener) => void closeListeners.push(listener),
    }
    return { ok: true, link }
  }
}
