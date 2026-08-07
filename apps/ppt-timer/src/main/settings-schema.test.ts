import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  COMPACT_WINDOW_SIZE,
  DETAILS_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  PRESET_SIZES,
  SETTINGS_SCHEMA_VERSION,
  validateSettings,
  withSettingsField,
} from './settings-schema'

describe('settings schema defaults (S-018/S-019)', () => {
  it('defaults to compact, no saved bounds/display, always-on-top on, timing remaining', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      windowBounds: null,
      selectedDisplayId: null,
      sizePreset: 'compact',
      alwaysOnTop: true,
      timingMode: 'remaining',
    })
  })

  it('exposes the minimalist compact/details sizes as the minimum and presets', () => {
    expect(COMPACT_WINDOW_SIZE).toEqual({ width: 190, height: 80 })
    expect(DETAILS_WINDOW_SIZE).toEqual({ width: 360, height: 520 })
    expect(MIN_WINDOW_SIZE).toBe(COMPACT_WINDOW_SIZE)
    expect(PRESET_SIZES.compact).toBe(COMPACT_WINDOW_SIZE)
    expect(PRESET_SIZES.large).toBe(DETAILS_WINDOW_SIZE)
  })
})

describe('validateSettings (S-021/S-023 partial + unknown recovery)', () => {
  it('returns defaults for non-object input', () => {
    for (const value of [undefined, null, 'x', 42, []]) {
      expect(validateSettings(value)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('returns defaults for an empty object', () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields and defaults the rest', () => {
    const result = validateSettings({ alwaysOnTop: false, timingMode: 'elapsed' })
    expect(result.alwaysOnTop).toBe(false)
    expect(result.timingMode).toBe('elapsed')
    expect(result.windowBounds).toBeNull()
    expect(result.selectedDisplayId).toBeNull()
    expect(result.sizePreset).toBe('compact')
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('drops unknown fields', () => {
    const result = validateSettings({ alwaysOnTop: true, secret: 'leak', nested: { x: 1 } })
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('rejects invalid field types and falls back to defaults per field', () => {
    const result = validateSettings({
      windowBounds: { x: 0, y: 0, width: 'wide', height: 10 },
      selectedDisplayId: 123,
      sizePreset: 'enormous',
      alwaysOnTop: 'yes',
      timingMode: 'sideways',
    })
    expect(result.windowBounds).toBeNull()
    expect(result.selectedDisplayId).toBeNull()
    expect(result.sizePreset).toBe('compact')
    expect(result.alwaysOnTop).toBe(true)
    expect(result.timingMode).toBe('remaining')
  })

  it('accepts a valid windowBounds and string display id and preserves custom/large presets', () => {
    const result = validateSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      windowBounds: { x: 10, y: 20, width: 360, height: 220 },
      selectedDisplayId: 'Display2',
      sizePreset: 'large',
    })
    expect(result.windowBounds).toEqual({ x: 10, y: 20, width: 360, height: 220 })
    expect(result.selectedDisplayId).toBe('Display2')
    expect(result.sizePreset).toBe('large')
  })

  it('preserves a "custom" preset from a prior manual resize', () => {
    expect(validateSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION, sizePreset: 'custom' }).sizePreset).toBe('custom')
  })

  it('migrates any pre-v2 beta bounds once to compact while retaining their center', () => {
    const betaBounds = { x: 40, y: 80, width: 360, height: 410 }
    for (const sizePreset of ['compact', 'custom', 'large', undefined]) {
      expect(validateSettings({ schemaVersion: 1, sizePreset, windowBounds: betaBounds })).toMatchObject({
        sizePreset: 'compact',
        windowBounds: {
          x: 125,
          y: 245,
          ...COMPACT_WINDOW_SIZE,
        },
      })
    }
  })

  it('never repeats the migration for current custom or large settings', () => {
    const customBounds = { x: 40, y: 80, width: 444, height: 333 }
    expect(validateSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION, sizePreset: 'custom', windowBounds: customBounds })).toMatchObject({
      sizePreset: 'custom',
      windowBounds: customBounds,
    })
    expect(validateSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION, sizePreset: 'large', windowBounds: customBounds })).toMatchObject({
      sizePreset: 'large',
      windowBounds: customBounds,
    })
  })

  it('migrates legacy partial settings that omitted the preset', () => {
    expect(validateSettings({ schemaVersion: 1, windowBounds: { x: 5, y: 6, width: 444, height: 333 } }).windowBounds).toEqual({
      x: 132,
      y: 133,
      ...COMPACT_WINDOW_SIZE,
    })
  })

  it('migrates installed v2/v3 compact shells once but preserves custom geometry', () => {
    expect(validateSettings({
      schemaVersion: 2,
      sizePreset: 'compact',
      windowBounds: { x: 100, y: 200, width: 260, height: 120 },
    })).toMatchObject({
      sizePreset: 'compact',
      windowBounds: { x: 135, y: 220, width: 190, height: 80 },
    })
    expect(validateSettings({
      schemaVersion: 3,
      sizePreset: 'compact',
      windowBounds: { x: 130, y: 216, width: 200, height: 88 },
    })).toMatchObject({
      sizePreset: 'compact',
      windowBounds: { x: 135, y: 220, width: 190, height: 80 },
    })
    const custom = { x: 100, y: 200, width: 310, height: 160 }
    expect(validateSettings({ schemaVersion: 2, sizePreset: 'custom', windowBounds: custom })).toMatchObject({
      sizePreset: 'custom',
      windowBounds: custom,
    })
  })

  it('always stamps the current schema version even if the file carried another', () => {
    expect(validateSettings({ schemaVersion: 999, alwaysOnTop: false }).schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })
})

describe('withSettingsField', () => {
  it('returns an immutable merged settings object stamped with the schema version', () => {
    const next = withSettingsField(DEFAULT_SETTINGS, { timingMode: 'elapsed' })
    expect(next.timingMode).toBe('elapsed')
    expect(DEFAULT_SETTINGS.timingMode).toBe('remaining')
    expect(next.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })
})
