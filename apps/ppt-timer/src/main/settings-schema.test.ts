import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MIN_WINDOW_SIZE,
  PRESET_SIZES,
  SETTINGS_SCHEMA_VERSION,
  validateSettings,
  withSettingsField,
} from './settings-schema'

describe('settings schema defaults (S-018/S-019)', () => {
  it('defaults to compact 360x220, no saved bounds/display, always-on-top on, timing remaining', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      windowBounds: null,
      selectedDisplayId: null,
      sizePreset: 'compact',
      alwaysOnTop: true,
      timingMode: 'remaining',
    })
  })

  it('exposes the minimum 320x180 and compact/large presets', () => {
    expect(MIN_WINDOW_SIZE).toEqual({ width: 320, height: 180 })
    expect(PRESET_SIZES.compact).toEqual({ width: 360, height: 220 })
    expect(PRESET_SIZES.large).toEqual({ width: 520, height: 320 })
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
      windowBounds: { x: 10, y: 20, width: 360, height: 220 },
      selectedDisplayId: 'Display2',
      sizePreset: 'large',
    })
    expect(result.windowBounds).toEqual({ x: 10, y: 20, width: 360, height: 220 })
    expect(result.selectedDisplayId).toBe('Display2')
    expect(result.sizePreset).toBe('large')
  })

  it('preserves a "custom" preset from a prior manual resize', () => {
    expect(validateSettings({ sizePreset: 'custom' }).sizePreset).toBe('custom')
  })

  it('always stamps the current schema version even if the file carried another', () => {
    expect(validateSettings({ schemaVersion: 999, alwaysOnTop: false }).schemaVersion).toBe(1)
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
