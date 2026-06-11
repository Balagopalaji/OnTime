#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
const files = output.split('\n').filter(Boolean)
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

function checkRequiredDocs() {
  for (const file of ['docs/rebuild-architecture.md', 'docs/rebuild-extraction-rules.md']) {
    if (!existsSync(path.join(root, file))) {
      fail(`required rebuild guardrail doc is missing: ${file}`)
    }
  }
}

checkPromptExports()
checkPackageBoundaries()
checkProductBoundaries()
checkForbiddenBugPatterns()
checkFileSizeCeilings()
checkRequiredDocs()

if (failures.length > 0) {
  console.error('Rebuild guardrail checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Rebuild guardrail checks passed.')
