import type { Room } from '../types'

export const roomOrderKey = (room: Pick<Room, 'order' | 'createdAt'>) => room.order ?? room.createdAt

/**
 * Pure function to reorder owned rooms.
 * Extracted for testability (no side effects).
 */
export const reorderOwnedRooms = (
  rooms: Room[],
  ownerId: string | undefined,
  pendingRooms: Set<string>,
  roomId: string,
  targetIndex: number,
): Room[] => {
  if (!ownerId) return rooms
  const owned = rooms
    .filter((room) => room.ownerId === ownerId && !pendingRooms.has(room.id))
    .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
  const fromIndex = owned.findIndex((room) => room.id === roomId)
  if (fromIndex === -1) return rooms
  const [moved] = owned.splice(fromIndex, 1)
  const clampedIndex = Math.max(0, Math.min(targetIndex, owned.length))
  owned.splice(clampedIndex, 0, moved)
  const updatedOrders = owned.reduce<Record<string, number>>((acc, room, idx) => {
    acc[room.id] = (idx + 1) * 10
    return acc
  }, {})
  return rooms.map((room) =>
    updatedOrders[room.id] !== undefined ? { ...room, order: updatedOrders[room.id] } : room,
  )
}
