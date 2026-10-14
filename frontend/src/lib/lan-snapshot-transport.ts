// rebuild-target: app-internal (LAN presentation viewer socket transport)
import { io } from 'socket.io-client'
import type { HandshakeError, HeartbeatPayload, JoinRoomPayload } from '@ontime/interface-contracts'
import type { LanSnapshotTransport } from '../routes/session-viewer/lan-snapshot-adapter'
import { getCompanionOrigin } from './companion-pairing'

/**
 * Socket.IO transport for the LAN presentation viewer (ISSUE-002 S9c). It sits
 * next to the Companion pairing code (not inside `routes/session-viewer/`,
 * which may not import sockets or Companion) and is injected into the
 * session-viewer follower/adapter.
 *
 * It uses the existing admission unchanged: a pairing-claim viewer JWT
 * (`claimLanPairing`) and `JOIN_ROOM` as `clientType: 'viewer'`, so the
 * role-bound JWT, revocation, and 20-device cap all apply. It subscribes only
 * to `REMOTE_SNAPSHOT` / `REMOTE_SNAPSHOT_ENDED` (and the handshake events) and
 * forwards those payloads raw: validation belongs to the strict snapshot parser
 * in the reducer. The token is only ever sent in the `JOIN_ROOM` payload.
 */

export const LAN_RECONNECT_BASE_MS = 1_000
export const LAN_RECONNECT_MAX_MS = 15_000
export const LAN_HEARTBEAT_MS = 15_000

/** The slice of a Socket.IO client socket this transport uses (injectable for tests). */
export type LanSocketLike = {
  connected: boolean
  on(event: string, handler: (payload?: never) => void): unknown
  emit(event: string, payload?: unknown): unknown
  disconnect(): unknown
  removeAllListeners(): unknown
}

export type LanSnapshotTransportOptions = {
  roomId: string
  /** Viewer JWT from `claimLanPairing` (read-only, role-bound). */
  token: string
  /** Companion origin; defaults to the one the pairing code uses. */
  origin?: string
  clientId?: string
  deviceName?: string
  createSocket?: (url: string, options: Record<string, unknown>) => LanSocketLike
  random?: () => number
}

/** Handshake refusals no reconnect can fix (the viewer must pair again). */
const TERMINAL_HANDSHAKE_CODES = new Set<HandshakeError['code']>(['INVALID_TOKEN', 'INVALID_PAYLOAD'])

const newClientId = () => `lan-viewer-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

export function createLanSnapshotTransport(options: LanSnapshotTransportOptions): LanSnapshotTransport {
  const { roomId, token } = options
  const origin = options.origin ?? getCompanionOrigin()
  const clientId = options.clientId ?? newClientId()
  const random = options.random ?? Math.random
  const createSocket =
    options.createSocket ?? ((url, socketOptions) => io(url, socketOptions) as unknown as LanSocketLike)

  const connectHandlers = new Set<() => void>()
  const envelopeHandlers = new Set<(envelope: unknown) => void>()
  const accessHandlers = new Set<() => void>()
  let socket: LanSocketLike | null = null
  let startTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let attempt = 0
  let closed = false

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function dropSocket(): void {
    clearHeartbeat()
    const current = socket
    socket = null
    if (!current) return
    current.removeAllListeners()
    current.disconnect()
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer !== null) return
    const delay = Math.min(LAN_RECONNECT_MAX_MS, LAN_RECONNECT_BASE_MS * 2 ** attempt)
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, Math.round(delay * (0.5 + random() / 2)))
  }

  /** This socket is unusable: replace it after a bounded delay (handlers of the old one are detached). */
  function fail(): void {
    dropSocket()
    scheduleReconnect()
  }

  function endAccess(): void {
    const handlers = [...accessHandlers]
    close()
    for (const handler of handlers) handler()
  }

  function connect(): void {
    if (closed) return
    const next = createSocket(origin, { transports: ['websocket'], reconnection: false, forceNew: true })
    socket = next
    next.on('connect', () => {
      const join: JoinRoomPayload = { type: 'JOIN_ROOM', roomId, token, clientType: 'viewer', clientId, deviceName: options.deviceName }
      next.emit('JOIN_ROOM', join)
    })
    next.on('HANDSHAKE_ACK', () => {
      attempt = 0
      clearHeartbeat()
      heartbeatTimer = setInterval(() => {
        const beat: HeartbeatPayload = { type: 'HEARTBEAT', roomId, clientId, timestamp: Date.now() }
        next.emit('HEARTBEAT', beat)
      }, LAN_HEARTBEAT_MS)
      for (const handler of connectHandlers) handler()
    })
    next.on('HANDSHAKE_ERROR', ((error?: HandshakeError) => {
      if (error && TERMINAL_HANDSHAKE_CODES.has(error.code)) return endAccess()
      fail()
    }) as never)
    next.on('connect_error', fail as never)
    next.on('disconnect', fail as never)
    next.on('REMOTE_SNAPSHOT', ((envelope: unknown) => {
      for (const handler of envelopeHandlers) handler(envelope)
    }) as never)
    next.on('REMOTE_SNAPSHOT_ENDED', ((envelope: unknown) => {
      for (const handler of envelopeHandlers) handler(envelope)
    }) as never)
  }

  /** All three handlers are registered synchronously by the controller; connect on the next task. */
  function ensureStarted(): void {
    if (closed || startTimer !== null || socket !== null || reconnectTimer !== null || attempt > 0) return
    startTimer = setTimeout(() => {
      startTimer = null
      connect()
    }, 0)
  }

  function close(): void {
    if (closed) return
    closed = true
    if (startTimer !== null) clearTimeout(startTimer)
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    startTimer = null
    reconnectTimer = null
    dropSocket()
  }

  const register = <T>(set: Set<T>, handler: T) => {
    set.add(handler)
    ensureStarted()
    return () => void set.delete(handler)
  }

  return {
    onConnect: (handler) => register(connectHandlers, handler),
    onEnvelope: (handler) => register(envelopeHandlers, handler),
    onAccessEnded: (handler) => register(accessHandlers, handler),
    close,
  }
}
