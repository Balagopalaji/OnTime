import { describe, expect, it } from 'vitest'

import { buildControllerRundownOrder } from './controller-rundown-order'
import type { Section, Segment, Timer } from '../types'

const makeSection = (id: string, order: number): Section => ({
  id,
  roomId: 'room-1',
  title: id,
  order,
})

const makeSegment = (id: string, sectionId: string, order: number): Segment => ({
  id,
  roomId: 'room-1',
  sectionId,
  title: id,
  order,
})

const makeTimer = (
  id: string,
  order: number,
  options: {
    sectionId?: string
    segmentId?: string
    segmentOrder?: number
  } = {},
): Timer => ({
  id,
  roomId: 'room-1',
  title: id,
  duration: 300,
  type: 'countdown',
  order,
  ...options,
})

describe('buildControllerRundownOrder', () => {
  it('uses section order before raw timer order', () => {
    const sections = [makeSection('session-1', 20), makeSection('session-2', 10)]
    const segments = [
      makeSegment('segment-1', 'session-1', 10),
      makeSegment('segment-2', 'session-2', 10),
    ]
    const timers = [
      makeTimer('timer-a', 10, { segmentId: 'segment-1' }),
      makeTimer('timer-b', 20, { segmentId: 'segment-2' }),
    ]

    expect(buildControllerRundownOrder({ timers, sections, segments }).map((timer) => timer.id)).toEqual([
      'timer-b',
      'timer-a',
    ])
  })

  it('keeps section-level timers after segment timers to match the rundown layout', () => {
    const sections = [makeSection('session-1', 10)]
    const segments = [makeSegment('segment-1', 'session-1', 10)]
    const timers = [
      makeTimer('section-item', 10, { sectionId: 'session-1', segmentOrder: 0 }),
      makeTimer('segment-item', 20, { segmentId: 'segment-1', segmentOrder: 0 }),
    ]

    expect(buildControllerRundownOrder({ timers, sections, segments }).map((timer) => timer.id)).toEqual([
      'segment-item',
      'section-item',
    ])
  })
})
