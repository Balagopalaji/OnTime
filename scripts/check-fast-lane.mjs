#!/usr/bin/env node
// Fast-lane eligibility gate (emitted-JS based).
//
// A PR is FAST-LANE only if it is provably type/comment/doc-only: for every
// changed TS/TSX source file, the EMITTED JavaScript (type-stripped, comments
// removed) is byte-identical before vs after. TypeScript type annotations,
// interfaces, type aliases, `import type`, and comments all erase from emitted
// JS; any runtime change (a new array element, an object field, a reordered
// value import, a changed literal) does not. So "emitted JS unchanged" is a
// sound definition of "inert" — far safer than regexing changed lines, which
// misses runtime edits inside existing arrays/objects (thanks Codex).
//
// This gate decides "no Claude review", so it is deliberately conservative:
//   - only `*.md` / `docs/` are auto-safe; any other non-source file → slow-lane
//   - if emitted JS differs OR can't be compared → slow-lane
//   - refuses to run on a dirty tree, so the committed diff is the whole story
//
// Usage (CI runs it only when a PR carries the `fast-lane` label; builders run
// it locally AFTER their final commit):
//   node scripts/check-fast-lane.mjs
//   FAST_LANE_BASE=origin/main node scripts/check-fast-lane.mjs
//
// Exit 0 => fast-lane eligible. Exit 1 => route to slow-lane. Exit 2 => cannot
// decide (dirty tree / tooling) — treat as slow-lane.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseRef = process.env.FAST_LANE_BASE ?? 'origin/main'

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const TS_EXT = /\.(ts|tsx)$/
const PLAIN_JS_EXT = /\.(js|jsx|mjs|cjs)$/
const AUTO_SAFE = /(^|\/)[^/]*\.md$|^docs\//

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

// Issue 1: refuse to run on a dirty tree, else uncommitted work makes the
// committed diff a lie and the gate reports a false green. Ignores untracked
// NON-source files (e.g. stray docs) but fails on any tracked change or
// untracked source file.
function assertCleanTree() {
  let dirty = false
  try {
    git(['diff', '--quiet'])
  } catch {
    dirty = true
  }
  try {
    git(['diff', '--cached', '--quiet'])
  } catch {
    dirty = true
  }
  const untrackedSource = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE_EXT.test(f))
  if (dirty || untrackedSource.length) {
    console.error('⛔ fast-lane check needs a clean tree — commit your work first, then re-run.')
    if (untrackedSource.length) console.error(`   untracked source files: ${untrackedSource.join(', ')}`)
    process.exit(2)
  }
}

function mergeBase() {
  return git(['merge-base', baseRef, 'HEAD']).trim()
}

// Emit type-stripped, comment-free JS for a single file's source text, then
// normalize away semantically-inert artifacts: blank lines and the bare
// `export {};` module marker TypeScript adds when a file becomes/stops being a
// module (e.g. when a type-only import is added/removed). Neither has any
// runtime effect, so dropping them avoids false slow-lane routing without
// hiding a real change.
function emit(source, file) {
  const isJsx = file.endsWith('.tsx') || file.endsWith('.jsx')
  const out = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: false,
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // The repo builds with verbatimModuleSyntax (frontend + all packages).
      // Without it, transpile elides unused value imports, so ADDING a runtime
      // import used only as a type would emit nothing and be misclassified as
      // inert (false negative). verbatim emits value imports verbatim → any
      // value-import add/remove/reorder shows up and forces slow-lane, while
      // explicit `import type` still erases. moduleDetection:force keeps module
      // treatment consistent across before/after.
      verbatimModuleSyntax: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
      jsx: isJsx ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
    },
  })
  return out.outputText
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l !== '' && l !== 'export {};')
    .join('\n')
}

// File content at a commit, or '' if the file did not exist there. stderr is
// suppressed so git's `fatal: path ... does not exist` for added/deleted files
// doesn't leak into the gate's output.
function contentAt(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return '' // absent at this ref (added/deleted)
  }
}

function emittedDiffers(file, base) {
  const before = contentAt(base, file)
  const after = contentAt('HEAD', file)
  if (before === after) return false // identical source (e.g. rename/mode only)
  try {
    return emit(before, file) !== emit(after, file)
  } catch {
    return true // can't transpile → cannot prove inert → slow-lane
  }
}

assertCleanTree()
const base = mergeBase()

const changed = git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean)
const violations = []

for (const file of changed) {
  if (AUTO_SAFE.test(file)) continue
  if (!SOURCE_EXT.test(file)) {
    violations.push({ file, reason: 'non-source, non-doc file (build/config/behavior risk)' })
    continue
  }
  if (PLAIN_JS_EXT.test(file) && !TS_EXT.test(file)) {
    // plain JS is already runtime — nothing erases; only identical source is inert
    if (contentAt(base, file) !== contentAt('HEAD', file)) {
      violations.push({ file, reason: 'JS source changed (no type layer to erase)' })
    }
    continue
  }
  if (emittedDiffers(file, base)) {
    violations.push({ file, reason: 'emitted JS changed → runtime-affecting' })
  }
}

if (violations.length === 0) {
  console.log(
    `✅ fast-lane eligible (base: ${baseRef}) — every changed source file emits identical JS (type/comment/doc-only).`,
  )
  process.exit(0)
}

console.error(`⛔ NOT fast-lane eligible (base: ${baseRef}). Route this PR to SLOW-LANE (full behavior review):`)
for (const v of violations) console.error(`  • ${v.file} — ${v.reason}`)
console.error('\nEither move to slow-lane, or split the type/comment-only files into their own fast-lane PR.')
process.exit(1)
