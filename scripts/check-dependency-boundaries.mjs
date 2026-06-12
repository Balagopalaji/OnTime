#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const depcruiseBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise',
)

const roots = [
  'frontend/src',
  'companion/src',
  'controller/src',
  'functions/src',
  'packages',
  'apps',
].filter((candidate) => existsSync(path.join(root, candidate)))

if (!existsSync(depcruiseBin)) {
  console.error('dependency-cruiser is not installed. Run npm ci from the repository root.')
  process.exit(1)
}

if (roots.length === 0) {
  console.error('No dependency roots found for boundary checks.')
  process.exit(1)
}

const result = spawnSync(
  depcruiseBin,
  ['--config', '.dependency-cruiser.cjs', '--output-type', 'err-long', ...roots],
  { cwd: root, stdio: 'inherit' },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
