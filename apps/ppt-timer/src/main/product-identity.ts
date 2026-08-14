import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Public Windows identity for the standalone timer. */
export const PRODUCT_NAME = 'Downstage PPT Video Timer'

/**
 * Keep settings in a suite-owned path that is independent of the internal npm
 * workspace name and the retired OnTime beta identity.
 */
export function resolveUserDataPath(appDataPath: string): string {
  return join(appDataPath, 'Downstage', 'PPT Video Timer')
}

type ProductIdentityApp = {
  setName(name: string): void
  getPath(name: 'appData'): string
  setPath(name: 'userData', path: string): void
}

/** Configure Electron before the single-instance lock and first settings read. */
export async function configureProductIdentity(
  app: ProductIdentityApp,
  ensureDirectory: (path: string) => Promise<unknown> = (path) => mkdir(path, { recursive: true }),
): Promise<string> {
  app.setName(PRODUCT_NAME)
  const userDataPath = resolveUserDataPath(app.getPath('appData'))
  await ensureDirectory(userDataPath)
  app.setPath('userData', userDataPath)
  return userDataPath
}
