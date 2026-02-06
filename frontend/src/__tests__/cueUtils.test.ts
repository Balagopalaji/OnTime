import { describe, expect, it } from 'vitest'
import type { Cue } from '../types'
import {
  buildAckPatch,
  buildEditedByRolePatch,
  canEditCue,
  insertCueId,
  reorderCueIds,
} from '../utils/cue-utils'

describe('cue utils', () => {
  it('allows owners to edit any cue', () => {
    expect(canEditCue({ isOwner: true, activeRole: null, cueRole: 'lx' })).toBe(true)
  })

  it('blocks edits when role mismatches', () => {
    expect(canEditCue({ isOwner: false, activeRole: 'ax', cueRole: 'lx' })).toBe(false)
  })

  it('allows edits when role matches', () => {
    expect(canEditCue({ isOwner: false, activeRole: 'vx', cueRole: 'vx' })).toBe(true)
  })

  it('reorders cue ids within a list', () => {
    const cues = [
      { id: 'a' } as Cue,
      { id: 'b' } as Cue,
      { id: 'c' } as Cue,
    ]
    expect(reorderCueIds(cues, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(reorderCueIds(cues, 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('inserts cue id into a list at a target index', () => {
    expect(insertCueId(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c'])
    expect(insertCueId(['a', 'b', 'c'], 'b', 10)).toEqual(['a', 'c', 'b'])
  })

  it('builds ack patches with timestamps', () => {
    const patch = buildAckPatch('done', 'user-1', 123)
    expect(patch).toEqual({ ackState: 'done', ackAt: 123, ackBy: 'user-1' })
    const pending = buildAckPatch('pending', 'user-1', 456)
    expect(pending).toEqual({ ackState: 'pending', ackAt: null, ackBy: null })
  })

  it('builds editedByRole patch for set and clear', () => {
    expect(buildEditedByRolePatch('lx')).toEqual({ editedByRole: 'lx' })
    expect(buildEditedByRolePatch(null)).toEqual({ editedByRole: null })
  })
})
