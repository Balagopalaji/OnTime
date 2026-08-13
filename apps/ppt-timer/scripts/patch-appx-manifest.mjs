import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export default async function patchAppxManifest(manifestPath) {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const appDir = join(scriptDir, '..')
  const { patchAppxManifestVersion } = await import(
    pathToFileURL(join(appDir, 'dist/main/store-package-version.js')).href
  )
  const storePackage = JSON.parse(await readFile(join(appDir, 'store-package.json'), 'utf8'))
  if (storePackage.status !== 'provisional-store-feasibility') {
    throw new Error('store-package.json must remain explicitly provisional until Store identity reservation')
  }
  const manifestText = await readFile(manifestPath, 'utf8')
  const patched = patchAppxManifestVersion(manifestText, storePackage.version)
  await writeFile(manifestPath, patched, 'utf8')
}
