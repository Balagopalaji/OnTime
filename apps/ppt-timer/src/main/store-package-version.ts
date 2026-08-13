/**
 * Store package version policy for the opt-in AppX/MSIX-family feasibility
 * artifact. Microsoft reserves the fourth component for the Store, so it is
 * always zero and the independently reviewed first three components carry
 * monotonic package ordering.
 */
const STORE_VERSION_PATTERN = /^([1-9]\d{0,4})\.(\d{1,5})\.(\d{1,5})\.0$/

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
