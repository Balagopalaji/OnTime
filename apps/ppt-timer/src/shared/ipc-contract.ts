/**
 * Shared IPC contract between the Electron main process, the sandboxed preload,
 * and the plain renderer (ISSUE-001 H5). Pure types + pure validation only — no
 * runtime side effects, no Electron, no Node.
 *
 * The main process owns projection, settings, diagnostics, and shutdown. The
 * renderer renders an immutable {@link AppView} and sends closed-union
 * {@link RendererAction}s. The upsell action carries no URL: main opens the one
 * build-time OnTime website constant itself, and only when it is a valid exact
 * HTTPS URL (S-033). When no canonical URL is configured, `ctaAvailable` is
 * false and the CTA is hidden/disabled (no placeholder or wildcard destination).
 */
import type { PowerPointTimingMode, PowerPointViewState } from '@ontime/presentation-core'

export type SizePreset = 'compact' | 'large' | 'custom'
export type TimingMode = PowerPointTimingMode

/** Persisted display reference (Electron display id stringified at the boundary). */
export type DisplayInfo = {
  id: string
  label: string
}

/**
 * Immutable view pushed to the renderer. Replaces the previous view wholesale
 * so an `unavailable` update removes numeric timing in the same frame (S-013).
 * `revision` is monotonic so the renderer ignores stale callbacks.
 */
export type AppView = {
  revision: number
  ctaAvailable: boolean
  state: PowerPointViewState
  timingMode: TimingMode
  alwaysOnTop: boolean
  preset: SizePreset
  displays: DisplayInfo[]
  selectedDisplayId: string | null
}

/** Closed union of renderer -> main actions. `openUpsell` takes no URL. */
export type RendererAction =
  | { type: 'setTimingMode'; mode: TimingMode }
  | { type: 'setAlwaysOnTop'; enabled: boolean }
  | { type: 'applyPreset'; preset: Exclude<SizePreset, 'custom'> }
  | { type: 'moveToDisplay'; displayId: string }
  | { type: 'setDetailsExpanded'; expanded: boolean }
  | { type: 'minimizeWindow' }
  | { type: 'closeWindow' }
  | { type: 'copyDiagnostics' }
  | { type: 'openUpsell' }

export type PreloadApi = {
  getView(): Promise<AppView>
  subscribe(listener: (view: AppView) => void): () => void
  dispatch(action: RendererAction): Promise<void>
}

/** Resolved upsell configuration: an exact HTTPS URL, or none (CTA hidden). */
export type UpsellConfig =
  | { url: string; ctaAvailable: true }
  | { url: null; ctaAvailable: false }

/** True only for an exact, credential-free HTTPS URL with a hostname. */
export function isValidHttpsUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.length > 0 &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

/**
 * Resolve the build-time upsell URL constant (S-033). A missing/empty/invalid
 * value yields `ctaAvailable: false`; the CTA must stay hidden rather than open
 * a placeholder or wildcard destination.
 */
export function resolveUpsellUrl(raw: string | undefined): UpsellConfig {
  if (raw !== undefined && isValidHttpsUrl(raw)) return { url: raw, ctaAvailable: true }
  return { url: null, ctaAvailable: false }
}

/**
 * Allowlist test for navigation/window-open (S-033). Exact match against the one
 * configured URL; never a prefix or wildcard. A null allowlist denies all.
 */
export function isAllowedUpsellUrl(target: string, allowed: string | null): boolean {
  return allowed !== null && target === allowed
}

/** True if `raw` is a plain object (not an array). */
function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

/**
 * Validate a renderer-originated action against the closed union (S-014/S-033).
 * Unknown action types and malformed payloads are rejected. The renderer can
 * never supply a URL: `openUpsell` carries none, and main always opens the
 * build-time constant.
 */
export type ParseResult = { ok: true; action: RendererAction } | { ok: false }

export function parseRendererAction(raw: unknown): ParseResult {
  if (!isRecord(raw) || typeof raw.type !== 'string') return { ok: false }
  switch (raw.type) {
    case 'setTimingMode':
      if (raw.mode === 'remaining' || raw.mode === 'elapsed') return { ok: true, action: { type: 'setTimingMode', mode: raw.mode } }
      return { ok: false }
    case 'setAlwaysOnTop':
      if (typeof raw.enabled === 'boolean') return { ok: true, action: { type: 'setAlwaysOnTop', enabled: raw.enabled } }
      return { ok: false }
    case 'applyPreset':
      if (raw.preset === 'compact' || raw.preset === 'large') return { ok: true, action: { type: 'applyPreset', preset: raw.preset } }
      return { ok: false }
    case 'moveToDisplay':
      if (typeof raw.displayId === 'string' && raw.displayId.length > 0) return { ok: true, action: { type: 'moveToDisplay', displayId: raw.displayId } }
      return { ok: false }
    case 'setDetailsExpanded':
      if (typeof raw.expanded === 'boolean') return { ok: true, action: { type: 'setDetailsExpanded', expanded: raw.expanded } }
      return { ok: false }
    case 'minimizeWindow':
      return { ok: true, action: { type: 'minimizeWindow' } }
    case 'closeWindow':
      return { ok: true, action: { type: 'closeWindow' } }
    case 'copyDiagnostics':
      return { ok: true, action: { type: 'copyDiagnostics' } }
    case 'openUpsell':
      // No URL is accepted from the renderer, even if one is supplied.
      return { ok: true, action: { type: 'openUpsell' } }
    default:
      return { ok: false }
  }
}
