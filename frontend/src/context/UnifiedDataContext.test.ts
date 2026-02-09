import * as React from 'react'
import { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  buildRoomFromCompanion,
  clearRoomControlLifecycleState,
  getConfidenceWindowMs,
  getReconnectJoinEntries,
  mergeCueQueueEvents,
  prunePendingControlRequests,
  readCachedSubscriptions,
  requeueJoinEntryToTail,
  readRoomCache,
  reduceControlDisplacementsForLockUpdate,
  reduceControlRequestsByStatus,
  reducePendingControlRequestByStatus,
  resolveQueuedCompanionLockReplayCallbackState,
  resolveQueuedCompanionLockReplayState,
  resolveControllerLockState,
  resolveRoomSource,
  shouldBootstrapCachedSubscriptions,
  shouldApplyControlRequestTimeoutError,
  shouldResetQueuedLockReplayOnSocketChange,
  shouldQueueCompanionLockPayload,
  resolveReconciledTimerTargetId,
  type CueQueuedEvent,
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
})

describe('mergeCueQueueEvents', () => {
  const baseCue = {
    id: 'cue-1',
    roomId: 'room-1',
    role: 'lx' as const,
    title: 'Lights',
    triggerType: 'timed' as const,
    createdBy: 'user-1',
  }

  it('merges update into create', () => {
    const queue: CueQueuedEvent[] = [
      {
        type: 'CREATE_CUE',
        roomId: 'room-1',
        cue: baseCue,
        timestamp: 100,
        clientId: 'client-a',
      },
      {
        type: 'UPDATE_CUE',
        roomId: 'room-1',
        cueId: 'cue-1',
        changes: { title: 'LX Go' },
        timestamp: 200,
        clientId: 'client-a',
      },
    ]

    const merged = mergeCueQueueEvents(queue)
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('CREATE_CUE')
    if (merged[0].type === 'CREATE_CUE') {
      expect(merged[0].cue.title).toBe('LX Go')
    }
  })

  it('keeps delete as the final action', () => {
    const queue: CueQueuedEvent[] = [
      {
        type: 'CREATE_CUE',
        roomId: 'room-1',
        cue: baseCue,
        timestamp: 100,
        clientId: 'client-a',
      },
      {
        type: 'DELETE_CUE',
        roomId: 'room-1',
        cueId: 'cue-1',
        timestamp: 200,
        clientId: 'client-a',
      },
    ]

    const merged = mergeCueQueueEvents(queue)
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('DELETE_CUE')
  })

  it('retains reorder events', () => {
    const queue: CueQueuedEvent[] = [
      {
        type: 'REORDER_CUES',
        roomId: 'room-1',
        cueIds: ['cue-1', 'cue-2'],
        timestamp: 300,
        clientId: 'client-a',
      },
    ]

    const merged = mergeCueQueueEvents(queue)
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('REORDER_CUES')
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
