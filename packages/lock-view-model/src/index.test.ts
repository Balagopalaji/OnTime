import { describe, expect, it } from 'vitest'
import {
  clearRoomControlLifecycleState,
  prunePendingControlRequests,
  reduceControlDisplacementsForLockUpdate,
  reduceControlRequestsByStatus,
  reducePendingControlRequestByStatus,
  resolveControllerLockState,
  resolveLockAuthoritySource,
  shouldResetQueuedLockReplayOnSocketChange,
} from './index'

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

  it('clears request state on cleared status for the requester', () => {
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
