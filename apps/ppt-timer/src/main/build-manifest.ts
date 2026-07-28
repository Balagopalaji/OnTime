/**
 * Deterministic build manifest + checksum helpers (ISSUE-001, Stage 6).
 *
 * Pure, side-effect-free functions only. The CLI wrapper
 * (`apps/ppt-timer/scripts/build-manifest.mjs`) performs all filesystem I/O and
 * calls these. There is deliberately NO wall-clock, random, or env-derived value
 * here: identical inputs produce an identical manifest, so the same installer
 * always yields the same manifest (deterministic). Version is read from the app
 * package.json (single source of truth) and the helper target from the canonical
 * csproj — never hardcoded.
 */
import { createHash } from 'node:crypto'

export type InstallerManifest = {
  product: string
  version: string
  helperVersion: string
  artifact: string
  artifactSha256: string
  architecture: 'win-x64'
  installer: 'nsis-assisted-per-user'
  electronVersion: string
  helperTarget: string
  helperArtifact: 'ppt-probe.exe'
  helperPath: 'resources/bin/ppt-probe.exe'
  signingState: 'unsigned'
}

/** Parse the `version` field out of an app package.json document. */
export function extractAppVersion(packageJsonText: string): string {
  const pkg = JSON.parse(packageJsonText) as { version?: unknown }
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('package.json is missing a string version field')
  }
  return pkg.version
}

/** Parse the electron devDependency version from an app package.json document. */
export function extractElectronVersion(packageJsonText: string): string {
  const pkg = JSON.parse(packageJsonText) as { devDependencies?: { electron?: unknown } }
  const electron = pkg.devDependencies?.electron
  if (typeof electron !== 'string' || electron.length === 0) {
    throw new Error('package.json is missing a string devDependencies.electron field')
  }
  return electron
}

/**
 * Parse the `<TargetFramework>` out of the canonical helper csproj text. Used to
 * record which .NET target the packaged helper was built against (e.g.
 * net10.0-windows after the Stage 6 retarget).
 */
export function extractHelperTarget(csprojText: string): string {
  const match = csprojText.match(/<TargetFramework>\s*([^<\s]+)\s*<\/TargetFramework>/)
  if (!match) throw new Error('csproj is missing a <TargetFramework> element')
  return match[1]
}

/**
 * Accept only the helper version independently read from the packaged PE by
 * the Windows workflow. This prevents a manifest from merely restating the app
 * package version without proving helper identity.
 */
export function verifyHelperVersion(expectedVersion: string, verifiedVersion: string | undefined): string {
  if (!verifiedVersion) throw new Error('verified helper version is required')
  if (verifiedVersion !== expectedVersion) {
    throw new Error(`helper version ${verifiedVersion} does not match app version ${expectedVersion}`)
  }
  return verifiedVersion
}

/** Lowercase hex SHA-256 of a byte buffer. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The deterministic `.sha256` checksum file body for one artifact, in the
 * `<hash> *<filename>` form `sha256sum -c` consumes. Stable for identical input.
 */
export function formatSha256File(filename: string, hash: string): string {
  return `${hash} *${filename}\n`
}

/** Assemble the deterministic installer manifest object from already-read inputs. */
export function generateInstallerManifest(input: {
  version: string
  helperVersion: string
  electronVersion: string
  helperTarget: string
  artifact: string
  artifactSha256: string
}): InstallerManifest {
  return {
    product: 'OnTime PowerPoint Video Timer',
    version: input.version,
    helperVersion: input.helperVersion,
    artifact: input.artifact,
    artifactSha256: input.artifactSha256,
    architecture: 'win-x64',
    installer: 'nsis-assisted-per-user',
    electronVersion: input.electronVersion,
    helperTarget: input.helperTarget,
    helperArtifact: 'ppt-probe.exe',
    helperPath: 'resources/bin/ppt-probe.exe',
    signingState: 'unsigned',
  }
}

/**
 * Serialize a manifest to JSON with keys in alphabetical order, so the output
 * bytes are stable regardless of the property-declaration order used by
 * `generateInstallerManifest` above. A plain `JSON.stringify(manifest, null, 2)`
 * would already be stable run-to-run (object literals preserve insertion order),
 * but it is NOT stable against a future edit that reorders those literal
 * properties — the explicit alphabetical sort is what actually guarantees
 * determinism as a property of the format, not an accident of call-site order.
 * Ends with a single trailing newline (POSIX text-file convention).
 */
export function formatManifestJson(manifest: InstallerManifest): string {
  const alphabeticalKeys = Object.keys(manifest).sort()
  return `${JSON.stringify(manifest, alphabeticalKeys, 2)}\n`
}
