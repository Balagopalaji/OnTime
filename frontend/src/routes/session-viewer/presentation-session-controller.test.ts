import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimerDisplayModel } from '@ontime/timer-face'
import {
  createPresentationSessionController,
  type PresentationTransport,
  type ResolveResult,
  type ViewerStateDoc,
} from './presentation-session-controller'

const SESSION = 'sess_Abc123'
const TOKEN = 'T'.repeat(43)
const SERVER_T0 = 1_790_000_000_000

type Listener<T> = { next: (value: T | null) => void; error: (code: string) => void }

/** Fake Firebase boundary recording call order; drives listener events from the test. */
function fakeTransport(resolveImpl?: () => Promise<ResolveResult>) {
  const calls: string[] = []
  let state: Listener<ViewerStateDoc> | null = null
  let snapshot: Listener<unknown> | null = null
  const transport: PresentationTransport = {
    resolve: vi.fn(async (sessionId, token) => {
      calls.push(`resolve:${sessionId}:${token.length}`)
      return resolveImpl ? resolveImpl() : { customToken: 'custom', serverNowMs: SERVER_T0, activeWindowExpiresAtMs: SERVER_T0 + 86_400_000 }
    }),
    signIn: vi.fn(async () => void calls.push('signIn')),
    onViewerState: vi.fn((_id, next, error) => {
      calls.push('listen:state')
      state = { next, error }
      return () => void calls.push('unlisten:state')
    }),
    onSnapshot: vi.fn((_id, next, error) => {
      calls.push('listen:snapshot')
      snapshot = { next, error }
      return () => void calls.push('unlisten:snapshot')
    }),
    close: vi.fn(async () => void calls.push('close')),
  }
  return {
    transport,
    calls,
    state: () => state as unknown as Listener<ViewerStateDoc>,
    snapshot: () => snapshot as unknown as Listener<unknown>,
  }
}

const row = { ordinal: 0, label: 'Walk-in', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true }
const stored = (overrides: Record<string, unknown> = {}) => ({
  snapshot: {
    schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: SESSION, epoch: 1, sequence: 1,
    observedAtMs: SERVER_T0 - 100, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: SERVER_T0,
    heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability: 'active',
    payload: {
      reason: 'presentation', presentationState: 'playing', slideNumber: 1, slideCount: 3,
      headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [row],
    },
    ...overrides,
  },
  cleanupAfterMs: SERVER_T0 + 1,
})
const activeState: ViewerStateDoc = { status: 'active', viewerGeneration: 1, activeWindowExpiresAtMs: SERVER_T0 + 86_400_000 }

describe('presentation session controller', () => {
  let monotonic = 0
  let displays: TimerDisplayModel[] = []
  const last = () => displays[displays.length - 1]

  beforeEach(() => {
    vi.useFakeTimers()
    monotonic = 5_000
    displays = []
  })
  afterEach(() => vi.useRealTimers())

  const start = (fake = fakeTransport(), token: string | null = TOKEN) => {
    const controller = createPresentationSessionController({
      sessionId: SESSION,
      token,
      transport: fake.transport,
      now: () => monotonic,
      random: () => 0.5,
      onDisplay: (d) => displays.push(d),
    })
    controller.start()
    return { controller, fake }
  }
  const advance = async (ms: number) => {
    monotonic += ms
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('resolves, signs in, and attaches the viewer-state listener before the snapshot listener', async () => {
    // Endpoint browser steps 1-3: listener order matters so access state is known before timing.
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.calls).toEqual([`resolve:${SESSION}:43`, 'signIn', 'listen:state', 'listen:snapshot'])
    expect(last()).toMatchObject({ connection: 'connecting', statusText: 'Connecting' })
  })

  it('stays connecting until a complete snapshot arrives, then goes live and interpolates on the server clock', async () => {
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.state().next(activeState)
    fake.snapshot().next(null)
    await advance(250)
    expect(last().connection).toBe('connecting')
    fake.snapshot().next(stored())
    await advance(250)
    // Resolve round trip took 0 ms, so server now = SERVER_T0 + 500 ms since the clock sample.
    expect(last()).toMatchObject({ connection: 'live', statusText: 'Playing', timeText: '01:29' })
    await advance(2_000)
    expect(last().timeText).toBe('01:27')
  })

  it('ignores a regressed sequence and an unexpected wrapper key', async () => {
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.snapshot().next(stored({ sequence: 5 }))
    fake.snapshot().next(stored({ sequence: 4, payload: { reason: 'presentation', presentationState: 'no-video', slideNumber: 1, slideCount: 3, headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [] } }))
    fake.snapshot().next({ ...stored({ sequence: 6, availability: 'source-unavailable', payload: { reason: 'no-slideshow' } }), leaked: 'C:\\deck.pptx' })
    await advance(250)
    expect(last()).toMatchObject({ statusText: 'Playing' })
  })

  it('goes stale at 25 s and disconnected at 60 s without a fresh publish (RPV-008)', async () => {
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.snapshot().next(stored())
    await advance(25_000)
    expect(last()).toMatchObject({ connection: 'stale', statusText: 'Reconnecting' })
    await advance(35_000)
    expect(last()).toMatchObject({ connection: 'disconnected', timeText: '--:--' })
  })

  it('renders session-ended from the viewer state, and access-ended when the viewer state is denied', async () => {
    const ended = start()
    await vi.advanceTimersByTimeAsync(0)
    ended.fake.snapshot().next(stored())
    ended.fake.state().next({ ...activeState, status: 'ended' })
    await advance(250)
    expect(last()).toMatchObject({ connection: 'ended', statusText: 'Session ended' })

    displays = []
    const revoked = start()
    await vi.advanceTimersByTimeAsync(0)
    revoked.fake.state().error('permission-denied')
    await advance(250)
    expect(last()).toMatchObject({ connection: 'ended', statusText: 'Access ended' })
  })

  it('ends access when the active window passes on the server clock', async () => {
    const { fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.state().next({ ...activeState, activeWindowExpiresAtMs: SERVER_T0 + 1_000 })
    fake.snapshot().next(stored())
    await advance(750)
    expect(last().statusText).toBe('Playing')
    await advance(500)
    expect(last()).toMatchObject({ statusText: 'Access ended' })
  })

  it('shows access ended without resolving when the link has no token', async () => {
    const { fake } = start(fakeTransport(), null)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.resolve).not.toHaveBeenCalled()
    expect(last()).toMatchObject({ statusText: 'Access ended' })
  })

  it('shows access ended when resolution is denied, without signing in', async () => {
    const fake = fakeTransport(async () => Promise.reject(Object.assign(new Error('denied'), { code: 'functions/permission-denied' })))
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.signIn).not.toHaveBeenCalled()
    expect(last()).toMatchObject({ statusText: 'Access ended' })
  })

  it('retries resolution after retryAfterMs when rate limited', async () => {
    let attempt = 0
    const fake = fakeTransport(async () => {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('limited'), { code: 'functions/resource-exhausted', details: { retryAfterMs: 3_000 } })
      return { customToken: 'custom', serverNowMs: SERVER_T0, activeWindowExpiresAtMs: SERVER_T0 + 86_400_000 }
    })
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.signIn).not.toHaveBeenCalled()
    await advance(2_999)
    expect(attempt).toBe(1)
    await advance(1)
    expect(attempt).toBe(2)
    expect(fake.transport.signIn).toHaveBeenCalledTimes(1)
  })

  it('retries the connection with backoff when viewer sign-in fails on the network', async () => {
    const fake = fakeTransport()
    let attempts = 0
    fake.transport.signIn = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('network'), { code: 'auth/network-request-failed' })
    })
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.onViewerState).not.toHaveBeenCalled()
    await advance(2_000)
    expect(attempts).toBe(2)
    expect(fake.transport.onViewerState).toHaveBeenCalledTimes(1)
  })

  it('does not loop on a permanent sign-in failure', async () => {
    // Defect: a misconfigured project makes every open tab resolve the link forever.
    const fake = fakeTransport()
    fake.transport.signIn = vi.fn(async () => Promise.reject(Object.assign(new Error('bad'), { code: 'auth/invalid-custom-token' })))
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    await advance(600_000)
    expect(fake.transport.resolve).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject({ statusText: 'Access ended' })
  })

  it('backs off exponentially with a cap while resolution is unavailable', async () => {
    const fake = fakeTransport(async () => Promise.reject(Object.assign(new Error('down'), { code: 'functions/unavailable' })))
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    const attemptsAt = async (ms: number) => {
      await advance(ms)
      return (fake.transport.resolve as ReturnType<typeof vi.fn>).mock.calls.length
    }
    // random() = 0.5 → no jitter offset: 2 s, 4 s, 8 s, … capped at 60 s.
    expect(await attemptsAt(2_000)).toBe(2)
    expect(await attemptsAt(4_000)).toBe(3)
    expect(await attemptsAt(8_000)).toBe(4)
    await advance(16_000 + 32_000)
    expect(await attemptsAt(60_000)).toBe(7)
    expect(await attemptsAt(60_000)).toBe(8)
  })

  it('clamps an unreasonable retryAfterMs from the server', async () => {
    let attempt = 0
    const fake = fakeTransport(async () => {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('limited'), { code: 'functions/resource-exhausted', details: { retryAfterMs: 86_400_000 } })
      return { customToken: 'custom', serverNowMs: SERVER_T0, activeWindowExpiresAtMs: SERVER_T0 + 86_400_000 }
    })
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    await advance(60_000)
    expect(attempt).toBe(2)
  })

  it('reconnects after a snapshot listener error instead of staying disconnected', async () => {
    // Defect: a Firestore listener error is terminal in the SDK, so the viewer never recovers.
    const fake = fakeTransport()
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    fake.snapshot().next(stored())
    fake.snapshot().error('unavailable')
    expect(fake.calls.slice(-2)).toEqual(['unlisten:state', 'unlisten:snapshot'])
    await advance(2_000)
    expect(fake.transport.resolve).toHaveBeenCalledTimes(2)
    fake.snapshot().next(stored({ sequence: 2, publishedAtMs: SERVER_T0 + 2_000 }))
    await advance(250)
    expect(last()).toMatchObject({ connection: 'live', statusText: 'Playing' })
  })

  it('does not loop when the snapshot listener keeps failing after successful sign-in', async () => {
    // Defect: backoff resets on sign-in, so a persistent listener error resolves every 2 s forever.
    const fake = fakeTransport()
    fake.transport.onSnapshot = vi.fn((_id, _next, error) => {
      queueMicrotask(() => error('permission-denied'))
      return () => {}
    })
    start(fake)
    await advance(30 * 60_000)
    expect((fake.transport.resolve as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(6)
    expect(last()).toMatchObject({ statusText: 'Access ended' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('schedules a single reconnect when both listeners fail in the same tick', async () => {
    const fake = fakeTransport()
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    fake.state().error('unavailable')
    fake.snapshot().error('unavailable')
    await advance(10_000)
    expect(fake.transport.resolve).toHaveBeenCalledTimes(2)
  })

  it.each(['auth/too-many-requests', 'auth/internal-error'])('retries sign-in after %s instead of ending access', async (code) => {
    const fake = fakeTransport()
    let attempts = 0
    fake.transport.signIn = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('temporary'), { code })
    })
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    await advance(2_000)
    expect(attempts).toBe(2)
    expect(fake.transport.onViewerState).toHaveBeenCalledTimes(1)
  })

  it('releases listeners and credentials as soon as a terminal state is reached', async () => {
    const fake = fakeTransport()
    start(fake)
    await vi.advanceTimersByTimeAsync(0)
    fake.state().next({ ...activeState, status: 'ended' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.calls.slice(-3)).toEqual(['unlisten:state', 'unlisten:snapshot', 'close'])
    expect(vi.getTimerCount()).toBe(0)
    expect(last().statusText).toBe('Session ended')
  })

  it('stops cleanly while sign-in is still in flight', async () => {
    let finishSignIn: () => void = () => {}
    const fake = fakeTransport()
    fake.transport.signIn = vi.fn(() => new Promise<void>((resolve) => (finishSignIn = resolve)))
    const { controller } = start(fake)
    await vi.advanceTimersByTimeAsync(0)
    await controller.stop()
    finishSignIn()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.onViewerState).not.toHaveBeenCalled()
    expect(fake.transport.close).toHaveBeenCalledTimes(1)
  })

  it('tears down state then snapshot listeners, stops the clock, and clears credentials; no updates after stop', async () => {
    // Endpoint browser step 6: no lease release exists; nothing may keep running.
    const { controller, fake } = start()
    await vi.advanceTimersByTimeAsync(0)
    fake.snapshot().next(stored())
    await advance(250)
    const count = displays.length
    await controller.stop()
    expect(fake.calls.slice(-3)).toEqual(['unlisten:state', 'unlisten:snapshot', 'close'])
    await advance(5_000)
    fake.snapshot().next(stored({ sequence: 9 }))
    expect(displays.length).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops cleanly while resolution is still in flight', async () => {
    let release: (value: ResolveResult) => void = () => {}
    const fake = fakeTransport(() => new Promise((resolve) => (release = resolve)))
    const { controller } = start(fake)
    await controller.stop()
    release({ customToken: 'custom', serverNowMs: SERVER_T0, activeWindowExpiresAtMs: SERVER_T0 + 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.transport.signIn).not.toHaveBeenCalled()
    expect(fake.transport.onViewerState).not.toHaveBeenCalled()
    expect(fake.transport.close).toHaveBeenCalledTimes(1)
  })
})
