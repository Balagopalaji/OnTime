import assert from 'node:assert/strict'
import test from 'node:test'

test('stopPptProbeHelper returns the shared closing promise so a quit awaits a prior in-flight close', async () => {
  const { stopPptProbeHelper } = await import('./ppt-probe.js')
  // No helper was ever started on this runner (non-Windows / no probe exe), so
  // the module holds its initial sentinel pptNativeClosing. Two stops must
  // return the SAME promise; otherwise a quit following a mode-change stop would
  // await a fresh resolved promise and skip a still-running helper close
  // (the orphan race this fix closes).
  const first = stopPptProbeHelper('mode change')
  const second = stopPptProbeHelper('app quit')
  assert.equal(first, second, 'stop must return the shared in-flight close promise')
  await Promise.all([first, second])
})
