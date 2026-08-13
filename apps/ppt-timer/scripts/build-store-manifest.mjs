#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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

const inspectedManifestPath = process.env.ONTIME_PPT_TIMER_INSPECTED_APPX_MANIFEST
const helperProductVersion = process.env.ONTIME_PPT_TIMER_VERIFIED_HELPER_VERSION
const helperFileVersion = process.env.ONTIME_PPT_TIMER_VERIFIED_HELPER_FILE_VERSION
const pkgText = readFileSync(join(appDir, 'package.json'), 'utf8')
const storeConfig = JSON.parse(readFileSync(join(appDir, 'store-package.json'), 'utf8'))

function fail(message) {
  console.error(`[store-build-manifest] ${message}`)
  process.exit(1)
}

if (!existsSync(distOut)) fail(`dist_out not found: ${distOut}`)
if (!inspectedManifestPath || !existsSync(inspectedManifestPath)) {
  fail('ONTIME_PPT_TIMER_INSPECTED_APPX_MANIFEST must name the unpacked, inspected AppxManifest.xml')
}

const artifacts = readdirSync(distOut)
  .filter((name) => name.endsWith(`-win-x64-store-v${storeConfig.version}.appx`))
  .sort()
if (artifacts.length !== 1) {
  fail(`expected exactly one Store v${storeConfig.version} feasibility AppX, found ${artifacts.length}`)
}

const {
  extractAppVersion,
  extractHelperTarget,
  extractStorePackageIdentity,
  formatManifestJson,
  formatSha256File,
  generateStorePackageManifest,
  sha256Hex,
  verifyHelperVersion,
} = await import(pathToFileURL(buildManifestModule).href)

const csprojText = readFileSync(
  join(repoRoot, 'packages/ppt-bridge/native/windows-ppt-probe/ppt-probe.csproj'),
  'utf8',
)
const artifactPath = join(distOut, artifacts[0])
const artifactBytes = readFileSync(artifactPath)
const identity = extractStorePackageIdentity(readFileSync(inspectedManifestPath, 'utf8'))
const appVersion = extractAppVersion(pkgText)

if (identity.version !== storeConfig.version) {
  fail(`inspected package version ${identity.version} does not match store-package.json ${storeConfig.version}`)
}
if (!helperFileVersion) fail('ONTIME_PPT_TIMER_VERIFIED_HELPER_FILE_VERSION is required')

const manifest = generateStorePackageManifest({
  appVersion,
  storePackageVersion: identity.version,
  artifact: basename(artifactPath),
  artifactSha256: sha256Hex(artifactBytes),
  helperProductVersion: verifyHelperVersion(appVersion, helperProductVersion),
  helperFileVersion,
  helperTarget: extractHelperTarget(csprojText),
  identity,
})

writeFileSync(
  `${artifactPath}.sha256`,
  formatSha256File(manifest.artifact, manifest.artifactSha256),
  'utf8',
)
writeFileSync(
  join(distOut, 'build.store-feasibility.manifest.json'),
  formatManifestJson(manifest),
  'utf8',
)

console.log(`[store-build-manifest] wrote ${basename(artifactPath)}.sha256 + build.store-feasibility.manifest.json`)
console.log(`[store-build-manifest] sha256=${manifest.artifactSha256}`)
