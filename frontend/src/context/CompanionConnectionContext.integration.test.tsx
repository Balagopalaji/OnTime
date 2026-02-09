import { useEffect } from 'react'
import { render, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionConnectionProvider, useCompanionConnection } from './CompanionConnectionContext'

class FakeSocket {
  connected = false
  active = false
  connect = vi.fn()
  disconnect = vi.fn()
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private ioListeners = new Map<string, Set<(...args: unknown[]) => void>>()

  io = {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      const list = this.ioListeners.get(event) ?? new Set()
      list.add(cb)
      this.ioListeners.set(event, list)
    },
    off: (event: string, cb: (...args: unknown[]) => void) => {
      this.ioListeners.get(event)?.delete(cb)
    },
  }

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.listeners.get(event) ?? new Set()
    list.add(cb)
    this.listeners.set(event, list)
  }

  off(event: string, cb: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(cb)
  }

  trigger(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => cb(...args))
  }
}

let socket: FakeSocket
let warnSpy: ReturnType<typeof vi.spyOn> | null = null

const buildJwtWithExpiry = (expiresInSeconds: number) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ exp: expiresInSeconds }))
  return `${header}.${payload}.signature`
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socket),
}))

type ConnectionSnapshot = {
  isConnected: boolean
  reconnectState: 'idle' | 'reconnecting' | 'stopped'
  handshakeStatus: 'idle' | 'pending' | 'ack' | 'error'
}

const ContextProbe = ({
  onUpdate,
  onReady,
}: {
  onUpdate: (ctx: ConnectionSnapshot) => void
  onReady: (ctx: ReturnType<typeof useCompanionConnection>) => void
}) => {
  const ctx = useCompanionConnection()
  useEffect(() => {
    onReady(ctx)
    onUpdate({ isConnected: ctx.isConnected, reconnectState: ctx.reconnectState, handshakeStatus: ctx.handshakeStatus })
  }, [ctx, onReady, onUpdate])
  return null
}

describe('CompanionConnectionProvider reconnect flow', () => {
  beforeEach(() => {
    socket = new FakeSocket()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'token-123' }),
      })
    vi.useFakeTimers()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    warnSpy?.mockRestore()
    warnSpy = null
  })

  it('reconnects after a disconnect', async () => {
    const snapshots: ConnectionSnapshot[] = []
    let latestCtx: ReturnType<typeof useCompanionConnection> | null = null
    const view = render(
      <CompanionConnectionProvider>
        <ContextProbe onReady={(ctx) => { latestCtx = ctx }} onUpdate={(ctx) => snapshots.push(ctx)} />
      </CompanionConnectionProvider>,
    )

    expect(socket.connect).toHaveBeenCalledTimes(1)

    act(() => {
      socket.trigger('connect')
    })
    const afterConnect = snapshots[snapshots.length - 1]
    expect(afterConnect?.isConnected).toBe(true)

    act(() => {
      socket.trigger('disconnect', 'transport close')
    })
    const afterDisconnect = snapshots[snapshots.length - 1]
    expect(afterDisconnect?.reconnectState).toBe('reconnecting')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    act(() => {
      latestCtx?.markHandshakePending()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    act(() => {
      socket.trigger('HANDSHAKE_ACK', {
        type: 'HANDSHAKE_ACK',
        success: true,
        roomId: 'room-latency',
        companionMode: 'show_control',
        companionVersion: '0.1.0',
        interfaceVersion: '1.2.0',
        capabilities: { powerpoint: true, externalVideo: false, fileOperations: true },
        systemInfo: { platform: 'darwin', hostname: 'local' },
      })
    })

    expect(socket.connect.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[snapshots.length - 1]?.handshakeStatus).toBe('ack')

    view.unmount()
  })

  it('does not block reconnect on slow token refresh when cached token is still usable', async () => {
    const deferredFetch = new Promise<{ ok: boolean; json: () => Promise<{ token: string }> }>(() => {})
    ;(globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch = vi.fn().mockReturnValue(deferredFetch)
    window.localStorage.setItem('ontime:companionToken', buildJwtWithExpiry(Math.floor(Date.now() / 1000) + 300))

    const view = render(
      <CompanionConnectionProvider>
        <ContextProbe onReady={() => {}} onUpdate={() => {}} />
      </CompanionConnectionProvider>,
    )

    act(() => {
      socket.trigger('connect')
      socket.trigger('disconnect', 'transport close')
    })
    const connectCallsBeforeRetryTimer = socket.connect.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      await Promise.resolve()
    })

    expect(socket.connect.mock.calls.length).toBeGreaterThan(connectCallsBeforeRetryTimer)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)

    view.unmount()
  })
})
