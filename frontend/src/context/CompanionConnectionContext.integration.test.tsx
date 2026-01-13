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

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socket),
}))

type ConnectionSnapshot = {
  isConnected: boolean
  reconnectState: 'idle' | 'reconnecting' | 'stopped'
}

const ContextProbe = ({ onUpdate }: { onUpdate: (ctx: ConnectionSnapshot) => void }) => {
  const ctx = useCompanionConnection()
  useEffect(() => {
    onUpdate({ isConnected: ctx.isConnected, reconnectState: ctx.reconnectState })
  }, [ctx, onUpdate])
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
    vi.useRealTimers()
    vi.restoreAllMocks()
    warnSpy?.mockRestore()
    warnSpy = null
  })

  it('reconnects after a disconnect', async () => {
    const snapshots: ConnectionSnapshot[] = []
    const view = render(
      <CompanionConnectionProvider>
        <ContextProbe onUpdate={(ctx) => snapshots.push(ctx)} />
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

    expect(socket.connect.mock.calls.length).toBeGreaterThanOrEqual(2)

    view.unmount()
  })
})
