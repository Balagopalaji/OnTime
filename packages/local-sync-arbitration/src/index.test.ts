import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ArbitrationDecision,
  ArbitrationInput,
  ArbitrationLastAcceptedCache,
  CueQueuedEvent,
  QueuedEvent,
} from './index'
import {
  buildRoomFromCompanion,
  getConfidenceWindowMs,
  isSnapshotStale,
  mergeControllerClients,
  mergeCueQueueEvents,
  mergeQueuedEvents,
  normalizeRoomAuthoritySource,
  resolveQueuedCompanionLockReplayCallbackState,
  resolveQueuedCompanionLockReplayState,
  resolveReconciledTimerTargetId,
  resolveRoomSource,
  resolveSnapshotTimestamp,
  shouldBootstrapCachedSubscriptions,
  toCompanionRoomState,
  translateCompanionStateToFirebase,
} from './index'
import type { ControllerClient, Cue, Room, Timer } from '@ontime/shared-types'

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

describe('mergeCueQueueEvents', () => {
  const cue = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, roomId: 'room-1', role: 'lx', title: 'Lights', triggerType: 'timed', createdBy: 'user-1', ...extra }) as unknown as Cue

  it('keys CUE_CRUD per cue id (CREATE/UPDATE/DELETE share a group)', () => {
    const cA: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 1,
      roomId: 'room-1',
      cue: cue('cue-1'),
      clientId: 'c1',
    }
    const cB: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 2,
      roomId: 'room-1',
      cue: cue('cue-2'),
      clientId: 'c1',
    }
    // Different cue ids stay in separate groups and are both kept.
    expect(mergeCueQueueEvents([cA, cB])).toEqual([cA, cB])
  })

  it('DELETE present in a cue group wins (last delete wins)', () => {
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 1,
      roomId: 'room-1',
      cue: cue('cue-1'),
      clientId: 'c1',
    }
    const update: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 2,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'x' },
      clientId: 'c1',
    }
    const del1: CueQueuedEvent = {
      type: 'DELETE_CUE',
      timestamp: 3,
      roomId: 'room-1',
      cueId: 'cue-1',
      clientId: 'c1',
    }
    const del2: CueQueuedEvent = {
      type: 'DELETE_CUE',
      timestamp: 5,
      roomId: 'room-1',
      cueId: 'cue-1',
      clientId: 'c2',
    }

    expect(mergeCueQueueEvents([create, update, del1, del2])).toEqual([del2])
  })

  it('merges CREATE + UPDATE into one CREATE with merged cue (update newer -> update clientId, max timestamp)', () => {
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 1,
      roomId: 'room-1',
      cue: cue('cue-1', { title: 'orig', notes: 'keep' }),
      clientId: 'creator',
    }
    const update: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 4,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'renamed' },
      clientId: 'updater',
    }

    const merged = mergeCueQueueEvents([create, update])
    expect(merged).toEqual([
      {
        type: 'CREATE_CUE',
        timestamp: 4,
        roomId: 'room-1',
        cue: cue('cue-1', { title: 'renamed', notes: 'keep' }),
        clientId: 'updater',
      },
    ])
  })

  it('CREATE + UPDATE with update NOT newer keeps create clientId but still uses max timestamp', () => {
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 10,
      roomId: 'room-1',
      cue: cue('cue-1', { title: 'orig' }),
      clientId: 'creator',
    }
    const update: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 4,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'renamed' },
      clientId: 'updater',
    }

    const merged = mergeCueQueueEvents([create, update])
    expect(merged).toEqual([
      {
        type: 'CREATE_CUE',
        timestamp: 10,
        roomId: 'room-1',
        cue: cue('cue-1', { title: 'renamed' }),
        clientId: 'creator',
      },
    ])
  })

  it('CREATE + UPDATE at equal timestamp uses the update clientId (>= is inclusive)', () => {
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 5,
      roomId: 'room-1',
      cue: cue('cue-1'),
      clientId: 'creator',
    }
    const update: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 5,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'renamed' },
      clientId: 'updater',
    }

    const merged = mergeCueQueueEvents([create, update])
    expect(merged).toEqual([
      {
        type: 'CREATE_CUE',
        timestamp: 5,
        roomId: 'room-1',
        cue: cue('cue-1', { title: 'renamed' }),
        clientId: 'updater',
      },
    ])
  })

  it('CREATE only in a group is returned as the create', () => {
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 7,
      roomId: 'room-1',
      cue: cue('cue-1'),
      clientId: 'c1',
    }
    expect(mergeCueQueueEvents([create])).toEqual([create])
  })

  it('fallthrough (updates only, no create/delete) collapses to the latest', () => {
    const u1: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 2,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'a' },
      clientId: 'c1',
    }
    const u2: CueQueuedEvent = {
      type: 'UPDATE_CUE',
      timestamp: 8,
      roomId: 'room-1',
      cueId: 'cue-1',
      changes: { title: 'b' },
      clientId: 'c1',
    }
    expect(mergeCueQueueEvents([u1, u2])).toEqual([u2])
  })

  it('keys REORDER_CUES per roomId and keeps the latest reorder', () => {
    const r1: CueQueuedEvent = {
      type: 'REORDER_CUES',
      timestamp: 3,
      roomId: 'room-1',
      cueIds: ['a', 'b'],
      clientId: 'c1',
    }
    const r2: CueQueuedEvent = {
      type: 'REORDER_CUES',
      timestamp: 9,
      roomId: 'room-1',
      cueIds: ['b', 'a'],
      clientId: 'c1',
    }
    expect(mergeCueQueueEvents([r1, r2])).toEqual([r2])
  })

  it('keys REORDER_CUES per roomId so different rooms are kept separate', () => {
    const rA: CueQueuedEvent = {
      type: 'REORDER_CUES',
      timestamp: 3,
      roomId: 'room-1',
      cueIds: ['a'],
      clientId: 'c1',
    }
    const rB: CueQueuedEvent = {
      type: 'REORDER_CUES',
      timestamp: 4,
      roomId: 'room-2',
      cueIds: ['b'],
      clientId: 'c1',
    }
    expect(mergeCueQueueEvents([rA, rB])).toEqual([rA, rB])
  })

  it('final output is sorted ascending by timestamp across groups', () => {
    const reorder: CueQueuedEvent = {
      type: 'REORDER_CUES',
      timestamp: 100,
      roomId: 'room-1',
      cueIds: ['a'],
      clientId: 'c1',
    }
    const create: CueQueuedEvent = {
      type: 'CREATE_CUE',
      timestamp: 5,
      roomId: 'room-1',
      cue: cue('cue-1'),
      clientId: 'c1',
    }
    const del: CueQueuedEvent = {
      type: 'DELETE_CUE',
      timestamp: 50,
      roomId: 'room-1',
      cueId: 'cue-2',
      clientId: 'c1',
    }
    const merged = mergeCueQueueEvents([reorder, create, del])
    expect(merged.map((event) => event.timestamp)).toEqual([5, 50, 100])
  })

  it('returns an empty array for an empty queue', () => {
    expect(mergeCueQueueEvents([])).toEqual([])
  })
})

describe('mergeControllerClients', () => {
  const NOW = 1_700_000_000_000
  const MAX_AGE_MS = 900_000

  const client = (overrides: Partial<ControllerClient> & { clientId: string }): ControllerClient => ({
    clientType: 'controller',
    ...overrides,
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keys distinct sources for the same clientId separately', () => {
    const result = mergeControllerClients(
      [client({ clientId: 'a', source: 'cloud', lastHeartbeat: NOW })],
      [client({ clientId: 'a', source: 'companion', lastHeartbeat: NOW })],
    )
    expect(result).toHaveLength(2)
    expect(new Set(result.map((c) => c.source))).toEqual(new Set(['cloud', 'companion']))
  })

  it('merges an incoming sourced client into an existing unknown-source entry and dedupes the fallback key', () => {
    const result = mergeControllerClients(
      [client({ clientId: 'a', deviceName: 'old', lastHeartbeat: NOW - 1000 })],
      [client({ clientId: 'a', source: 'cloud', deviceName: 'new', lastHeartbeat: NOW })],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      clientId: 'a',
      source: 'cloud',
      deviceName: 'new',
      lastHeartbeat: NOW,
    })
  })

  it('lets a newer lastHeartbeat win while preserving prior-only fields (spread order)', () => {
    const result = mergeControllerClients(
      [client({ clientId: 'a', source: 'cloud', deviceName: 'old', userId: 'u1', clientType: 'controller', lastHeartbeat: NOW - 5000 })],
      [client({ clientId: 'a', source: 'cloud', deviceName: 'new', clientType: 'viewer', lastHeartbeat: NOW })],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      source: 'cloud',
      deviceName: 'new',
      clientType: 'viewer',
      userId: 'u1',
      lastHeartbeat: NOW,
    })
  })

  it('backfills source from an older incoming client without overwriting the newer previous heartbeat', () => {
    const result = mergeControllerClients(
      [client({ clientId: 'a', deviceName: 'keep', lastHeartbeat: NOW })],
      [client({ clientId: 'a', source: 'companion', deviceName: 'stale', lastHeartbeat: NOW - 5000 })],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      clientId: 'a',
      source: 'companion',
      deviceName: 'keep',
      lastHeartbeat: NOW,
    })
  })

  it('drops clients with a numeric lastHeartbeat older than the TTL and keeps edge/non-number/fresh entries', () => {
    const result = mergeControllerClients(
      [
        client({ clientId: 'stale', source: 'cloud', lastHeartbeat: NOW - MAX_AGE_MS - 1 }),
        client({ clientId: 'edge', source: 'cloud', lastHeartbeat: NOW - MAX_AGE_MS }),
        client({ clientId: 'nohb', source: 'cloud' }),
        client({ clientId: 'fresh', source: 'companion', lastHeartbeat: NOW }),
      ],
      [],
    )
    expect(result.map((c) => c.clientId).sort()).toEqual(['edge', 'fresh', 'nohb'])
  })

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeControllerClients([], [])).toEqual([])
  })
})

describe('queued companion lock replay arbitration', () => {
  it('replays queued lock payload after hold expires', () => {
    const payload = { roomId: 'room-1', type: 'CONTROLLER_LOCK_STATE' } as const
    const held = resolveQueuedCompanionLockReplayState(payload, true)
    expect(held.shouldRequeue).toBe(true)
    expect(held.replayPayload).toBeNull()

    const replayed = resolveQueuedCompanionLockReplayState(payload, false)
    expect(replayed.shouldRequeue).toBe(false)
    expect(replayed.replayPayload).toEqual(payload)
  })

  it('does not replay queued lock payload after room unsubscribe', () => {
    const payload = { roomId: 'room-1', type: 'CONTROLLER_LOCK_STATE' } as const
    const replayState = resolveQueuedCompanionLockReplayState(payload, false, false)
    expect(replayState.shouldRequeue).toBe(false)
    expect(replayState.replayPayload).toBeNull()
    expect(replayState.queuedPayload).toBeNull()
  })

  it('replay callback no-ops when room unsubscribes before apply', () => {
    const payload = { roomId: 'room-1', type: 'CONTROLLER_LOCK_STATE' } as const
    const replayState = resolveQueuedCompanionLockReplayCallbackState(
      resolveQueuedCompanionLockReplayState(payload, false, true),
      false,
    )
    expect(replayState.shouldRequeue).toBe(false)
    expect(replayState.replayPayload).toBeNull()
    expect(replayState.queuedPayload).toBeNull()
  })
})

describe('buildRoomFromCompanion', () => {
  it('uses fallback owner for companion-only room bootstrap when no base room exists', () => {
    const room = buildRoomFromCompanion(
      'room-fallback',
      {
        activeTimerId: null,
        isRunning: false,
        currentTime: 0,
        lastUpdate: 1234,
      } as Parameters<typeof buildRoomFromCompanion>[1],
      undefined,
      'user-123',
    )

    expect(room.ownerId).toBe('user-123')
  })
})

// Pins the companion -> cloud Room['state'] projection (translateCompanionStateToFirebase),
// the timer-elapsed mapping used by buildRoomFromCompanion and the ROOM_STATE_SNAPSHOT
// handler: companion currentTime is the elapsed anchor (elapsedOffset === currentTime),
// and a running timer anchors startedAt on lastUpdate (null when paused).
describe('translateCompanionStateToFirebase (companion -> cloud state projection)', () => {
  it('maps a running companion projection: elapsedOffset/currentTime = companion currentTime, startedAt = lastUpdate', () => {
    const state = translateCompanionStateToFirebase({
      activeTimerId: 't1',
      isRunning: true,
      currentTime: 4200,
      lastUpdate: 9000,
    } as Parameters<typeof translateCompanionStateToFirebase>[0])

    expect(state.isRunning).toBe(true)
    expect(state.activeTimerId).toBe('t1')
    expect(state.elapsedOffset).toBe(4200)
    expect(state.currentTime).toBe(4200)
    expect(state.lastUpdate).toBe(9000)
    expect(state.startedAt).toBe(9000)
  })

  it('leaves startedAt null when paused but still carries elapsedOffset = currentTime (bonus time preserved)', () => {
    const state = translateCompanionStateToFirebase({
      activeTimerId: 't1',
      isRunning: false,
      currentTime: -2000,
      lastUpdate: 9000,
    } as Parameters<typeof translateCompanionStateToFirebase>[0])

    expect(state.isRunning).toBe(false)
    expect(state.startedAt).toBeNull()
    expect(state.elapsedOffset).toBe(-2000)
    expect(state.currentTime).toBe(-2000)
  })
})

// Pins the cloud -> CompanionRoomState adapter (toCompanionRoomState) that
// replaces the previous `room.state as RoomState` structural-lie seed cast.
// The adapter is the explicit, lossless conversion from the cloud
// startedAt/elapsedOffset anchor to the companion currentTime/lastUpdate
// projection. It must NOT emit startedAt or clockMode (those are not part of
// the companion projection), and it must carry title/timezone from the room.
describe('toCompanionRoomState (cloud -> companion adapter)', () => {
  type CloudRoom = Parameters<typeof toCompanionRoomState>[0]

  function makeRoom(overrides: Partial<CloudRoom['state']> = {}): CloudRoom {
    return {
      id: 'room-1',
      ownerId: 'owner-1',
      title: 'Main Stage',
      timezone: 'America/New_York',
      createdAt: 1,
      order: 0,
      config: { warningSec: 60, criticalSec: 15 },
      state: {
        activeTimerId: 'timer-a',
        isRunning: true,
        startedAt: 1000,
        elapsedOffset: 0,
        progress: { 'timer-a': 5000 },
        showClock: true,
        message: { text: 'Go', visible: true, color: 'green' },
        lastUpdate: 2000,
        ...overrides,
      },
    }
  }

  it('produces a CompanionRoomState anchored on currentTime/lastUpdate', () => {
    const out = toCompanionRoomState(makeRoom(), 5000)
    expect(out.activeTimerId).toBe('timer-a')
    expect(out.isRunning).toBe(true)
    // currentTime comes from the caller (computed elapsed), not the cloud anchor.
    expect(out.currentTime).toBe(5000)
    expect(out.lastUpdate).toBe(2000)
    expect(out.showClock).toBe(true)
    expect(out.message).toEqual({ text: 'Go', visible: true, color: 'green' })
    expect(out.title).toBe('Main Stage')
    expect(out.timezone).toBe('America/New_York')
  })

  it('does NOT carry startedAt or clockMode (companion projection is divergent)', () => {
    const out = toCompanionRoomState(makeRoom({ clockMode: '24h' }), 0)
    expect(out).not.toHaveProperty('startedAt')
    expect(out).not.toHaveProperty('clockMode')
    // Compile-time guard: the CompanionRoomState type has no such keys.
    type Keys = keyof typeof out
    const hasStartedAt: Keys extends 'startedAt' ? true : false = false as never
    const hasClockMode: Keys extends 'clockMode' ? true : false = false as never
    expect(hasStartedAt).toBe(false as never)
    expect(hasClockMode).toBe(false as never)
  })

  it('defaults optional cloud fields (null activeTimerId, missing lastUpdate)', () => {
    const out = toCompanionRoomState(
      makeRoom({ activeTimerId: null, lastUpdate: undefined }),
      0,
    )
    expect(out.activeTimerId).toBeNull()
    // lastUpdate falls back to Date.now() when cloud omits it.
    expect(typeof out.lastUpdate).toBe('number')
    expect(out.lastUpdate).toBeGreaterThan(0)
  })
})
