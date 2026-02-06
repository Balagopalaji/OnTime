import { describe, it, expect } from 'vitest'
import type { Cue } from '../types'
import {
  createCueRecord,
  applyCuePatch,
  removeCue,
  reorderCueList,
} from '../context/MockDataContext'

const baseInput = {
  title: 'Cue',
  role: 'lx' as const,
  triggerType: 'timed' as const,
  createdByRole: 'lx' as const,
  sectionId: 'section-1',
}

describe('cue data helpers', () => {
  it('creates cues with createdByRole and timestamps', () => {
    const now = 1234
    const cue = createCueRecord({
      roomId: 'room-1',
      input: baseInput,
      userId: 'user-1',
      existingCues: [],
      now,
      cueId: 'cue-1',
    })

    expect(cue.id).toBe('cue-1')
    expect(cue.createdBy).toBe('user-1')
    expect(cue.createdByRole).toBe('lx')
    expect(cue.createdAt).toBe(now)
    expect(cue.updatedAt).toBe(now)
  })

  it('applies edits with editedByRole and ack fields', () => {
    const cue: Cue = createCueRecord({
      roomId: 'room-1',
      input: baseInput,
      userId: 'user-1',
      existingCues: [],
      now: 1000,
      cueId: 'cue-1',
    })

    const next = applyCuePatch({
      cues: [cue],
      cueId: 'cue-1',
      patch: {
        title: 'Updated cue',
        editedByRole: 'lx',
        ackState: 'done',
        ackAt: 2000,
        ackBy: 'user-1',
      },
      userId: 'user-1',
      now: 2000,
    })

    expect(next[0].title).toBe('Updated cue')
    expect(next[0].editedByRole).toBe('lx')
    expect(next[0].editedBy).toBe('user-1')
    expect(next[0].ackState).toBe('done')
    expect(next[0].ackAt).toBe(2000)
    expect(next[0].ackBy).toBe('user-1')
  })

  it('removes cues by id', () => {
    const cueA: Cue = createCueRecord({
      roomId: 'room-1',
      input: baseInput,
      userId: 'user-1',
      existingCues: [],
      now: 1000,
      cueId: 'cue-1',
    })
    const cueB: Cue = createCueRecord({
      roomId: 'room-1',
      input: { ...baseInput, title: 'Cue B' },
      userId: 'user-1',
      existingCues: [cueA],
      now: 1000,
      cueId: 'cue-2',
    })

    const next = removeCue([cueA, cueB], 'cue-1')
    expect(next.map((cue) => cue.id)).toEqual(['cue-2'])
  })

  it('reorders cues by updating order values', () => {
    const cueA: Cue = { ...createCueRecord({
      roomId: 'room-1',
      input: baseInput,
      userId: 'user-1',
      existingCues: [],
      now: 1000,
      cueId: 'cue-1',
    }), order: 10 }
    const cueB: Cue = { ...createCueRecord({
      roomId: 'room-1',
      input: { ...baseInput, title: 'Cue B' },
      userId: 'user-1',
      existingCues: [cueA],
      now: 1000,
      cueId: 'cue-2',
    }), order: 20 }

    const reordered = reorderCueList({
      cues: [cueA, cueB],
      cueIds: ['cue-2', 'cue-1'],
      now: 3000,
    })

    const ordered = [...reordered].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    expect(ordered.map((cue) => cue.id)).toEqual(['cue-2', 'cue-1'])
  })
})
