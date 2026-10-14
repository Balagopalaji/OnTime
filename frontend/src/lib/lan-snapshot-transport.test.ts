import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAN_HEARTBEAT_MS,
  LAN_RECONNECT_BASE_MS,
  LAN_RECONNECT_MAX_MS,
  createLanSnapshotTransport,
  type LanSocketLike,
} from './lan-snapshot-transport'

type Handler = (payload?: unknown) => void

type FakeSocket = LanSocketLike & {
  url: string
  options: unknown
  emitted: Array<{ event: string; payload: unknown }>
  disconnected: boolean
  removed: boolean
  fire(event: string, payload?: unknown): void
  joins(): Array<Record<string, unknown>>
}

function fakeSocketFactory() {
  const sockets: FakeSocket[] = []
  function makeSocket(url: string, options: unknown): FakeSocket {
    const handlers = new Map<string, Set<Handler>>()
    const emitted: Array<{ event: string; payload: unknown }> = []
    const socket = {
      url,
      options,
      emitted,
      connected: false,
      disconnected: false,
      removed: false,
      on(event: string, handler: Handler) {
        const set = handlers.get(event) ?? new Set<Handler>()
        set.add(handler)
        handlers.set(event, set)
        return socket
      },
      off(event: string, handler: Handler) {
        handlers.get(event)?.delete(handler)
        return socket
      },
      emit(event: string, payload?: unknown) {
        emitted.push({ event, payload })
        return socket
      },
      connect() {
        return socket
      },
      disconnect() {
        socket.connected = false
        socket.disconnected = true
        return socket
      },
      removeAllListeners() {
        handlers.clear()
        socket.removed = true
        return socket
      },
      fire(event: string, payload?: unknown) {
        socket.connected = event === 'connect' ? true : event === 'disconnect' ? false : socket.connected
        handlers.get(event)?.forEach((handler) => handler(payload))
      },
      joins: () => emitted.filter((entry) => entry.event === 'JOIN_ROOM').map((entry) => entry.payload as Record<string, unknown>),
    }
    sockets.push(socket as unknown as FakeSocket)
    return socket as unknown as FakeSocket
  }
  return { sockets, create: (url: string, options: unknown) => makeSocket(url, options) }
}

const TOKEN = 'jwt.viewer.token'
const ack = { type: 'HANDSHAKE_ACK', success: true }

function setup(overrides: Partial<Parameters<typeof createLanSnapshotTransport>[0]> = {}) {
  const factory = fakeSocketFactory()
  const transport = createLanSnapshotTransport({
    roomId: 'room-1',
    token: TOKEN,
    origin: 'https://192.168.1.20:4440',
    clientId: 'viewer-client-1',
    deviceName: 'iPad',
    createSocket: factory.create,
    random: () => 1,
    ...overrides,
  })
  const connects = vi.fn()
  const envelopes = vi.fn()
  const access = vi.fn()
  transport.onConnect(connects)
  transport.onEnvelope(envelopes)
  transport.onAccessEnded(access)
  return { factory, transport, connects, envelopes, access }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('LAN snapshot transport (pairing JWT + JOIN_ROOM)', () => {
  it('does not open a socket until the controller has registered its handlers, then connects once', async () => {
    // Defect: the socket connects before onEnvelope exists and the bootstrap snapshot is lost.
    const factory = fakeSocketFactory()
    const transport = createLanSnapshotTransport({ roomId: 'room-1', token: TOKEN, origin: 'http://localhost:4000', createSocket: factory.create })
    transport.onConnect(() => undefined)
    expect(factory.sockets).toHaveLength(0)
    transport.onEnvelope(() => undefined)
    transport.onAccessEnded(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(factory.sockets).toHaveLength(1)
    expect(factory.sockets[0].url).toBe('http://localhost:4000')
    expect(factory.sockets[0].options).toMatchObject({ transports: ['websocket'], reconnection: false, forceNew: true })
    transport.close()
  })

  it('joins as a read-only viewer with the pairing token and reports connected only after the handshake ack', async () => {
    // Defect: onConnect fires on the raw socket, re-anchoring the clock before admission; or a controller join.
    const { factory, connects } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const [socket] = factory.sockets
    socket.fire('connect')
    expect(socket.joins()).toEqual([
      expect.objectContaining({ type: 'JOIN_ROOM', roomId: 'room-1', token: TOKEN, clientType: 'viewer', clientId: 'viewer-client-1', deviceName: 'iPad' }),
    ])
    expect(connects).not.toHaveBeenCalled()
    socket.fire('HANDSHAKE_ACK', ack)
    expect(connects).toHaveBeenCalledTimes(1)
  })

  it('forwards only REMOTE_SNAPSHOT and REMOTE_SNAPSHOT_ENDED, raw, to the controller', async () => {
    // Defect: room/timer events or unvalidated parsing leak into the presentation viewer.
    const { factory, envelopes } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const [socket] = factory.sockets
    socket.fire('connect')
    socket.fire('HANDSHAKE_ACK', ack)
    const snap = { type: 'REMOTE_SNAPSHOT', roomId: 'room-1', snapshot: { any: 'thing' }, timestamp: 1 }
    const end = { type: 'REMOTE_SNAPSHOT_ENDED', roomId: 'room-1', sessionId: 's', timestamp: 2 }
    socket.fire('REMOTE_SNAPSHOT', snap)
    socket.fire('REMOTE_SNAPSHOT_ENDED', end)
    socket.fire('ROOM_STATE_SNAPSHOT', { type: 'ROOM_STATE_SNAPSHOT' })
    socket.fire('TIMER_UPDATED', {})
    expect(envelopes.mock.calls).toEqual([[snap], [end]])
  })

  it('a refused token ends access once, closes the socket, and never reconnects', async () => {
    // Defect: a revoked/expired pairing is retried forever, or the page never returns to the pairing prompt.
    const { factory, access } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const [socket] = factory.sockets
    socket.fire('connect')
    socket.fire('HANDSHAKE_ERROR', { type: 'HANDSHAKE_ERROR', code: 'INVALID_TOKEN', message: 'Invalid or expired token.' })
    socket.fire('disconnect', 'io server disconnect')
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_MAX_MS * 2)
    expect(access).toHaveBeenCalledTimes(1)
    expect(socket.disconnected).toBe(true)
    expect(factory.sockets).toHaveLength(1)
  })

  it('treats a handshake still pending as transient and rejoins with backoff', async () => {
    // Defect: a momentary HANDSHAKE_PENDING ends the viewer's access.
    const { factory, access } = setup()
    await vi.advanceTimersByTimeAsync(0)
    factory.sockets[0].fire('connect')
    factory.sockets[0].fire('HANDSHAKE_ERROR', { type: 'HANDSHAKE_ERROR', code: 'HANDSHAKE_PENDING', message: 'pending' })
    factory.sockets[0].fire('disconnect', 'transport close')
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_BASE_MS)
    expect(access).not.toHaveBeenCalled()
    expect(factory.sockets).toHaveLength(2)
  })

  it('reconnects after a drop or connect error with growing, bounded delays, and rejoins with the same client ID', async () => {
    // Defect: no reconnect after Companion restarts, a hot loop, or a new device identity each time.
    const { factory, connects } = setup()
    await vi.advanceTimersByTimeAsync(0)
    factory.sockets[0].fire('connect')
    factory.sockets[0].fire('HANDSHAKE_ACK', ack)
    factory.sockets[0].fire('disconnect', 'transport close')
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_BASE_MS - 1)
    expect(factory.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(factory.sockets).toHaveLength(2)
    factory.sockets[1].fire('connect_error', new Error('refused'))
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_BASE_MS * 2)
    expect(factory.sockets).toHaveLength(3)
    for (let i = 0; i < 10; i += 1) {
      factory.sockets.at(-1)!.fire('connect_error', new Error('refused'))
      await vi.advanceTimersByTimeAsync(LAN_RECONNECT_MAX_MS)
    }
    const countBefore = factory.sockets.length
    factory.sockets.at(-1)!.fire('connect_error', new Error('refused'))
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_MAX_MS)
    expect(factory.sockets.length).toBe(countBefore + 1)
    const last = factory.sockets.at(-1)!
    last.fire('connect')
    expect(last.joins()[0]).toMatchObject({ clientId: 'viewer-client-1', clientType: 'viewer' })
    last.fire('HANDSHAKE_ACK', ack)
    expect(connects).toHaveBeenCalledTimes(2)
  })

  it('resets the backoff after a successful admission', async () => {
    // Defect: delays stay at the cap after one bad period.
    const { factory } = setup()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 4; i += 1) {
      factory.sockets.at(-1)!.fire('connect_error', new Error('x'))
      await vi.advanceTimersByTimeAsync(LAN_RECONNECT_MAX_MS)
    }
    const good = factory.sockets.at(-1)!
    good.fire('connect')
    good.fire('HANDSHAKE_ACK', ack)
    good.fire('disconnect', 'transport close')
    const count = factory.sockets.length
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_BASE_MS)
    expect(factory.sockets.length).toBe(count + 1)
  })

  it('sends viewer heartbeats while admitted and stops when closed', async () => {
    // Defect: the controller's device list shows the viewer as stale, or a closed viewer keeps a timer.
    const { factory, transport } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const [socket] = factory.sockets
    socket.fire('connect')
    socket.fire('HANDSHAKE_ACK', ack)
    await vi.advanceTimersByTimeAsync(LAN_HEARTBEAT_MS * 2)
    const beats = socket.emitted.filter((entry) => entry.event === 'HEARTBEAT')
    expect(beats).toHaveLength(2)
    expect(beats[0].payload).toMatchObject({ type: 'HEARTBEAT', roomId: 'room-1', clientId: 'viewer-client-1' })
    transport.close()
    await vi.advanceTimersByTimeAsync(LAN_HEARTBEAT_MS * 3)
    expect(socket.emitted.filter((entry) => entry.event === 'HEARTBEAT')).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('close disconnects, drops listeners, cancels a pending reconnect, and is idempotent', async () => {
    // Defect: route teardown leaves a socket that keeps reconnecting with the viewer token.
    const { factory, transport } = setup()
    await vi.advanceTimersByTimeAsync(0)
    factory.sockets[0].fire('connect_error', new Error('x'))
    transport.close()
    transport.close()
    await vi.advanceTimersByTimeAsync(LAN_RECONNECT_MAX_MS * 2)
    expect(factory.sockets).toHaveLength(1)
    expect(factory.sockets[0].disconnected).toBe(true)
    expect(factory.sockets[0].removed).toBe(true)
  })

  it('does not connect at all when closed before the deferred start', async () => {
    // Defect: StrictMode's discarded first mount opens (and leaks) a socket with the viewer token.
    const { factory, transport } = setup()
    transport.close()
    await vi.advanceTimersByTimeAsync(10)
    expect(factory.sockets).toHaveLength(0)
  })

  it('never puts the token in the socket URL or handshake query', async () => {
    // Defect: the bearer token lands in logs / history via the URL.
    const { factory } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(factory.sockets[0].url).not.toContain(TOKEN)
    expect(JSON.stringify(factory.sockets[0].options)).not.toContain(TOKEN)
  })
})
