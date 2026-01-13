import { describe, it, expect, beforeEach } from 'vitest'
import { pushWithCap, popUndo, popRedo, pushRedo, type UndoStack } from '../lib/undoStack'

// Simple helper tests to validate update action round-trips on stacks.

const createEmpty = (): UndoStack => ({ undo: [], redo: [] })

describe('undoStack update actions', () => {
  let stack: UndoStack

  beforeEach(() => {
    stack = createEmpty()
  })

  it('pushes a room update entry and undoes/redoes in order', () => {
    const { stack: afterPush } = pushWithCap(stack, {
      kind: 'room',
      action: 'update',
      id: 'u1',
      roomId: 'r1',
      expiresAt: Date.now(),
      before: { title: 'Before', timezone: 'UTC' },
      patch: { title: 'After', timezone: 'US/Pacific' },
    }, 10)
    const { entry: undoEntry, stack: afterUndo } = popUndo(afterPush)
    expect(undoEntry?.action).toBe('update')
    expect(afterUndo.redo).toHaveLength(0)
    const next = pushRedo(afterUndo, undoEntry!, 10)
    const { entry: redoEntry } = popRedo(next)
    expect(redoEntry?.action).toBe('update')
  })

  it('pushes a timer update entry and respects cap', () => {
    let working = stack
    for (let i = 0; i < 12; i += 1) {
      const { stack: next } = pushWithCap(working, {
        kind: 'timer',
        action: 'update',
        id: `t${i}`,
        roomId: 'room',
        timerId: `timer-${i}`,
        expiresAt: Date.now(),
        before: { title: `before-${i}` },
        patch: { title: `after-${i}` },
      }, 10)
      working = next
    }
    expect(working.undo).toHaveLength(10)
    expect(working.undo[0]?.id).toBe('t11')
  })
})
