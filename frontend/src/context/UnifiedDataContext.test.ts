import { describe, expect, it } from 'vitest'
import {
  clearRoomControlLifecycleState,
  getConfidenceWindowMs,
  getReconnectJoinEntries,
  mergeCueQueueEvents,
  prunePendingControlRequests,
  reduceControlRequestsByStatus,
  reducePendingControlRequestByStatus,
  resolveQueuedCompanionLockReplayState,
  resolveControllerLockState,
  resolveRoomSource,
  shouldApplyControlRequestTimeoutError,
  shouldResetQueuedLockReplayOnSocketChange,
  shouldQueueCompanionLockPayload,
  type CueQueuedEvent,
} from './UnifiedDataContext'

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
