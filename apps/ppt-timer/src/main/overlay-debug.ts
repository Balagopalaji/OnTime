/**
 * Pure builders for the Windows overlay-window diagnostics (ISSUE-001 Presenter
 * View faults). No Electron import: the main process reads window/display state
 * through Electron's read-only getters (`getBounds`, `isVisible`, …) and passes
 * plain snapshots here, so this module computes events without a window manager
 * and stays unit-testable. {@link isOverlayDebug} gates emission at the call
 * site; these builders never perform effects of their own.
 *
 * Hard constraint (see plan): diagnostics must never call focus(), show(),
 * hide(), moveTop(), setAlwaysOnTop(), setBounds(), or any activation API
 * merely to log. The inputs to these builders are gathered from passive reads
 * only — they never request activation or geometry mutations.
 */
import type { AppDiagEvent } from './diagnostics.js'

/**
 * Hypothesis: a true→false `isAlwaysOnTop()` observation can be an external
 * native transition between samples, rather than an app request. Scope: observe
 * only; do not alter AOT, focus, style, z-order, or query raw HWND styles.
 */
export const AOT_DEBUG_HYPOTHESIS = 'An observed true-to-false AOT transition may be an external native change between samples, not an app setter request.'

/** Read-only scalar snapshot of a window's observable state (no HWND, no title). */
export type WindowStateSnapshot = {
  visible: boolean
  minimized: boolean
  focused: boolean
  alwaysOnTop: boolean
  bx: number
  by: number
  bw: number
  bh: number
}

/** Read-only scalar snapshot of the display matched to the window's bounds. */
export type DisplaySnapshot = {
  displayId: string
  scaleFactor: number
  wx: number
  wy: number
  ww: number
  wh: number
}

export type WindowDiagEvent =
  | 'ready-to-show'
  | 'show'
  | 'hide'
  | 'focus'
  | 'blur'
  | 'restore'
  | 'minimize'

export type MovedResizedEvent = 'moved' | 'resized'

export type DisplayDiagEvent = 'display-added' | 'display-removed' | 'display-metrics-changed'

export type ProgrammaticBoundsReason = 'preset' | 'moveToDisplay' | 'revalidate'

export type PlacementOutcome = 'kept' | 'recentered' | 'clamped'

/**
 * Classify a placement-revalidation outcome WITHOUT re-running or duplicating
 * the placement policy: the caller passes the window's bounds *before* and the
 * restored bounds *after* (both produced by the pure `restoreBounds`), plus the
 * display id the saved bounds were substantially visible on (or null) and the
 * target display id the restore landed on.
 *
 * - `kept`: restore returned the same bounds (no mutation).
 * - `recentered`: bounds changed AND the saved bounds were not substantially
 *   visible on any display (restore fell back to centering).
 * - `clamped`: bounds changed but were still substantially visible (restore only
 *   clamped into the work area).
 *
 * This is read-only observation over values the policy already produced; it does
 * not change placement behavior.
 */
export function classifyPlacementOutcome(
  before: { bx: number; by: number; bw: number; bh: number },
  after: { bx: number; by: number; bw: number; bh: number },
  visibleOnDisplayId: string | null,
): PlacementOutcome {
  const unchanged =
    before.bx === after.bx && before.by === after.by && before.bw === after.bw && before.bh === after.bh
  if (unchanged) return 'kept'
  return visibleOnDisplayId === null ? 'recentered' : 'clamped'
}

/** Build a one-shot launch snapshot event from window + display topology. */
export function launchSnapshotEvent(
  window: WindowStateSnapshot,
  displayCount: number,
  primaryId: string,
  savedAlwaysOnTop: boolean,
): AppDiagEvent {
  return { kind: 'debug_launch_snapshot', displayCount, primaryId, savedAlwaysOnTop, ...window }
}

/** Build a passive before/after record around an existing native AOT request. */
export function alwaysOnTopRequestEvent(requested: boolean, nativeBefore: boolean, nativeAfter: boolean): AppDiagEvent {
  return { kind: 'debug_always_on_top_request', requested, nativeBefore, nativeAfter }
}

/** Electron payload + current getter lets reports identify a real change gap. */
export function alwaysOnTopChangedEvent(eventValue: boolean, currentValue: boolean, insideAppSetter: boolean): AppDiagEvent {
  return { kind: 'debug_always_on_top_changed', eventValue, currentValue, insideAppSetter }
}

export const WINDOW_MESSAGE_SPECS = [
  { code: 0x0006, message: 'WM_ACTIVATE' },
  { code: 0x001c, message: 'WM_ACTIVATEAPP' },
  { code: 0x0018, message: 'WM_SHOWWINDOW' },
  { code: 0x0046, message: 'WM_WINDOWPOSCHANGING' },
  { code: 0x0047, message: 'WM_WINDOWPOSCHANGED' },
  { code: 0x007d, message: 'WM_STYLECHANGED' },
] as const

type WindowMessageSpec = typeof WINDOW_MESSAGE_SPECS[number]

/** Read only a scalar low word from Electron's wParam; never retain pointers. */
function wParamLow32(wParam: Uint8Array): number {
  if (wParam.length < 4) return 0
  return (wParam[0] | (wParam[1] << 8) | (wParam[2] << 16) | (wParam[3] << 24)) >>> 0
}

/** Build a safe compact record; only activation/show derive any wParam state. */
export function windowMessageEvent(spec: WindowMessageSpec, wParam: Uint8Array): AppDiagEvent {
  const value = wParamLow32(wParam)
  if (spec.message === 'WM_ACTIVATE') {
    const state = value & 0xffff
    const activation = state === 0 ? 'inactive' : state === 1 ? 'active' : state === 2 ? 'click-active' : 'other'
    return { kind: 'debug_window_message', ...spec, activation }
  }
  if (spec.message === 'WM_ACTIVATEAPP') return { kind: 'debug_window_message', ...spec, appActive: value !== 0 }
  if (spec.message === 'WM_SHOWWINDOW') return { kind: 'debug_window_message', ...spec, shown: value !== 0 }
  return { kind: 'debug_window_message', ...spec }
}

/** Build one of the intentionally passive focus/blur follow-up snapshots. */
export function delayedWindowSnapshotEvent(
  trigger: 'focus' | 'blur',
  delayMs: 100 | 500 | 1000,
  window: WindowStateSnapshot,
  display: DisplaySnapshot,
): AppDiagEvent {
  return { kind: 'debug_delayed_window_snapshot', trigger, delayMs, ...window, displayId: display.displayId, scaleFactor: display.scaleFactor }
}

/** Build a window lifecycle/activation event from a passive state read. */
export function windowEventEvent(event: WindowDiagEvent, window: WindowStateSnapshot, display: DisplaySnapshot): AppDiagEvent {
  return { kind: 'debug_window_event', event, ...window, displayId: display.displayId, scaleFactor: display.scaleFactor }
}

/** Build a moved/resized event carrying the matched display + its work area. */
export function movedResizedEvent(event: MovedResizedEvent, window: WindowStateSnapshot, display: DisplaySnapshot): AppDiagEvent {
  return {
    kind: 'debug_moved_resized',
    event,
    bx: window.bx,
    by: window.by,
    bw: window.bw,
    bh: window.bh,
    displayId: display.displayId,
    scaleFactor: display.scaleFactor,
    wx: display.wx,
    wy: display.wy,
    ww: display.ww,
    wh: display.wh,
  }
}

/** Build a screen topology event (add/remove/metrics) for the affected display. */
export function displayEventEvent(event: DisplayDiagEvent, display: DisplaySnapshot, displayCount: number): AppDiagEvent {
  return { kind: 'debug_display_event', event, displayCount, ...display }
}

/**
 * Build a programmatic-bounds event with before/after geometry. Callers pass
 * the reason so the report distinguishes preset / move-to-display / revalidate.
 */
export function programmaticBoundsEvent(
  reason: ProgrammaticBoundsReason,
  before: { bx: number; by: number; bw: number; bh: number },
  after: { bx: number; by: number; bw: number; bh: number },
  displayId: string,
): AppDiagEvent {
  return {
    kind: 'debug_programmatic_bounds',
    reason,
    bxBefore: before.bx,
    byBefore: before.by,
    bwBefore: before.bw,
    bhBefore: before.bh,
    bxAfter: after.bx,
    byAfter: after.by,
    bwAfter: after.bw,
    bhAfter: after.bh,
    displayId,
  }
}

/**
 * Build a placement-decision event. `outcome` and `visibleOnDisplayId` come from
 * the pure placement module's restore computation (re-exported by the caller),
 * so the report records *why* the window did or did not move, not just that it
 * did. `targetDisplayId` is the display the decision landed on.
 */
export function placementDecisionEvent(
  outcome: PlacementOutcome,
  visibleOnDisplayId: string | null,
  targetDisplayId: string,
  bounds: { bx: number; by: number; bw: number; bh: number },
): AppDiagEvent {
  return { kind: 'debug_placement_decision', outcome, visibleOnDisplayId, targetDisplayId, ...bounds }
}

// ---- Effectful wiring (still no Electron import) -----------------------------
// `attachOverlayDebug` registers passive listeners on the window. It depends on
// structural read-only views ({@link DebugWindow}/{@link DebugScreen}) rather
// than Electron types so the module stays unit-testable, and takes a `bind`
// callback for listener registration so it never has to fight Electron's strict
// per-literal `.on` overloads. As above, it gathers state ONLY — it never calls
// focus/show/hide/moveTop/setAlwaysOnTop/setBounds.

/** Physical pixel rectangle (structural — Electron Rectangle satisfies this). */
export type Rect = { x: number; y: number; width: number; height: number }

/** Read-only structural view of a BrowserWindow's observable state. */
export type DebugWindow = {
  isDestroyed(): boolean
  getBounds(): Rect
  isVisible(): boolean
  isMinimized(): boolean
  isFocused(): boolean
  isAlwaysOnTop(): boolean
}

/** Electron levels used by the timer's deliberately small AOT policy. */
export type TimerAlwaysOnTopLevel = 'normal' | 'pop-up-menu'

/**
 * Use the first Electron level above the Windows taskbar when enabled. The
 * default `floating` level can lose to PowerPoint Presenter View; `normal`
 * explicitly resets the level when the user disables the setting.
 */
export function timerAlwaysOnTopLevel(enabled: boolean): TimerAlwaysOnTopLevel {
  return enabled ? 'pop-up-menu' : 'normal'
}

/** Minimal mutable surface for the existing AOT action, isolated for testing. */
export type AlwaysOnTopWindow = Pick<DebugWindow, 'isAlwaysOnTop'> & {
  setAlwaysOnTop(enabled: boolean, level: TimerAlwaysOnTopLevel): void
}

/** Mutable marker shared by the app setter wrapper and Electron's event listener. */
export type AlwaysOnTopSetterMarker = { insideAppSetter: boolean }

export function createAlwaysOnTopSetterMarker(): AlwaysOnTopSetterMarker {
  return { insideAppSetter: false }
}

/** Read-only structural view of the screen APIs the diagnostics read. */
export type DebugScreen = {
  getDisplayMatching(bounds: Rect): { id: number | string; scaleFactor: number; workArea: Rect }
  getAllDisplays(): unknown[]
  getPrimaryDisplay(): { id: number | string }
}

/** Listener-registration callback injected by the caller (hides Electron overloads). */
export type OverlayDebugBind = (
  event: WindowDiagEvent | MovedResizedEvent | 'ready-to-show',
  listener: () => void,
) => () => void

export type OverlayDebugSchedule = (callback: () => void, delayMs: 100 | 500 | 1000) => unknown
export type OverlayDebugCancel = (handle: unknown) => void

/** Apply the timer AOT policy, reading native state only for opt-in debug. */
export function setAlwaysOnTopWithDebug(
  window: AlwaysOnTopWindow,
  enabled: boolean,
  debugEnabled: boolean,
  push: (event: AppDiagEvent) => void,
  marker?: AlwaysOnTopSetterMarker,
): void {
  const level = timerAlwaysOnTopLevel(enabled)
  if (!debugEnabled) {
    window.setAlwaysOnTop(enabled, level)
    return
  }
  const nativeBefore = window.isAlwaysOnTop()
  if (marker) marker.insideAppSetter = true
  try {
    window.setAlwaysOnTop(enabled, level)
  } finally {
    if (marker) marker.insideAppSetter = false
  }
  push(alwaysOnTopRequestEvent(enabled, nativeBefore, window.isAlwaysOnTop()))
}

export type AlwaysOnTopChangedWindow = Pick<DebugWindow, 'isAlwaysOnTop'> & { on(event: 'always-on-top-changed', listener: (_event: unknown, isAlwaysOnTop: boolean) => void): unknown; off(event: 'always-on-top-changed', listener: (_event: unknown, isAlwaysOnTop: boolean) => void): unknown }

/** Attach the Electron change event that closes the snapshot sampling gap. */
export function attachAlwaysOnTopChangedDebug(
  window: AlwaysOnTopChangedWindow,
  marker: AlwaysOnTopSetterMarker,
  push: (event: AppDiagEvent) => void,
): () => void {
  let disposed = false
  const listener = (_event: unknown, eventValue: boolean): void => push(alwaysOnTopChangedEvent(eventValue, window.isAlwaysOnTop(), marker.insideAppSetter))
  window.on('always-on-top-changed', listener)
  return () => {
    if (disposed) return
    disposed = true
    window.off('always-on-top-changed', listener)
  }
}

export type WindowMessageDebugWindow = { isDestroyed(): boolean; hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void; unhookWindowMessage(message: number): void }

/** Attach only relevant own-window Windows messages; disposal unhooks every one while the native window remains live. */
export function attachWindowMessageDebug(window: WindowMessageDebugWindow, push: (event: AppDiagEvent) => void): () => void {
  let disposed = false
  for (const spec of WINDOW_MESSAGE_SPECS) window.hookWindowMessage(spec.code, (wParam) => push(windowMessageEvent(spec, wParam)))
  return () => {
    if (disposed) return
    disposed = true
    // `closed` runs after native destruction, so late cleanup must be harmless.
    if (window.isDestroyed()) return
    for (const spec of WINDOW_MESSAGE_SPECS) window.unhookWindowMessage(spec.code)
  }
}

/**
 * Register the overlay-debug listeners on a window. Each listener reads passive
 * state at fire time and pushes a {@link AppDiagEvent} through `push`; none of
 * them mutate z-order, focus, or geometry. Returns nothing — purely for effect.
 */
export function attachOverlayDebug(
  window: DebugWindow,
  screen: DebugScreen,
  bind: OverlayDebugBind,
  push: (event: AppDiagEvent) => void,
  savedAlwaysOnTop: boolean,
  schedule: OverlayDebugSchedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: OverlayDebugCancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
): () => void {
  let disposed = false
  const scheduledHandles: unknown[] = []
  const unbinds: Array<() => void> = []
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const handle of scheduledHandles) cancel(handle)
    scheduledHandles.length = 0
    for (const unbind of unbinds) unbind()
    unbinds.length = 0
  }
  const readWindow = (): WindowStateSnapshot | null => {
    if (window.isDestroyed()) return null
    const { x, y, width, height } = window.getBounds()
    return {
      visible: window.isVisible(),
      minimized: window.isMinimized(),
      focused: window.isFocused(),
      alwaysOnTop: window.isAlwaysOnTop(),
      bx: x,
      by: y,
      bw: width,
      bh: height,
    }
  }
  const readMatched = (): DisplaySnapshot | null => {
    if (window.isDestroyed()) return null
    const matched = screen.getDisplayMatching(window.getBounds())
    const wa = matched.workArea
    return { displayId: String(matched.id), scaleFactor: matched.scaleFactor, wx: wa.x, wy: wa.y, ww: wa.width, wh: wa.height }
  }

  // One-shot launch snapshot once the window realizes (caller keeps its own
  // ready-to-show → show(); this only records the resulting state).
  unbinds.push(bind('ready-to-show', () => {
    const snap = readWindow()
    if (snap) push(launchSnapshotEvent(snap, screen.getAllDisplays().length, String(screen.getPrimaryDisplay().id), savedAlwaysOnTop))
  }))
  // Lifecycle/activation events: read the state tuple + matched display at fire.
  const lifecycle = (label: WindowDiagEvent): (() => void) => () => {
    const snap = readWindow()
    const display = readMatched()
    if (snap && display) push(windowEventEvent(label, snap, display))
    if (label === 'focus' || label === 'blur') {
      for (const delayMs of [100, 500, 1000] as const) {
        const handle = schedule(() => {
          if (disposed) return
          const delayedSnap = readWindow()
          const delayedDisplay = readMatched()
          if (delayedSnap && delayedDisplay) push(delayedWindowSnapshotEvent(label, delayMs, delayedSnap, delayedDisplay))
        }, delayMs)
        scheduledHandles.push(handle)
      }
    }
  }
  for (const label of ['show', 'hide', 'focus', 'blur', 'restore', 'minimize'] as const) unbinds.push(bind(label, lifecycle(label)))
  // moved/resized: also capture the matched display's work area.
  const geometry = (label: MovedResizedEvent): (() => void) => () => {
    const snap = readWindow()
    const display = readMatched()
    if (snap && display) push(movedResizedEvent(label, snap, display))
  }
  for (const label of ['moved', 'resized'] as const) unbinds.push(bind(label, geometry(label)))
  return dispose
}
