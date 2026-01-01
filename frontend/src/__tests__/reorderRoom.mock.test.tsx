import { describe, it, expect } from 'vitest'
import { reorderOwnedRooms } from '../utils/room-utils'
import type { Room } from '../types'

const createRoom = (id: string, order: number, title: string): Room => ({
  id,
  ownerId: 'user-1',
  title,
  timezone: 'UTC',
  createdAt: order,
  order,
  config: { warningSec: 120, criticalSec: 30 },
  state: {
    activeTimerId: null,
    isRunning: false,
    startedAt: null,
    elapsedOffset: 0,
    progress: {},
    showClock: false,
    clockMode: '24h',
    message: {
      text: '',
      visible: false,
      color: 'green',
    },
  },
})

describe('reorderOwnedRooms', () => {
  it('reorders rooms for the owner and updates order values', () => {
    const rooms = [createRoom('room-1', 10, 'First'), createRoom('room-2', 20, 'Second')]

    const nextRooms = reorderOwnedRooms(rooms, 'user-1', new Set<string>(), 'room-2', 0)

    // Function updates order values; array position is unchanged but order values are updated
    // When sorted by order, 'Second' should come before 'First'
    const sorted = [...nextRooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    expect(sorted.map((room) => room.title)).toEqual(['Second', 'First'])

    // room-2 (Second) should have lower order than room-1 (First)
    const room1 = nextRooms.find((r) => r.id === 'room-1')!
    const room2 = nextRooms.find((r) => r.id === 'room-2')!
    expect(room2.order).toBeLessThan(room1.order)
  })

  it('returns original rooms if ownerId is undefined', () => {
    const rooms = [createRoom('room-1', 10, 'First')]
    const result = reorderOwnedRooms(rooms, undefined, new Set<string>(), 'room-1', 0)
    expect(result).toBe(rooms)
  })

  it('returns original rooms if roomId not found', () => {
    const rooms = [createRoom('room-1', 10, 'First')]
    const result = reorderOwnedRooms(rooms, 'user-1', new Set<string>(), 'room-unknown', 0)
    expect(result).toBe(rooms)
  })

  it('excludes pending rooms from reorder', () => {
    const rooms = [
      createRoom('room-1', 10, 'First'),
      createRoom('room-2', 20, 'Second'),
      createRoom('room-3', 30, 'Third'),
    ]
    const pendingRooms = new Set(['room-2'])

    const result = reorderOwnedRooms(rooms, 'user-1', pendingRooms, 'room-3', 0)

    // room-3 should now have lowest order among non-pending rooms
    const nonPending = result
      .filter((r) => !pendingRooms.has(r.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    expect(nonPending[0]?.title).toBe('Third')
  })
})
