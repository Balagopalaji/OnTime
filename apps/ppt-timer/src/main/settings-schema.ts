/**
 * Settings schema + validation (ISSUE-001 H5, S-018/S-019/S-021/S-023). Pure:
 * no fs, no time, no Electron. The store layer owns atomic writes and corrupt
 * quarantine; this module owns defaults, per-field validation, unknown-field
 * dropping, and partial-data recovery.
 *
 * Persisted under `app.getPath('userData')` as schema-versioned JSON: window
 * bounds, selected display id, size preset, always-on-top, and timing mode.
 */
import type { SizePreset, TimingMode } from '../shared/ipc-contract.js'

export const SETTINGS_SCHEMA_VERSION = 2

export type WindowBounds = { x: number; y: number; width: number; height: number }

export type Settings = {
  schemaVersion: number
  windowBounds: WindowBounds | null
  selectedDisplayId: string | null
  sizePreset: SizePreset
  alwaysOnTop: boolean
  timingMode: TimingMode
}

/** S-018: compact window by default; S-019: always-on-top defaults on; timing remaining. */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  windowBounds: null,
  selectedDisplayId: null,
  sizePreset: 'compact',
  alwaysOnTop: true,
  timingMode: 'remaining',
}

/** Minimalist-v2 closed surface: focused timer, status, and disclosure caret. */
export const COMPACT_WINDOW_SIZE = { width: 260, height: 120 } as const

/** Minimalist-v2 open surface: compact timer plus the settings/details drawer. */
export const DETAILS_WINDOW_SIZE = { width: 360, height: 520 } as const

/** S-018 minimum window size; placement module enforces it against the work area. */
export const MIN_WINDOW_SIZE = COMPACT_WINDOW_SIZE

/** S-018 compact/large presets. */
export const PRESET_SIZES: Record<Exclude<SizePreset, 'custom'>, { width: number; height: number }> = {
  compact: COMPACT_WINDOW_SIZE,
  large: DETAILS_WINDOW_SIZE,
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBounds(raw: unknown): WindowBounds | null {
  if (!isObject(raw)) return null
  const { x, y, width, height } = raw
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return { x, y, width, height } as WindowBounds
}

function readPreset(raw: unknown): SizePreset {
  if (raw === 'compact' || raw === 'large' || raw === 'custom') return raw
  return 'compact'
}

function readTimingMode(raw: unknown): TimingMode {
  if (raw === 'remaining' || raw === 'elapsed') return raw
  return 'remaining'
}

function readString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * Validate a parsed (possibly partial/mistyped) settings object. Each field is
 * validated independently; unknown fields are dropped; invalid values fall back
 * to defaults. The output always carries the current schema version.
 */
export function validateSettings(raw: unknown): Settings {
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS }
  const windowBounds = readBounds(raw.windowBounds)
  const legacy = raw.schemaVersion !== SETTINGS_SCHEMA_VERSION
  const migratedBounds = legacy && windowBounds
    ? {
        x: Math.round(windowBounds.x + (windowBounds.width - COMPACT_WINDOW_SIZE.width) / 2),
        y: Math.round(windowBounds.y + (windowBounds.height - COMPACT_WINDOW_SIZE.height) / 2),
        ...COMPACT_WINDOW_SIZE,
      }
    : windowBounds
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    // Version 2 is a one-time visual-shell migration. Every pre-v2 beta window
    // starts once at the new compact size while retaining its former center;
    // v2 custom and large geometry is thereafter preserved verbatim.
    windowBounds: migratedBounds,
    selectedDisplayId: readString(raw.selectedDisplayId),
    sizePreset: legacy ? 'compact' : readPreset(raw.sizePreset),
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : true,
    timingMode: readTimingMode(raw.timingMode),
  }
}

/** Merge a settings field update into a settings object (immutable). */
export function withSettingsField(settings: Settings, patch: Partial<Settings>): Settings {
  return { ...settings, ...patch, schemaVersion: SETTINGS_SCHEMA_VERSION }
}
