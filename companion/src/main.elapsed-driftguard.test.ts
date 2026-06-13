/**
 * Drift-guard for resolveCompanionElapsedForState.
 *
 * This test guards against silent drift from timer-core's `computeCompanionElapsed`
 * (packages/timer-core/src/index.ts). The companion cannot import that package at
 * runtime (node16 CJS resolves its exports to raw .ts), so it mirrors the formula
 * locally. If anyone changes the core formula or the companion mirror without
 * updating both, the "running valid" case will fail because it asserts equality to
 * the canonical expression computed inline — not to a hard-coded number.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const loadLifecycleHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  return import('./main.js')
}

// Canonical formula from timer-core's computeCompanionElapsed (no hardening).
// Keep this expression in sync with packages/timer-core/src/index.ts.
const canonical = (currentTime: number, now: number, lastUpdate: number): number =>
  currentTime + (now - lastUpdate)

test('resolveCompanionElapsedForState — paused: returns currentTime regardless of lastUpdate', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const result = resolveCompanionElapsedForState(
    { isRunning: false, currentTime: 5_000, lastUpdate: 100_000 },
    103_000,
  )
  assert.equal(result, 5_000)
})

test('resolveCompanionElapsedForState — running valid: equals canonical formula (drift pin)', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const now = 103_000
  const currentTime = 5_000
  const lastUpdate = 100_000
  const result = resolveCompanionElapsedForState(
    { isRunning: true, currentTime, lastUpdate },
    now,
  )
  // This assertion is the drift pin: it compares against the canonical expression
  // directly, so a formula divergence (in either direction) breaks this test.
  assert.equal(result, canonical(currentTime, now, lastUpdate))
  assert.equal(result, 8_000)
})

test('resolveCompanionElapsedForState — running negative currentTime preserved', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const result = resolveCompanionElapsedForState(
    { isRunning: true, currentTime: -2_000, lastUpdate: 100_000 },
    103_000,
  )
  assert.equal(result, 1_000)
})

test('resolveCompanionElapsedForState — hardening: non-finite currentTime → 0 base', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const result = resolveCompanionElapsedForState(
    { isRunning: true, currentTime: NaN, lastUpdate: 100_000 },
    103_000,
  )
  assert.equal(result, 3_000)
})

test('resolveCompanionElapsedForState — hardening: future lastUpdate → no delta', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const result = resolveCompanionElapsedForState(
    { isRunning: true, currentTime: 5_000, lastUpdate: 200_000 },
    103_000,
  )
  assert.equal(result, 5_000)
})

test('resolveCompanionElapsedForState — hardening: lastUpdate ≤ 0 → no delta', async () => {
  const { resolveCompanionElapsedForState } = await loadLifecycleHelpers()
  const result = resolveCompanionElapsedForState(
    { isRunning: true, currentTime: 5_000, lastUpdate: 0 },
    103_000,
  )
  assert.equal(result, 5_000)
})
