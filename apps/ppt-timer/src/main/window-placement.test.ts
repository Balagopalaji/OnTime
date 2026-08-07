import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  centerOf,
  clampIntoWorkArea,
  expandDetailsBounds,
  findDisplay,
  intersectArea,
  isSubstantiallyVisible,
  moveToDisplay,
  restoreBounds,
  restoreCompactBounds,
  VISIBILITY_THRESHOLD,
  type DisplaySnapshot,
  type Rectangle,
} from './window-placement'
import { DETAILS_WINDOW_SIZE, PRESET_SIZES } from './settings-schema'

const WA = (x: number, y: number, w: number, h: number): Rectangle => ({ x, y, width: w, height: h })
const rect = (x: number, y: number, w: number, h: number): Rectangle => ({ x, y, width: w, height: h })

const primary: DisplaySnapshot = { id: '1', label: 'Primary', workArea: WA(0, 0, 1920, 1040) }
const second: DisplaySnapshot = { id: '2', label: 'Second', workArea: WA(1920, 0, 1920, 1080) }

describe('geometry primitives', () => {
  it('intersectArea is 0 for disjoint rects and exact for contained rects', () => {
    expect(intersectArea(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toBe(0)
    expect(intersectArea(rect(0, 0, 100, 100), rect(25, 25, 50, 50))).toBe(2500)
  })

  it('isSubstantiallyVisible uses the 80x60 threshold', () => {
    expect(VISIBILITY_THRESHOLD).toBe(4800)
    expect(isSubstantiallyVisible(rect(0, 0, 90, 90), WA(0, 0, 1920, 1080))).toBe(true)
    expect(isSubstantiallyVisible(rect(0, 0, 70, 60), WA(0, 0, 1920, 1080))).toBe(false)
    expect(isSubstantiallyVisible(rect(-5000, -5000, 100, 100), WA(0, 0, 1920, 1080))).toBe(false)
  })

  it('centerOf returns the midpoint', () => {
    expect(centerOf(rect(100, 200, 360, 220))).toEqual({ x: 280, y: 310 })
  })
})

describe('clampIntoWorkArea (S-018 minimum, S-022 clamp)', () => {
  it('clamps an offscreen position back into the work area', () => {
    const r = clampIntoWorkArea(rect(-500, 10_000, 360, 220), primary.workArea)
    expect(r.x).toBe(0)
    expect(r.y).toBe(1040 - 220)
    expect(r.width).toBe(360)
    expect(r.height).toBe(220)
  })

  it('enforces the compact minimum when the work area permits', () => {
    const r = clampIntoWorkArea(rect(10, 10, 50, 50), primary.workArea)
    expect(r.width).toBe(PRESET_SIZES.compact.width)
    expect(r.height).toBe(PRESET_SIZES.compact.height)
  })

  it('caps dimensions to the work area when it is smaller than the minimum', () => {
    const tiny = WA(0, 0, 200, 120)
    const r = clampIntoWorkArea(rect(0, 0, 500, 500), tiny)
    expect(r.width).toBe(200)
    expect(r.height).toBe(120)
  })
})

describe('restoreBounds (S-022 offscreen / removed display / DPI)', () => {
  it('keeps saved bounds that are substantially visible, clamped into that display', () => {
    const saved = { x: 100, y: 100, width: 360, height: 220 }
    const r = restoreBounds({ saved, savedDisplayId: '1', displays: [primary, second], primary })
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
  })

  it('recenters onto the saved display when bounds are offscreen but the display exists', () => {
    const saved = { x: 5000, y: 5000, width: 360, height: 220 }
    const r = restoreBounds({ saved, savedDisplayId: '2', displays: [primary, second], primary })
    // Centered in the second display work area (1920..3840, 0..1080).
    expect(r.x).toBe(1920 + Math.round((1920 - 360) / 2))
    expect(r.y).toBe(Math.round((1080 - 220) / 2))
  })

  it('falls back to the primary display when the saved display was removed', () => {
    const saved = { x: 5000, y: 5000, width: 360, height: 220 }
    const r = restoreBounds({ saved, savedDisplayId: '2', displays: [primary], primary })
    expect(r.x).toBe(Math.round((1920 - 360) / 2))
    expect(r.y).toBe(Math.round((1040 - 220) / 2))
  })

  it('uses the compact default size centered on primary when no saved bounds exist', () => {
    const r = restoreBounds({ saved: null, savedDisplayId: null, displays: [primary], primary })
    expect(r.width).toBe(PRESET_SIZES.compact.width)
    expect(r.height).toBe(PRESET_SIZES.compact.height)
    expect(r.x).toBe(Math.round((1920 - PRESET_SIZES.compact.width) / 2))
  })
})

describe('moveToDisplay (S-020) and applyPreset (S-018)', () => {
  it('recenters onto the chosen display work area keeping the size', () => {
    const r = moveToDisplay(second, { width: 520, height: 320 })
    expect(r.width).toBe(520)
    expect(r.x).toBe(1920 + Math.round((1920 - 520) / 2))
  })

  it('applyPreset preserves the current center and applies the preset size when it fits', () => {
    const current = rect(500, 400, 360, 220) // center (680, 510) fits a 520x320 preset
    const center = centerOf(current)
    const r = applyPreset(current, 'large', primary.workArea)
    expect(r.width).toBe(PRESET_SIZES.large.width)
    expect(r.height).toBe(PRESET_SIZES.large.height)
    expect(centerOf(r)).toEqual(center)
  })

  it('applyPreset clamps toward the work area when the centered preset would not fit', () => {
    const current = rect(0, 980, 360, 220) // center y ~1090, near the bottom edge
    const r = applyPreset(current, 'large', primary.workArea)
    expect(r.height).toBe(PRESET_SIZES.large.height)
    // Clamped so the bottom edge sits on the work-area floor (y + height == 1040).
    expect(r.y + r.height).toBe(1040)
  })

  it('findDisplay returns undefined for a missing/null id', () => {
    expect(findDisplay(null, [primary])).toBeUndefined()
    expect(findDisplay('99', [primary, second])).toBeUndefined()
    expect(findDisplay('2', [primary, second])?.id).toBe('2')
  })
})

describe('minimalist details drawer placement', () => {
  it('expands downward from the current top-left when the details surface fits', () => {
    const compact = rect(200, 100, 190, 80)
    expect(expandDetailsBounds(compact, primary.workArea)).toEqual({
      x: 200,
      y: 100,
      ...DETAILS_WINDOW_SIZE,
    })
  })

  it('expands upward near the bottom while retaining the compact bottom edge', () => {
    const compact = rect(200, 800, 190, 80)
    const expanded = expandDetailsBounds(compact, primary.workArea)
    expect(expanded).toEqual({ x: 200, y: 360, ...DETAILS_WINDOW_SIZE })
    expect(expanded.y + expanded.height).toBe(compact.y + compact.height)
  })

  it('edge-clamps the expanded surface on work areas smaller than the preset', () => {
    const smallWorkArea = WA(100, 50, 300, 400)
    expect(expandDetailsBounds(rect(350, 300, 190, 80), smallWorkArea)).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 400,
    })
  })

  it('restores the exact captured compact bounds after a downward expansion', () => {
    const compact = rect(200, 100, 190, 80)
    const expanded = expandDetailsBounds(compact, primary.workArea)
    expect(expanded).not.toEqual(compact)
    expect(restoreCompactBounds(compact, primary.workArea)).toEqual(compact)
  })

  it('restores an intentional custom collapsed size without coercing it to compact', () => {
    const custom = rect(250, 140, 310, 160)
    expect(restoreCompactBounds(custom, primary.workArea)).toEqual(custom)
  })

  it('restores the exact captured compact bounds after an upward expansion', () => {
    const compact = rect(200, 800, 190, 80)
    expect(expandDetailsBounds(compact, primary.workArea).y).toBeLessThan(compact.y)
    expect(restoreCompactBounds(compact, primary.workArea)).toEqual(compact)
  })

  it('edge-clamps a compact restore only when the work area changed', () => {
    const compact = rect(1800, 1000, 190, 80)
    expect(restoreCompactBounds(compact, primary.workArea)).toEqual({
      x: 1920 - 190,
      y: 1040 - 80,
      width: 190,
      height: 80,
    })
  })
})
