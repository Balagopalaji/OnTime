/**
 * Atomic settings persistence (ISSUE-001 H5, S-021/S-023). Owns serialized
 * temp-file -> rename writes and corrupt-file quarantine. The fs layer is
 * injected so the ordering, quarantine, and serialization are unit-testable
 * without touching the real disk.
 *
 * - ENOENT on load means first run: return defaults.
 * - Unreadable or unparseable file is renamed to `<path>.corrupt-<ts>` and
 *   replaced with defaults; quarantine failure must not crash startup.
 * - Writes are serialized through one promise queue and use same-directory
 *   temp-file -> atomic rename so a crash mid-write cannot leave a partial file.
 */
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, validateSettings, type Settings } from './settings-schema.js'

export type SettingsFs = {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export type LoadResult = { settings: Settings; recovered: boolean; migrated: boolean; quarantinedPath: string | null }

export type SettingsStoreOptions = {
  filePath: string
  fs: SettingsFs
  now?: () => number
}

export type SettingsStore = {
  load(): Promise<LoadResult>
  save(settings: Settings): Promise<void>
}

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const { filePath, fs } = options
  const now = options.now ?? Date.now
  let queue: Promise<unknown> = Promise.resolve()

  const quarantine = async (reason: string): Promise<string | null> => {
    const quarantinedPath = `${filePath}.corrupt-${now()}`
    try {
      await fs.rename(filePath, quarantinedPath)
      return quarantinedPath
    } catch {
      // Quarantine failure (e.g. unreadable file, permissions) must not crash
      // startup; fall back to defaults with no quarantined path.
      return null
    }
  }

  const save = (settings: Settings): Promise<void> => {
    const run = queue.then(async () => {
      const tmp = `${filePath}.tmp-${now()}`
      const data = JSON.stringify(settings, null, 2)
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, filePath)
    })
    queue = run.catch(() => undefined)
    return run
  }

  const load = async (): Promise<LoadResult> => {
    let text: string
    try {
      text = await fs.readFile(filePath)
    } catch (error) {
      if (isEnoent(error)) return { settings: { ...DEFAULT_SETTINGS }, recovered: false, migrated: false, quarantinedPath: null }
      const quarantinedPath = await quarantine('read-failed')
      return { settings: { ...DEFAULT_SETTINGS }, recovered: true, migrated: false, quarantinedPath }
    }
    try {
      const parsed = JSON.parse(text) as unknown
      const settings = validateSettings(parsed)
      const migrated = typeof parsed === 'object' && parsed !== null
        && (parsed as { schemaVersion?: unknown }).schemaVersion !== SETTINGS_SCHEMA_VERSION
      // Migration persistence is best-effort. A transient write failure must
      // not misclassify valid JSON as corrupt or block the timer from opening.
      if (migrated) await save(settings).catch(() => undefined)
      return { settings, recovered: false, migrated, quarantinedPath: null }
    } catch {
      const quarantinedPath = await quarantine('parse-failed')
      return { settings: { ...DEFAULT_SETTINGS }, recovered: true, migrated: false, quarantinedPath }
    }
  }

  return { load, save }
}
