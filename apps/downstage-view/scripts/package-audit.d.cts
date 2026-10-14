interface UnpackedAppOptions {
  platform: 'win32' | 'darwin'
}
export const APP_NAME: string
export function auditAsarEntries(entries: readonly string[]): string[]
export function auditUnpackedApp(files: readonly string[], options: UnpackedAppOptions): string[]
