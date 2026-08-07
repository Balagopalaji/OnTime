import { describe, expect, it } from 'vitest'
import { createSettingsStore, type SettingsFs } from './settings-store'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from './settings-schema'

class FakeFs {
  files = new Map<string, string>()
  ops: string[] = []
  readFileFail?: Error
  renameFail?: Error
  constructor(files: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v)
  }
  readFile: SettingsFs['readFile'] = async (path) => {
    this.ops.push(`read:${path}`)
    if (this.readFileFail) throw this.readFileFail
    if (!this.files.has(path)) {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    return this.files.get(path)!
  }
  writeFile: SettingsFs['writeFile'] = async (path, data) => {
    this.ops.push(`write:${path}`)
    this.files.set(path, data)
  }
  rename: SettingsFs['rename'] = async (from, to) => {
    this.ops.push(`rename:${from}->${to}`)
    if (this.renameFail) throw this.renameFail
    if (!this.files.has(from)) throw new Error('ENOENT')
    this.files.set(to, this.files.get(from)!)
    this.files.delete(from)
  }
}

const PATH = '/userData/ontime-ppt-timer/settings.json'

describe('load (S-023 corrupt recovery, first-run)', () => {
  it('returns defaults with recovered=false when the file does not exist (first run)', async () => {
    const fs = new FakeFs()
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 100 })
    const result = await store.load()
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.recovered).toBe(false)
    expect(result.quarantinedPath).toBeNull()
  })

  it('returns parsed settings when the file is valid', async () => {
    const fs = new FakeFs({ [PATH]: JSON.stringify({ alwaysOnTop: false, timingMode: 'elapsed' }) })
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 100 })
    const result = await store.load()
    expect(result.recovered).toBe(false)
    expect(result.settings.alwaysOnTop).toBe(false)
    expect(result.settings.timingMode).toBe('elapsed')
  })

  it('atomically persists the v2 layout migration once and does not repeat it', async () => {
    let tick = 10
    const fs = new FakeFs({
      [PATH]: JSON.stringify({
        schemaVersion: 1,
        sizePreset: 'custom',
        windowBounds: { x: 40, y: 80, width: 360, height: 410 },
        alwaysOnTop: true,
        timingMode: 'remaining',
      }),
    })
    const first = await createSettingsStore({ filePath: PATH, fs, now: () => tick++ }).load()
    expect(first.migrated).toBe(true)
    expect(first.settings).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sizePreset: 'compact',
      windowBounds: { x: 90, y: 225, width: 260, height: 120 },
    })
    expect(JSON.parse(fs.files.get(PATH)!)).toMatchObject({ schemaVersion: SETTINGS_SCHEMA_VERSION })
    const writesAfterMigration = fs.ops.filter((op) => op.startsWith('write:')).length

    const second = await createSettingsStore({ filePath: PATH, fs, now: () => tick++ }).load()
    expect(second.migrated).toBe(false)
    expect(fs.ops.filter((op) => op.startsWith('write:'))).toHaveLength(writesAfterMigration)
  })

  it('quarantines a malformed JSON file with .corrupt-<ts> and returns defaults', async () => {
    const fs = new FakeFs({ [PATH]: '{ this is not json' })
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 42 })
    const result = await store.load()
    expect(result.recovered).toBe(true)
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.quarantinedPath).toBe(`${PATH}.corrupt-42`)
    expect(fs.files.has(`${PATH}.corrupt-42`)).toBe(true)
    expect(fs.files.has(PATH)).toBe(false)
  })

  it('returns recovered with null path when quarantine itself fails, without throwing', async () => {
    const fs = new FakeFs({ [PATH]: '{ bad' })
    fs.renameFail = new Error('permissions')
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 7 })
    const result = await store.load()
    expect(result.recovered).toBe(true)
    expect(result.quarantinedPath).toBeNull()
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('quarantines when the read itself fails for a non-ENOENT reason', async () => {
    const fs = new FakeFs({ [PATH]: '{}' })
    fs.readFileFail = new Error('I/O error') as NodeJS.ErrnoException
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 9 })
    const result = await store.load()
    expect(result.recovered).toBe(true)
    expect(result.quarantinedPath).toBe(`${PATH}.corrupt-9`)
  })
})

describe('save (S-021 atomic, ordered, serialized)', () => {
  it('writes a temp file then atomically renames it onto the target', async () => {
    const fs = new FakeFs()
    const store = createSettingsStore({ filePath: PATH, fs, now: () => 5 })
    await store.save({ ...DEFAULT_SETTINGS, alwaysOnTop: false })
    expect(fs.ops).toEqual([`write:${PATH}.tmp-5`, `rename:${PATH}.tmp-5->${PATH}`])
    expect(fs.files.get(PATH)).toContain('"alwaysOnTop": false')
    expect(fs.files.has(`${PATH}.tmp-5`)).toBe(false)
  })

  it('serializes concurrent saves so writes and renames never interleave', async () => {
    const fs = new FakeFs()
    let n = 0
    const store = createSettingsStore({ filePath: PATH, fs, now: () => n++ })
    const a = store.save({ ...DEFAULT_SETTINGS, timingMode: 'remaining' })
    const b = store.save({ ...DEFAULT_SETTINGS, timingMode: 'elapsed' })
    await Promise.all([a, b])
    // Order: write tmp-0, rename tmp-0, write tmp-1, rename tmp-1 — no interleave.
    expect(fs.ops).toEqual([
      `write:${PATH}.tmp-0`,
      `rename:${PATH}.tmp-0->${PATH}`,
      `write:${PATH}.tmp-1`,
      `rename:${PATH}.tmp-1->${PATH}`,
    ])
    // Final persisted value is the last save (elapsed).
    expect(fs.files.get(PATH)).toContain('"timingMode": "elapsed"')
  })

  it('does not reject a later save if an earlier save failed', async () => {
    const fs = new FakeFs()
    let n = 0
    let renameCalls = 0
    const originalRename = fs.rename
    fs.rename = async (from, to) => {
      renameCalls += 1
      if (renameCalls === 1) throw new Error('transient')
      await originalRename(from, to)
    }
    const store = createSettingsStore({ filePath: PATH, fs, now: () => n++ })
    await expect(store.save(DEFAULT_SETTINGS)).rejects.toThrow('transient')
    await expect(store.save({ ...DEFAULT_SETTINGS, timingMode: 'elapsed' })).resolves.toBeUndefined()
    expect(fs.files.get(PATH)).toContain('"timingMode": "elapsed"')
  })

  it('persists a manual custom resize across a restart', async () => {
    const fs = new FakeFs()
    const beforeRestart = createSettingsStore({ filePath: PATH, fs, now: () => 1 })
    await beforeRestart.save({
      ...DEFAULT_SETTINGS,
      sizePreset: 'custom',
      windowBounds: { x: 100, y: 200, width: 444, height: 333 },
    })
    const afterRestart = createSettingsStore({ filePath: PATH, fs, now: () => 2 })
    await expect(afterRestart.load()).resolves.toMatchObject({
      settings: { sizePreset: 'custom', windowBounds: { x: 100, y: 200, width: 444, height: 333 } },
    })
  })
})
