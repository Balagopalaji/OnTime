import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-contract.js'
import { registerViewerIpc } from './ipc.js'

const LAUNCHER = 'file:///app/dist/renderer/index.html'

function setup() {
  const handlers = new Map<string, (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => unknown>()
  const ipcMain = { handle: vi.fn((channel: string, handler: never) => void handlers.set(channel, handler)) }
  const controller = {
    open: vi.fn(async (_text: string) => ({ ok: true }) as const),
    launcherInfo: vi.fn(() => ({ webOrigin: 'https://ontime.app' })),
  }
  registerViewerIpc(ipcMain, controller, LAUNCHER)
  return { handlers, controller, ipcMain }
}
const fromLauncher = { senderFrame: { url: LAUNCHER } }

describe('registerViewerIpc', () => {
  it('registers exactly the two read-only-viewer channels (no control, file, or shell channel)', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual([IPC_CHANNELS.getLauncherInfo, IPC_CHANNELS.openLink].sort())
  })

  it('opens a link requested by the launcher', async () => {
    const { handlers, controller } = setup()
    await expect(handlers.get(IPC_CHANNELS.openLink)?.(fromLauncher, 'https://x')).resolves.toEqual({ ok: true })
    expect(controller.open).toHaveBeenCalledWith('https://x')
  })

  it.each([
    ['the hosted viewer page', { senderFrame: { url: 'https://ontime.app/session/abc/view' } }],
    ['an unknown frame', { senderFrame: null }],
    ['a missing frame', {}],
    ['another file', { senderFrame: { url: 'file:///tmp/evil.html' } }],
  ])('refuses open-link from %s', async (_name, event) => {
    const { handlers, controller } = setup()
    await expect(handlers.get(IPC_CHANNELS.openLink)?.(event, 'https://x')).resolves.toEqual({ ok: false, code: 'untrusted-sender' })
    expect(controller.open).not.toHaveBeenCalled()
  })

  it('refuses launcher info from an untrusted sender', () => {
    const { handlers } = setup()
    expect(handlers.get(IPC_CHANNELS.getLauncherInfo)?.({ senderFrame: { url: 'https://evil.example/' } })).toEqual({ webOrigin: null })
    expect(handlers.get(IPC_CHANNELS.getLauncherInfo)?.(fromLauncher)).toEqual({ webOrigin: 'https://ontime.app' })
  })

  it.each([42, null, undefined, {}, ['a'], 'x'.repeat(5000)])('rejects a non-string or oversized payload (%#)', async (payload) => {
    const { handlers, controller } = setup()
    await expect(handlers.get(IPC_CHANNELS.openLink)?.(fromLauncher, payload)).resolves.toEqual({ ok: false, code: 'malformed' })
    expect(controller.open).not.toHaveBeenCalled()
  })
})
