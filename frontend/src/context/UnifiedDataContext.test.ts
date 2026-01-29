import { describe, expect, it } from 'vitest'
import { getConfidenceWindowMs, resolveControllerLockState, resolveRoomSource, mergeCueQueueEvents, type CueQueuedEvent } from './UnifiedDataContext'

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
