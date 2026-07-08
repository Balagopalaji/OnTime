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
  type EmitMock = ReturnType<typeof vi.fn<(event: string, payload: unknown) => void>>
  type RoomLookupMock = ReturnType<typeof vi.fn<(roomId: string) => unknown[]>>
  let seedFired: { current: boolean }
  let mockSocket: { connected: boolean; emit: EmitMock }
  let mockFirebaseRooms: Array<{ id: string; state: { lastUpdate: number } }>
  let mockGetTimers: RoomLookupMock
  let mockGetCues: RoomLookupMock

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
    mockSocket = { connected: true, emit: vi.fn<(event: string, payload: unknown) => void>() }
    mockFirebaseRooms = [{ id: 'room-1', state: { lastUpdate: 100 } }]
    mockGetTimers = vi.fn<(roomId: string) => unknown[]>().mockReturnValue([])
    mockGetCues = vi.fn<(roomId: string) => unknown[]>().mockReturnValue([])
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

// ---------------------------------------------------------------------------
// Lean projection behavior (toSeedRoomState)
// ---------------------------------------------------------------------------

/**
 * Tests that seedCompanion emits the lean companion projection with stored values.
 *
 * The seed payload should:
 * - NOT include: startedAt, elapsedOffset, progress, clockMode
 * - DOES include: activeTimerId, isRunning, currentTime, lastUpdate, showClock, message, title, timezone, activeLiveCueId
 * - Use stored currentTime/lastUpdate values (NOT computed)
 * - Skip rooms without lastUpdate
 */
describe('seedCompanion emits the lean companion projection with stored values', () => {
  type FullCloudState = {
    activeTimerId: string | null
    isRunning: boolean
    startedAt: number | null
    elapsedOffset: number
    progress: Record<string, number>
    showClock?: boolean
    clockMode?: '24h' | 'ampm'
    message?: { text: string; visible: boolean; color: string }
    currentTime?: number
    lastUpdate?: number
    activeLiveCueId?: string
    title?: string
    timezone?: string
  }
  // Removed FullRoom type alias - inlined for lint

  /** Mirrors the toSeedRoomState logic from UnifiedDataContext */
  function toSeedRoomState(room: { id: string; state: FullCloudState }) {
    const { state } = room
    if (!state?.lastUpdate) return undefined

    return {
      activeTimerId: state.activeTimerId ?? null,
      isRunning: state.isRunning ?? false,
      currentTime: state.currentTime ?? 0,
      lastUpdate: state.lastUpdate,
      ...(state.showClock !== undefined && { showClock: state.showClock }),
      ...(state.message && { message: state.message }),
      ...(state.title && { title: state.title }),
      ...(state.timezone && { timezone: state.timezone }),
      ...(state.activeLiveCueId && { activeLiveCueId: state.activeLiveCueId }),
    }
  }

  it('emits lean projection with only allowed fields', () => {
    const storedState: FullCloudState = {
      activeTimerId: 'timer-a',
      isRunning: true,
      startedAt: 1000,                      // EXCLUDED
      elapsedOffset: 200,                  // EXCLUDED
      progress: { 'timer-a': 5000 },        // EXCLUDED
      showClock: true,
      clockMode: '24h',                     // EXCLUDED
      message: { text: 'Go', visible: true, color: 'green' },
      currentTime: 9000,
      lastUpdate: 2000,
      activeLiveCueId: 'cue-x',
      title: 'Room Title',
      timezone: 'America/New_York',
    }

    const leanState = toSeedRoomState({ id: 'room-1', state: storedState })
    expect(leanState).toBeDefined()

    // Fields that SHOULD be included
    expect(leanState).toMatchObject({
      activeTimerId: 'timer-a',
      isRunning: true,
      currentTime: 9000,
      lastUpdate: 2000,
      showClock: true,
      message: { text: 'Go', visible: true, color: 'green' },
      title: 'Room Title',
      timezone: 'America/New_York',
      activeLiveCueId: 'cue-x',
    })

    // Fields that should NOT be included
    expect(leanState).not.toHaveProperty('startedAt')
    expect(leanState).not.toHaveProperty('elapsedOffset')
    expect(leanState).not.toHaveProperty('progress')
    expect(leanState).not.toHaveProperty('clockMode')
  })

  it('uses stored currentTime and lastUpdate without computation', () => {
    const storedState: FullCloudState = {
      activeTimerId: 'timer-a',
      isRunning: false,
      startedAt: 1000,                      // 30 minutes ago
      elapsedOffset: 1800000,               // 30 minutes in ms
      progress: { 'timer-a': 1234 },
      showClock: false,
      message: { text: '', visible: false, color: 'none' },
      currentTime: 1234,                    // Stored value, NOT computed
      lastUpdate: 5678,                     // Stored value, NOT Date.now()
      activeLiveCueId: 'live-1',
    }

    const leanState = toSeedRoomState({ id: 'room-1', state: storedState })
    expect(leanState).toBeDefined()

    // Verify stored values are used directly (no computation)
    expect(leanState?.currentTime).toBe(1234)       // Stored value, not computed
    expect(leanState?.lastUpdate).toBe(5678)       // Stored value, not Date.now()
  })

  it('skips rooms without lastUpdate', () => {
    const stateWithoutLastUpdate: FullCloudState = {
      activeTimerId: 'timer-a',
      isRunning: true,
      startedAt: 1000,
      elapsedOffset: 200,
      progress: { 'timer-a': 5000 },
      showClock: true,
      message: { text: 'Go', visible: true, color: 'green' },
      currentTime: 9000,
      // lastUpdate is MISSING
      activeLiveCueId: 'cue-x',
    }

    const leanState = toSeedRoomState({ id: 'room-1', state: stateWithoutLastUpdate })
    expect(leanState).toBeUndefined()
  })

  it('handles minimal state with only required fields', () => {
    const minimalState: FullCloudState = {
      activeTimerId: null,
      isRunning: false,
      startedAt: null,
      elapsedOffset: 0,
      progress: {},
      // showClock: undefined (omitted on purpose)
      // message: undefined (omitted on purpose)
      currentTime: 0,
      lastUpdate: 123,
    }

    const leanState = toSeedRoomState({ id: 'room-1', state: minimalState })
    expect(leanState).toBeDefined()
    expect(leanState).toMatchObject({
      activeTimerId: null,
      isRunning: false,
      currentTime: 0,
      lastUpdate: 123,
    })

    // Optional fields not present in minimal state should not be in output
    expect(leanState).not.toHaveProperty('showClock')
    expect(leanState).not.toHaveProperty('message')
    expect(leanState).not.toHaveProperty('title')
    expect(leanState).not.toHaveProperty('timezone')
    expect(leanState).not.toHaveProperty('activeLiveCueId')
  })

  it('includes optional fields when present', () => {
    const stateWithOptionals: FullCloudState = {
      activeTimerId: 'timer-b',
      isRunning: true,
      startedAt: 5000,
      elapsedOffset: 1000,
      progress: { 'timer-b': 2000 },
      showClock: true,
      message: { text: 'Message', visible: true, color: 'blue' },
      currentTime: 3000,
      lastUpdate: 4000,
      title: 'Test Room',
      timezone: 'UTC',
      activeLiveCueId: 'cue-123',
    }

    const leanState = toSeedRoomState({ id: 'room-2', state: stateWithOptionals })
    expect(leanState).toBeDefined()

    expect(leanState?.showClock).toBe(true)
    expect(leanState?.message).toEqual({ text: 'Message', visible: true, color: 'blue' })
    expect(leanState?.title).toBe('Test Room')
    expect(leanState?.timezone).toBe('UTC')
    expect(leanState?.activeLiveCueId).toBe('cue-123')
  })

  it('preserves bonus time (negative elapsedOffset) as stored currentTime', () => {
    const bonusTimeState: FullCloudState = {
      activeTimerId: 'timer-c',
      isRunning: true,
      startedAt: 1000,
      elapsedOffset: -30000,                 // Negative (bonus time)
      progress: { 'timer-c': 5000 },
      showClock: true,
      message: { text: 'Bonus', visible: true, color: 'gold' },
      currentTime: -30000,                   // Stored negative value
      lastUpdate: 7000,
      activeLiveCueId: 'cue-abc',
    }

    const leanState = toSeedRoomState({ id: 'room-3', state: bonusTimeState })
    expect(leanState).toBeDefined()
    expect(leanState?.currentTime).toBe(-30000)  // Negative value preserved
    expect(leanState?.lastUpdate).toBe(7000)
  })
})
