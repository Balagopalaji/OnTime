#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
const files = output
  .split('\n')
  .filter(Boolean)
  .filter((file) => existsSync(path.join(root, file)))
const failures = []

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])

function fail(message) {
  failures.push(message)
}

function isTextFile(file) {
  return textExtensions.has(path.extname(file))
}

function isSourceFile(file) {
  return sourceExtensions.has(path.extname(file))
}

function isTestFile(file) {
  return /(\.test|\.spec)\.[cm]?[jt]sx?$/.test(file)
}

function read(file) {
  return readFileSync(path.join(root, file), 'utf8')
}

function stripSourceComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function trackedUnder(prefix) {
  return files.filter((file) => file.startsWith(prefix))
}

function packageName(file) {
  const parts = file.split('/')
  return parts.length >= 2 && parts[0] === 'packages' ? parts[1] : null
}

const adapterImportAllowlist = {
  'cloud-adapter-firestore': [/^firebase(\/|$)/, /^firebase-admin(\/|$)/, /^firebase-functions(\/|$)/],
  'companion-adapter': [/^socket\.io(\/|$)/, /^socket\.io-client(\/|$)/],
  'ppt-bridge': [/^child_process$/, /^node:child_process$/, /^fs$/, /^node:fs$/, /^path$/, /^node:path$/],
}

function importSpecifiers(content) {
  const specs = []
  const patterns = [
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specs.push(match[1])
    }
  }
  return specs
}

function importAllowedForPackage(pkg, specifier) {
  const allowed = adapterImportAllowlist[pkg] ?? []
  return allowed.some((pattern) => pattern.test(specifier))
}

function checkPromptExports() {
  for (const file of trackedUnder('prompt-exports/')) {
    fail(`prompt-exports must not be tracked: ${file}`)
  }
}

function checkPackageBoundaries() {
  for (const file of trackedUnder('packages/')) {
    if (!isSourceFile(file)) continue
    const pkg = packageName(file)
    const content = read(file)
    const imports = importSpecifiers(content)

    for (const specifier of imports) {
      if (
        specifier.includes('frontend/src/context') ||
        specifier.includes('companion/src/main') ||
        specifier.startsWith('../apps/') ||
        specifier.startsWith('../../apps/') ||
        specifier.includes('/apps/')
      ) {
        fail(`package code must not import legacy/app internals: ${file} -> ${specifier}`)
      }

      const bannedRuntimeImports = [
        /^react$/,
        /^react-dom$/,
        /^electron$/,
        /^firebase(\/|$)/,
        /^socket\.io(\/|$)/,
        /^socket\.io-client(\/|$)/,
      ]

      for (const pattern of bannedRuntimeImports) {
        if (pattern.test(specifier) && !importAllowedForPackage(pkg, specifier)) {
          fail(`banned runtime import in package ${pkg}: ${file} -> ${specifier}`)
        }
      }
    }
  }
}

function checkProductBoundaries() {
  const cloudFiles = [
    ...trackedUnder('apps/cloud-web/'),
    ...trackedUnder('apps/cloud-functions/'),
    ...trackedUnder('functions/'),
  ]
  for (const file of cloudFiles) {
    if (!isTextFile(file)) continue
    const content = read(file)
    if (/local-sync-arbitration|@ontime\/local-sync-arbitration/.test(content)) {
      fail(`Cloud code must not import or reference local-sync-arbitration: ${file}`)
    }
  }

  for (const file of files.filter((item) => /^apps\/viewer(-|\/)/.test(item))) {
    if (!isTextFile(file)) continue
    const content = read(file)
    if (/local-sync-arbitration|@ontime\/local-sync-arbitration/.test(content)) {
      fail(`Viewer code must not import or reference local-sync-arbitration: ${file}`)
    }
  }

  for (const file of trackedUnder('apps/ppt-timer/')) {
    if (!isSourceFile(file)) continue
    const content = read(file)
    for (const specifier of importSpecifiers(content)) {
      if (/firebase|cloud-adapter|local-sync|companion/i.test(specifier)) {
        fail(`PPT Timer must stay standalone: ${file} -> ${specifier}`)
      }
    }
  }
}

function checkPackageAliasImports() {
  const appSourceFiles = files.filter((file) => {
    if (!isSourceFile(file)) return false
    return (
      file.startsWith('frontend/src/') ||
      file.startsWith('companion/src/') ||
      file.startsWith('controller/src/') ||
      file.startsWith('functions/src/') ||
      file.startsWith('apps/')
    )
  })

  for (const file of appSourceFiles) {
    for (const specifier of importSpecifiers(read(file))) {
      if (/packages\/[^/]+\/src/.test(specifier)) {
        fail(`app/runtime source must import Stage 1a packages by @ontime/* alias: ${file} -> ${specifier}`)
      }
    }
  }
}

function checkForbiddenBugPatterns() {
  const scopedFiles = files.filter((file) => {
    if (!isTextFile(file)) return false
    if (isTestFile(file)) return false
    return (
      file.startsWith('frontend/src/') ||
      file.startsWith('packages/') ||
      file.startsWith('apps/') ||
      file.startsWith('companion/src/')
    )
  })

  for (const file of scopedFiles) {
    const content = read(file)
    if (/mergeProgress\(\s*roomProgress\s*,\s*cachedProgress\s*\)/.test(content)) {
      fail(`stale cache-wins progress merge order found: ${file}`)
    }
    if (/Math\.max\(\s*0\s*,[^)\n]*(elapsed|elapsedOffset|currentTime|startedAt|lastUpdate)/.test(content)) {
      fail(`timer elapsed clamping pattern found outside timer contract: ${file}`)
    }
    if (/\bapplyNudge\b/.test(content)) {
      fail(`dead applyNudge helper/reference must not return: ${file}`)
    }
  }
}

function checkTimerFormulaDuplication() {
  const allowlistedFiles = new Set([
    'frontend/src/utils/timer-utils.ts',
    'packages/timer-core/src/index.ts',
  ])
  const scopedFiles = files.filter((file) => {
    if (!isSourceFile(file)) return false
    if (isTestFile(file) || /\.d\.[cm]?ts$/.test(file)) return false
    if (allowlistedFiles.has(file)) return false
    return file.startsWith('frontend/src/') || file.startsWith('packages/') || file.startsWith('apps/')
  })

  const propAccess = '(?:[\\w$]+\\.)*'

  const patterns = [
    {
      pattern: new RegExp(
        `\\b(?:\\w+\\.)?duration\\s*\\*\\s*1000\\s*-\\s*${propAccess}(?:elapsed|elapsedMs|elapsedOffset|totalElapsed|currentTime)\\b`,
      ),
      message: 'inline remaining-time formula found; use computeRemaining from timer-core/timer-utils',
    },
    {
      pattern: new RegExp(
        `\\bdurationMs\\s*-\\s*${propAccess}(?:elapsed|elapsedMs|elapsedOffset|totalElapsed|currentTime)\\b`,
      ),
      message: 'inline remaining-time formula found; use computeRemaining from timer-core/timer-utils',
    },
    {
      pattern: new RegExp(
        `\\bdurationSec\\s*\\*\\s*1000\\s*-\\s*${propAccess}(?:elapsed|elapsedMs|elapsedOffset|totalElapsed|currentTime)\\b`,
      ),
      message: 'inline remaining-time formula found; use computeRemaining from timer-core/timer-utils',
    },
    {
      pattern: new RegExp(
        `\\b${propAccess}elapsedOffset\\s*\\+\\s*\\(?\\s*(?:Date\\.now\\(\\)|now|timestamp)\\s*-\\s*${propAccess}startedAt\\s*\\)?`,
      ),
      message: 'inline Firebase elapsed formula found; use computeElapsed from timer-core/timer-utils',
    },
    {
      pattern: new RegExp(
        `\\b${propAccess}currentTime\\s*\\+\\s*\\(?\\s*(?:Date\\.now\\(\\)|now|timestamp)\\s*-\\s*${propAccess}lastUpdate\\s*\\)?`,
      ),
      message:
        'inline Companion elapsed formula found; use computeCompanionElapsed from timer-core/timer-utils',
    },
  ]

  for (const file of scopedFiles) {
    const content = stripSourceComments(read(file))
    for (const { pattern, message } of patterns) {
      if (pattern.test(content)) {
        fail(`${message}: ${file}`)
      }
    }
  }
}

function checkFileSizeCeilings() {
  const maxProductionLines = 400
  for (const file of files) {
    if (!isSourceFile(file)) continue
    if (!file.startsWith('packages/') && !file.startsWith('apps/')) continue
    if (isTestFile(file) || /\.d\.[cm]?ts$/.test(file)) continue
    const lines = read(file).split('\n').length
    if (lines > maxProductionLines) {
      fail(`new package/app production file exceeds ${maxProductionLines} lines: ${file} (${lines})`)
    }
  }
}

// Anti-drift guardrail G2 (docs/rebuild-plan.md §5): package population must
// move upward as Stage 1b creates target packages. A populated package has a
// package manifest, a src/index.ts export surface, and at least one test.
const TARGET_PACKAGE_NAMES = [
  'shared-types',
  'interface-contracts',
  'timer-core',
  'cloud-adapter-firestore',
  'local-sync-arbitration',
  'viewer-renderer',
  'presentation-core',
  'ppt-bridge',
  'cue-controller-core',
  'lock-view-model',
]

const PACKAGE_POPULATION_BASELINE = 4
let packagePopulationStatus = ''

function hasPackageTest(pkg) {
  return files.some((file) => file.startsWith(`packages/${pkg}/`) && isTestFile(file))
}

function hasPackageExportSurface(pkg) {
  const indexFile = `packages/${pkg}/src/index.ts`
  if (!files.includes(indexFile)) return false
  const content = stripSourceComments(read(indexFile))
  return /\bexport\s+(?:\{|\*|type\s+|interface\s+|const\s+|function\s+|class\s+|enum\s+)/.test(content)
}

function populatedTargetPackages() {
  return TARGET_PACKAGE_NAMES.filter((pkg) => {
    if (!files.includes(`packages/${pkg}/package.json`)) return false
    return hasPackageExportSurface(pkg) && hasPackageTest(pkg)
  })
}

function checkPackagePopulationRatchet() {
  const populated = populatedTargetPackages()
  packagePopulationStatus =
    `Package population ratchet: ${populated.length}/${TARGET_PACKAGE_NAMES.length} populated ` +
    `(baseline ${PACKAGE_POPULATION_BASELINE})`
  if (populated.length < PACKAGE_POPULATION_BASELINE) {
    fail(
      `target package population fell below baseline: ${populated.length} < ` +
        `${PACKAGE_POPULATION_BASELINE} (${populated.join(', ') || 'none'})`,
    )
  }
}

// Stage-1b ratchet: these legacy god-files may only SHRINK. Carve-outs that reduce a file
// must lower its baseline here in the same PR. Never raise a baseline.
const GOD_FILE_LINE_BASELINES = {
  'frontend/src/context/UnifiedDataContext.tsx': 6707,
  'companion/src/main.ts': 7890,
}

function checkGodFileRatchet() {
  for (const [file, baseline] of Object.entries(GOD_FILE_LINE_BASELINES)) {
    if (!files.includes(file)) {
      fail(`god-file ratchet baseline references a missing file: ${file} (rename? update GOD_FILE_LINE_BASELINES)`)
      continue
    }
    const lines = read(file).split('\n').length
    if (lines > baseline) {
      fail(`god-file grew past its ratchet baseline: ${file} (${lines} > ${baseline}); carve out, do not grow`)
    }
  }
}

function checkRequiredDocs() {
  for (const file of ['docs/rebuild-architecture.md', 'docs/rebuild-extraction-rules.md']) {
    if (!existsSync(path.join(root, file))) {
      fail(`required rebuild guardrail doc is missing: ${file}`)
    }
  }
}

// Anti-drift guardrail G1 (docs/rebuild-plan.md §5): every NEW module under a
// rebuild-watched dir must declare its target destination so carves cannot drift
// destination-blind. Legacy modules that predate the policy are grandfathered; the
// set only shrinks as they are dismantled or marked.
const REBUILD_TARGET_WATCHED_DIRS = [
  'companion/src/',
  'frontend/src/context/',
  'frontend/src/lib/',
  'frontend/src/utils/',
]

const REBUILD_TARGET_GRANDFATHERED = new Set([
  'companion/src/main.ts',
  'frontend/src/context/AppModeContext.tsx',
  'frontend/src/context/AuthContext.tsx',
  'frontend/src/context/CompanionConnectionContext.tsx',
  'frontend/src/context/CompanionDataContext.tsx',
  'frontend/src/context/DataContext.tsx',
  'frontend/src/context/DataProvider.tsx',
  'frontend/src/context/FirebaseDataContext.tsx',
  'frontend/src/context/MockDataContext.tsx',
  'frontend/src/context/UnifiedDataContext.tsx',
  'frontend/src/context/firebase-data-utils.ts',
  'frontend/src/context/firebase-timer-state-utils.ts',
  'frontend/src/context/undoTypes.ts',
  'frontend/src/lib/arbitration.ts',
  'frontend/src/lib/companion-pairing.ts',
  'frontend/src/lib/electron.ts',
  'frontend/src/lib/firebase.ts',
  'frontend/src/lib/firestore-utils.ts',
  'frontend/src/lib/time.ts',
  'frontend/src/lib/timezones.ts',
  'frontend/src/lib/undoKeys.ts',
  'frontend/src/lib/undoStack.ts',
  'frontend/src/lib/utils.ts',
  'frontend/src/lib/viewer-links.ts',
  'frontend/src/utils/cue-utils.ts',
  'frontend/src/utils/timer-utils.ts',
])

const REBUILD_TARGET_MARKER = /\/\/\s*rebuild-target:\s*\S/

function checkRebuildTargetMarkers() {
  for (const file of files) {
    if (!isSourceFile(file) || isTestFile(file) || file.endsWith('.d.ts')) continue
    if (!REBUILD_TARGET_WATCHED_DIRS.some((dir) => file.startsWith(dir))) continue
    if (REBUILD_TARGET_GRANDFATHERED.has(file)) continue
    if (!REBUILD_TARGET_MARKER.test(read(file))) {
      fail(
        `${file}: new module under a rebuild-watched dir must declare its destination — add a ` +
          `'// rebuild-target: packages/<§3-name>' or '// rebuild-target: app-internal (<§4-app>)' ` +
          `header (see docs/rebuild-plan.md §5 G1). If this file legitimately predates the policy, ` +
          `add it to REBUILD_TARGET_GRANDFATHERED.`,
      )
    }
  }
}

checkPromptExports()
checkPackageBoundaries()
checkProductBoundaries()
checkPackageAliasImports()
checkForbiddenBugPatterns()
checkTimerFormulaDuplication()
checkFileSizeCeilings()
checkPackagePopulationRatchet()
checkGodFileRatchet()
checkRebuildTargetMarkers()
checkRequiredDocs()

if (failures.length > 0) {
  console.error('Rebuild guardrail checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(packagePopulationStatus)
console.log('Rebuild guardrail checks passed.')
