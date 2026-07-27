/**
 * Sanitized diagnostics (ISSUE-001 H5, S-025/S-026). A bounded in-memory ring
 * (last 100 events) plus a redacted clipboard report.
 *
 * Redaction is structural, not an after-the-fact scrub: the event union never
 * stores slide titles, raw selected-video names, stderr text, environment
 * variables, usernames, tokens, or document contents. The only path-bearing
 * field is a quarantined settings path, which is basename-trimmed on insert.
 * "Copy diagnostics" formats the ring into a support-safe clipboard string.
 */
import type { BridgeDiagnosticEvent, BridgeDiagnosticSink } from '@ontime/ppt-bridge'

export const DIAGNOSTICS_CAPACITY = 100

export type SigningStatus = 'unsigned-beta' | 'signed' | 'unknown'

export type DiagMeta = {
  appVersion: string
  helperVersion: string
  protocolVersion: number | null
  signingStatus: SigningStatus
  windowsBitness?: string
  officeBitness?: string
}

/** App-originated events. Closed union; no field carries raw PII/content. */
export type AppDiagEvent =
  | { kind: 'app_launch' }
  | { kind: 'app_shutdown' }
  | { kind: 'availability_transition'; from: string; to: string }
  | { kind: 'slide_observed'; slideNumber: number | null; mediaCount: number; selectedMediaId: number | null }
  | { kind: 'affinity'; processCount: number | null; selectedPid: number | null; comPid: number | null; mismatch: boolean }
  | { kind: 'display_change'; displayId: string; scaleFactor: number; displayCount: number }
  | { kind: 'window_bounds'; x: number; y: number; width: number; height: number }
  | { kind: 'settings_recovered'; quarantinedPath: string | null }

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
    case 'helper_stderr': return `bridge helper_stderr generation=${event.generation} byteCount=${event.byteCount}`
    case 'validation_warning': return `bridge validation_warning code=${event.code} path=${event.path}`
    case 'availability': return `bridge availability outcome=${event.outcome}`
    case 'output_failure': return `bridge output_failure outcome=${event.outcome}`
    default: return `bridge unknown`
  }
}

function formatApp(event: AppDiagEvent): string {
  switch (event.kind) {
    case 'app_launch': return 'app app_launch'
    case 'app_shutdown': return 'app app_shutdown'
    case 'availability_transition': return `app availability_transition from=${event.from} to=${event.to}`
    case 'slide_observed': return `app slide_observed slide=${event.slideNumber ?? '--'} mediaCount=${event.mediaCount} selectedMediaId=${event.selectedMediaId ?? '--'}`
    case 'affinity': return `app affinity processCount=${event.processCount ?? '--'} selectedPid=${event.selectedPid ?? '--'} comPid=${event.comPid ?? '--'} mismatch=${event.mismatch}`
    case 'display_change': return `app display_change displayId=${event.displayId} scaleFactor=${event.scaleFactor} displayCount=${event.displayCount}`
    case 'window_bounds': return `app window_bounds x=${event.x} y=${event.y} width=${event.width} height=${event.height}`
    case 'settings_recovered': return `app settings_recovered quarantinedPath=${event.quarantinedPath ?? '--'}`
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
    this.append({ source: 'app', at: this.now(), event: sanitized })
  }

  private append(entry: DiagEntry): void {
    if (this.entries.length >= this.capacity) this.entries.shift()
    this.entries.push(entry)
  }

  buildReport(meta: DiagMeta): string {
    const lines: string[] = [
      'OnTime PPT Timer diagnostics',
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
