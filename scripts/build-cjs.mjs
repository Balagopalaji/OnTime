#!/usr/bin/env node
/**
 * Cross-platform CommonJS build for the workspace runtime packages.
 *
 * npm runs workspace scripts with the package directory as cwd. This helper
 * owns cleanup, TypeScript invocation, and the CommonJS package marker without
 * relying on POSIX shell commands, so the same script runs on Windows and Unix.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageRoot = process.cwd()
const outputDir = path.join(packageRoot, 'dist-cjs')
const tsconfigPath = path.join(packageRoot, 'tsconfig.cjs.json')
const tscPath = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

rmSync(outputDir, { recursive: true, force: true })

const result = spawnSync(process.execPath, [tscPath, '-p', tsconfigPath], {
  cwd: packageRoot,
  stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync(outputDir, { recursive: true })
writeFileSync(path.join(outputDir, 'package.json'), '{"type":"commonjs"}\n', 'utf8')
