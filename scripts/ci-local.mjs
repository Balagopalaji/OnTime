#!/usr/bin/env node
// CI-equivalent local gate for the rebuild fast-lane system.
//
// Runs the SAME checks as the `Guardrail checks` job in
// `.github/workflows/rebuild-guardrails.yml`, in the same order, fail-fast,
// so that "ci-local green" reliably predicts "GitHub guardrails green".
//
// This is CI-EQUIVALENT, not byte-identical: it mirrors the workflow but does
// not execute it. When a step is added/removed/changed in
// `.github/workflows/rebuild-guardrails.yml`, update the STEPS array below in
// the same PR. As a safety net this script does a best-effort drift check on
// startup and prints a WARNING (non-fatal) if the workflow's `run:` commands
// no longer match STEPS — keep them in sync by hand.
//
// Usage:
//   npm run ci-local              # gate against `main` (default base)
//   CI_LOCAL_BASE=origin/main npm run ci-local
//
// Exit 0 iff every step passes. Builders paste the final summary into the PR
// before flipping the review baton.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Mirror CI, which gates against the PR base (`origin/<base_ref>`). Override
// with CI_LOCAL_BASE for a local base.
const base = process.env.CI_LOCAL_BASE ?? 'origin/main'

// Each step mirrors one `run:` in the guardrails workflow. `cwd` is relative to
// repo root (matches the workflow's `working-directory`). Keep in sync with
// .github/workflows/rebuild-guardrails.yml.
const STEPS = [
  { name: 'Rebuild boundary and pattern checks', cmd: 'npm run guardrails' },
  { name: 'Companion typecheck', cmd: 'npx tsc -p tsconfig.json --noEmit', cwd: 'companion' },
  { name: 'Companion tests', cmd: 'npm test', cwd: 'companion' },
  { name: 'Frontend lint', cmd: 'npm run lint --workspace frontend' },
  { name: 'Frontend typecheck', cmd: 'npm run typecheck --workspace frontend' },
  { name: 'Timer-core typecheck', cmd: 'npm run typecheck --workspace @ontime/timer-core' },
  {
    name: 'Timer-core tests',
    cmd: 'npx vitest --run --root . packages/timer-core/src/index.test.ts frontend/src/utils/timer-utils.test.ts',
  },
  { name: 'Shared-types typecheck', cmd: 'npm run typecheck --workspace @ontime/shared-types' },
  { name: 'Local-sync arbitration typecheck', cmd: 'npm run typecheck --workspace @ontime/local-sync-arbitration' },
  {
    name: 'Local-sync arbitration tests',
    cmd: 'npx vitest --run --root . packages/local-sync-arbitration/src/index.test.ts frontend/src/lib/arbitration.test.ts frontend/src/lib/arbitration.mode-bias.test.ts',
  },
  { name: 'Interface-contracts typecheck', cmd: 'npm run typecheck --workspace @ontime/interface-contracts' },
  { name: 'Interface-contracts tests', cmd: 'npm run test --workspace @ontime/interface-contracts' },
  { name: 'Lock-view-model typecheck', cmd: 'npm run typecheck --workspace @ontime/lock-view-model' },
  { name: 'Lock-view-model tests', cmd: 'npm run test --workspace @ontime/lock-view-model' },
  { name: 'Presentation-core typecheck', cmd: 'npm run typecheck --workspace @ontime/presentation-core' },
  { name: 'Presentation-core tests', cmd: 'npm run test --workspace @ontime/presentation-core' },
  { name: 'Frontend test suite (characterization safety net)', cmd: 'npx vitest run', cwd: 'frontend' },
  { name: 'Diff whitespace check', cmd: `git diff --check ${base}...HEAD` },
  { name: 'Commit whitespace check', cmd: 'git show --check HEAD' },
]

// Best-effort drift check: compare the workflow's single-line `run:` commands
// against STEPS. Non-fatal — just a nudge to resync when the workflow changes.
function warnOnWorkflowDrift() {
  try {
    const wf = readFileSync(path.join(root, '.github/workflows/rebuild-guardrails.yml'), 'utf8')
    const ignore = new Set(['npm ci'])
    // The whitespace-diff step legitimately differs between CI (templated
    // `origin/${{ github.base_ref }}...HEAD`) and local (`${base}...HEAD`), so
    // exclude it from drift on BOTH sides — comparing it would always warn.
    const isIgnored = (c) => ignore.has(c) || c.includes('${{') || c.startsWith('git diff --check')
    const wfCmds = new Set(
      wf
        .split('\n')
        .map((l) => l.match(/^\s*run:\s*(.+?)\s*$/))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((c) => !isIgnored(c)),
    )
    const stepCmds = new Set(STEPS.map((s) => s.cmd).filter((c) => !isIgnored(c)))
    const missingLocally = [...wfCmds].filter((c) => !stepCmds.has(c))
    const staleLocally = [...stepCmds].filter((c) => !wfCmds.has(c))
    if (missingLocally.length || staleLocally.length) {
      process.stdout.write('\n⚠️  ci-local may have drifted from rebuild-guardrails.yml:\n')
      for (const c of missingLocally) process.stdout.write(`   + in workflow, not in ci-local: ${c}\n`)
      for (const c of staleLocally) process.stdout.write(`   - in ci-local, not in workflow: ${c}\n`)
      process.stdout.write('   → resync the STEPS array. (non-fatal)\n')
    }
  } catch {
    // workflow unreadable — skip drift check silently
  }
}

warnOnWorkflowDrift()

// Non-fatal nudge: tests run against the WORKING TREE, so iterating dirty is
// fine — but the summary pasted for review must come from the final committed
// state (that's what CI runs against). Warn if the tree is dirty.
function warnIfDirty() {
  try {
    execFileSync('git', ['diff', '--quiet'], { cwd: root })
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: root })
  } catch {
    process.stdout.write(
      '\n⚠️  Working tree is dirty. Iterate freely, but only a run on your final\n' +
        '   committed state is valid to paste for review (CI runs against the commit).\n',
    )
  }
}

warnIfDirty()

const results = []
let failed = false

for (const step of STEPS) {
  const cwd = step.cwd ? path.join(root, step.cwd) : root
  process.stdout.write(`\n▶ ${step.name}\n  $ ${step.cmd}${step.cwd ? `  (cwd: ${step.cwd})` : ''}\n`)
  const res = spawnSync(step.cmd, { cwd, shell: true, stdio: 'inherit' })
  const ok = res.status === 0
  results.push({ name: step.name, ok })
  if (!ok) {
    failed = true
    break // fail-fast, like CI
  }
}

process.stdout.write('\n─── ci-local summary ───\n')
for (const step of STEPS) {
  const r = results.find((x) => x.name === step.name)
  const mark = !r ? '– skipped' : r.ok ? '✅ pass' : '❌ FAIL'
  process.stdout.write(`  ${mark}  ${step.name}\n`)
}
process.stdout.write(
  failed
    ? '\n❌ ci-local FAILED — fix the failing step before requesting review.\n'
    : `\n✅ ci-local PASSED (base: ${base}) — paste this summary into the PR.\n`,
)

process.exit(failed ? 1 : 0)
