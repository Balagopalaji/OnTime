import { describe, it, expect } from 'vitest'
import { reorderOwnedRooms } from '../context/MockDataContext'
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

    const ordered = [...nextRooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    expect(ordered.map((room) => room.title)).toEqual(['Second', 'First'])

    const firstOrder = nextRooms.find((room) => room.id === 'room-2')?.order ?? Infinity
    const secondOrder = nextRooms.find((room) => room.id === 'room-1')?.order ?? Infinity
    expect(firstOrder).toBeLessThan(secondOrder)
  })
})
