#!/usr/bin/env node
/**
 * Runs the ISSUE-002 presentation emulator suites in two emulator sessions:
 * multi-case contract suites with an emulator-only rate-limit multiplier
 * (one loopback IP stands in for many users), then the limiter/cleanup suite
 * at production default limits.
 */
import { spawnSync } from 'node:child_process'

const firebase = process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
const exec = (script, env) =>
  spawnSync(firebase, ['emulators:exec', '--config', '../firebase.json', '--only', 'firestore,functions,auth', script], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  }).status

const scaled = exec(
  'node ./tests/presentation-auth-session.emu.js && node ./tests/presentation-links.emu.js && node ./tests/presentation-publish.emu.js',
  { PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER: '100' },
)
if (scaled !== 0) process.exit(scaled ?? 1)
const { PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER: _unused, ...unscaledEnv } = process.env
const unscaled = spawnSync(firebase, ['emulators:exec', '--config', '../firebase.json', '--only', 'firestore,functions,auth', 'node ./tests/presentation-limits.emu.js'], {
  stdio: 'inherit',
  env: unscaledEnv,
  shell: process.platform === 'win32',
}).status
process.exit(unscaled ?? 1)
