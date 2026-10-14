import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearViewerToken, readViewerToken, writeViewerToken } from './lan-viewer-token'

const KEY = 'ontime:viewerToken:room-1'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('LAN viewer token storage', () => {
  it('round-trips under the key the room viewer already uses', () => {
    // Defect: the presentation viewer and the room viewer pair separately.
    writeViewerToken('room-1', { token: 't', expiresAt: Date.now() + 60_000, role: 'all' })
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    expect(readViewerToken('room-1')).toMatchObject({ token: 't', role: 'all' })
    clearViewerToken('room-1')
    expect(readViewerToken('room-1')).toBeNull()
  })

  it('drops expired or malformed entries', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ token: 't', expiresAt: Date.now() - 1, role: 'all' }))
    expect(readViewerToken('room-1')).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    window.localStorage.setItem(KEY, '{nope')
    expect(readViewerToken('room-1')).toBeNull()
    window.localStorage.setItem(KEY, JSON.stringify({ token: '', expiresAt: 'x' }))
    expect(readViewerToken('room-1')).toBeNull()
    expect(readViewerToken('')).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readViewerToken('room-1')).toBeNull()
    expect(() => writeViewerToken('room-1', { token: 't', expiresAt: Date.now() + 1000, role: 'all' })).not.toThrow()
    expect(() => clearViewerToken('room-1')).not.toThrow()
  })
})
