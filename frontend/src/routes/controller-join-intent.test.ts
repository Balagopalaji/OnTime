import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_FORCE_REJOIN_COOLDOWN_MS,
  resolveControllerJoinIntent,
  shouldIssueForcedControllerJoin,
} from './controller-join-intent'

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

  it('throttles activity-driven forced rejoins inside cooldown window', () => {
    const first = shouldIssueForcedControllerJoin({
      reason: 'activity:reorder',
      now: 10_000,
    })
    expect(first.shouldJoin).toBe(true)

    const second = shouldIssueForcedControllerJoin({
      lastForcedJoinAt: first.nextForcedJoinAt,
      reason: 'idle-move',
      now: 10_000 + ACTIVITY_FORCE_REJOIN_COOLDOWN_MS - 1,
    })
    expect(second.shouldJoin).toBe(false)
  })

  it('allows activity-driven forced rejoins after cooldown', () => {
    const first = shouldIssueForcedControllerJoin({
      reason: 'activity:start',
      now: 1_000,
    })
    const second = shouldIssueForcedControllerJoin({
      lastForcedJoinAt: first.nextForcedJoinAt,
      reason: 'activity:play',
      now: 1_000 + ACTIVITY_FORCE_REJOIN_COOLDOWN_MS,
    })
    expect(second.shouldJoin).toBe(true)
  })

  it('does not throttle explicit manual forced rejoins', () => {
    const first = shouldIssueForcedControllerJoin({
      reason: 'manual-rejoin',
      now: 5_000,
    })
    const second = shouldIssueForcedControllerJoin({
      lastForcedJoinAt: first.nextForcedJoinAt,
      reason: 'manual-rejoin',
      now: 5_001,
    })
    expect(second.shouldJoin).toBe(true)
  })
})
