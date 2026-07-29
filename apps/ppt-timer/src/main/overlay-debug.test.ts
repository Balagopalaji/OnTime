import { describe, expect, it } from 'vitest'
import {
  classifyPlacementOutcome,
  displayEventEvent,
  launchSnapshotEvent,
  movedResizedEvent,
  placementDecisionEvent,
  programmaticBoundsEvent,
  windowEventEvent,
  type DisplaySnapshot,
  type WindowStateSnapshot,
} from './overlay-debug'

const win: WindowStateSnapshot = { visible: true, minimized: false, focused: true, alwaysOnTop: true, bx: 10, by: 20, bw: 360, bh: 220 }
const display: DisplaySnapshot = { displayId: '692542', scaleFactor: 1.5, wx: 0, wy: 0, ww: 1920, wh: 1040 }

describe('overlay-debug builders (pure, no Electron)', () => {
  it('launchSnapshotEvent carries topology + full window state tuple', () => {
    expect(launchSnapshotEvent(win, 2, '692542')).toEqual({
      kind: 'debug_launch_snapshot',
      displayCount: 2,
      primaryId: '692542',
      ...win,
    })
  })

  it('windowEventEvent pairs the lifecycle label with the matched display + state', () => {
    const event = windowEventEvent('focus', win, display)
    expect(event).toMatchObject({ kind: 'debug_window_event', event: 'focus', focused: true, alwaysOnTop: true })
    expect(event).toMatchObject({ displayId: '692542', scaleFactor: 1.5 })
  })

  it('movedResizedEvent includes the matched work-area bounds for clamping analysis', () => {
    const event = movedResizedEvent('moved', win, display)
    expect(event).toMatchObject({ kind: 'debug_moved_resized', event: 'moved' })
    expect(event).toMatchObject({ wx: 0, wy: 0, ww: 1920, wh: 1040, displayId: '692542', scaleFactor: 1.5 })
  })

  it('displayEventEvent records the topology event, display count, and work area', () => {
    const event = displayEventEvent('display-metrics-changed', display, 3)
    expect(event).toEqual({
      kind: 'debug_display_event',
      event: 'display-metrics-changed',
      displayCount: 3,
      displayId: '692542',
      scaleFactor: 1.5,
      wx: 0,
      wy: 0,
      ww: 1920,
      wh: 1040,
    })
  })

  it('programmaticBoundsEvent records before/after geometry and the reason', () => {
    const event = programmaticBoundsEvent(
      'revalidate',
      { bx: 10, by: 20, bw: 360, bh: 220 },
      { bx: 780, by: 410, bw: 360, bh: 220 },
      '692542',
    )
    expect(event).toEqual({
      kind: 'debug_programmatic_bounds',
      reason: 'revalidate',
      bxBefore: 10,
      byBefore: 20,
      bwBefore: 360,
      bhBefore: 220,
      bxAfter: 780,
      byAfter: 410,
      bwAfter: 360,
      bhAfter: 220,
      displayId: '692542',
    })
  })

  it('placementDecisionEvent surfaces outcome, visible/target displays, and bounds', () => {
    const event = placementDecisionEvent('recentered', null, '692542', { bx: 780, by: 410, bw: 360, bh: 220 })
    expect(event).toEqual({
      kind: 'debug_placement_decision',
      outcome: 'recentered',
      visibleOnDisplayId: null,
      targetDisplayId: '692542',
      bx: 780,
      by: 410,
      bw: 360,
      bh: 220,
    })
  })
})

describe('classifyPlacementOutcome (observation only — no policy change)', () => {
  const sameBefore = { bx: 10, by: 20, bw: 360, bh: 220 }
  const sameAfter = { bx: 10, by: 20, bw: 360, bh: 220 }

  it('returns "kept" when restore did not mutate the bounds', () => {
    expect(classifyPlacementOutcome(sameBefore, sameAfter, '692542')).toBe('kept')
    expect(classifyPlacementOutcome(sameBefore, sameAfter, null)).toBe('kept')
  })

  it('returns "recentered" when bounds changed and the saved bounds were not visible on any display', () => {
    const after = { bx: 780, by: 410, bw: 360, bh: 220 }
    expect(classifyPlacementOutcome(sameBefore, after, null)).toBe('recentered')
  })

  it('returns "clamped" when bounds changed but were still substantially visible', () => {
    const after = { bx: 12, by: 22, bw: 360, bh: 220 }
    expect(classifyPlacementOutcome(sameBefore, after, '692542')).toBe('clamped')
  })
})
