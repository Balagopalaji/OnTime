import { describe, expect, it, vi } from 'vitest'
import type {
  ArbitrationDecision,
  ArbitrationInput,
  ArbitrationLastAcceptedCache,
  QueuedEvent,
} from './index'
import {
  getConfidenceWindowMs,
  isSnapshotStale,
  mergeQueuedEvents,
  normalizeRoomAuthoritySource,
  resolveReconciledTimerTargetId,
  resolveRoomSource,
  resolveSnapshotTimestamp,
  shouldBootstrapCachedSubscriptions,
} from './index'
import type { Room, Timer } from '@ontime/shared-types'

const baseInput = () => ({
  roomId: 'room-1',
  domain: 'room' as const,
  cloudTs: 1000,
  companionTs: 900,
  authoritySource: 'cloud' as const,
  mode: 'auto' as const,
  effectiveMode: 'cloud' as const,
  isCompanionLive: true,
  cloudOnline: true,
  confidenceWindowMs: 2000,
})

const createLastAcceptedSourceCache = (): ArbitrationLastAcceptedCache => {
  const cache = new Map<string, ArbitrationDecision['acceptSource']>()

  return {
    get: (key) => cache.get(key),
    set: (key, source) => {
      cache.set(key, source)
    },
  }
}

describe('arbitrate', () => {
  it('preserves the current rollout flags', async () => {
    vi.resetModules()
    const { ARBITRATION_FLAGS } = await import('./index')

    expect(ARBITRATION_FLAGS).toEqual({
      room: true,
      lock: true,
      pin: false,
      timer: false,
      cue: false,
      liveCue: false,
    })
  })

  it('calls the optional decision hook without owning environment logging', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const onDecision = vi.fn()
    const input = { ...baseInput(), companionTs: 1500 }

    const decision = arbitrate(input, { onDecision })

    expect(decision.acceptSource).toBe('cloud')
    expect(onDecision).toHaveBeenCalledWith(input, decision)
  })

  it('prefers hold source within window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const input = {
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1500,
      holdActive: true,
      authoritySource: 'companion' as const,
    }

    const decision = arbitrate(input)
    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('hold active')
  })

  it('skew guard overrides hold window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const input = {
      ...baseInput(),
      cloudTs: 1_000,
      companionTs: 1_000 + 10 * 60 * 1000 + 1,
      holdActive: true,
      skewThreshold: 10 * 60 * 1000,
    }

    const decision = arbitrate(input)
    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('skew - authority fallback')
  })

  it('uses last accepted when both offline', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const options = { lastAcceptedSourceCache: createLastAcceptedSourceCache() }
    const online = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    }, options)
    expect(online.acceptSource).toBe('companion')

    const offline = arbitrate({
      ...baseInput(),
      isCompanionLive: false,
      cloudOnline: false,
      cloudTs: null,
      companionTs: null,
    }, options)
    expect(offline.acceptSource).toBe('companion')
    expect(offline.reason).toBe('no data')
  })

  it('returns source with data when other side is empty', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: 500,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })

  it('uses tie breaker for equal timestamps', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1000,
      controllerTieBreaker: 'companion' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('within window - tie breaker')
  })

  it('uses authority within confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1200,
      authoritySource: 'companion' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('within window - authority')
  })

  it('newer timestamp wins outside confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('companion newer')
  })

  it('uses last accepted when both online with no data', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const options = { lastAcceptedSourceCache: createLastAcceptedSourceCache() }
    const initial = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    }, options)
    expect(initial.acceptSource).toBe('companion')

    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: null,
      isCompanionLive: true,
      cloudOnline: true,
    }, options)

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })

  it('does not retain last accepted source without an injected cache', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const initial = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    })
    expect(initial.acceptSource).toBe('companion')

    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: null,
      isCompanionLive: true,
      cloudOnline: true,
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('no data')
  })

  it('ignores hold when delta exceeds confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1_000,
      companionTs: 5_000,
      confidenceWindowMs: 1_000,
      holdActive: true,
      authoritySource: 'cloud' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('companion newer')
  })

  it('skew guard boundary uses threshold strictly', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const atThreshold = arbitrate({
      ...baseInput(),
      cloudTs: 1_000,
      companionTs: 1_000 + 10 * 60 * 1000,
      skewThreshold: 10 * 60 * 1000,
    })

    expect(atThreshold.acceptSource).toBe('companion')
    expect(atThreshold.reason).toBe('companion newer')

    const overThreshold = arbitrate({
      ...baseInput(),
      cloudTs: 1_000,
      companionTs: 1_000 + 10 * 60 * 1000 + 1,
      skewThreshold: 10 * 60 * 1000,
    })

    expect(overThreshold.acceptSource).toBe('cloud')
    expect(overThreshold.reason).toBe('skew - authority fallback')
  })

  it('on large skew, falls back to the room authority rather than a hardcoded source', async () => {
    const { arbitrate } = await import('./index')
    // local-authority room: companion is materially newer than stale cloud by >threshold.
    // Old behavior hardcoded cloud (stale won). New: authority/mode fallback -> companion.
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1_000,
      companionTs: 1_000 + 10 * 60 * 1000 + 1,
      skewThreshold: 10 * 60 * 1000,
      authoritySource: 'companion',
    })
    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('skew - authority fallback')
  })
})

describe('arbitrate zero-sentinel (FIX-097)', () => {
  // `0` is the never-cached sentinel for state.lastUpdate (see the
  // resolveSnapshotTimestamp doc comment) — NOT a real wall-clock anchor.
  // arbitrate() must treat ===0 as MISSING so a never-cached side routes through
  // the no-data / missing-timestamp branches instead of computing a huge
  // |0 - realTs| delta that always trips the skew guard and drops a live
  // companion snapshot in a cloud/auto room whose Firebase room hasn't loaded.
  // S4 (real drifted clocks still skew) and S5 (real within-window clocks still
  // use authority/hold) are guarded by the existing skew/within-window tests
  // above, which now use real non-zero timestamps.
  it('S1: cloudTs=0 (never-cached cloud) does not trip skew — accepts companion via no-data', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 0,
      companionTs: 1_700_000_000_000,
      authoritySource: 'cloud' as const,
      mode: 'cloud',
      effectiveMode: 'cloud',
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })

  it('S2: companionTs=0 (missing companion) routes to cloud via no-data, not skew', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1_700_000_000_000,
      companionTs: 0,
      authoritySource: 'companion' as const,
      mode: 'local',
      effectiveMode: 'local',
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('no data')
  })

  it('S3: both sides=0 route to no-data, not skew or within-window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 0,
      companionTs: 0,
      authoritySource: 'companion' as const,
      mode: 'local',
      effectiveMode: 'local',
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })
})

describe('arbitrate mode bias', () => {
  const modeBiasInput = () => ({
    roomId: 'mode-bias-room',
    domain: 'room' as const,
    cloudTs: 1_000,
    companionTs: 1_000,
    mode: 'auto' as const,
    effectiveMode: 'cloud' as const,
    isCompanionLive: true,
    cloudOnline: true,
    confidenceWindowMs: 2_000,
  })

  it('selects local source in ambiguous near-equal cases when mode is local', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-local',
      mode: 'local',
      effectiveMode: 'local',
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('mode bias')
  })

  it('selects cloud source in ambiguous near-equal cases when mode is cloud', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-cloud',
      mode: 'cloud',
      effectiveMode: 'cloud',
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('mode bias')
  })

  it('uses companion preference in auto mode when companion is connected', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-auto-connected',
      mode: 'auto',
      effectiveMode: 'local',
      isCompanionLive: true,
      cloudOnline: true,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('mode bias')
  })
})

describe('resolveSnapshotTimestamp', () => {
  // Regression for 7th-audit MINOR-1: a never-cached room carries
  // state.lastUpdate = 0 (companion getRoomState sentinel). The live snapshot
  // must anchor on the envelope timestamp, not be dropped as epoch-stale.
  it('uses the envelope timestamp when stateLastUpdate is 0 (never-cached room)', () => {
    expect(resolveSnapshotTimestamp(0, 5_000, 9_999)).toBe(5_000)
  })

  it('prefers a real stateLastUpdate over the envelope timestamp', () => {
    expect(resolveSnapshotTimestamp(2_000, 5_000, 9_999)).toBe(2_000)
  })

  it('falls back to now when both lastUpdate and envelope are 0/missing', () => {
    expect(resolveSnapshotTimestamp(0, 0, 9_999)).toBe(9_999)
    expect(resolveSnapshotTimestamp(undefined, undefined, 9_999)).toBe(9_999)
  })
})

describe('normalizeRoomAuthoritySource', () => {
  it('maps pending to undefined and passes cloud/companion through', () => {
    expect(normalizeRoomAuthoritySource('pending')).toBeUndefined()
    expect(normalizeRoomAuthoritySource('cloud')).toBe('cloud')
    expect(normalizeRoomAuthoritySource('companion')).toBe('companion')
  })
})

describe('getConfidenceWindowMs', () => {
  it('uses a 2000ms base window and 4000ms under reconnect churn', () => {
    expect(getConfidenceWindowMs(false)).toBe(2000)
    expect(getConfidenceWindowMs(true)).toBe(4000)
  })
})

describe('shouldBootstrapCachedSubscriptions', () => {
  const subs = { 'room-a': { clientType: 'controller' } }
  it('bootstraps only when not-yet-bootstrapped, socket+token present, and subs non-empty', () => {
    expect(shouldBootstrapCachedSubscriptions({ hasBootstrapped: false, hasSocket: true, hasToken: true, cachedSubscriptions: subs })).toBe(true)
    expect(shouldBootstrapCachedSubscriptions({ hasBootstrapped: true, hasSocket: true, hasToken: true, cachedSubscriptions: subs })).toBe(false)
    expect(shouldBootstrapCachedSubscriptions({ hasBootstrapped: false, hasSocket: false, hasToken: true, cachedSubscriptions: subs })).toBe(false)
    expect(shouldBootstrapCachedSubscriptions({ hasBootstrapped: false, hasSocket: true, hasToken: false, cachedSubscriptions: subs })).toBe(false)
    expect(shouldBootstrapCachedSubscriptions({ hasBootstrapped: false, hasSocket: true, hasToken: true, cachedSubscriptions: {} })).toBe(false)
  })
})

describe('resolveReconciledTimerTargetId', () => {
  it('prefers a valid requested id, then a valid active id, then the first timer', () => {
    const timers = [{ id: 't1' }, { id: 't2' }] as unknown as Timer[]
    expect(resolveReconciledTimerTargetId({ requestedTimerId: 't1', activeTimerId: 't2', timers })).toBe('t1')
    expect(resolveReconciledTimerTargetId({ requestedTimerId: 'x', activeTimerId: 't2', timers })).toBe('t2')
    expect(resolveReconciledTimerTargetId({ requestedTimerId: 'x', activeTimerId: 'y', timers })).toBe('t1')
  })

  it('falls back through requested/active/null on an empty rundown', () => {
    const empty = [] as Timer[]
    expect(resolveReconciledTimerTargetId({ requestedTimerId: 'r', activeTimerId: 'a', timers: empty })).toBe('r')
    expect(resolveReconciledTimerTargetId({ requestedTimerId: null, activeTimerId: null, timers: empty })).toBeNull()
  })
})

describe('isSnapshotStale', () => {
  const baseState = {
    activeTimerId: null,
    isRunning: false,
    startedAt: null,
    elapsedOffset: 0,
    progress: {},
    showClock: false,
    message: { text: '', visible: false, color: 'green' },
    currentTime: 0,
    lastUpdate: 0,
  } as Room['state']

  it('treats a running timer with unknown duration as stale after 30s', () => {
    const running = { ...baseState, isRunning: true, elapsedOffset: 1_000 } as Room['state']
    expect(isSnapshotStale(running, 1_000_000 - 10_000, 1_000_000)).toBe(false)
    expect(isSnapshotStale(running, 1_000_000 - 31_000, 1_000_000)).toBe(true)
  })

  it('never marks a fresh timer without progress as stale', () => {
    expect(isSnapshotStale(baseState, 1_000_000 - 100_000_000, 1_000_000)).toBe(false)
  })
})

describe('resolveRoomSource', () => {
  const base = {
    roomId: 'r1',
    isCompanionLive: true,
    viewerSyncGuard: false,
    firebaseTs: 1234,
    companionTs: 1234,
    authoritySource: 'cloud' as const,
    mode: 'auto' as const,
    effectiveMode: 'cloud' as const,
    confidenceWindowMs: 2000,
    cloudOnline: true,
  }

  it('delegates to core arbitrate by default (single-side offline wins the live side)', () => {
    expect(resolveRoomSource({ ...base, isCompanionLive: false })).toBe('cloud')
    expect(resolveRoomSource({ ...base, cloudOnline: false })).toBe('companion')
  })

  it('maps fields onto the injected resolver: domain room, firebaseTs->cloudTs, pending authority normalized away', () => {
    const seen = vi.fn((_input: ArbitrationInput): ArbitrationDecision => ({
      acceptSource: 'cloud',
      reason: 'mode bias',
    }))
    const result = resolveRoomSource({
      ...base,
      firebaseTs: 1234,
      companionTs: 9999,
      authoritySource: 'pending',
      arbitrateFn: seen,
    })

    expect(result).toBe('cloud')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0]).toMatchObject({
      roomId: 'r1',
      domain: 'room',
      cloudTs: 1234,
      companionTs: 9999,
      authoritySource: undefined,
      isCompanionLive: true,
      cloudOnline: true,
      viewerSyncGuard: false,
      mode: 'auto',
      effectiveMode: 'cloud',
      confidenceWindowMs: 2000,
    })
  })
})

describe('mergeQueuedEvents', () => {
  const timer = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, roomId: 'room-1', ...extra }) as unknown as import('@ontime/shared-types').Timer

  it('groups TIMER_ACTION per timerId, keeping the latest per timer', () => {
    const a1: QueuedEvent = {
      type: 'TIMER_ACTION',
      action: 'START',
      timestamp: 10,
      roomId: 'room-1',
      timerId: 't1',
      clientId: 'c1',
    }
    const a2: QueuedEvent = {
      type: 'TIMER_ACTION',
      action: 'PAUSE',
      timestamp: 20,
      roomId: 'room-1',
      timerId: 't1',
      clientId: 'c1',
    }
    const b1: QueuedEvent = {
      type: 'TIMER_ACTION',
      action: 'START',
      timestamp: 15,
      roomId: 'room-1',
      timerId: 't2',
      clientId: 'c1',
    }

    const merged = mergeQueuedEvents([a1, a2, b1])
    // t1 collapses to its latest (PAUSE@20); t2 kept independently.
    expect(merged).toEqual([b1, a2])
  })

  it('collapses ROOM_STATE_PATCH per roomId to the latest (latest wins)', () => {
    const p1: QueuedEvent = {
      type: 'ROOM_STATE_PATCH',
      timestamp: 5,
      roomId: 'room-1',
      changes: { isRunning: false },
      clientId: 'c1',
    }
    const p2: QueuedEvent = {
      type: 'ROOM_STATE_PATCH',
      timestamp: 30,
      roomId: 'room-1',
      changes: { isRunning: true },
      clientId: 'c2',
    }

    expect(mergeQueuedEvents([p1, p2])).toEqual([p2])
    // Order-insensitive: still latest by timestamp.
    expect(mergeQueuedEvents([p2, p1])).toEqual([p2])
  })

  it('keys ROOM_STATE_PATCH per roomId so different rooms are kept separate', () => {
    const pA: QueuedEvent = {
      type: 'ROOM_STATE_PATCH',
      timestamp: 5,
      roomId: 'room-1',
      changes: { title: 'a' },
      clientId: 'c1',
    }
    const pB: QueuedEvent = {
      type: 'ROOM_STATE_PATCH',
      timestamp: 6,
      roomId: 'room-2',
      changes: { title: 'b' },
      clientId: 'c1',
    }

    expect(mergeQueuedEvents([pA, pB])).toEqual([pA, pB])
  })

  it('DELETE present in a TIMER_CRUD group wins (last delete wins)', () => {
    const create: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 1,
      roomId: 'room-1',
      timer: timer('t1'),
      clientId: 'c1',
    }
    const update: QueuedEvent = {
      type: 'UPDATE_TIMER',
      timestamp: 2,
      roomId: 'room-1',
      timerId: 't1',
      changes: { name: 'x' } as never,
      clientId: 'c1',
    }
    const del1: QueuedEvent = {
      type: 'DELETE_TIMER',
      timestamp: 3,
      roomId: 'room-1',
      timerId: 't1',
      clientId: 'c1',
    }
    const del2: QueuedEvent = {
      type: 'DELETE_TIMER',
      timestamp: 5,
      roomId: 'room-1',
      timerId: 't1',
      clientId: 'c2',
    }

    expect(mergeQueuedEvents([create, update, del1, del2])).toEqual([del2])
  })

  it('merges CREATE + UPDATE into one CREATE with merged timer (update newer -> update clientId, max timestamp)', () => {
    const create: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 1,
      roomId: 'room-1',
      timer: timer('t1', { name: 'orig', duration: 60 }),
      clientId: 'creator',
    }
    const update: QueuedEvent = {
      type: 'UPDATE_TIMER',
      timestamp: 4,
      roomId: 'room-1',
      timerId: 't1',
      changes: { name: 'renamed' } as never,
      clientId: 'updater',
    }

    const merged = mergeQueuedEvents([create, update])
    expect(merged).toEqual([
      {
        type: 'CREATE_TIMER',
        timestamp: 4,
        roomId: 'room-1',
        timer: timer('t1', { name: 'renamed', duration: 60 }),
        clientId: 'updater',
      },
    ])
  })

  it('CREATE + UPDATE with update NOT newer keeps create clientId but still uses max timestamp', () => {
    const create: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 10,
      roomId: 'room-1',
      timer: timer('t1', { name: 'orig' }),
      clientId: 'creator',
    }
    const update: QueuedEvent = {
      type: 'UPDATE_TIMER',
      timestamp: 4,
      roomId: 'room-1',
      timerId: 't1',
      changes: { name: 'renamed' } as never,
      clientId: 'updater',
    }

    const merged = mergeQueuedEvents([create, update])
    expect(merged).toEqual([
      {
        type: 'CREATE_TIMER',
        timestamp: 10,
        roomId: 'room-1',
        timer: timer('t1', { name: 'renamed' }),
        clientId: 'creator',
      },
    ])
  })

  it('CREATE only in a group is returned as the create', () => {
    const create: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 7,
      roomId: 'room-1',
      timer: timer('t1'),
      clientId: 'c1',
    }
    expect(mergeQueuedEvents([create])).toEqual([create])
  })

  it('fallthrough (updates only, no create/delete) collapses to the latest', () => {
    const u1: QueuedEvent = {
      type: 'UPDATE_TIMER',
      timestamp: 2,
      roomId: 'room-1',
      timerId: 't1',
      changes: { name: 'a' } as never,
      clientId: 'c1',
    }
    const u2: QueuedEvent = {
      type: 'UPDATE_TIMER',
      timestamp: 8,
      roomId: 'room-1',
      timerId: 't1',
      changes: { name: 'b' } as never,
      clientId: 'c1',
    }
    expect(mergeQueuedEvents([u1, u2])).toEqual([u2])
  })

  it('keys REORDER_TIMERS per roomId and keeps the latest reorder', () => {
    const r1: QueuedEvent = {
      type: 'REORDER_TIMERS',
      timestamp: 3,
      roomId: 'room-1',
      timerIds: ['a', 'b'],
      clientId: 'c1',
    }
    const r2: QueuedEvent = {
      type: 'REORDER_TIMERS',
      timestamp: 9,
      roomId: 'room-1',
      timerIds: ['b', 'a'],
      clientId: 'c1',
    }
    expect(mergeQueuedEvents([r1, r2])).toEqual([r2])
  })

  it('keys TIMER_CRUD per timer id so different timers stay separate', () => {
    const cA: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 1,
      roomId: 'room-1',
      timer: timer('t1'),
      clientId: 'c1',
    }
    const cB: QueuedEvent = {
      type: 'CREATE_TIMER',
      timestamp: 2,
      roomId: 'room-1',
      timer: timer('t2'),
      clientId: 'c1',
    }
    expect(mergeQueuedEvents([cA, cB])).toEqual([cA, cB])
  })

  it('final output is sorted ascending by timestamp across groups', () => {
    const reorder: QueuedEvent = {
      type: 'REORDER_TIMERS',
      timestamp: 100,
      roomId: 'room-1',
      timerIds: ['a'],
      clientId: 'c1',
    }
    const action: QueuedEvent = {
      type: 'TIMER_ACTION',
      action: 'START',
      timestamp: 5,
      roomId: 'room-1',
      timerId: 't1',
      clientId: 'c1',
    }
    const patch: QueuedEvent = {
      type: 'ROOM_STATE_PATCH',
      timestamp: 50,
      roomId: 'room-1',
      changes: { isRunning: true },
      clientId: 'c1',
    }
    const merged = mergeQueuedEvents([reorder, action, patch])
    expect(merged.map((event) => event.timestamp)).toEqual([5, 50, 100])
  })

  it('returns an empty array for an empty queue', () => {
    expect(mergeQueuedEvents([])).toEqual([])
  })
})
