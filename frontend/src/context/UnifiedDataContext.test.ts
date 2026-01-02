import { describe, expect, it } from 'vitest'
import { resolveControllerLockState } from './UnifiedDataContext'

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
