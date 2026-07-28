import assert from 'node:assert/strict'
import test from 'node:test'
import type { PptBridgeClient } from '@ontime/ppt-bridge'

test('P1-05 stop invalidates an ensure suspended on a prior close before it can create a replacement client', async () => {
  const { createPptNativeLifecycle } = await import('./ppt-probe.js')
  let releaseClose!: () => void
  const blockedClose = new Promise<void>((resolve) => { releaseClose = resolve })
  const clients: PptBridgeClient[] = []
  const lifecycle = createPptNativeLifecycle({
    resolveProbePath: () => 'ppt-probe.exe',
    createClient: () => {
      const index = clients.length
      const client: PptBridgeClient = {
        poll: async () => { throw new Error('not used') },
        close: () => index === 0 ? blockedClose : Promise.resolve(),
      }
      clients.push(client)
      return client
    },
  })

  const first = await lifecycle.ensure()
  assert.equal(first, clients[0])
  const closing = lifecycle.stop('mode change')
  const staleEnsure = lifecycle.ensure()
  const quitStop = lifecycle.stop('app quit')
  assert.equal(quitStop, closing, 'quit must await the same blocked close')

  releaseClose()
  await closing
  assert.equal(await staleEnsure, null, 'ensure captured before quit stop must be cancelled')
  assert.equal(clients.length, 1, 'no replacement client may be created after stop/quit')

  const fresh = await lifecycle.ensure()
  assert.equal(fresh, clients[1], 'a later fresh lifecycle may re-enable native polling')
  assert.equal(clients.length, 2)
  await lifecycle.stop('test cleanup')
})

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
