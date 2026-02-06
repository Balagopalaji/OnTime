import { describe, expect, it } from 'vitest'
import { resolveControllerJoinIntent } from './controller-join-intent'

describe('resolveControllerJoinIntent', () => {
  it('does not rejoin repeatedly for the same room/controller intent', () => {
    const first = resolveControllerJoinIntent(null, 'room-1')
    expect(first.shouldJoin).toBe(true)

    const second = resolveControllerJoinIntent(first.nextKey, 'room-1')
    expect(second.shouldJoin).toBe(false)

    const third = resolveControllerJoinIntent(second.nextKey, 'room-1')
    expect(third.shouldJoin).toBe(false)
  })

  it('allows explicit forced rejoin for the same room intent', () => {
    const current = resolveControllerJoinIntent(null, 'room-1')
    const forced = resolveControllerJoinIntent(current.nextKey, 'room-1', { force: true })
    expect(forced.shouldJoin).toBe(true)
    expect(forced.nextKey).toBe(current.nextKey)
  })

  it('joins when room intent changes', () => {
    const current = resolveControllerJoinIntent(null, 'room-1')
    const nextRoom = resolveControllerJoinIntent(current.nextKey, 'room-2')
    expect(nextRoom.shouldJoin).toBe(true)
  })
})
