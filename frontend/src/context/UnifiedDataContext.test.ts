import { describe, expect, it } from 'vitest'
import { getConfidenceWindowMs, resolveControllerLockState, resolveRoomSource } from './UnifiedDataContext'

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
    isCompanionLive: true,
    viewerSyncGuard: false,
    firebaseTs: 1234,
    companionTs: 1234,
    authoritySource: 'cloud' as const,
    mode: 'auto' as const,
    effectiveMode: 'cloud' as const,
    confidenceWindowMs: 2000,
  }

  it('prefers controller-originated companion changes on equal timestamps', () => {
    expect(resolveRoomSource({ ...baseArgs, controllerTieBreaker: 'companion' })).toBe('companion')
  })

  it('prefers controller-originated cloud changes on equal timestamps', () => {
    expect(resolveRoomSource({ ...baseArgs, controllerTieBreaker: 'cloud' })).toBe('cloud')
  })
})
