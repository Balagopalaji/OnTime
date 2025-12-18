import { describe, it, expect } from 'vitest'
import { reorderOwnedRooms } from '../context/MockDataContext'
import type { Room } from '../types'

// TODO: Test is skipped. MockDataContext has timers/storage side effects that keep Vitest alive.
// Fix path: refactor MockDataContext for testability (extract pure reorder helper, disable persistence/timers in tests),
// or provide a test harness that stubs/cleans all intervals/storage listeners.

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

describe.skip('reorderOwnedRooms', () => {
  it('reorders rooms for the owner and updates order values', () => {
    const rooms = [createRoom('room-1', 10, 'First'), createRoom('room-2', 20, 'Second')]

    const nextRooms = reorderOwnedRooms(rooms, 'user-1', new Set<string>(), 'room-2', 0)

    expect(nextRooms.map((room) => room.title)).toEqual(['Second', 'First'])
    expect(nextRooms[0]?.order).toBeLessThan(nextRooms[1]?.order ?? Infinity)
  })
})
