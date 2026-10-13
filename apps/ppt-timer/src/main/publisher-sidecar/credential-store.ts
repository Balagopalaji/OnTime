/**
 * Main-process credential broker (Deep Plan "Credential lifecycle"). Electron
 * `safeStorage` (DPAPI on Windows) seals opaque sidecar credential data into a
 * dedicated, versioned file under user data, replaced atomically. There is no
 * plaintext fallback; main never interprets or logs the data.
 */
import { sealedDataFits, type StorageError } from './protocol'

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type CredentialFs = {
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: Buffer): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string): Promise<void>
}

export type StorageOutcome = { ok: true } | { ok: false; error: StorageError }
export type UnsealOutcome = { ok: true; data: string } | { ok: false; error: StorageError }
export type CredentialBroker = {
  seal(data: string): Promise<StorageOutcome>
  unseal(): Promise<UnsealOutcome>
  clear(): Promise<StorageOutcome>
}

const HEADER = Buffer.from('ODPC1\n', 'utf8')
const isMissing = (error: unknown) => (error as { code?: string }).code === 'ENOENT'

export function createCredentialBroker(options: { safeStorage: SafeStorageLike; fs: CredentialFs; filePath: string }): CredentialBroker {
  const { safeStorage, fs, filePath } = options
  // Operations run strictly in request order: a clear (sign-out) can never be
  // overtaken by an earlier seal's rename, and concurrent seals never share a temp file.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op)
    queue = run.catch(() => undefined)
    return run
  }
  let writes = 0
  const broker: CredentialBroker = {
    async seal(data) {
      if (!sealedDataFits(data)) return { ok: false, error: 'too-large' }
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
      let sealed: Buffer
      try {
        sealed = Buffer.concat([HEADER, safeStorage.encryptString(data)])
      } catch {
        return { ok: false, error: 'encryption-unavailable' }
      }
      const tempPath = `${filePath}.${++writes}.tmp`
      try {
        await fs.writeFile(tempPath, sealed)
        await fs.rename(tempPath, filePath)
        return { ok: true }
      } catch {
        await fs.rm(tempPath).catch(() => undefined)
        return { ok: false, error: 'io' }
      }
    },
    async unseal() {
      let stored: Buffer
      try {
        stored = await fs.readFile(filePath)
      } catch (error) {
        return { ok: false, error: isMissing(error) ? 'not-found' : 'io' }
      }
      if (stored.length < HEADER.length || !stored.subarray(0, HEADER.length).equals(HEADER)) return { ok: false, error: 'corrupt' }
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
      try {
        const data = safeStorage.decryptString(stored.subarray(HEADER.length))
        return sealedDataFits(data) ? { ok: true, data } : { ok: false, error: 'corrupt' }
      } catch {
        return { ok: false, error: 'corrupt' }
      }
    },
    async clear() {
      try {
        await fs.rm(filePath)
        return { ok: true }
      } catch (error) {
        return isMissing(error) ? { ok: true } : { ok: false, error: 'io' }
      }
    },
  }
  return { seal: (data) => serial(() => broker.seal(data)), unseal: () => serial(broker.unseal), clear: () => serial(broker.clear) }
}
