/**
 * Settings schema + validation (ISSUE-001 H5, S-018/S-019/S-021/S-023). Pure:
 * no fs, no time, no Electron. The store layer owns atomic writes and corrupt
 * quarantine; this module owns defaults, per-field validation, unknown-field
 * dropping, and partial-data recovery.
 *
 * Persisted under `app.getPath('userData')` as schema-versioned JSON: window
 * bounds, selected display id, size preset, always-on-top, auto-open, timing
 * mode, and playing-video headline mode.
 */
import type { HeadlineMode, SizePreset, TimingMode } from '../shared/ipc-contract.js'

export const SETTINGS_SCHEMA_VERSION = 6

export type WindowBounds = { x: number; y: number; width: number; height: number }

export type Settings = {
  schemaVersion: number
  windowBounds: WindowBounds | null
  selectedDisplayId: string | null
  sizePreset: SizePreset
  alwaysOnTop: boolean
  autoOpenVideoList: boolean
  timingMode: TimingMode
  headlineMode: HeadlineMode
}

/** S-018: compact window by default; S-019: always-on-top defaults on; timing remaining. */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  windowBounds: null,
  selectedDisplayId: null,
  sizePreset: 'compact',
  alwaysOnTop: true,
  autoOpenVideoList: false,
  timingMode: 'remaining',
  headlineMode: 'longest-remaining',
}

/** Minimalist-v6 closed surface: focused timer, status, and disclosure caret. */
export const COMPACT_WINDOW_SIZE = { width: 190, height: 80 } as const

/** Manual compact-window resizing stays on the accepted timer-card shape. */
export const COMPACT_WINDOW_ASPECT_RATIO = COMPACT_WINDOW_SIZE.width / COMPACT_WINDOW_SIZE.height

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

function readHeadlineMode(raw: unknown): HeadlineMode {
  if (raw === 'longest-remaining' || raw === 'latest-started') return raw
  return 'longest-remaining'
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
  const sourceVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  // All original beta layouts migrate, while v2/v3 installs migrate only when
  // they still represent the semantic compact preset. Genuine custom/large
  // resizes are preserved and stamped v4+, so this refinement never repeats.
  const migrateCompact = sourceVersion < 2
    || (sourceVersion < 4 && raw.sizePreset === 'compact')
  const migratedBounds = migrateCompact && windowBounds
    ? {
        x: Math.round(windowBounds.x + (windowBounds.width - COMPACT_WINDOW_SIZE.width) / 2),
        y: Math.round(windowBounds.y + (windowBounds.height - COMPACT_WINDOW_SIZE.height) / 2),
        ...COMPACT_WINDOW_SIZE,
      }
    : windowBounds
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    // Version 4 refines the visual shell. Old beta windows and semantic v2/v3
    // compact presets shrink once around their center; custom/large and all v4+
    // geometry remain verbatim.
    windowBounds: migratedBounds,
    selectedDisplayId: readString(raw.selectedDisplayId),
    sizePreset: migrateCompact ? 'compact' : readPreset(raw.sizePreset),
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : true,
    autoOpenVideoList: typeof raw.autoOpenVideoList === 'boolean' ? raw.autoOpenVideoList : false,
    timingMode: readTimingMode(raw.timingMode),
    headlineMode: readHeadlineMode(raw.headlineMode),
  }
}

/** Merge a settings field update into a settings object (immutable). */
export function withSettingsField(settings: Settings, patch: Partial<Settings>): Settings {
  return { ...settings, ...patch, schemaVersion: SETTINGS_SCHEMA_VERSION }
}
