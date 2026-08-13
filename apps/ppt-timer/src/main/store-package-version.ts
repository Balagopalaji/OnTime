/**
 * Store package version policy for the opt-in AppX/MSIX-family feasibility
 * artifact. Microsoft reserves the fourth component for the Store, so it is
 * always zero and the independently reviewed first three components carry
 * monotonic package ordering.
 */
const STORE_VERSION_PATTERN = /^([1-9]\d{0,4})\.(\d{1,5})\.(\d{1,5})\.0$/
const APP_VERSION_FILENAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]*$/

export function validateStorePackageVersion(version: unknown): string {
  if (typeof version !== 'string' || !STORE_VERSION_PATTERN.test(version)) {
    throw new Error('Store package version must be a numeric Major.Minor.Build.0 with nonzero Major')
  }
  const components = version.split('.').map(Number)
  if (components.some((component) => component > 65535)) {
    throw new Error('Store package version components must be no greater than 65535')
  }
  return version
}

export function patchAppxManifestVersion(manifestText: string, version: unknown): string {
  const validatedVersion = validateStorePackageVersion(version)
  const identityPattern = /(<Identity\b[^>]*\bVersion=")[^"]+("[^>]*\/?>)/
  if (!identityPattern.test(manifestText)) {
    throw new Error('AppxManifest.xml is missing Identity Version')
  }
  return manifestText.replace(identityPattern, `$1${validatedVersion}$2`)
}

export function buildStoreArtifactName(appVersion: unknown, storeVersion: unknown): string {
  if (typeof appVersion !== 'string' || !APP_VERSION_FILENAME_PATTERN.test(appVersion)) {
    throw new Error('Application version must be safe for the Store artifact filename')
  }
  const validatedStoreVersion = validateStorePackageVersion(storeVersion)
  return `OnTime-PowerPoint-Video-Timer-${appVersion}-win-x64-store-v${validatedStoreVersion}.appx`
}
