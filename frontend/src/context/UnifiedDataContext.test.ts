import * as React from 'react'
import { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRoomFromCompanion,
  clearRoomControlLifecycleState,
  getConfidenceWindowMs,
  getReconnectJoinEntries,
  prunePendingControlRequests,
  readCachedSubscriptions,
  requeueJoinEntryToTail,
  readRoomCache,
  reduceControlDisplacementsForLockUpdate,
  reduceControlRequestsByStatus,
  reducePendingControlRequestByStatus,
  resolveQueuedCompanionLockReplayCallbackState,
  resolveQueuedCompanionLockReplayState,
  resolveLockAuthoritySource,
  resolveControllerLockState,
  resolveRoomSource,
  shouldBootstrapCachedSubscriptions,
  shouldApplyControlRequestTimeoutError,
  shouldResetQueuedLockReplayOnSocketChange,
  shouldQueueCompanionLockPayload,
  resolveReconciledTimerTargetId,
  toCompanionRoomState,
} from './UnifiedDataContext'
import { resolveControllerTimerTargetId } from '../routes/controller-timer-target'

const baseArgs = {
  roomId: 'room-1',
  clientId: 'client-a',
  controllerLocks: {},
  controlDisplacements: {},
  pendingControlRequests: {},
}

describe('resolveControllerLockState', () => {
  it('returns authoritative when no lock exists', () => {
    expect(resolveControllerLockState(baseArgs)).toBe('authoritative')
  })

  const buildLock = (clientId: string) => ({
    clientId,
    roomId: 'room-1',
    lockedAt: 0,
    lastHeartbeat: 0,
  })

  it('returns authoritative when current client holds the lock', () => {
    expect(
      resolveControllerLockState({
        ...baseArgs,
        controllerLocks: { 'room-1': buildLock('client-a') },
      }),
    ).toBe('authoritative')
  })

  it('returns read-only when another client holds the lock', () => {
    expect(
      resolveControllerLockState({
        ...baseArgs,
        controllerLocks: { 'room-1': buildLock('client-b') },
      }),
    ).toBe('read-only')
  })

  it('returns requesting when this client has a pending request', () => {
    expect(
      resolveControllerLockState({
        ...baseArgs,
        controllerLocks: { 'room-1': buildLock('client-b') },
        pendingControlRequests: { 'room-1': { requesterId: 'client-a' } },
      }),
    ).toBe('requesting')
  })

  it('returns displaced when control was taken from this client', () => {
    expect(
      resolveControllerLockState({
        ...baseArgs,
        controllerLocks: { 'room-1': buildLock('client-b') },
        controlDisplacements: { 'room-1': { takenAt: Date.now() } },
        pendingControlRequests: { 'room-1': { requesterId: 'client-a' } },
      }),
    ).toBe('displaced')
  })

  it('ignores stale displacement when no active lock exists', () => {
    expect(
      resolveControllerLockState({
        ...baseArgs,
        controllerLocks: { 'room-1': null },
        controlDisplacements: { 'room-1': { takenAt: Date.now() } },
      }),
    ).toBe('authoritative')
  })
})

describe('resolveLockAuthoritySource', () => {
  it('uses cloud lock authority for active rooms while cloud is online', () => {
    expect(
      resolveLockAuthoritySource({
        room: { id: 'room-1' },
        connectionStatus: 'online',
      }),
    ).toBe('cloud')
  })

  it('falls back to companion lock authority when cloud is offline', () => {
    expect(
      resolveLockAuthoritySource({
        room: { id: 'room-1' },
        connectionStatus: 'offline',
      }),
    ).toBe('companion')
  })

  it('falls back to companion lock authority before the room is loaded', () => {
    expect(
      resolveLockAuthoritySource({
        room: undefined,
        connectionStatus: 'online',
      }),
    ).toBe('companion')
  })
})

describe('control-lock authority + lock-state composition (characterization)', () => {
  const buildLock = (clientId: string) => ({
    clientId,
    roomId: 'room-1',
    lockedAt: 0,
    lastHeartbeat: 0,
  })

  it('feeds resolved authority alongside lock-state resolution for holder vs non-holder clients', () => {
    // Cloud online + room loaded => cloud authority; non-holding client is read-only.
    expect(
      resolveLockAuthoritySource({ room: { id: 'room-1' }, connectionStatus: 'online' }),
    ).toBe('cloud')
    expect(
      resolveControllerLockState({
        roomId: 'room-1',
        clientId: 'client-a',
        controllerLocks: { 'room-1': buildLock('client-b') },
        controlDisplacements: {},
        pendingControlRequests: {},
      }),
    ).toBe('read-only')

    // Cloud offline => companion authority; the lock holder stays authoritative.
    expect(
      resolveLockAuthoritySource({ room: { id: 'room-1' }, connectionStatus: 'offline' }),
    ).toBe('companion')
    expect(
      resolveControllerLockState({
        roomId: 'room-1',
        clientId: 'client-a',
        controllerLocks: { 'room-1': buildLock('client-a') },
        controlDisplacements: {},
        pendingControlRequests: {},
      }),
    ).toBe('authoritative')
  })
})

describe('getConfidenceWindowMs', () => {
  it('uses the base window when no churn is detected', () => {
    expect(getConfidenceWindowMs(false)).toBe(2000)
  })

  it('expands the window when reconnect churn is detected', () => {
    expect(getConfidenceWindowMs(true)).toBe(4000)
  })
})

describe('resolveRoomSource', () => {
  const baseArgs = {
    roomId: 'room-1',
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

  it('prefers controller-originated companion changes on equal timestamps', () => {
    expect(resolveRoomSource({ ...baseArgs, controllerTieBreaker: 'companion' })).toBe('companion')
  })

  it('prefers controller-originated cloud changes on equal timestamps', () => {
    expect(resolveRoomSource({ ...baseArgs, controllerTieBreaker: 'cloud' })).toBe('cloud')
  })

  it('uses the viewer sync guard to keep viewers on cloud while Companion syncs', () => {
    expect(
      resolveRoomSource({
        ...baseArgs,
        viewerSyncGuard: true,
        effectiveMode: 'local',
        preferSource: 'companion',
      }),
    ).toBe('cloud')
  })

  it('uses local preference for ambiguous room arbitration', () => {
    expect(
      resolveRoomSource({
        ...baseArgs,
        effectiveMode: 'local',
        preferSource: 'companion',
      }),
    ).toBe('companion')
  })

  it('falls back to cloud when Companion is offline', () => {
    expect(resolveRoomSource({ ...baseArgs, isCompanionLive: false })).toBe('cloud')
  })

  it('uses Companion when cloud is offline', () => {
    expect(resolveRoomSource({ ...baseArgs, cloudOnline: false })).toBe('companion')
  })

  it('normalizes pending authority before arbitration', () => {
    expect(
      resolveRoomSource({
        ...baseArgs,
        authoritySource: 'pending',
        effectiveMode: 'local',
        preferSource: 'companion',
      }),
    ).toBe('companion')
  })

  it('remembers the last accepted source across calls when both sides go offline (cache wired through)', () => {
    // Unique room so the shared module-level lastAccepted cache (lib/arbitration.ts) is uncontaminated.
    const cacheArgs = { ...baseArgs, roomId: 'room-rs-cache' }
    // Online: companion materially newer, outside the window -> decides + caches 'companion'.
    expect(
      resolveRoomSource({
        ...cacheArgs,
        firebaseTs: 1_000,
        companionTs: 10_000,
        confidenceWindowMs: 10,
      }),
    ).toBe('companion')

    // Both sides now offline: must return the cached 'companion', NOT the authority/mode fallback
    // ('cloud'). Pins that resolveRoomSource still delegates to the app's wrapped arbitrate
    // (lastAccepted cache) — a cache-less core arbitrate would fall back to 'cloud' here.
    expect(
      resolveRoomSource({
        ...cacheArgs,
        isCompanionLive: false,
        cloudOnline: false,
      }),
    ).toBe('companion')
  })
})

describe('BUG-CTRL-SELECTED-001 controller timer target reconciliation', () => {
  it('falls back to valid active timer when rundown selection is stale', () => {
    const target = resolveControllerTimerTargetId({
      shortcutScope: 'rundown',
      selectedTimerId: 'timer-stale',
      activeTimerId: 'timer-active',
      timers: [{ id: 'timer-active' }, { id: 'timer-next' }],
    })

    expect(target).toBe('timer-active')
  })
})

describe('BUG-CTRL-SELECTED-002 unified timer target reconciliation', () => {
  it('does not persist invalid requested timer id when active timer is valid', () => {
    const target = resolveReconciledTimerTargetId({
      requestedTimerId: 'timer-missing',
      activeTimerId: 'timer-active',
      timers: [{ id: 'timer-active' }, { id: 'timer-next' }] as Parameters<
        typeof resolveReconciledTimerTargetId
      >[0]['timers'],
    })

    expect(target).toBe('timer-active')
  })

  it('falls back to first timer when both requested and active ids are invalid', () => {
    const target = resolveReconciledTimerTargetId({
      requestedTimerId: 'timer-missing',
      activeTimerId: 'timer-stale',
      timers: [{ id: 'timer-1' }, { id: 'timer-2' }] as Parameters<
        typeof resolveReconciledTimerTargetId
      >[0]['timers'],
    })

    expect(target).toBe('timer-1')
  })

  it('returns the requested id when it is still present in the rundown', () => {
    const target = resolveReconciledTimerTargetId({
      requestedTimerId: 'timer-1',
      activeTimerId: 'timer-2',
      timers: [{ id: 'timer-1' }, { id: 'timer-2' }] as Parameters<
        typeof resolveReconciledTimerTargetId
      >[0]['timers'],
    })

    expect(target).toBe('timer-1')
  })

  it('falls back through requested/active/null when the rundown is empty', () => {
    const timers = [] as Parameters<typeof resolveReconciledTimerTargetId>[0]['timers']

    expect(resolveReconciledTimerTargetId({ requestedTimerId: 'r', activeTimerId: 'a', timers })).toBe('r')
    expect(resolveReconciledTimerTargetId({ requestedTimerId: null, activeTimerId: 'a', timers })).toBe('a')
    expect(resolveReconciledTimerTargetId({ requestedTimerId: null, activeTimerId: null, timers })).toBe(null)
  })
})

describe('getReconnectJoinEntries', () => {
  it('returns reconnect entries only for active intent rooms with subscriptions', () => {
    const entries = getReconnectJoinEntries(
      {
        'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
        'room-b': { clientType: 'viewer', token: 'token-b', tokenSource: 'viewer' },
      },
      new Set(['room-b', 'room-c']),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.[0]).toBe('room-b')
    expect(entries[0]?.[1]).toEqual({
      clientType: 'viewer',
      token: 'token-b',
      tokenSource: 'viewer',
    })
  })

  it('returns no reconnect entries when intents are empty by default', () => {
    const entries = getReconnectJoinEntries(
      {
        'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
      },
      new Set<string>(),
    )

    expect(entries).toEqual([])
  })

  it('returns all cached subscriptions when intents are empty and include-all fallback is enabled', () => {
    const entries = getReconnectJoinEntries(
      {
        'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
        'room-b': { clientType: 'viewer', token: 'token-b', tokenSource: 'viewer' },
      },
      new Set<string>(),
      { includeAllWhenNoIntents: true },
    )

    expect(entries).toEqual([
      ['room-a', { clientType: 'controller', token: 'token-a', tokenSource: 'controller' }],
      ['room-b', { clientType: 'viewer', token: 'token-b', tokenSource: 'viewer' }],
    ])
  })
})

describe('join replay queue progression', () => {
  it('keeps queue progress deterministic when one join fails and is requeued', () => {
    const queue = requeueJoinEntryToTail(
      [
        { roomId: 'room-b', clientType: 'controller', token: 'token-b', tokenSource: 'controller' },
      ],
      { roomId: 'room-a', clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
    )

    expect(queue.map((entry) => entry.roomId)).toEqual(['room-b', 'room-a'])
  })
})

describe('ACK-LAT-002 join watchdog integration', () => {
  it('clears stalled in-flight join, requeues it, and resumes queue processing after watchdog timeout', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    class FakeSocket {
      connected = true
      active = true
      connect = vi.fn()
      disconnect = vi.fn()
      emit = vi.fn()
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      on(event: string, cb: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? new Set()
        list.add(cb)
        this.listeners.set(event, list)
      }

      off(event: string, cb: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(cb)
      }

      trigger(event: string, payload?: unknown) {
        this.listeners.get(event)?.forEach((cb) => cb(payload))
      }
    }

    const socket = new FakeSocket()
    const companionMock = {
      socket,
      isConnected: true,
      handshakeStatus: 'idle' as const,
      reconnectState: 'idle' as const,
      reconnectAttempts: 0,
      reconnectChurn: false,
      token: 'cached-token',
      fetchToken: vi.fn(async () => 'cached-token'),
      clearToken: vi.fn(),
      markHandshakePending: vi.fn(),
      retryConnection: vi.fn(),
      protocolStatus: { clientVersion: '1.2.0', serverVersion: '1.2.0', compatibility: 'ok' as const },
      companionMode: 'show_control',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: true },
      capabilitiesRevision: 0,
      systemInfo: null,
      discoverCompanion: vi.fn(async () => 'cached-token'),
    }
    const firebaseValue = {
      rooms: [],
      connectionStatus: 'online',
      setConnectionStatus: vi.fn(),
      pendingRooms: new Set<string>(),
      pendingRoomPlaceholders: [],
      pendingTimers: {},
      pendingTimerPlaceholders: {},
      undoRoomDelete: vi.fn(async () => {}),
      redoRoomDelete: vi.fn(async () => {}),
      undoTimerDelete: vi.fn(async () => {}),
      redoTimerDelete: vi.fn(async () => {}),
      clearUndoStacks: vi.fn(async () => {}),
      getRoom: vi.fn(() => undefined),
      getTimers: vi.fn(() => []),
      getCues: vi.fn(() => []),
      getLiveCues: vi.fn(() => []),
      getLiveCueRecords: vi.fn(() => []),
      createRoom: vi.fn(async () => { throw new Error('not used') }),
      deleteRoom: vi.fn(async () => {}),
      createTimer: vi.fn(async () => undefined),
      createCue: vi.fn(async () => undefined),
      updateTimer: vi.fn(async () => {}),
      updateCue: vi.fn(async () => {}),
      updateRoomMeta: vi.fn(async () => {}),
      restoreTimer: vi.fn(async () => {}),
      resetTimerProgress: vi.fn(async () => {}),
      deleteTimer: vi.fn(async () => {}),
      deleteCue: vi.fn(async () => {}),
      moveTimer: vi.fn(async () => {}),
      reorderTimer: vi.fn(async () => {}),
      reorderCues: vi.fn(async () => {}),
      getSections: vi.fn(() => []),
      getSegments: vi.fn(() => []),
      createSection: vi.fn(async () => undefined),
      updateSection: vi.fn(async () => {}),
      deleteSection: vi.fn(async () => {}),
      reorderSections: vi.fn(async () => {}),
      createSegment: vi.fn(async () => undefined),
      updateSegment: vi.fn(async () => {}),
      deleteSegment: vi.fn(async () => {}),
      reorderSegments: vi.fn(async () => {}),
      setActiveTimer: vi.fn(async () => {}),
      startTimer: vi.fn(async () => {}),
      pauseTimer: vi.fn(async () => {}),
      resetTimer: vi.fn(async () => {}),
      nudgeTimer: vi.fn(async () => {}),
      setClockMode: vi.fn(async () => {}),
      setClockFormat: vi.fn(async () => {}),
      updateMessage: vi.fn(async () => {}),
      controllerLocks: {},
      roomPins: {},
      roomClients: {},
      controlRequests: {},
      pendingControlRequests: {},
      controlDenials: {},
      controlDisplacements: {},
      controlErrors: {},
      getControllerLock: vi.fn(() => null),
      getControllerLockState: vi.fn(() => 'authoritative'),
      getRoomPin: vi.fn(() => null),
      setRoomPin: vi.fn(),
      requestControl: vi.fn(),
      forceTakeover: vi.fn(),
      handOverControl: vi.fn(),
      denyControl: vi.fn(),
      enqueueOfflineAction: vi.fn(),
      clearOfflineQueue: vi.fn(),
      cloudSync: vi.fn(),
      cloudSyncEnabled: false,
      clearLiveCues: vi.fn(),
      sendHeartbeat: vi.fn(),
    }

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => companionMock,
    }))
    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'auto', effectiveMode: 'local' }),
    }))
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    const { UnifiedDataProvider, useUnifiedDataContext, JOIN_PENDING_WATCHDOG_MS } = module
    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => {
        ctxRef = ctx
      }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))

    await act(async () => {
      await Promise.resolve()
    })
    expect(ctxRef).not.toBeNull()

    await act(async () => {
      ctxRef?.subscribeToCompanionRoom('room-a', 'controller')
      await Promise.resolve()
      await Promise.resolve()
    })

    const joinRoomCallsAfterQueue = socket.emit.mock.calls.filter(([event]) => event === 'JOIN_ROOM')
    expect(joinRoomCallsAfterQueue.map(([, payload]) => (payload as { roomId: string }).roomId)).toEqual(['room-a'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOIN_PENDING_WATCHDOG_MS + 1)
    })
    const joinRoomCallsAfterFirstWatchdog = socket.emit.mock.calls.filter(([event]) => event === 'JOIN_ROOM')
    expect(joinRoomCallsAfterFirstWatchdog.map(([, payload]) => (payload as { roomId: string }).roomId)).toEqual([
      'room-a',
      'room-a',
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOIN_PENDING_WATCHDOG_MS + 1)
    })
    const joinRoomCallsAfterSecondWatchdog = socket.emit.mock.calls.filter(([event]) => event === 'JOIN_ROOM')
    expect(joinRoomCallsAfterSecondWatchdog.map(([, payload]) => (payload as { roomId: string }).roomId)).toEqual([
      'room-a',
      'room-a',
      'room-a',
    ])

    view.unmount()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
  })

  it('retries after HANDSHAKE_PENDING without forcing a disconnect loop', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    class FakeSocket {
      connected = true
      active = true
      connect = vi.fn()
      disconnect = vi.fn()
      emit = vi.fn()
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      on(event: string, cb: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? new Set()
        list.add(cb)
        this.listeners.set(event, list)
      }

      off(event: string, cb: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(cb)
      }

      trigger(event: string, payload?: unknown) {
        this.listeners.get(event)?.forEach((cb) => cb(payload))
      }
    }

    const socket = new FakeSocket()
    const companionMock = {
      socket,
      isConnected: true,
      handshakeStatus: 'idle' as const,
      reconnectState: 'idle' as const,
      reconnectAttempts: 0,
      reconnectChurn: false,
      token: 'cached-token',
      fetchToken: vi.fn(async () => 'cached-token'),
      clearToken: vi.fn(),
      markHandshakePending: vi.fn(),
      retryConnection: vi.fn(),
      protocolStatus: { clientVersion: '1.2.0', serverVersion: '1.2.0', compatibility: 'ok' as const },
      companionMode: 'show_control',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: true },
      capabilitiesRevision: 0,
      systemInfo: null,
      discoverCompanion: vi.fn(async () => 'cached-token'),
    }
    const firebaseValue = {
      rooms: [],
      connectionStatus: 'online',
      setConnectionStatus: vi.fn(),
      pendingRooms: new Set<string>(),
      pendingRoomPlaceholders: [],
      pendingTimers: {},
      pendingTimerPlaceholders: {},
      undoRoomDelete: vi.fn(async () => {}),
      redoRoomDelete: vi.fn(async () => {}),
      undoTimerDelete: vi.fn(async () => {}),
      redoTimerDelete: vi.fn(async () => {}),
      clearUndoStacks: vi.fn(async () => {}),
      getRoom: vi.fn(() => undefined),
      getTimers: vi.fn(() => []),
      getCues: vi.fn(() => []),
      getLiveCues: vi.fn(() => []),
      getLiveCueRecords: vi.fn(() => []),
      createRoom: vi.fn(async () => { throw new Error('not used') }),
      deleteRoom: vi.fn(async () => {}),
      createTimer: vi.fn(async () => undefined),
      createCue: vi.fn(async () => undefined),
      updateTimer: vi.fn(async () => {}),
      updateCue: vi.fn(async () => {}),
      updateRoomMeta: vi.fn(async () => {}),
      restoreTimer: vi.fn(async () => {}),
      resetTimerProgress: vi.fn(async () => {}),
      deleteTimer: vi.fn(async () => {}),
      deleteCue: vi.fn(async () => {}),
      moveTimer: vi.fn(async () => {}),
      reorderTimer: vi.fn(async () => {}),
      reorderCues: vi.fn(async () => {}),
      getSections: vi.fn(() => []),
      getSegments: vi.fn(() => []),
      createSection: vi.fn(async () => undefined),
      updateSection: vi.fn(async () => {}),
      deleteSection: vi.fn(async () => {}),
      reorderSections: vi.fn(async () => {}),
      createSegment: vi.fn(async () => undefined),
      updateSegment: vi.fn(async () => {}),
      deleteSegment: vi.fn(async () => {}),
      reorderSegments: vi.fn(async () => {}),
      setActiveTimer: vi.fn(async () => {}),
      startTimer: vi.fn(async () => {}),
      pauseTimer: vi.fn(async () => {}),
      resetTimer: vi.fn(async () => {}),
      nudgeTimer: vi.fn(async () => {}),
      setClockMode: vi.fn(async () => {}),
      setClockFormat: vi.fn(async () => {}),
      updateMessage: vi.fn(async () => {}),
      controllerLocks: {},
      roomPins: {},
      roomClients: {},
      controlRequests: {},
      pendingControlRequests: {},
      controlDenials: {},
      controlDisplacements: {},
      controlErrors: {},
      getControllerLock: vi.fn(() => null),
      getControllerLockState: vi.fn(() => 'authoritative'),
      getRoomPin: vi.fn(() => null),
      setRoomPin: vi.fn(),
      requestControl: vi.fn(),
      forceTakeover: vi.fn(),
      handOverControl: vi.fn(),
      denyControl: vi.fn(),
      enqueueOfflineAction: vi.fn(),
      clearOfflineQueue: vi.fn(),
      cloudSync: vi.fn(),
      cloudSyncEnabled: false,
      clearLiveCues: vi.fn(),
      sendHeartbeat: vi.fn(),
    }

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => companionMock,
    }))
    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'auto', effectiveMode: 'local' }),
    }))
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    const { UnifiedDataProvider, useUnifiedDataContext, JOIN_PENDING_WATCHDOG_MS } = module
    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => {
        ctxRef = ctx
      }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(ctxRef).not.toBeNull()

    await act(async () => {
      ctxRef?.subscribeToCompanionRoom('room-a', 'controller')
      await Promise.resolve()
    })
    expect(socket.emit.mock.calls.filter(([event]) => event === 'JOIN_ROOM')).toHaveLength(1)

    act(() => {
      socket.trigger('HANDSHAKE_ERROR', {
        type: 'HANDSHAKE_ERROR',
        code: 'HANDSHAKE_PENDING',
        message: 'Handshake still pending.',
      })
    })
    expect(socket.disconnect).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOIN_PENDING_WATCHDOG_MS + 1)
    })
    expect(socket.emit.mock.calls.filter(([event]) => event === 'JOIN_ROOM')).toHaveLength(2)

    view.unmount()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
  })

  it('does not forward reauthenticated in local force takeover payloads', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    class FakeSocket {
      connected = true
      active = true
      connect = vi.fn()
      disconnect = vi.fn()
      emit = vi.fn()
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      on(event: string, cb: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? new Set()
        list.add(cb)
        this.listeners.set(event, list)
      }

      off(event: string, cb: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(cb)
      }
    }

    const socket = new FakeSocket()
    const companionMock = {
      socket,
      isConnected: true,
      handshakeStatus: 'ack' as const,
      reconnectState: 'idle' as const,
      reconnectAttempts: 0,
      reconnectChurn: false,
      token: 'cached-token',
      fetchToken: vi.fn(async () => 'cached-token'),
      clearToken: vi.fn(),
      markHandshakePending: vi.fn(),
      retryConnection: vi.fn(),
      protocolStatus: { clientVersion: '1.2.0', serverVersion: '1.2.0', compatibility: 'ok' as const },
      companionMode: 'show_control',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: true },
      capabilitiesRevision: 0,
      systemInfo: null,
      discoverCompanion: vi.fn(async () => 'cached-token'),
    }
    const firebaseValue = {
      rooms: [],
      connectionStatus: 'online',
      setConnectionStatus: vi.fn(),
      pendingRooms: new Set<string>(),
      pendingRoomPlaceholders: [],
      pendingTimers: {},
      pendingTimerPlaceholders: {},
      undoRoomDelete: vi.fn(async () => {}),
      redoRoomDelete: vi.fn(async () => {}),
      undoTimerDelete: vi.fn(async () => {}),
      redoTimerDelete: vi.fn(async () => {}),
      clearUndoStacks: vi.fn(async () => {}),
      getRoom: vi.fn(() => undefined),
      getTimers: vi.fn(() => []),
      getCues: vi.fn(() => []),
      getLiveCues: vi.fn(() => []),
      getLiveCueRecords: vi.fn(() => []),
      createRoom: vi.fn(async () => { throw new Error('not used') }),
      deleteRoom: vi.fn(async () => {}),
      createTimer: vi.fn(async () => undefined),
      createCue: vi.fn(async () => undefined),
      updateTimer: vi.fn(async () => {}),
      updateCue: vi.fn(async () => {}),
      updateRoomMeta: vi.fn(async () => {}),
      restoreTimer: vi.fn(async () => {}),
      resetTimerProgress: vi.fn(async () => {}),
      deleteTimer: vi.fn(async () => {}),
      deleteCue: vi.fn(async () => {}),
      moveTimer: vi.fn(async () => {}),
      reorderTimer: vi.fn(async () => {}),
      reorderCues: vi.fn(async () => {}),
      getSections: vi.fn(() => []),
      getSegments: vi.fn(() => []),
      createSection: vi.fn(async () => undefined),
      updateSection: vi.fn(async () => {}),
      deleteSection: vi.fn(async () => {}),
      reorderSections: vi.fn(async () => {}),
      createSegment: vi.fn(async () => undefined),
      updateSegment: vi.fn(async () => {}),
      deleteSegment: vi.fn(async () => {}),
      reorderSegments: vi.fn(async () => {}),
      setActiveTimer: vi.fn(async () => {}),
      startTimer: vi.fn(async () => {}),
      pauseTimer: vi.fn(async () => {}),
      resetTimer: vi.fn(async () => {}),
      nudgeTimer: vi.fn(async () => {}),
      setClockMode: vi.fn(async () => {}),
      setClockFormat: vi.fn(async () => {}),
      updateMessage: vi.fn(async () => {}),
      controllerLocks: {},
      roomPins: {},
      roomClients: {},
      controlRequests: {},
      pendingControlRequests: {},
      controlDenials: {},
      controlDisplacements: {},
      controlErrors: {},
      getControllerLock: vi.fn(() => null),
      getControllerLockState: vi.fn(() => 'authoritative'),
      getRoomPin: vi.fn(() => null),
      setRoomPin: vi.fn(),
      requestControl: vi.fn(),
      forceTakeover: vi.fn(),
      handOverControl: vi.fn(),
      denyControl: vi.fn(),
      enqueueOfflineAction: vi.fn(),
      clearOfflineQueue: vi.fn(),
      cloudSync: vi.fn(),
      cloudSyncEnabled: false,
      clearLiveCues: vi.fn(),
      sendHeartbeat: vi.fn(),
    }

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => companionMock,
    }))
    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'auto', effectiveMode: 'local' }),
    }))
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    const { UnifiedDataProvider, useUnifiedDataContext } = module
    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => {
        ctxRef = ctx
      }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(ctxRef).not.toBeNull()

    act(() => {
      ctxRef?.forceTakeover('room-a', { reauthenticated: true })
    })

    const forceCall = socket.emit.mock.calls.find(([event]) => event === 'FORCE_TAKEOVER')
    expect(forceCall).toBeTruthy()
    const [, payload] = forceCall as [string, { reauthenticated?: boolean }]
    expect(payload.reauthenticated).toBeUndefined()

    view.unmount()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
  })

  it('does not send timer lastUpdate in local metadata-only room patches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.resetModules()

    class FakeSocket {
      connected = true
      active = true
      connect = vi.fn()
      disconnect = vi.fn()
      emit = vi.fn()
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      on(event: string, cb: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? new Set()
        list.add(cb)
        this.listeners.set(event, list)
      }

      off(event: string, cb: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(cb)
      }
    }

    const socket = new FakeSocket()
    const companionMock = {
      socket,
      isConnected: true,
      handshakeStatus: 'ack' as const,
      reconnectState: 'idle' as const,
      reconnectAttempts: 0,
      reconnectChurn: false,
      token: 'cached-token',
      fetchToken: vi.fn(async () => 'cached-token'),
      clearToken: vi.fn(),
      markHandshakePending: vi.fn(),
      retryConnection: vi.fn(),
      protocolStatus: { clientVersion: '1.2.0', serverVersion: '1.2.0', compatibility: 'ok' as const },
      companionMode: 'show_control',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: true },
      capabilitiesRevision: 0,
      systemInfo: null,
      discoverCompanion: vi.fn(async () => 'cached-token'),
    }
    const firebaseValue = {
      rooms: [],
      connectionStatus: 'online',
      setConnectionStatus: vi.fn(),
      pendingRooms: new Set<string>(),
      pendingRoomPlaceholders: [],
      pendingTimers: {},
      pendingTimerPlaceholders: {},
      undoRoomDelete: vi.fn(async () => {}),
      redoRoomDelete: vi.fn(async () => {}),
      undoTimerDelete: vi.fn(async () => {}),
      redoTimerDelete: vi.fn(async () => {}),
      clearUndoStacks: vi.fn(async () => {}),
      getRoom: vi.fn(() => undefined),
      getTimers: vi.fn(() => []),
      getCues: vi.fn(() => []),
      getLiveCues: vi.fn(() => []),
      getLiveCueRecords: vi.fn(() => []),
      createRoom: vi.fn(async () => { throw new Error('not used') }),
      deleteRoom: vi.fn(async () => {}),
      createTimer: vi.fn(async () => undefined),
      createCue: vi.fn(async () => undefined),
      updateTimer: vi.fn(async () => {}),
      updateCue: vi.fn(async () => {}),
      updateRoomMeta: vi.fn(async () => {}),
      restoreTimer: vi.fn(async () => {}),
      resetTimerProgress: vi.fn(async () => {}),
      deleteTimer: vi.fn(async () => {}),
      deleteCue: vi.fn(async () => {}),
      moveTimer: vi.fn(async () => {}),
      reorderTimer: vi.fn(async () => {}),
      reorderCues: vi.fn(async () => {}),
      getSections: vi.fn(() => []),
      getSegments: vi.fn(() => []),
      createSection: vi.fn(async () => undefined),
      updateSection: vi.fn(async () => {}),
      deleteSection: vi.fn(async () => {}),
      reorderSections: vi.fn(async () => {}),
      createSegment: vi.fn(async () => undefined),
      updateSegment: vi.fn(async () => {}),
      deleteSegment: vi.fn(async () => {}),
      reorderSegments: vi.fn(async () => {}),
      setActiveTimer: vi.fn(async () => {}),
      startTimer: vi.fn(async () => {}),
      pauseTimer: vi.fn(async () => {}),
      resetTimer: vi.fn(async () => {}),
      nudgeTimer: vi.fn(async () => {}),
      setClockMode: vi.fn(async () => {}),
      setClockFormat: vi.fn(async () => {}),
      updateMessage: vi.fn(async () => {}),
      controllerLocks: {},
      roomPins: {},
      roomClients: {},
      controlRequests: {},
      pendingControlRequests: {},
      controlDenials: {},
      controlDisplacements: {},
      controlErrors: {},
      getControllerLock: vi.fn(() => null),
      getControllerLockState: vi.fn(() => 'authoritative'),
      getRoomPin: vi.fn(() => null),
      setRoomPin: vi.fn(),
      requestControl: vi.fn(),
      forceTakeover: vi.fn(),
      handOverControl: vi.fn(),
      denyControl: vi.fn(),
      enqueueOfflineAction: vi.fn(),
      clearOfflineQueue: vi.fn(),
      cloudSync: vi.fn(),
      cloudSyncEnabled: false,
      clearLiveCues: vi.fn(),
      sendHeartbeat: vi.fn(),
    }

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => companionMock,
    }))
    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'auto', effectiveMode: 'local' }),
    }))
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    const { UnifiedDataProvider, useUnifiedDataContext } = module
    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => {
        ctxRef = ctx
      }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(ctxRef).not.toBeNull()

    await act(async () => {
      ctxRef?.subscribeToCompanionRoom('room-a', 'controller')
      await Promise.resolve()
    })

    await act(async () => {
      await ctxRef?.updateMessage('room-a', { text: 'Hold' })
      await ctxRef?.setClockMode('room-a', false)
      await ctxRef?.updateRoomMeta('room-a', { title: 'Updated room' })
    })

    const patchCalls = socket.emit.mock.calls.filter(([event]) => event === 'ROOM_STATE_PATCH')
    expect(patchCalls).toHaveLength(3)
    patchCalls.forEach(([, payload]) => {
      expect((payload as { changes: { lastUpdate?: number } }).changes.lastUpdate).toBeUndefined()
      expect((payload as { timestamp?: number }).timestamp).toBe(1_000_000)
    })

    view.unmount()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
  })

  it('keeps timer anchor stable on receiving metadata-only room deltas', async () => {
    vi.useFakeTimers()
    // T0 stays within the arbitration skew threshold of the (zero) cloud timestamp
    // so the companion delta is accepted as "companion newer" rather than skew-rejected.
    vi.setSystemTime(100_000)
    vi.resetModules()

    class FakeSocket {
      connected = true
      active = true
      connect = vi.fn()
      disconnect = vi.fn()
      emit = vi.fn()
      private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      on(event: string, cb: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? new Set()
        list.add(cb)
        this.listeners.set(event, list)
      }

      off(event: string, cb: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(cb)
      }

      trigger(event: string, payload?: unknown) {
        this.listeners.get(event)?.forEach((cb) => cb(payload))
      }
    }

    const socket = new FakeSocket()
    const companionMock = {
      socket,
      isConnected: true,
      handshakeStatus: 'ack' as const,
      reconnectState: 'idle' as const,
      reconnectAttempts: 0,
      reconnectChurn: false,
      token: 'cached-token',
      fetchToken: vi.fn(async () => 'cached-token'),
      clearToken: vi.fn(),
      markHandshakePending: vi.fn(),
      retryConnection: vi.fn(),
      protocolStatus: { clientVersion: '1.2.0', serverVersion: '1.2.0', compatibility: 'ok' as const },
      companionMode: 'show_control',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: true },
      capabilitiesRevision: 0,
      systemInfo: null,
      discoverCompanion: vi.fn(async () => 'cached-token'),
    }
    const firebaseValue = {
      rooms: [],
      connectionStatus: 'online',
      setConnectionStatus: vi.fn(),
      pendingRooms: new Set<string>(),
      pendingRoomPlaceholders: [],
      pendingTimers: {},
      pendingTimerPlaceholders: {},
      undoRoomDelete: vi.fn(async () => {}),
      redoRoomDelete: vi.fn(async () => {}),
      undoTimerDelete: vi.fn(async () => {}),
      redoTimerDelete: vi.fn(async () => {}),
      clearUndoStacks: vi.fn(async () => {}),
      getRoom: vi.fn(() => undefined),
      getTimers: vi.fn(() => []),
      getCues: vi.fn(() => []),
      getLiveCues: vi.fn(() => []),
      getLiveCueRecords: vi.fn(() => []),
      createRoom: vi.fn(async () => { throw new Error('not used') }),
      deleteRoom: vi.fn(async () => {}),
      createTimer: vi.fn(async () => undefined),
      createCue: vi.fn(async () => undefined),
      updateTimer: vi.fn(async () => {}),
      updateCue: vi.fn(async () => {}),
      updateRoomMeta: vi.fn(async () => {}),
      restoreTimer: vi.fn(async () => {}),
      resetTimerProgress: vi.fn(async () => {}),
      deleteTimer: vi.fn(async () => {}),
      deleteCue: vi.fn(async () => {}),
      moveTimer: vi.fn(async () => {}),
      reorderTimer: vi.fn(async () => {}),
      reorderCues: vi.fn(async () => {}),
      getSections: vi.fn(() => []),
      getSegments: vi.fn(() => []),
      createSection: vi.fn(async () => undefined),
      updateSection: vi.fn(async () => {}),
      deleteSection: vi.fn(async () => {}),
      reorderSections: vi.fn(async () => {}),
      createSegment: vi.fn(async () => undefined),
      updateSegment: vi.fn(async () => {}),
      deleteSegment: vi.fn(async () => {}),
      reorderSegments: vi.fn(async () => {}),
      setActiveTimer: vi.fn(async () => {}),
      startTimer: vi.fn(async () => {}),
      pauseTimer: vi.fn(async () => {}),
      resetTimer: vi.fn(async () => {}),
      nudgeTimer: vi.fn(async () => {}),
      setClockMode: vi.fn(async () => {}),
      setClockFormat: vi.fn(async () => {}),
      updateMessage: vi.fn(async () => {}),
      controllerLocks: {},
      roomPins: {},
      roomClients: {},
      controlRequests: {},
      pendingControlRequests: {},
      controlDenials: {},
      controlDisplacements: {},
      controlErrors: {},
      getControllerLock: vi.fn(() => null),
      getControllerLockState: vi.fn(() => 'authoritative'),
      getRoomPin: vi.fn(() => null),
      setRoomPin: vi.fn(),
      requestControl: vi.fn(),
      forceTakeover: vi.fn(),
      handOverControl: vi.fn(),
      denyControl: vi.fn(),
      enqueueOfflineAction: vi.fn(),
      clearOfflineQueue: vi.fn(),
      cloudSync: vi.fn(),
      cloudSyncEnabled: false,
      clearLiveCues: vi.fn(),
      sendHeartbeat: vi.fn(),
    }

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => companionMock,
    }))
    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'auto', effectiveMode: 'local' }),
    }))
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    const { UnifiedDataProvider, useUnifiedDataContext } = module
    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => {
        ctxRef = ctx
      }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => {
      await Promise.resolve()
    })
    expect(ctxRef).not.toBeNull()
    const ctx = ctxRef as unknown as ReturnType<typeof useUnifiedDataContext>

    await act(async () => {
      ctx.subscribeToCompanionRoom('room-a', 'controller')
      await Promise.resolve()
    })

    // Seed a running-timer anchor at T0 (100_000).
    await act(async () => {
      socket.trigger('ROOM_STATE_DELTA', {
        type: 'ROOM_STATE_DELTA',
        roomId: 'room-a',
        changes: {
          activeTimerId: 't1',
          isRunning: true,
          currentTime: 5000,
          lastUpdate: 100_000,
        },
        timestamp: 100_000,
      })
      await Promise.resolve()
    })

    const seeded = ctx.getRoom('room-a')
    expect(seeded?.state.lastUpdate).toBe(100_000)
    expect(seeded?.state.currentTime).toBe(5000)

    // Advance the clock and apply a metadata-only delta (no timer anchor fields).
    // This mirrors exactly what the H-1b companion send-side now emits.
    vi.setSystemTime(150_000)
    await act(async () => {
      socket.trigger('ROOM_STATE_DELTA', {
        type: 'ROOM_STATE_DELTA',
        roomId: 'room-a',
        changes: {
          message: { text: 'Hold' },
        },
        timestamp: 150_000,
      })
      await Promise.resolve()
    })

    const afterMeta = ctx.getRoom('room-a')
    // Anchor must be PRESERVED, not smeared to delta-receipt time.
    expect(afterMeta?.state.lastUpdate).toBe(100_000)
    expect(afterMeta?.state.currentTime).toBe(5000)
    expect(afterMeta?.state.message?.text).toBe('Hold')

    // Positive control: a delta carrying an explicit timer anchor DOES move it.
    await act(async () => {
      socket.trigger('ROOM_STATE_DELTA', {
        type: 'ROOM_STATE_DELTA',
        roomId: 'room-a',
        changes: {
          activeTimerId: 't1',
          isRunning: true,
          currentTime: 7000,
          lastUpdate: 150_000,
        },
        timestamp: 150_000,
      })
      await Promise.resolve()
    })

    const afterAnchor = ctx.getRoom('room-a')
    expect(afterAnchor?.state.lastUpdate).toBe(150_000)
    expect(afterAnchor?.state.currentTime).toBe(7000)

    view.unmount()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
  })
})

describe('secure-reauth-force-takeover', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('./CompanionConnectionContext')
    vi.doUnmock('./AuthContext')
    vi.doUnmock('./AppModeContext')
    vi.doUnmock('./FirebaseDataContext')
    vi.doUnmock('../lib/firebase')
    vi.doUnmock('firebase/functions')
  })

  const buildFirebaseValue = () => ({
    rooms: [],
    connectionStatus: 'online',
    setConnectionStatus: vi.fn(),
    pendingRooms: new Set<string>(),
    pendingRoomPlaceholders: [],
    pendingTimers: {},
    pendingTimerPlaceholders: {},
    undoRoomDelete: vi.fn(async () => {}),
    redoRoomDelete: vi.fn(async () => {}),
    undoTimerDelete: vi.fn(async () => {}),
    redoTimerDelete: vi.fn(async () => {}),
    clearUndoStacks: vi.fn(async () => {}),
    getRoom: vi.fn(() => ({ id: 'room-a', tier: 'show_control', ownerId: 'user-1' })),
    getTimers: vi.fn(() => []),
    getCues: vi.fn(() => []),
    getLiveCues: vi.fn(() => []),
    getLiveCueRecords: vi.fn(() => []),
    createRoom: vi.fn(async () => { throw new Error('not used') }),
    deleteRoom: vi.fn(async () => {}),
    createTimer: vi.fn(async () => undefined),
    createCue: vi.fn(async () => undefined),
    updateTimer: vi.fn(async () => {}),
    updateCue: vi.fn(async () => {}),
    updateRoomMeta: vi.fn(async () => {}),
    restoreTimer: vi.fn(async () => {}),
    resetTimerProgress: vi.fn(async () => {}),
    deleteTimer: vi.fn(async () => {}),
    deleteCue: vi.fn(async () => {}),
    moveTimer: vi.fn(async () => {}),
    reorderTimer: vi.fn(async () => {}),
    reorderCues: vi.fn(async () => {}),
    getSections: vi.fn(() => []),
    getSegments: vi.fn(() => []),
    createSection: vi.fn(async () => undefined),
    updateSection: vi.fn(async () => {}),
    deleteSection: vi.fn(async () => {}),
    reorderSections: vi.fn(async () => {}),
    createSegment: vi.fn(async () => undefined),
    updateSegment: vi.fn(async () => {}),
    deleteSegment: vi.fn(async () => {}),
    reorderSegments: vi.fn(async () => {}),
    setActiveTimer: vi.fn(async () => {}),
    startTimer: vi.fn(async () => {}),
    pauseTimer: vi.fn(async () => {}),
    resetTimer: vi.fn(async () => {}),
    nudgeTimer: vi.fn(async () => {}),
    setClockMode: vi.fn(async () => {}),
    setClockFormat: vi.fn(async () => {}),
    updateMessage: vi.fn(async () => {}),
    controllerLocks: {},
    roomPins: {},
    roomClients: {},
    controlRequests: {},
    pendingControlRequests: {},
    controlDenials: {},
    controlDisplacements: {},
    controlErrors: {},
    getControllerLock: vi.fn(() => null),
    getControllerLockState: vi.fn(() => 'authoritative'),
    getRoomPin: vi.fn(() => null),
    setRoomPin: vi.fn(),
    requestControl: vi.fn(),
    forceTakeover: vi.fn(),
    handOverControl: vi.fn(),
    denyControl: vi.fn(),
    enqueueOfflineAction: vi.fn(),
    clearOfflineQueue: vi.fn(),
    cloudSync: vi.fn(),
    cloudSyncEnabled: false,
    clearLiveCues: vi.fn(),
    sendHeartbeat: vi.fn(),
  })

  const setupCloudProvider = async (mockCallable: ReturnType<typeof vi.fn>) => {
    vi.doMock('../lib/firebase', () => ({
      app: null,
      auth: null,
      db: null,
      functions: { _mock: true },
    }))

    vi.doMock('firebase/functions', () => ({
      httpsCallable: (_fns: unknown, name: string) => {
        if (name === 'forceTakeover') return mockCallable
        return vi.fn(async () => ({ data: { success: true } }))
      },
    }))

    vi.doMock('./CompanionConnectionContext', () => ({
      INTERFACE_VERSION: '1.2.0',
      getTokenExpiryMs: () => null,
      useCompanionConnection: () => ({
        socket: null,
        isConnected: false,
        handshakeStatus: 'idle' as const,
        reconnectState: 'idle' as const,
        reconnectAttempts: 0,
        reconnectChurn: false,
        token: null,
        fetchToken: vi.fn(async () => null),
        clearToken: vi.fn(),
        markHandshakePending: vi.fn(),
        retryConnection: vi.fn(),
        protocolStatus: null,
        companionMode: null,
        capabilities: null,
        capabilitiesRevision: 0,
        systemInfo: null,
        discoverCompanion: vi.fn(async () => null),
      }),
    }))

    vi.doMock('./AuthContext', () => ({
      useAuth: () => ({ user: { uid: 'user-1', displayName: 'User One' } }),
    }))
    vi.doMock('./AppModeContext', () => ({
      useAppMode: () => ({ mode: 'cloud', effectiveMode: 'cloud' }),
    }))

    const firebaseValue = buildFirebaseValue()
    vi.doMock('./FirebaseDataContext', async () => {
      const React = await import('react')
      const { DataProviderBoundary } = await import('./DataContext')
      return {
        FirebaseDataProvider: ({ children }: { children: React.ReactNode }) =>
          React.createElement(DataProviderBoundary, { value: firebaseValue as never }, children),
      }
    })

    const module = await import('./UnifiedDataContext')
    return module
  }

  it('unauthorized caller cannot takeover by setting reauthenticated=true (cloud sends reauthRequired which server verifies via auth_time)', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    // Simulate server rejecting: auth_time too old → PERMISSION_DENIED
    const mockCallable = vi.fn(async () => ({ data: { success: false, error: 'PERMISSION_DENIED' } }))
    const { UnifiedDataProvider, useUnifiedDataContext } = await setupCloudProvider(mockCallable)

    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => { ctxRef = ctx }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => { await Promise.resolve() })
    expect(ctxRef).not.toBeNull()

    act(() => {
      ctxRef?.forceTakeover('room-a', { reauthenticated: true })
    })
    await act(async () => { await Promise.resolve() })

    // The callable is invoked with reauthRequired (server-side check, not raw boolean trust)
    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({ reauthRequired: true }),
    )
    // Server returned PERMISSION_DENIED – the raw boolean alone doesn't grant access
    await expect(mockCallable.mock.results[0].value).resolves.toEqual(
      expect.objectContaining({ data: { success: false, error: 'PERMISSION_DENIED' } }),
    )

    view.unmount()
  })

  it('authorized reauth path succeeds on cloud (server verifies fresh auth_time)', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    // Simulate server accepting: auth_time is fresh
    const mockCallable = vi.fn(async () => ({ data: { success: true, lock: { clientId: 'c1' } } }))
    const { UnifiedDataProvider, useUnifiedDataContext } = await setupCloudProvider(mockCallable)

    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => { ctxRef = ctx }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => { await Promise.resolve() })
    expect(ctxRef).not.toBeNull()

    act(() => {
      ctxRef?.forceTakeover('room-a', { reauthenticated: true })
    })
    await act(async () => { await Promise.resolve() })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-a',
        clientId: expect.any(String),
        userId: 'user-1',
        reauthRequired: true,
      }),
    )

    view.unmount()
  })

  it('PIN path still works (cloud forceTakeover sends pin without reauthRequired)', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const mockCallable = vi.fn(async () => ({ data: { success: true } }))
    const { UnifiedDataProvider, useUnifiedDataContext } = await setupCloudProvider(mockCallable)

    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => { ctxRef = ctx }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => { await Promise.resolve() })
    expect(ctxRef).not.toBeNull()

    act(() => {
      ctxRef?.forceTakeover('room-a', { pin: '1234' })
    })
    await act(async () => { await Promise.resolve() })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    const calls = (mockCallable as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls
    const payload = calls[0]?.[0]
    expect(payload).toBeDefined()
    if (!payload) throw new Error('missing callable payload')
    expect(payload.pin).toBe('1234')
    expect(payload.reauthRequired).toBeUndefined()

    view.unmount()
  })

  it('timeout path still works (cloud forceTakeover without pin or reauth)', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const mockCallable = vi.fn(async () => ({ data: { success: true } }))
    const { UnifiedDataProvider, useUnifiedDataContext } = await setupCloudProvider(mockCallable)

    let ctxRef: ReturnType<typeof useUnifiedDataContext> | null = null
    const Probe = () => {
      const ctx = useUnifiedDataContext()
      useEffect(() => { ctxRef = ctx }, [ctx])
      return null
    }

    const view = render(React.createElement(UnifiedDataProvider, null, React.createElement(Probe)))
    await act(async () => { await Promise.resolve() })
    expect(ctxRef).not.toBeNull()

    act(() => {
      ctxRef?.forceTakeover('room-a')
    })
    await act(async () => { await Promise.resolve() })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    const calls = (mockCallable as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls
    const payload = calls[0]?.[0]
    expect(payload).toBeDefined()
    if (!payload) throw new Error('missing callable payload')
    expect(payload.pin).toBeUndefined()
    expect(payload.reauthRequired).toBeUndefined()

    view.unmount()
  })
})

describe('offline companion room bootstrap helpers', () => {
  it('normalizes cached subscriptions from localStorage', () => {
    localStorage.setItem('ontime:companionSubs.v2', JSON.stringify({
      'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
      'room-b': { clientType: 'something-else', token: 'token-b', tokenSource: 'invalid' },
    }))

    const subscriptions = readCachedSubscriptions()
    expect(subscriptions).toEqual({
      'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' },
      'room-b': { clientType: 'viewer', token: 'token-b', tokenSource: 'controller' },
    })

    localStorage.removeItem('ontime:companionSubs.v2')
  })

  it('reads room cache online with stale-entry filtering and legacy timestamp fallback', () => {
    const now = Date.now()
    const previousOnline = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    localStorage.setItem('ontime:companionRoomCache.v2', JSON.stringify({
      fresh: {
        roomId: 'fresh',
        room: { id: 'fresh', state: { lastUpdate: 50 } },
        timers: [],
        cachedAt: now - 1000,
        source: 'companion',
      },
      legacy: {
        roomId: 'legacy',
        room: { id: 'legacy', state: { lastUpdate: 0 } },
        timers: [],
        updatedAt: now - 1000,
        source: 'cloud',
      },
      stale: {
        roomId: 'stale',
        room: { id: 'stale', state: { lastUpdate: 90 } },
        timers: [],
        cachedAt: now - 20_000,
        source: 'companion',
      },
    }))

    const cache = readRoomCache()
    expect(Object.keys(cache).sort()).toEqual(['fresh', 'legacy'])
    expect(cache.legacy?.cachedAt).toBe(now - 1000)
    expect(cache.legacy?.dataTs).toBe(0)

    localStorage.removeItem('ontime:companionRoomCache.v2')
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: previousOnline })
  })

  it('keeps stale room cache entries while offline', () => {
    const previousOnline = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    localStorage.setItem('ontime:companionRoomCache.v2', JSON.stringify({
      stale: {
        roomId: 'stale',
        room: { id: 'stale', state: { lastUpdate: 42 } },
        timers: [],
        cachedAt: Date.now() - 20_000,
        source: 'companion',
      },
    }))

    const cache = readRoomCache()
    expect(cache.stale?.roomId).toBe('stale')

    localStorage.removeItem('ontime:companionRoomCache.v2')
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: previousOnline })
  })

  it('evaluates cached-subscription bootstrap guard deterministically', () => {
    expect(shouldBootstrapCachedSubscriptions({
      hasBootstrapped: false,
      hasSocket: true,
      hasToken: true,
      cachedSubscriptions: { 'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' } },
    })).toBe(true)

    expect(shouldBootstrapCachedSubscriptions({
      hasBootstrapped: true,
      hasSocket: true,
      hasToken: true,
      cachedSubscriptions: { 'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' } },
    })).toBe(false)

    expect(shouldBootstrapCachedSubscriptions({
      hasBootstrapped: false,
      hasSocket: true,
      hasToken: true,
      cachedSubscriptions: {},
    })).toBe(false)
  })

  it('does not bootstrap when the socket is missing', () => {
    expect(shouldBootstrapCachedSubscriptions({
      hasBootstrapped: false,
      hasSocket: false,
      hasToken: true,
      cachedSubscriptions: { 'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' } },
    })).toBe(false)
  })

  it('does not bootstrap when the token is missing', () => {
    expect(shouldBootstrapCachedSubscriptions({
      hasBootstrapped: false,
      hasSocket: true,
      hasToken: false,
      cachedSubscriptions: { 'room-a': { clientType: 'controller', token: 'token-a', tokenSource: 'controller' } },
    })).toBe(false)
  })

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

describe('hold-conflict lock reconciliation helpers', () => {
  it('queues lock payload during hold conflict instead of dropping it', () => {
    expect(
      shouldQueueCompanionLockPayload({
        holdActive: true,
        cloudClientId: 'cloud-controller',
        companionClientId: 'companion-controller',
      }),
    ).toBe(true)
  })

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

describe('clearRoomControlLifecycleState', () => {
  it('clears pending/denials/displacements/errors during room teardown', () => {
    const next = clearRoomControlLifecycleState(
      'room-1',
      {
        controlRequests: { 'room-1': { requesterId: 'a', requestedAt: 1 } },
        pendingControlRequests: { 'room-1': { requesterId: 'a', requestedAt: 1 } },
        controlDenials: { 'room-1': { requesterId: 'a', deniedAt: 2 } },
        controlDisplacements: { 'room-1': { takenAt: 3, takenById: 'b' } },
        controlErrors: { 'room-1': { code: 'ERR', message: 'error', receivedAt: 4 } },
        roomClients: { 'room-1': [{ clientId: 'a', clientType: 'controller', source: 'companion' }] },
      },
      { clearRoomClients: true },
    )

    expect(next.controlRequests['room-1']).toBeUndefined()
    expect(next.pendingControlRequests['room-1']).toBeUndefined()
    expect(next.controlDenials['room-1']).toBeUndefined()
    expect(next.controlDisplacements['room-1']).toBeUndefined()
    expect(next.controlErrors['room-1']).toBeUndefined()
    expect(next.roomClients['room-1']).toBeUndefined()
  })

  it('clears every lifecycle map for the room at once while leaving other rooms intact (characterization)', () => {
    const slices = {
      controlRequests: {
        'room-1': { requesterId: 'a', requestedAt: 1 },
        'room-2': { requesterId: 'z', requestedAt: 9 },
      },
      pendingControlRequests: {
        'room-1': { requesterId: 'a', requestedAt: 1 },
        'room-2': { requesterId: 'z', requestedAt: 9 },
      },
      controlDenials: {
        'room-1': { requesterId: 'a', deniedAt: 2 },
        'room-2': { requesterId: 'z', deniedAt: 8 },
      },
      controlDisplacements: {
        'room-1': { takenAt: 3, takenById: 'b' },
        'room-2': { takenAt: 7, takenById: 'y' },
      },
      controlErrors: {
        'room-1': { code: 'ERR', message: 'error', receivedAt: 4 },
        'room-2': { code: 'ERR2', message: 'error-2', receivedAt: 6 },
      },
      roomClients: {
        'room-1': [{ clientId: 'a', clientType: 'controller' as const, source: 'companion' as const }],
        'room-2': [{ clientId: 'z', clientType: 'viewer' as const, source: 'companion' as const }],
      },
    }

    const next = clearRoomControlLifecycleState('room-1', slices, { clearRoomClients: true })

    // Every lifecycle map for room-1 is cleared together.
    expect(next.controlRequests['room-1']).toBeUndefined()
    expect(next.pendingControlRequests['room-1']).toBeUndefined()
    expect(next.controlDenials['room-1']).toBeUndefined()
    expect(next.controlDisplacements['room-1']).toBeUndefined()
    expect(next.controlErrors['room-1']).toBeUndefined()
    expect(next.roomClients['room-1']).toBeUndefined()

    // Other rooms are untouched across all maps.
    expect(next.controlRequests['room-2']).toEqual({ requesterId: 'z', requestedAt: 9 })
    expect(next.pendingControlRequests['room-2']).toEqual({ requesterId: 'z', requestedAt: 9 })
    expect(next.controlDenials['room-2']).toEqual({ requesterId: 'z', deniedAt: 8 })
    expect(next.controlDisplacements['room-2']).toEqual({ takenAt: 7, takenById: 'y' })
    expect(next.controlErrors['room-2']).toEqual({ code: 'ERR2', message: 'error-2', receivedAt: 6 })
    expect(next.roomClients['room-2']).toEqual([{ clientId: 'z', clientType: 'viewer', source: 'companion' }])

    // Input maps are not mutated (pure reducer).
    expect(slices.controlRequests['room-1']).toEqual({ requesterId: 'a', requestedAt: 1 })
    expect(slices.roomClients['room-1']).toBeDefined()
  })
})

describe('prunePendingControlRequests', () => {
  it('expires stale pending requests to avoid indefinite requesting', () => {
    const { next, expiredRoomIds } = prunePendingControlRequests(
      {
        'room-1': { requesterId: 'client-a', requestedAt: 0 },
        'room-2': { requesterId: 'client-a', requestedAt: 150_000 },
      },
      200_000,
      90_000,
    )

    expect(expiredRoomIds).toEqual(['room-1'])
    expect(next['room-1']).toBeNull()
    expect(next['room-2']).not.toBeNull()
  })
})

describe('reducePendingControlRequestByStatus', () => {
  it('applies queued then cleared status transitions for requester lifecycle', () => {
    const queued = reducePendingControlRequestByStatus(
      {},
      {
        type: 'CONTROL_REQUEST_STATUS',
        roomId: 'room-1',
        requesterId: 'client-a',
        status: 'queued',
        requestedAt: 123,
        timestamp: 124,
      },
      'client-a',
    )
    expect(queued['room-1']).toEqual({
      requesterId: 'client-a',
      requestedAt: 123,
    })

    const cleared = reducePendingControlRequestByStatus(
      queued,
      {
        type: 'CONTROL_REQUEST_STATUS',
        roomId: 'room-1',
        requesterId: 'client-a',
        status: 'cleared',
        reason: 'lock_changed',
        requestedAt: 123,
        timestamp: 200,
      },
      'client-a',
    )
    expect(cleared['room-1']).toBeNull()
  })

  it('does not clear a newer pending request when cleared status is stale for same requester', () => {
    const queued = reducePendingControlRequestByStatus(
      {},
      {
        type: 'CONTROL_REQUEST_STATUS',
        roomId: 'room-1',
        requesterId: 'client-a',
        status: 'queued',
        requestedAt: 200,
        timestamp: 201,
      },
      'client-a',
    )
    const staleCleared = reducePendingControlRequestByStatus(
      queued,
      {
        type: 'CONTROL_REQUEST_STATUS',
        roomId: 'room-1',
        requesterId: 'client-a',
        status: 'cleared',
        reason: 'lock_changed',
        requestedAt: 100,
        timestamp: 202,
      },
      'client-a',
    )
    expect(staleCleared['room-1']).toEqual({
      requesterId: 'client-a',
      requestedAt: 200,
    })
  })
})

describe('reduceControlRequestsByStatus', () => {
  it('clears controller-side request banner state on cleared status', () => {
    const next = reduceControlRequestsByStatus(
      {
        'room-1': {
          requesterId: 'requester-a',
          requestedAt: 1,
        },
      },
      {
        type: 'CONTROL_REQUEST_STATUS',
        roomId: 'room-1',
        requesterId: 'requester-a',
        status: 'cleared',
        reason: 'request_denied',
        requestedAt: 1,
        timestamp: 2,
      },
    )
    expect(next['room-1']).toBeNull()
  })

  it('non-requester status still resolves control request state while timeout error remains requester-only', () => {
    const payload = {
      type: 'CONTROL_REQUEST_STATUS' as const,
      roomId: 'room-1',
      requesterId: 'requester-a',
      status: 'cleared' as const,
      reason: 'timeout' as const,
      requestedAt: 1,
      timestamp: 2,
    }
    const next = reduceControlRequestsByStatus(
      {
        'room-1': {
          requesterId: 'requester-a',
          requestedAt: 1,
        },
      },
      payload,
    )
    expect(next['room-1']).toBeNull()
    expect(shouldApplyControlRequestTimeoutError(payload, 'other-client')).toBe(false)
    expect(shouldApplyControlRequestTimeoutError(payload, 'requester-a')).toBe(true)
  })

  it('does not clear an active request when cleared status is for a different requester', () => {
    const current = {
      'room-1': {
        requesterId: 'requester-b',
        requestedAt: 5,
      },
    }
    const payload = {
      type: 'CONTROL_REQUEST_STATUS' as const,
      roomId: 'room-1',
      requesterId: 'requester-a',
      status: 'cleared' as const,
      reason: 'request_denied' as const,
      requestedAt: 1,
      timestamp: 6,
    }
    const next = reduceControlRequestsByStatus(current, payload)
    expect(next).toEqual(current)
  })

  it('does not clear a newer active request on stale cleared timestamp tuple', () => {
    const current = {
      'room-1': {
        requesterId: 'requester-a',
        requestedAt: 10,
      },
    }
    const payload = {
      type: 'CONTROL_REQUEST_STATUS' as const,
      roomId: 'room-1',
      requesterId: 'requester-a',
      status: 'cleared' as const,
      reason: 'lock_changed' as const,
      requestedAt: 5,
      timestamp: 11,
    }
    const next = reduceControlRequestsByStatus(current, payload)
    expect(next).toEqual(current)
  })
})

describe('reduceControlDisplacementsForLockUpdate', () => {
  it('clears displacement when lock is removed', () => {
    const next = reduceControlDisplacementsForLockUpdate({
      current: {
        'room-1': {
          takenAt: 100,
          takenById: 'client-b',
        },
      },
      roomId: 'room-1',
      previousLock: {
        roomId: 'room-1',
        clientId: 'client-a',
        lockedAt: 50,
        lastHeartbeat: 50,
      },
      nextLock: null,
      clientId: 'client-a',
      timestamp: 200,
    })
    expect(next['room-1']).toBeNull()
  })

  it('creates displacement when control moves away from current client', () => {
    const next = reduceControlDisplacementsForLockUpdate({
      current: {},
      roomId: 'room-1',
      previousLock: {
        roomId: 'room-1',
        clientId: 'client-a',
        lockedAt: 50,
        lastHeartbeat: 50,
      },
      nextLock: {
        roomId: 'room-1',
        clientId: 'client-b',
        lockedAt: 100,
        lastHeartbeat: 100,
        deviceName: 'Bridge iPad',
      },
      clientId: 'client-a',
      timestamp: 200,
    })
    expect(next['room-1']).toEqual({
      takenAt: 200,
      takenById: 'client-b',
      takenByName: 'Bridge iPad',
      takenByUserId: undefined,
      takenByUserName: undefined,
    })
  })
})

describe('shouldResetQueuedLockReplayOnSocketChange', () => {
  it('does not reset queued replay state on listener effect reruns with same socket', () => {
    const socket = { id: 'socket-a' }
    expect(shouldResetQueuedLockReplayOnSocketChange(socket, socket)).toBe(false)
  })

  it('resets queued replay state when socket instance changes', () => {
    expect(
      shouldResetQueuedLockReplayOnSocketChange(
        { id: 'socket-a' },
        { id: 'socket-b' },
      ),
    ).toBe(true)
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
