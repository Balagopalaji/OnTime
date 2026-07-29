import { describe, expect, it } from 'vitest'
import {
  AOT_DEBUG_HYPOTHESIS,
  WINDOW_MESSAGE_SPECS,
  attachAlwaysOnTopChangedDebug,
  alwaysOnTopRequestEvent,
  attachOverlayDebug,
  attachWindowMessageDebug,
  classifyPlacementOutcome,
  createAlwaysOnTopSetterMarker,
  delayedWindowSnapshotEvent,
  displayEventEvent,
  launchSnapshotEvent,
  movedResizedEvent,
  placementDecisionEvent,
  programmaticBoundsEvent,
  setAlwaysOnTopWithDebug,
  windowMessageEvent,
  windowEventEvent,
  type DisplaySnapshot,
  type WindowStateSnapshot,
} from './overlay-debug'

const win: WindowStateSnapshot = { visible: true, minimized: false, focused: true, alwaysOnTop: true, bx: 10, by: 20, bw: 360, bh: 220 }
const display: DisplaySnapshot = { displayId: '692542', scaleFactor: 1.5, wx: 0, wy: 0, ww: 1920, wh: 1040 }

describe('overlay-debug builders (pure, no Electron)', () => {
  // Hypothesis/minimal scope: the AOT flip is external between snapshots; these
  // tests pin passive observation only, never a behavior/window-style change.
  it('documents the sampling-gap hypothesis without widening diagnostic scope', () => {
    expect(AOT_DEBUG_HYPOTHESIS).toContain('external native change between samples')
  })
  it('launchSnapshotEvent carries topology + full window state tuple', () => {
    expect(launchSnapshotEvent(win, 2, '692542', true)).toEqual({
      kind: 'debug_launch_snapshot',
      displayCount: 2,
      primaryId: '692542',
      savedAlwaysOnTop: true,
      ...win,
    })
  })

  it('builds request and delayed snapshot events without a native mutation API', () => {
    expect(alwaysOnTopRequestEvent(false, true, false)).toEqual({ kind: 'debug_always_on_top_request', requested: false, nativeBefore: true, nativeAfter: false })
    expect(delayedWindowSnapshotEvent('focus', 100, win, display)).toMatchObject({ kind: 'debug_delayed_window_snapshot', trigger: 'focus', delayMs: 100, alwaysOnTop: true })
  })

  it('uses only the native write when debug is disabled', () => {
    const calls: string[] = []
    const window = {
      isAlwaysOnTop: () => { calls.push('read'); return false },
      setAlwaysOnTop: (enabled: boolean) => calls.push(`write:${enabled}`),
    }
    setAlwaysOnTopWithDebug(window, true, false, () => calls.push('push'))
    expect(calls).toEqual(['write:true'])
  })

  it('correlates a synchronous Electron AOT event with the app setter wrapper', () => {
    let listener: ((_event: unknown, value: boolean) => void) | undefined
    let offCalls = 0
    let native = true
    const marker = createAlwaysOnTopSetterMarker()
    const events: unknown[] = []
    const window = {
      isAlwaysOnTop: () => native,
      setAlwaysOnTop: (enabled: boolean) => { native = enabled; listener?.({}, enabled) },
      on: (_event: 'always-on-top-changed', next: (_event: unknown, value: boolean) => void) => { listener = next },
      off: () => { offCalls++ },
    }
    const dispose = attachAlwaysOnTopChangedDebug(window, marker, (event) => events.push(event))
    setAlwaysOnTopWithDebug(window, false, true, (event) => events.push(event), marker)
    expect(events[0]).toEqual({ kind: 'debug_always_on_top_changed', eventValue: false, currentValue: false, insideAppSetter: true })
    dispose()
    expect(offCalls).toBe(1)
  })

  it('records only safe activation/show WParam state and unhooks every relevant own-window message', () => {
    const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>()
    const unhooked: number[] = []
    const events: unknown[] = []
    const dispose = attachWindowMessageDebug({
      hookWindowMessage: (code, callback) => hooks.set(code, callback),
      unhookWindowMessage: (code) => unhooked.push(code),
    }, (event) => events.push(event))
    hooks.get(0x0006)?.(Buffer.from([2, 0, 0, 0]), Buffer.alloc(8, 0xff))
    hooks.get(0x001c)?.(Buffer.from([0, 0, 0, 0]), Buffer.alloc(8, 0xff))
    hooks.get(0x0018)?.(Buffer.from([1, 0, 0, 0]), Buffer.alloc(8, 0xff))
    hooks.get(0x0046)?.(Buffer.alloc(8, 0xff), Buffer.alloc(8, 0xff))
    expect(events).toEqual([
      { kind: 'debug_window_message', message: 'WM_ACTIVATE', code: 6, activation: 'click-active' },
      { kind: 'debug_window_message', message: 'WM_ACTIVATEAPP', code: 28, appActive: false },
      { kind: 'debug_window_message', message: 'WM_SHOWWINDOW', code: 24, shown: true },
      { kind: 'debug_window_message', message: 'WM_WINDOWPOSCHANGING', code: 70 },
    ])
    dispose()
    expect(unhooked).toEqual(WINDOW_MESSAGE_SPECS.map(({ code }) => code))
  })

  it('does not derive or retain WParam state for position/style messages', () => {
    expect(windowMessageEvent(WINDOW_MESSAGE_SPECS[4], Buffer.alloc(8, 0xff))).toEqual({ kind: 'debug_window_message', message: 'WM_WINDOWPOSCHANGED', code: 71 })
    expect(windowMessageEvent(WINDOW_MESSAGE_SPECS[5], Buffer.alloc(8, 0xff))).toEqual({ kind: 'debug_window_message', message: 'WM_STYLECHANGED', code: 125 })
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

describe('attachOverlayDebug passive focus/blur follow-ups', () => {
  it('schedules 100/500/1000ms snapshots after focus and blur using getters only', () => {
    const listeners = new Map<string, () => void>()
    const scheduled: Array<{ callback: () => void; delayMs: number }> = []
    const events: unknown[] = []
    const window = {
      isDestroyed: () => false,
      getBounds: () => ({ x: 10, y: 20, width: 360, height: 220 }),
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => false,
      isAlwaysOnTop: () => true,
    }
    const screen = {
      getDisplayMatching: () => ({ id: '692542', scaleFactor: 1.5, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [{}],
      getPrimaryDisplay: () => ({ id: '692542' }),
    }
    const dispose = attachOverlayDebug(window, screen, (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event) }, (event) => events.push(event), true, (callback, delayMs) => scheduled.push({ callback, delayMs }))

    listeners.get('focus')?.()
    listeners.get('blur')?.()
    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([100, 500, 1000, 100, 500, 1000])
    for (const { callback } of scheduled) callback()
    expect(events.filter((event) => (event as { kind: string }).kind === 'debug_delayed_window_snapshot')).toHaveLength(6)
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('cancels pending snapshots so post-dispose callbacks read and push nothing', () => {
    const listeners = new Map<string, () => void>()
    const scheduled: Array<{ callback: () => void; handle: number }> = []
    const cancelled: number[] = []
    let getterCalls = 0
    const window = {
      isDestroyed: () => false,
      getBounds: () => { getterCalls++; return { x: 10, y: 20, width: 360, height: 220 } },
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => false,
      isAlwaysOnTop: () => true,
    }
    const screen = {
      getDisplayMatching: () => ({ id: '692542', scaleFactor: 1.5, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [{}],
      getPrimaryDisplay: () => ({ id: '692542' }),
    }
    const events: unknown[] = []
    const dispose = attachOverlayDebug(window, screen, (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event) }, (event) => events.push(event), true, (callback) => {
      const handle = scheduled.length
      scheduled.push({ callback, handle })
      return handle
    }, (handle) => cancelled.push(handle as number))
    listeners.get('focus')?.()
    const callsBeforeDispose = getterCalls
    dispose()
    for (const { callback } of scheduled) callback()
    expect(cancelled).toEqual([0, 1, 2])
    expect(getterCalls).toBe(callsBeforeDispose)
    expect(events.filter((event) => (event as { kind: string }).kind === 'debug_delayed_window_snapshot')).toHaveLength(0)
    expect(listeners.size).toBe(0)
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
