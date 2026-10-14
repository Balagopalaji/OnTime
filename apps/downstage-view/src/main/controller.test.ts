import { describe, expect, it, vi } from 'vitest'
import { createViewerController } from './controller.js'

const ORIGIN = 'https://ontime.app'
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v'
const LINK = `${ORIGIN}/session/abc/view#token=${TOKEN}`

function setup(config: { webOrigin: string } | null = { webOrigin: ORIGIN }, loadViewer = vi.fn(async (_url: string) => undefined)) {
  const loadLauncher = vi.fn(async () => undefined)
  const controller = createViewerController({ config, loadViewer, loadLauncher })
  return { controller, loadViewer, loadLauncher }
}

describe('viewer controller', () => {
  it('loads a valid link into the viewer and reports the screen', async () => {
    const { controller, loadViewer } = setup()
    expect(controller.screen()).toBe('launcher')
    await expect(controller.open(LINK)).resolves.toEqual({ ok: true })
    expect(loadViewer).toHaveBeenCalledExactlyOnceWith(LINK)
    expect(controller.screen()).toBe('viewer')
  })

  it('rejects an invalid link without loading anything', async () => {
    const { controller, loadViewer } = setup()
    await expect(controller.open('https://evil.example/session/abc/view#token=' + TOKEN)).resolves.toEqual({ ok: false, code: 'wrong-origin' })
    expect(loadViewer).not.toHaveBeenCalled()
    expect(controller.screen()).toBe('launcher')
  })

  it('reports not-configured when no web origin is configured', async () => {
    const { controller, loadViewer } = setup(null)
    await expect(controller.open(LINK)).resolves.toEqual({ ok: false, code: 'not-configured' })
    expect(loadViewer).not.toHaveBeenCalled()
  })

  it('reports load-failed (without the link) and stays on the launcher when loading throws', async () => {
    const { controller } = setup({ webOrigin: ORIGIN }, vi.fn(async () => Promise.reject(new Error(`ERR_FAILED ${LINK}`))))
    const result = await controller.open(LINK)
    expect(result).toEqual({ ok: false, code: 'load-failed' })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(controller.screen()).toBe('launcher')
  })

  it('returns to the launcher on request', async () => {
    const { controller, loadLauncher } = setup()
    await controller.open(LINK)
    await controller.showLauncher()
    expect(loadLauncher).toHaveBeenCalledOnce()
    expect(controller.screen()).toBe('launcher')
  })

  it('exposes only the non-secret launcher info', () => {
    expect(setup().controller.launcherInfo()).toEqual({ webOrigin: ORIGIN })
    expect(setup(null).controller.launcherInfo()).toEqual({ webOrigin: null })
  })

  it('serialises concurrent opens so the last accepted link wins', async () => {
    const order: string[] = []
    const { controller } = setup(
      { webOrigin: ORIGIN },
      vi.fn(async (url: string) => {
        await new Promise((resolve) => setTimeout(resolve, url.includes('/first/') ? 20 : 0))
        order.push(url)
      }),
    )
    const first = controller.open(`${ORIGIN}/session/first/view#token=${TOKEN}`)
    const second = controller.open(`${ORIGIN}/session/second/view#token=${TOKEN}`)
    await Promise.all([first, second])
    expect(order).toEqual([`${ORIGIN}/session/first/view#token=${TOKEN}`, `${ORIGIN}/session/second/view#token=${TOKEN}`])
  })
})
