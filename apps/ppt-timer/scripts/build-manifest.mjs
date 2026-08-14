#!/usr/bin/env node
/**
 * Deterministic installer manifest + .sha256 generator (ISSUE-001, Stage 6).
 *
 * Runs AFTER `npm run dist` has produced the installer under dist_out/ (so the
 * compiled helpers in dist/main/build-manifest.js exist). It:
 *   1. reads version + electron version from package.json (single version source),
 *   2. reads the helper <TargetFramework> from the canonical csproj,
 *   3. SHA-256s the setup .exe,
 *   4. writes <exe>.sha256 (sha256sum -c format) and build.manifest.json.
 *
 * Deterministic: same installer bytes + same source files => identical outputs.
 * Windows/packaging-only (macOS hosts do not produce an installer); the pure
 * functions it calls are unit-tested in src/main/build-manifest.test.ts.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const appDir = join(here, '..')
const repoRoot = join(appDir, '..', '..')
const distOut = process.env.ONTIME_PPT_TIMER_DIST_OUT
  ? resolve(process.env.ONTIME_PPT_TIMER_DIST_OUT)
  : join(appDir, 'dist_out')
const buildManifestModule = process.env.ONTIME_PPT_TIMER_BUILD_MANIFEST_MODULE
  ? resolve(process.env.ONTIME_PPT_TIMER_BUILD_MANIFEST_MODULE)
  : join(appDir, 'dist/main/build-manifest.js')

// Compiled by `npm run build` (runs before electron-builder in `npm run dist`).
// Convert the filesystem path to a file URL: raw Windows drive paths are not
// valid ESM module specifiers (P1-03). The env override is only an integration
// test seam for exercising this real entrypoint without a full Electron build.
const {
  extractAppVersion,
  extractElectronVersion,
  extractHelperTarget,
  sha256Hex,
  formatSha256File,
  generateInstallerManifest,
  verifyHelperVersion,
  formatManifestJson,
} = await import(pathToFileURL(buildManifestModule).href)

function fail(message) {
  console.error(`[build-manifest] ${message}`)
  process.exit(1)
}

if (!existsSync(distOut)) fail(`dist_out not found: ${distOut}. Run "npm run dist" first.`)

const pkgText = readFileSync(join(appDir, 'package.json'), 'utf8')
const appVersion = extractAppVersion(pkgText)
const installer = `Downstage-PPT-Video-Timer-${appVersion}-win-x64-setup.exe`
const installerPath = join(distOut, installer)
if (!existsSync(installerPath)) fail(`expected installer not found: ${installerPath}`)

const csprojText = readFileSync(
  join(repoRoot, 'packages/ppt-bridge/native/windows-ppt-probe/ppt-probe.csproj'),
  'utf8',
)
const installerBytes = readFileSync(installerPath)

const helperVersion = verifyHelperVersion(
  appVersion,
  process.env.ONTIME_PPT_TIMER_VERIFIED_HELPER_VERSION,
)

const manifest = generateInstallerManifest({
  version: appVersion,
  helperVersion,
  electronVersion: extractElectronVersion(pkgText),
  helperTarget: extractHelperTarget(csprojText),
  artifact: basename(installerPath),
  artifactSha256: sha256Hex(installerBytes),
})

const shaPath = `${installerPath}.sha256`
writeFileSync(shaPath, formatSha256File(manifest.artifact, manifest.artifactSha256), 'utf8')

// Stable key ordering (alphabetical) is a property of the format, not this
// call site — see the shared, unit-tested formatManifestJson helper.
writeFileSync(join(distOut, 'build.manifest.json'), formatManifestJson(manifest), 'utf8')

console.log(`[build-manifest] wrote ${basename(shaPath)} + build.manifest.json for ${manifest.artifact}`)
console.log(`[build-manifest] sha256=${manifest.artifactSha256}`)
