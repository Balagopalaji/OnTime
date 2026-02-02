import { describe, it, expect } from 'vitest'
import { mapSection, mapSegment, stripUndefined } from '../context/firebase-data-utils'
import type { SectionDoc, SegmentDoc } from '../context/firebase-data-utils'
import type { Section, Segment, Timer } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────

const makeSection = (id: string, order: number, overrides?: Partial<Section>): Section => ({
  id,
  roomId: 'room-1',
  title: `Section ${id}`,
  order,
  ...overrides,
})

const makeSegment = (id: string, order: number, overrides?: Partial<Segment>): Segment => ({
  id,
  roomId: 'room-1',
  title: `Segment ${id}`,
  order,
  ...overrides,
})

const makeTimer = (id: string, order: number, overrides?: Partial<Timer>): Timer => ({
  id,
  roomId: 'room-1',
  title: `Timer ${id}`,
  duration: 300,
  type: 'countdown',
  order,
  ...overrides,
})

// ─── Pure reorder helpers (mirroring ControllerPage logic) ───────

/** Reorder segments within a section — returns new ordered ids */
const reorderSegmentsInSection = (
  segments: Segment[],
  sectionId: string | undefined,
  orderedIds: string[],
): Segment[] => {
  const inSection = segments.filter((s) => s.sectionId === sectionId)
  const outside = segments.filter((s) => s.sectionId !== sectionId)
  const reordered = orderedIds
    .map((id) => inSection.find((s) => s.id === id))
    .filter(Boolean)
    .map((seg, idx) => ({ ...seg!, order: (idx + 1) * 10 }))
  return [...outside, ...reordered]
}

/** Move a segment from one section to another */
const moveSegmentToSection = (
  segments: Segment[],
  segmentId: string,
  fromSectionId: string | undefined,
  targetSectionId: string | undefined,
  targetIndex: number,
): Segment[] => {
  if (fromSectionId === targetSectionId) return segments

  const targetSegs = segments
    .filter((s) => s.sectionId === targetSectionId && s.id !== segmentId)
    .sort((a, b) => a.order - b.order)

  const movedSeg = segments.find((s) => s.id === segmentId)
  if (movedSeg) {
    const clamped = Math.max(0, Math.min(targetIndex, targetSegs.length))
    targetSegs.splice(clamped, 0, { ...movedSeg, sectionId: targetSectionId })
  }

  const sourceSegs = segments
    .filter((s) => s.sectionId === fromSectionId && s.id !== segmentId)
    .sort((a, b) => a.order - b.order)

  const other = segments.filter(
    (s) => s.sectionId !== fromSectionId && s.sectionId !== targetSectionId && s.id !== segmentId,
  )

  return [
    ...other,
    ...sourceSegs.map((s, idx) => ({ ...s, order: (idx + 1) * 10 })),
    ...targetSegs.map((s, idx) => ({ ...s, order: (idx + 1) * 10 })),
  ]
}

/** Move a timer between segments */
const moveTimerToSegment = (
  timers: Timer[],
  segments: Segment[],
  timerId: string,
  fromSegmentId: string | undefined,
  targetSegmentId: string | undefined,
  targetIndex: number,
): { timers: Timer[]; segmentUpdates: Array<{ id: string; primaryTimerId: string | null }> } => {
  if (fromSegmentId === targetSegmentId) return { timers, segmentUpdates: [] }

  const targetTimers = timers
    .filter((t) => t.segmentId === targetSegmentId && t.id !== timerId)
    .sort((a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order))

  const moved = timers.find((t) => t.id === timerId)
  if (moved) {
    const clamped = Math.max(0, Math.min(targetIndex, targetTimers.length))
    targetTimers.splice(clamped, 0, { ...moved, segmentId: targetSegmentId })
  }

  const sourceTimers = timers
    .filter((t) => t.segmentId === fromSegmentId && t.id !== timerId)
    .sort((a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order))

  const others = timers.filter(
    (t) => t.segmentId !== fromSegmentId && t.segmentId !== targetSegmentId && t.id !== timerId,
  )

  const updatedTimers = [
    ...others,
    ...sourceTimers.map((t, idx) => ({ ...t, segmentOrder: idx * 10 })),
    ...targetTimers.map((t, idx) => ({ ...t, segmentOrder: idx * 10 })),
  ]

  const segmentUpdates: Array<{ id: string; primaryTimerId: string | null }> = []

  // If target was empty, set primaryTimerId
  if (targetSegmentId) {
    const targetWasEmpty = timers.filter(
      (t) => t.segmentId === targetSegmentId && t.id !== timerId,
    ).length === 0
    if (targetWasEmpty) {
      segmentUpdates.push({ id: targetSegmentId, primaryTimerId: timerId })
    }
  }

  // If moved timer was primary of source, reassign
  if (fromSegmentId) {
    const sourceSeg = segments.find((s) => s.id === fromSegmentId)
    if (sourceSeg?.primaryTimerId === timerId) {
      segmentUpdates.push({ id: fromSegmentId, primaryTimerId: sourceTimers[0]?.id ?? null })
    }
  }

  return { timers: updatedTimers, segmentUpdates }
}

// ═══════════════════════════════════════════════════════════════════
// 1. mapSection / mapSegment tests
// ═══════════════════════════════════════════════════════════════════

describe('mapSection', () => {
  it('maps a complete SectionDoc', () => {
    const doc: SectionDoc = {
      title: 'Act 1',
      order: 10,
      notes: 'Opening',
      plannedDurationSec: 600,
      plannedStartAt: 1700000000000,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    }
    const section = mapSection('s-1', 'room-1', doc)
    expect(section).toEqual({
      id: 's-1',
      roomId: 'room-1',
      title: 'Act 1',
      order: 10,
      notes: 'Opening',
      plannedDurationSec: 600,
      plannedStartAt: 1700000000000,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    })
  })

  it('defaults missing fields', () => {
    const section = mapSection('s-2', 'room-1', {})
    expect(section.title).toBe('')
    expect(section.order).toBe(0)
    expect(section.notes).toBeUndefined()
    expect(section.plannedDurationSec).toBeUndefined()
  })

  it('handles Firestore Timestamp objects for createdAt/updatedAt', () => {
    const doc: SectionDoc = {
      title: 'Test',
      order: 1,
      createdAt: { seconds: 1700000000, nanoseconds: 0 },
      updatedAt: { seconds: 1700000001, nanoseconds: 0 },
    }
    const section = mapSection('s-3', 'room-1', doc)
    expect(section.createdAt).toBe(1700000000000)
    expect(section.updatedAt).toBe(1700000001000)
  })

  it('ignores non-string title', () => {
    const doc = { title: 42, order: 5 } as unknown as SectionDoc
    expect(mapSection('s-4', 'room-1', doc).title).toBe('')
  })

  it('ignores non-number order', () => {
    const doc = { title: 'X', order: 'bad' } as unknown as SectionDoc
    expect(mapSection('s-5', 'room-1', doc).order).toBe(0)
  })
})

describe('mapSegment', () => {
  it('maps a complete SegmentDoc', () => {
    const doc: SegmentDoc = {
      sectionId: 's-1',
      title: 'Worship',
      order: 20,
      plannedStartAt: 1700000000000,
      plannedDurationSec: 1200,
      primaryTimerId: 't-1',
      notes: 'Songs',
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
    }
    const segment = mapSegment('seg-1', 'room-1', doc)
    expect(segment).toEqual({
      id: 'seg-1',
      roomId: 'room-1',
      sectionId: 's-1',
      title: 'Worship',
      order: 20,
      plannedStartAt: 1700000000000,
      plannedDurationSec: 1200,
      primaryTimerId: 't-1',
      notes: 'Songs',
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
    })
  })

  it('defaults missing sectionId to undefined', () => {
    const segment = mapSegment('seg-2', 'room-1', { title: 'Loose' })
    expect(segment.sectionId).toBeUndefined()
  })

  it('defaults missing primaryTimerId to undefined', () => {
    const segment = mapSegment('seg-3', 'room-1', {})
    expect(segment.primaryTimerId).toBeUndefined()
  })

  it('handles Firestore Timestamp objects', () => {
    const doc: SegmentDoc = {
      createdAt: { seconds: 1700000000, nanoseconds: 0 },
      updatedAt: { seconds: 1700000010, nanoseconds: 0 },
    }
    const segment = mapSegment('seg-4', 'room-1', doc)
    expect(segment.createdAt).toBe(1700000000000)
    expect(segment.updatedAt).toBe(1700000010000)
  })

  it('ignores non-string sectionId', () => {
    const doc = { sectionId: 123 } as unknown as SegmentDoc
    expect(mapSegment('seg-5', 'room-1', doc).sectionId).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════
// 2. stripUndefined
// ═══════════════════════════════════════════════════════════════════

describe('stripUndefined', () => {
  it('removes undefined values', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })

  it('keeps null and falsy values', () => {
    expect(stripUndefined({ a: null, b: 0, c: '', d: false })).toEqual({
      a: null,
      b: 0,
      c: '',
      d: false,
    })
  })

  it('returns empty object when all undefined', () => {
    expect(stripUndefined({ a: undefined, b: undefined })).toEqual({})
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3. Section ordering tests
// ═══════════════════════════════════════════════════════════════════

describe('Section ordering', () => {
  it('sections sort by order', () => {
    const sections = [makeSection('s-2', 20), makeSection('s-1', 10), makeSection('s-3', 30)]
    const sorted = [...sections].sort((a, b) => a.order - b.order)
    expect(sorted.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])
  })

  it('reorder assigns (idx+1)*10 orders', () => {
    const ids = ['s-3', 's-1', 's-2']
    const reordered = ids.map((id, idx) => ({ id, order: (idx + 1) * 10 }))
    expect(reordered).toEqual([
      { id: 's-3', order: 10 },
      { id: 's-1', order: 20 },
      { id: 's-2', order: 30 },
    ])
  })

  it('next order auto-increments by 10', () => {
    const existing = [makeSection('s-1', 10), makeSection('s-2', 20)]
    const nextOrder = existing.length ? Math.max(...existing.map((s) => s.order)) + 10 : 10
    expect(nextOrder).toBe(30)
  })

  it('first section gets order 10', () => {
    const existing: Section[] = []
    const nextOrder = existing.length ? Math.max(...existing.map((s) => s.order)) + 10 : 10
    expect(nextOrder).toBe(10)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4. Segment CRUD + ordering
// ═══════════════════════════════════════════════════════════════════

describe('Segment ordering', () => {
  it('segments within same section sort by order', () => {
    const segments = [
      makeSegment('seg-2', 20, { sectionId: 's-1' }),
      makeSegment('seg-1', 10, { sectionId: 's-1' }),
    ]
    const sorted = [...segments].sort((a, b) => a.order - b.order)
    expect(sorted.map((s) => s.id)).toEqual(['seg-1', 'seg-2'])
  })

  it('next segment order scoped to same sectionId', () => {
    const all = [
      makeSegment('seg-1', 10, { sectionId: 's-1' }),
      makeSegment('seg-2', 20, { sectionId: 's-1' }),
      makeSegment('seg-3', 10, { sectionId: 's-2' }),
    ]
    const sameSection = all.filter((s) => s.sectionId === 's-1')
    const nextOrder = sameSection.length ? Math.max(...sameSection.map((s) => s.order)) + 10 : 10
    expect(nextOrder).toBe(30)
  })

  it('reorderSegmentsInSection reorders only target section', () => {
    const segments = [
      makeSegment('seg-1', 10, { sectionId: 's-1' }),
      makeSegment('seg-2', 20, { sectionId: 's-1' }),
      makeSegment('seg-3', 10, { sectionId: 's-2' }),
    ]
    const result = reorderSegmentsInSection(segments, 's-1', ['seg-2', 'seg-1'])
    const s1 = result.filter((s) => s.sectionId === 's-1').sort((a, b) => a.order - b.order)
    expect(s1.map((s) => s.id)).toEqual(['seg-2', 'seg-1'])
    expect(s1[0].order).toBe(10)
    expect(s1[1].order).toBe(20)
    // Other section untouched
    const s2 = result.filter((s) => s.sectionId === 's-2')
    expect(s2).toHaveLength(1)
    expect(s2[0].order).toBe(10)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5. Timer ↔ Segment linkage
// ═══════════════════════════════════════════════════════════════════

describe('Timer ↔ Segment linkage', () => {
  it('timer with segmentId belongs to that segment', () => {
    const timer = makeTimer('t-1', 10, { segmentId: 'seg-1', segmentOrder: 0 })
    expect(timer.segmentId).toBe('seg-1')
    expect(timer.segmentOrder).toBe(0)
  })

  it('timer without segmentId is unsegmented', () => {
    const timer = makeTimer('t-2', 20)
    expect(timer.segmentId).toBeUndefined()
  })

  it('timers in a segment sort by segmentOrder', () => {
    const timers = [
      makeTimer('t-2', 20, { segmentId: 'seg-1', segmentOrder: 20 }),
      makeTimer('t-1', 10, { segmentId: 'seg-1', segmentOrder: 10 }),
      makeTimer('t-3', 30, { segmentId: 'seg-1', segmentOrder: 0 }),
    ]
    const sorted = [...timers].sort(
      (a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order),
    )
    expect(sorted.map((t) => t.id)).toEqual(['t-3', 't-1', 't-2'])
  })

  it('segment.primaryTimerId references a timer', () => {
    const segment = makeSegment('seg-1', 10, { primaryTimerId: 't-1' })
    const timers = [makeTimer('t-1', 10, { segmentId: 'seg-1' })]
    const primary = timers.find((t) => t.id === segment.primaryTimerId)
    expect(primary).toBeDefined()
    expect(primary!.id).toBe('t-1')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6. Section-level timers (sectionId set, segmentId unset)
// ═══════════════════════════════════════════════════════════════════

describe('Section-level timers', () => {
  it('timer with sectionId but no segmentId is a section item', () => {
    const timer = makeTimer('t-1', 10, { sectionId: 's-1' })
    expect(timer.sectionId).toBe('s-1')
    expect(timer.segmentId).toBeUndefined()
  })

  it('section items are distinct from segment timers', () => {
    const timers = [
      makeTimer('t-1', 10, { sectionId: 's-1' }), // section item
      makeTimer('t-2', 20, { segmentId: 'seg-1' }), // segment timer
      makeTimer('t-3', 30, { sectionId: 's-1', segmentId: 'seg-2' }), // segment timer in section
    ]
    const sectionItems = timers.filter((t) => t.sectionId && !t.segmentId)
    const segmentTimers = timers.filter((t) => t.segmentId)
    expect(sectionItems.map((t) => t.id)).toEqual(['t-1'])
    expect(segmentTimers.map((t) => t.id)).toEqual(['t-2', 't-3'])
  })
})

// ═══════════════════════════════════════════════════════════════════
// 7. Move segment to another section
// ═══════════════════════════════════════════════════════════════════

describe('moveSegmentToSection', () => {
  it('moves a segment and reorders both sections', () => {
    const segments = [
      makeSegment('seg-1', 10, { sectionId: 's-1' }),
      makeSegment('seg-2', 20, { sectionId: 's-1' }),
      makeSegment('seg-3', 10, { sectionId: 's-2' }),
    ]
    const result = moveSegmentToSection(segments, 'seg-1', 's-1', 's-2', 0)
    const s1 = result.filter((s) => s.sectionId === 's-1').sort((a, b) => a.order - b.order)
    const s2 = result.filter((s) => s.sectionId === 's-2').sort((a, b) => a.order - b.order)
    expect(s1.map((s) => s.id)).toEqual(['seg-2'])
    expect(s2.map((s) => s.id)).toEqual(['seg-1', 'seg-3'])
    expect(s2[0].sectionId).toBe('s-2')
  })

  it('no-ops when from === target', () => {
    const segments = [makeSegment('seg-1', 10, { sectionId: 's-1' })]
    const result = moveSegmentToSection(segments, 'seg-1', 's-1', 's-1', 0)
    expect(result).toBe(segments) // same reference
  })

  it('clamps targetIndex to bounds', () => {
    const segments = [
      makeSegment('seg-1', 10, { sectionId: 's-1' }),
      makeSegment('seg-2', 10, { sectionId: 's-2' }),
    ]
    const result = moveSegmentToSection(segments, 'seg-1', 's-1', 's-2', 999)
    const s2 = result.filter((s) => s.sectionId === 's-2').sort((a, b) => a.order - b.order)
    // seg-1 should be after seg-2
    expect(s2.map((s) => s.id)).toEqual(['seg-2', 'seg-1'])
  })
})

// ═══════════════════════════════════════════════════════════════════
// 8. Move timer between segments
// ═══════════════════════════════════════════════════════════════════

describe('moveTimerToSegment', () => {
  it('moves timer and sets segmentOrder', () => {
    const timers = [
      makeTimer('t-1', 10, { segmentId: 'seg-1', segmentOrder: 0 }),
      makeTimer('t-2', 20, { segmentId: 'seg-2', segmentOrder: 0 }),
    ]
    const segments = [
      makeSegment('seg-1', 10, { primaryTimerId: 't-1' }),
      makeSegment('seg-2', 20, { primaryTimerId: 't-2' }),
    ]
    const { timers: result, segmentUpdates } = moveTimerToSegment(
      timers, segments, 't-1', 'seg-1', 'seg-2', 0,
    )
    const seg2Timers = result
      .filter((t) => t.segmentId === 'seg-2')
      .sort((a, b) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0))
    expect(seg2Timers.map((t) => t.id)).toEqual(['t-1', 't-2'])
    // Source segment lost its primary → reassign to null
    expect(segmentUpdates).toContainEqual({ id: 'seg-1', primaryTimerId: null })
  })

  it('sets primaryTimerId on empty target segment', () => {
    const timers = [makeTimer('t-1', 10, { segmentId: 'seg-1', segmentOrder: 0 })]
    const segments = [
      makeSegment('seg-1', 10, { primaryTimerId: 't-1' }),
      makeSegment('seg-2', 20),
    ]
    const { segmentUpdates } = moveTimerToSegment(
      timers, segments, 't-1', 'seg-1', 'seg-2', 0,
    )
    expect(segmentUpdates).toContainEqual({ id: 'seg-2', primaryTimerId: 't-1' })
  })

  it('no-ops when from === target', () => {
    const timers = [makeTimer('t-1', 10, { segmentId: 'seg-1' })]
    const segments = [makeSegment('seg-1', 10)]
    const { timers: result } = moveTimerToSegment(timers, segments, 't-1', 'seg-1', 'seg-1', 0)
    expect(result).toBe(timers)
  })

  it('reassigns primaryTimerId on source to next timer', () => {
    const timers = [
      makeTimer('t-1', 10, { segmentId: 'seg-1', segmentOrder: 0 }),
      makeTimer('t-2', 20, { segmentId: 'seg-1', segmentOrder: 10 }),
    ]
    const segments = [
      makeSegment('seg-1', 10, { primaryTimerId: 't-1' }),
      makeSegment('seg-2', 20),
    ]
    const { segmentUpdates } = moveTimerToSegment(
      timers, segments, 't-1', 'seg-1', 'seg-2', 0,
    )
    // Source should get t-2 as new primary
    expect(segmentUpdates).toContainEqual({ id: 'seg-1', primaryTimerId: 't-2' })
  })
})

// ═══════════════════════════════════════════════════════════════════
// 9. Default bootstrap expectations
// ═══════════════════════════════════════════════════════════════════

describe('Default bootstrap structure', () => {
  it('a new room creates a default timer with order 10', () => {
    // Mirrors FirebaseDataContext.createRoom default timer
    const defaultTimer: Timer = {
      id: 'timer-default',
      roomId: 'room-new',
      title: 'Opening Remarks',
      duration: 300,
      speaker: 'Host',
      type: 'countdown',
      order: 10,
    }
    expect(defaultTimer.order).toBe(10)
    expect(defaultTimer.duration).toBe(300)
    expect(defaultTimer.type).toBe('countdown')
  })

  it('room state initializes with activeTimerId pointing to default timer', () => {
    const state = {
      activeTimerId: 'timer-default',
      isRunning: false,
      startedAt: null,
      elapsedOffset: 0,
      progress: { 'timer-default': 0 },
      showClock: false,
      clockMode: '24h' as const,
      message: { text: '', visible: false, color: 'green' as const },
    }
    expect(state.activeTimerId).toBe('timer-default')
    expect(state.isRunning).toBe(false)
    expect(state.progress['timer-default']).toBe(0)
  })
})
