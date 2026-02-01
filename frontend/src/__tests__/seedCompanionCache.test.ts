import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Tests for SEED_COMPANION_CACHE protocol logic.
 *
 * Companion-side overwrite rules are tested as pure logic (mirroring the
 * handleSeedCompanionCache algorithm). Frontend guard behavior is tested
 * with a minimal mock of the seedCompanion callback pattern.
 */

// ---------------------------------------------------------------------------
// Companion-side: overwrite arbitration helpers (mirrors handleSeedCompanionCache)
// ---------------------------------------------------------------------------

type MinimalState = { lastUpdate?: number; [k: string]: unknown }
type MinimalItem = { id: string; updatedAt?: number; [k: string]: unknown }
type MinimalPin = { value: string | null; updatedAt: number }

function shouldApplyState(incoming: MinimalState, local: MinimalState | undefined): boolean {
  const incomingTs = incoming.lastUpdate ?? 0
  const localTs = local?.lastUpdate ?? 0
  return incomingTs > localTs
}

function shouldApplyItem(incoming: MinimalItem, local: MinimalItem | undefined): boolean {
  const incomingTs = incoming.updatedAt ?? 0
  const localTs = local?.updatedAt ?? 0
  return incomingTs > localTs
}

function shouldApplyPin(incoming: MinimalPin, local: MinimalPin | undefined): boolean {
  const localTs = local?.updatedAt ?? 0
  return incoming.updatedAt > localTs
}

// ---------------------------------------------------------------------------
// Companion overwrite rules
// ---------------------------------------------------------------------------

describe('SEED_COMPANION_CACHE overwrite rules', () => {
  describe('state arbitration', () => {
    it('applies incoming state when newer than local', () => {
      expect(shouldApplyState({ lastUpdate: 200 }, { lastUpdate: 100 })).toBe(true)
    })

    it('rejects incoming state when older than local', () => {
      expect(shouldApplyState({ lastUpdate: 100 }, { lastUpdate: 200 })).toBe(false)
    })

    it('rejects incoming state when equal to local', () => {
      expect(shouldApplyState({ lastUpdate: 100 }, { lastUpdate: 100 })).toBe(false)
    })

    it('applies incoming state when local has no lastUpdate', () => {
      expect(shouldApplyState({ lastUpdate: 100 }, undefined)).toBe(true)
    })

    it('rejects incoming state when incoming has no lastUpdate', () => {
      expect(shouldApplyState({}, { lastUpdate: 100 })).toBe(false)
    })
  })

  describe('timer/cue item arbitration', () => {
    it('applies incoming item when newer', () => {
      expect(shouldApplyItem({ id: 't1', updatedAt: 200 }, { id: 't1', updatedAt: 100 })).toBe(true)
    })

    it('rejects incoming item when older', () => {
      expect(shouldApplyItem({ id: 't1', updatedAt: 100 }, { id: 't1', updatedAt: 200 })).toBe(false)
    })

    it('rejects incoming item when equal', () => {
      expect(shouldApplyItem({ id: 't1', updatedAt: 100 }, { id: 't1', updatedAt: 100 })).toBe(false)
    })

    it('applies incoming item when local does not exist', () => {
      expect(shouldApplyItem({ id: 't1', updatedAt: 100 }, undefined)).toBe(true)
    })

    it('rejects incoming item when both lack updatedAt (0 vs 0)', () => {
      expect(shouldApplyItem({ id: 't1' }, { id: 't1' })).toBe(false)
    })
  })

  describe('pin arbitration', () => {
    it('applies incoming pin when newer', () => {
      expect(shouldApplyPin({ value: '1234', updatedAt: 200 }, { value: '0000', updatedAt: 100 })).toBe(true)
    })

    it('rejects incoming pin when older', () => {
      expect(shouldApplyPin({ value: '1234', updatedAt: 100 }, { value: '0000', updatedAt: 200 })).toBe(false)
    })

    it('applies incoming pin when local has no pin', () => {
      expect(shouldApplyPin({ value: '1234', updatedAt: 100 }, undefined)).toBe(true)
    })
  })

  describe('tombstone guard', () => {
    it('tombstoned rooms are skipped', () => {
      const tombstones = new Set(['room-1'])
      const rooms = [
        { roomId: 'room-1', state: { lastUpdate: 999 } },
        { roomId: 'room-2', state: { lastUpdate: 200 } },
      ]
      const localStates = new Map<string, MinimalState>([['room-2', { lastUpdate: 100 }]])

      let updated = 0
      for (const entry of rooms) {
        if (tombstones.has(entry.roomId)) continue
        if (shouldApplyState(entry.state, localStates.get(entry.roomId))) {
          updated++
        }
      }

      expect(updated).toBe(1) // Only room-2 was processed
    })
  })
})

// ---------------------------------------------------------------------------
// Frontend: seedCompanion guard behavior
// ---------------------------------------------------------------------------

describe('seedCompanion guard behavior', () => {
  let seedFired: { current: boolean }
  let mockSocket: { connected: boolean; emit: ReturnType<typeof vi.fn> }
  let mockFirebaseRooms: Array<{ id: string; state: { lastUpdate: number } }>
  let mockGetTimers: ReturnType<typeof vi.fn>
  let mockGetCues: ReturnType<typeof vi.fn>

  /** Mirrors the seedCompanion callback logic from UnifiedDataContext */
  function seedCompanion() {
    if (!mockSocket?.connected) return
    if (seedFired.current) return

    const firebaseRooms = mockFirebaseRooms ?? []
    if (firebaseRooms.length === 0) return
    seedFired.current = true

    const rooms = firebaseRooms.map((room) => ({
      roomId: room.id,
      state: room.state,
      timers: mockGetTimers(room.id),
      cues: mockGetCues(room.id),
    }))

    mockSocket.emit('SEED_COMPANION_CACHE', { type: 'SEED_COMPANION_CACHE', rooms, timestamp: Date.now() })
  }

  beforeEach(() => {
    seedFired = { current: false }
    mockSocket = { connected: true, emit: vi.fn() }
    mockFirebaseRooms = [{ id: 'room-1', state: { lastUpdate: 100 } }]
    mockGetTimers = vi.fn().mockReturnValue([])
    mockGetCues = vi.fn().mockReturnValue([])
  })

  it('emits SEED_COMPANION_CACHE when socket is connected and rooms exist', () => {
    seedCompanion()
    expect(mockSocket.emit).toHaveBeenCalledOnce()
    expect(mockSocket.emit).toHaveBeenCalledWith('SEED_COMPANION_CACHE', expect.objectContaining({ type: 'SEED_COMPANION_CACHE' }))
  })

  it('does not fire twice in the same session', () => {
    seedCompanion()
    seedCompanion()
    expect(mockSocket.emit).toHaveBeenCalledOnce()
  })

  it('fires again after seedFired is reset (simulating disconnect)', () => {
    seedCompanion()
    seedFired.current = false // disconnect resets this
    seedCompanion()
    expect(mockSocket.emit).toHaveBeenCalledTimes(2)
  })

  it('does not fire when socket is disconnected', () => {
    mockSocket.connected = false
    seedCompanion()
    expect(mockSocket.emit).not.toHaveBeenCalled()
  })

  it('does not fire when rooms are empty and does not set seedFired', () => {
    mockFirebaseRooms = []
    seedCompanion()
    expect(mockSocket.emit).not.toHaveBeenCalled()
    expect(seedFired.current).toBe(false) // can retry later when rooms load
  })

  it('fires later once rooms become available', () => {
    mockFirebaseRooms = []
    seedCompanion() // no rooms yet
    expect(mockSocket.emit).not.toHaveBeenCalled()

    mockFirebaseRooms = [{ id: 'room-1', state: { lastUpdate: 100 } }]
    seedCompanion() // rooms now available
    expect(mockSocket.emit).toHaveBeenCalledOnce()
  })
})
