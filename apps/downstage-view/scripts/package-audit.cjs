// Packaged-content audit for Downstage View (ISSUE-002 S8b/S8c).
//
// Pure functions (unit-tested in src/packaging/package-content.test.ts) plus a CLI
// that runs them against real electron-builder output:
//
//   node scripts/package-audit.cjs dist_out
//
// The packaged app must be only the viewer shell: compiled main/preload/renderer/
// shared plus package.json inside app.asar, with no helper, COM/native module,
// workspace package, source, or extra executable beside it.
'use strict'
const { existsSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')

const APP_NAME = 'Downstage View'

const REQUIRED_ASAR_ENTRIES = ['package.json', 'dist/main/main.js', 'dist/preload/preload.js', 'dist/renderer/index.html']

const ALLOWED_ASAR_FILES = [
  /^package\.json$/,
  /^dist\/main\/[^/]+\.js$/,
  /^dist\/shared\/[^/]+\.js$/,
  /^dist\/preload\/preload\.js$/,
  /^dist\/renderer\/index\.html$/,
  /^dist\/renderer\/assets\/[^/]+\.(?:js|css)$/,
]

// Checked first so a forbidden thing gets a specific reason even when its path
// would otherwise fit the allowlist (e.g. dist/main/ppt-probe.js).
const FORBIDDEN_PATHS = [
  [/(?:^|\/)node_modules(?:\/|$)/, 'node_modules must not be packaged (the shell has no runtime dependencies)'],
  [/@ontime\//, 'workspace package must not be packaged'],
  [/ppt-?probe/i, 'ppt-probe helper must not be packaged'],
  [/power-?point|powershell/i, 'PowerPoint/PowerShell integration must not be packaged'],
  [/(?:^|[/._-])com(?:[/._-]|$)|\.(?:ps1|cs|csproj|vbs)$/i, 'COM/helper glue must not be packaged'],
  [/(?:^|[/._-])(?:helper|probe|bridge|native)(?:[/._-]|$)/i, 'helper/native payload must not be packaged'],
  [/\.(?:exe|dll|node|so|dylib|cc|cpp|h|gyp)$/i, 'binary/native file must not be packaged'],
  [/\.map$/, 'source map must not be packaged'],
  [/\.test\./, 'test file must not be packaged'],
  [/(?:^|\/)src(?:\/|$)|\.tsx?$/, 'source file must not be packaged'],
]

function normalize(entry) {
  return entry.split('\\').join('/').replace(/^(?:\.\/|\/)+/, '').replace(/\/+$/, '')
}

function findForbidden(file) {
  for (const [pattern, reason] of FORBIDDEN_PATHS) if (pattern.test(file)) return reason
  return null
}

/** Violations for an app.asar listing. An empty array means the shell is clean. */
function auditAsarEntries(entries) {
  const all = entries.map(normalize).filter((entry) => entry !== '')
  const directories = new Set()
  for (const entry of all) {
    const parts = entry.split('/')
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'))
  }
  const violations = []
  for (const entry of all) {
    const forbidden = findForbidden(entry)
    if (forbidden) violations.push(`${forbidden}: ${entry}`)
    else if (!directories.has(entry) && !ALLOWED_ASAR_FILES.some((pattern) => pattern.test(entry))) {
      violations.push(`unexpected packaged file: ${entry}`)
    }
  }
  const present = new Set(all)
  for (const required of REQUIRED_ASAR_ENTRIES) {
    if (!present.has(required)) violations.push(`missing required entry: ${required}`)
  }
  return violations
}

/**
 * Violations for an unpacked app tree. `files` are file paths relative to
 * win-unpacked/ (win32) or to the directory containing `Downstage View.app` (darwin).
 */
function auditUnpackedApp(files, { platform }) {
  const all = files.map(normalize).filter((file) => file !== '')
  const violations = []
  for (const file of all) {
    if (/ppt-?probe/i.test(file)) violations.push(`ppt-probe helper must not be packaged: ${file}`)
    if (/\.node$/i.test(file)) violations.push(`native module must not be packaged: ${file}`)
    if (/app\.asar\.unpacked/.test(file)) violations.push(`nothing may be unpacked from app.asar: ${file}`)
  }
  if (platform === 'win32') {
    const appExe = `${APP_NAME}.exe`
    for (const file of all) {
      if (/\.exe$/i.test(file) && file !== appExe) violations.push(`unexpected executable (only ${appExe} is allowed): ${file}`)
      if (file.startsWith('resources/') && file !== 'resources/app.asar' && !/app\.asar\.unpacked|ppt-?probe|\.node$/i.test(file)) {
        violations.push(`unexpected file in resources (only app.asar is allowed): ${file}`)
      }
    }
    for (const required of [appExe, 'resources/app.asar']) {
      if (!all.includes(required)) violations.push(`missing required file: ${required}`)
    }
  } else {
    const root = `${APP_NAME}.app/Contents/`
    const resources = `${root}Resources/`
    for (const file of all) {
      if (file.startsWith(resources)) {
        const rest = file.slice(resources.length)
        if (rest !== 'app.asar' && !/\.icns$/.test(rest) && !/^[^/]+\.lproj\//.test(rest) && !/app\.asar\.unpacked|ppt-?probe|\.node$/i.test(rest)) {
          violations.push(`unexpected file in Resources (only app.asar, icons, lproj): ${file}`)
        }
      }
      if (file.startsWith(`${root}MacOS/`) && file !== `${root}MacOS/${APP_NAME}`) {
        violations.push(`unexpected executable in Contents/MacOS: ${file}`)
      }
    }
    for (const required of [`${root}MacOS/${APP_NAME}`, `${resources}app.asar`]) {
      if (!all.includes(required)) violations.push(`missing required file: ${required}`)
    }
  }
  return violations
}

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const rel = `${prefix}${dirent.name}`
    if (dirent.isDirectory()) return walk(path.join(dir, dirent.name), `${rel}/`)
    return [rel]
  })
}

function auditOutput(outDir) {
  const asar = require('@electron/asar')
  const targets = []
  const win = path.join(outDir, 'win-unpacked')
  if (existsSync(win)) targets.push({ platform: 'win32', root: win, asarPath: path.join(win, 'resources/app.asar') })
  for (const name of existsSync(outDir) ? readdirSync(outDir) : []) {
    const appDir = path.join(outDir, name, `${APP_NAME}.app`)
    if (name.startsWith('mac') && existsSync(appDir)) {
      targets.push({ platform: 'darwin', root: path.join(outDir, name), asarPath: path.join(appDir, 'Contents/Resources/app.asar') })
    }
  }
  if (targets.length === 0) return [`no win-unpacked or mac*/${APP_NAME}.app found under ${outDir} (run npm run dist:* first)`]
  const violations = []
  for (const { platform, root, asarPath } of targets) {
    const label = path.relative(outDir, root) || '.'
    if (statSync(root).isDirectory()) {
      for (const v of auditUnpackedApp(walk(root), { platform })) violations.push(`${label}: ${v}`)
    }
    if (existsSync(asarPath)) {
      for (const v of auditAsarEntries(asar.listPackage(asarPath))) violations.push(`${label} app.asar: ${v}`)
    }
  }
  return violations
}

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] ?? 'dist_out')
  const violations = auditOutput(outDir)
  if (violations.length > 0) {
    console.error(`Downstage View package audit FAILED (${violations.length}):`)
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log(`Downstage View package audit passed: ${outDir}`)
}

module.exports = { APP_NAME, auditAsarEntries, auditUnpackedApp }
