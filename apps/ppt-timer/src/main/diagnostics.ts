/**
 * Sanitized diagnostics (ISSUE-001 H5, S-025/S-026). A bounded in-memory ring
 * (last 100 events) plus a redacted clipboard report.
 *
 * Redaction is structural, not an after-the-fact scrub: the event union never
 * stores slide titles, raw selected-video names, stderr text, environment
 * variables, usernames, tokens, or document contents. The only path-bearing
 * field is a quarantined settings path, which is basename-trimmed on insert.
 * "Copy diagnostics" formats the ring into a support-safe clipboard string.
 *
 * The `debug_*` event kinds (overlay-window diagnostics) are opt-in: they are
 * only ever pushed when `PPT_TIMER_DEBUG=1` (see {@link isOverlayDebug}), so a
 * normal run's report is unchanged. They carry only scalar geometry/state
 * (bounds, display IDs, scale factors, visibility/always-on-top booleans) —
 * never window titles, process names, or other foreground-window identifiers.
 */
import type { BridgeDiagnosticEvent, BridgeDiagnosticSink } from '@ontime/ppt-bridge'

export const DIAGNOSTICS_CAPACITY = 100
/** Polling can produce affinity observations every second; retain only this many. */
export const AFFINITY_DIAGNOSTICS_CAPACITY = 20

/**
 * Env flag for the Windows overlay-window diagnostics (ISSUE-001 Presenter View
 * faults). When unset, no `debug_*` events are pushed and `console.debug` stays
 * silent, so normal behavior is byte-identical to before this batch.
 */
export const OVERLAY_DEBUG_ENV = 'PPT_TIMER_DEBUG'

/** True only when the overlay-debug env flag is explicitly enabled. Pure. */
export function isOverlayDebug(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OVERLAY_DEBUG_ENV] === '1'
}

export type SigningStatus = 'unsigned-beta' | 'signed' | 'unknown'

export type DiagMeta = {
  appVersion: string
  helperVersion: string
  protocolVersion: number | null
  signingStatus: SigningStatus
  windowsBitness?: string
  officeBitness?: string
}

/**
 * App-originated events. Closed union; no field carries raw PII/content.
 *
 * The `debug_*` kinds are overlay-window diagnostics (opt-in via
 * {@link isOverlayDebug}); the rest are always-on. Geometry bounds use the
 * compact `{bx,by,bw,bh}` shape to stay distinguishable from the always-on
 * `window_bounds` event in the formatted report.
 */
export type AppDiagEvent =
  | { kind: 'app_launch' }
  | { kind: 'app_ready'; elapsedMs: number }
  | { kind: 'window_ready'; elapsedMs: number }
  | { kind: 'second_instance' }
  | { kind: 'app_shutdown' }
  | { kind: 'availability_transition'; from: string; to: string }
  | { kind: 'slide_observed'; slideNumber: number | null; mediaCount: number; selectedMediaId: number | null; selectedMediaIndex: number | null }
  | { kind: 'affinity'; processCount: number | null; selectedPid: number | null; comPid: number | null; mismatch: boolean }
  | { kind: 'display_change'; displayId: string; scaleFactor: number; displayCount: number }
  | { kind: 'window_bounds'; x: number; y: number; width: number; height: number }
  | { kind: 'settings_recovered'; quarantinedPath: string | null }
  // Overlay-window diagnostics (PPT_TIMER_DEBUG=1 only). No PII: only scalar
  // geometry, display IDs/labels, scale factors, and visibility/order state.
  // `bx/by/bw/bh` are window bounds; `wx/wy/ww/wh` are matched work-area bounds.
  | { kind: 'debug_launch_snapshot'; displayCount: number; primaryId: string; savedAlwaysOnTop: boolean; bx: number; by: number; bw: number; bh: number; visible: boolean; minimized: boolean; focused: boolean; alwaysOnTop: boolean }
  | { kind: 'debug_window_event'; event: 'ready-to-show' | 'show' | 'hide' | 'focus' | 'blur' | 'restore' | 'minimize'; visible: boolean; minimized: boolean; focused: boolean; alwaysOnTop: boolean; bx: number; by: number; bw: number; bh: number; displayId: string; scaleFactor: number }
  | { kind: 'debug_delayed_window_snapshot'; trigger: 'focus' | 'blur'; delayMs: 100 | 500 | 1000; visible: boolean; minimized: boolean; focused: boolean; alwaysOnTop: boolean; bx: number; by: number; bw: number; bh: number; displayId: string; scaleFactor: number }
  | { kind: 'debug_always_on_top_request'; requested: boolean; nativeBefore: boolean; nativeAfter: boolean }
  | { kind: 'debug_always_on_top_changed'; eventValue: boolean; currentValue: boolean; insideAppSetter: boolean }
  | { kind: 'debug_window_message'; message: 'WM_ACTIVATE' | 'WM_ACTIVATEAPP' | 'WM_WINDOWPOSCHANGING' | 'WM_WINDOWPOSCHANGED' | 'WM_STYLECHANGED' | 'WM_SHOWWINDOW'; code: number; activation?: 'inactive' | 'active' | 'click-active' | 'other'; appActive?: boolean; shown?: boolean }
  | { kind: 'debug_moved_resized'; event: 'moved' | 'resized'; bx: number; by: number; bw: number; bh: number; displayId: string; scaleFactor: number; wx: number; wy: number; ww: number; wh: number }
  | { kind: 'debug_display_event'; event: 'display-added' | 'display-removed' | 'display-metrics-changed'; displayId: string; displayCount: number; scaleFactor: number; wx: number; wy: number; ww: number; wh: number }
  | { kind: 'debug_programmatic_bounds'; reason: 'preset' | 'moveToDisplay' | 'revalidate'; bxBefore: number; byBefore: number; bwBefore: number; bhBefore: number; bxAfter: number; byAfter: number; bwAfter: number; bhAfter: number; displayId: string }
  | { kind: 'debug_placement_decision'; outcome: 'kept' | 'recentered' | 'clamped'; visibleOnDisplayId: string | null; targetDisplayId: string; bx: number; by: number; bw: number; bh: number }

type DiagEntry =
  | { source: 'bridge'; at: number; event: BridgeDiagnosticEvent }
  | { source: 'app'; at: number; event: AppDiagEvent }

/** Reduce a full filesystem path to its basename (supports `/` and `\`). */
export function redactPath(path: string): string {
  const last = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return last === -1 ? path : path.slice(last + 1)
}

function formatBridge(event: BridgeDiagnosticEvent): string {
  switch (event.kind) {
    case 'helper_start': return `bridge helper_start generation=${event.generation}`
    case 'helper_exit': return `bridge helper_exit generation=${event.generation} expected=${event.expected}${event.code !== undefined ? ` code=${event.code}` : ''}${event.signal ? ` signal=${event.signal}` : ''}`
    case 'helper_timeout': return `bridge helper_timeout generation=${event.generation} timeoutMs=${event.timeoutMs}`
    case 'helper_restart': return `bridge helper_restart attempt=${event.attempt} delayMs=${event.delayMs}`
    case 'helper_close': return `bridge helper_close phase=${event.phase}`
    case 'helper_termination': return `bridge helper_termination generation=${event.generation} context=${event.context} result=${event.result} waitMs=${event.waitMs}`
    case 'helper_stderr': return `bridge helper_stderr generation=${event.generation} byteCount=${event.byteCount}`
    case 'poll_slow': return `bridge poll_slow generation=${event.generation} elapsedMs=${event.elapsedMs} outcome=${event.outcome}`
    case 'validation_warning': return `bridge validation_warning code=${event.code} path=${event.path}`
    case 'availability': return `bridge availability outcome=${event.outcome}`
    case 'output_failure': return `bridge output_failure outcome=${event.outcome}`
    default: return `bridge unknown`
  }
}

/** Compact `x,y,w,h` bounds formatter shared by the `debug_*` events. */
function fmtBounds(x: number, y: number, w: number, h: number): string {
  return `${x},${y},${w},${h}`
}

function formatApp(event: AppDiagEvent): string {
  switch (event.kind) {
    case 'app_launch': return 'app app_launch'
    case 'app_ready': return `app app_ready elapsedMs=${event.elapsedMs}`
    case 'window_ready': return `app window_ready elapsedMs=${event.elapsedMs}`
    case 'second_instance': return 'app second_instance'
    case 'app_shutdown': return 'app app_shutdown'
    case 'availability_transition': return `app availability_transition from=${event.from} to=${event.to}`
    case 'slide_observed': return `app slide_observed slide=${event.slideNumber ?? '--'} mediaCount=${event.mediaCount} selectedMediaId=${event.selectedMediaId ?? '--'} selectedMediaIndex=${event.selectedMediaIndex ?? '--'}`
    case 'affinity': return `app affinity processCount=${event.processCount ?? '--'} selectedPid=${event.selectedPid ?? '--'} comPid=${event.comPid ?? '--'} mismatch=${event.mismatch}`
    case 'display_change': return `app display_change displayId=${event.displayId} scaleFactor=${event.scaleFactor} displayCount=${event.displayCount}`
    case 'window_bounds': return `app window_bounds x=${event.x} y=${event.y} width=${event.width} height=${event.height}`
    case 'settings_recovered': return `app settings_recovered quarantinedPath=${event.quarantinedPath ?? '--'}`
    case 'debug_launch_snapshot':
      return `app debug_launch_snapshot displayCount=${event.displayCount} primaryId=${event.primaryId} savedAlwaysOnTop=${event.savedAlwaysOnTop} actualAlwaysOnTop=${event.alwaysOnTop} bounds=${fmtBounds(event.bx, event.by, event.bw, event.bh)} visible=${event.visible} minimized=${event.minimized} focused=${event.focused}`
    case 'debug_window_event':
      return `app debug_window_event event=${event.event} visible=${event.visible} minimized=${event.minimized} focused=${event.focused} alwaysOnTop=${event.alwaysOnTop} bounds=${fmtBounds(event.bx, event.by, event.bw, event.bh)} displayId=${event.displayId} scaleFactor=${event.scaleFactor}`
    case 'debug_delayed_window_snapshot':
      return `app debug_delayed_window_snapshot trigger=${event.trigger} delayMs=${event.delayMs} visible=${event.visible} minimized=${event.minimized} focused=${event.focused} alwaysOnTop=${event.alwaysOnTop} bounds=${fmtBounds(event.bx, event.by, event.bw, event.bh)} displayId=${event.displayId} scaleFactor=${event.scaleFactor}`
    case 'debug_always_on_top_request':
      return `app debug_always_on_top_request requested=${event.requested} nativeBefore=${event.nativeBefore} nativeAfter=${event.nativeAfter}`
    case 'debug_always_on_top_changed':
      return `app debug_always_on_top_changed eventValue=${event.eventValue} currentValue=${event.currentValue} insideAppSetter=${event.insideAppSetter}`
    case 'debug_window_message':
      return `app debug_window_message message=${event.message} code=${event.code}${event.activation ? ` activation=${event.activation}` : ''}${event.appActive === undefined ? '' : ` appActive=${event.appActive}`}${event.shown === undefined ? '' : ` shown=${event.shown}`}`
    case 'debug_moved_resized':
      return `app debug_moved_resized event=${event.event} bounds=${fmtBounds(event.bx, event.by, event.bw, event.bh)} displayId=${event.displayId} scaleFactor=${event.scaleFactor} workArea=${fmtBounds(event.wx, event.wy, event.ww, event.wh)}`
    case 'debug_display_event':
      return `app debug_display_event event=${event.event} displayId=${event.displayId} displayCount=${event.displayCount} scaleFactor=${event.scaleFactor} workArea=${fmtBounds(event.wx, event.wy, event.ww, event.wh)}`
    case 'debug_programmatic_bounds':
      return `app debug_programmatic_bounds reason=${event.reason} before=${fmtBounds(event.bxBefore, event.byBefore, event.bwBefore, event.bhBefore)} after=${fmtBounds(event.bxAfter, event.byAfter, event.bwAfter, event.bhAfter)} displayId=${event.displayId}`
    case 'debug_placement_decision':
      return `app debug_placement_decision outcome=${event.outcome} visibleOnDisplayId=${event.visibleOnDisplayId ?? '--'} targetDisplayId=${event.targetDisplayId} bounds=${fmtBounds(event.bx, event.by, event.bw, event.bh)}`
    default: return 'app unknown'
  }
}

export class DiagnosticsBuffer {
  private entries: DiagEntry[] = []
  private readonly capacity: number
  private readonly now: () => number

  constructor(options: { capacity?: number; now?: () => number } = {}) {
    this.capacity = options.capacity ?? DIAGNOSTICS_CAPACITY
    this.now = options.now ?? Date.now
  }

  get count(): number {
    return this.entries.length
  }

  /** Compatible with `@ontime/ppt-bridge`'s `BridgeDiagnosticSink`. */
  asSink(): BridgeDiagnosticSink {
    return (event) => this.pushBridge(event)
  }

  pushBridge(event: BridgeDiagnosticEvent): void {
    this.append({ source: 'bridge', at: this.now(), event })
  }

  push(event: AppDiagEvent): void {
    const sanitized: AppDiagEvent =
      event.kind === 'settings_recovered'
        ? { ...event, quarantinedPath: event.quarantinedPath ? redactPath(event.quarantinedPath) : null }
        : event
    const entry: DiagEntry = { source: 'app', at: this.now(), event: sanitized }
    if (sanitized.kind === 'affinity') this.appendAffinity(entry)
    else this.append(entry)
  }

  /**
   * Affinity is a poll-side signal. It is deliberately lossy under pressure so
   * it cannot evict opt-in overlay evidence from the shared 100-entry report.
   */
  private appendAffinity(entry: DiagEntry): void {
    const oldestAffinity = this.entries.findIndex((candidate) => candidate.source === 'app' && candidate.event.kind === 'affinity')
    const affinityCount = this.entries.filter((candidate) => candidate.source === 'app' && candidate.event.kind === 'affinity').length
    if (this.entries.length >= this.capacity) {
      if (oldestAffinity === -1) return
      this.entries.splice(oldestAffinity, 1)
    } else if (affinityCount >= AFFINITY_DIAGNOSTICS_CAPACITY) {
      this.entries.splice(oldestAffinity, 1)
    }
    this.entries.push(entry)
  }

  private append(entry: DiagEntry): void {
    if (this.entries.length >= this.capacity) this.entries.shift()
    this.entries.push(entry)
  }

  buildReport(meta: DiagMeta): string {
    const lines: string[] = [
      'Downstage PPT Video Timer diagnostics',
      `appVersion: ${meta.appVersion}`,
      `helperVersion: ${meta.helperVersion}`,
      `protocolVersion: ${meta.protocolVersion ?? '--'}`,
      `signingStatus: ${meta.signingStatus}`,
    ]
    if (meta.windowsBitness) lines.push(`windowsBitness: ${meta.windowsBitness}`)
    if (meta.officeBitness) lines.push(`officeBitness: ${meta.officeBitness}`)
    lines.push(`--- events (last ${this.entries.length}) ---`)
    for (const entry of this.entries) {
      const formatted = entry.source === 'bridge' ? formatBridge(entry.event) : formatApp(entry.event)
      lines.push(`[${entry.at}] ${formatted}`)
    }
    return lines.join('\n')
  }
}
