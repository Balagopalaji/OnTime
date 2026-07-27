import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the handlers registered against a mocked ipcMain so we can invoke them
// exactly as Electron would, without an Electron runtime. `vi.hoisted` shares the
// state with the hoisted `vi.mock` factory below.
const { handlers, removeHandler } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel))
  return { handlers, removeHandler }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn),
    removeHandler,
  },
}))

import { bindPptTimerIpc, isAllowedSender, type IpcBinding } from './ipc'
import type { AppView } from '../shared/ipc-contract'

const appView: AppView = {
  revision: 7,
  ctaAvailable: false,
  state: { kind: 'connecting', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false },
  timingMode: 'remaining',
  alwaysOnTop: true,
  preset: 'compact',
  displays: [],
  selectedDisplayId: null,
}

const ownContents = { id: 'own' } as unknown
const foreignContents = { id: 'foreign' } as unknown
const mainWindow = { webContents: ownContents } as unknown as import('electron').BrowserWindow

function makeBinding(): { binding: IpcBinding; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(async () => undefined)
  return { binding: { getView: () => appView, dispatch }, dispatch }
}

beforeEach(() => {
  handlers.clear()
  removeHandler.mockClear()
})

describe('isAllowedSender', () => {
  it('accepts only the exact main-window web contents (S-033)', () => {
    expect(isAllowedSender(ownContents as never, ownContents as never)).toBe(true)
    expect(isAllowedSender(foreignContents as never, ownContents as never)).toBe(false)
  })
})

describe('bindPptTimerIpc', () => {
  it('registers the get-view and dispatch channels', () => {
    const { binding } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    expect([...handlers.keys()].sort()).toEqual(['ppt-timer:dispatch', 'ppt-timer:get-view'])
  })

  it('get-view returns the binding view to the trusted sender', () => {
    const { binding } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    expect(handlers.get('ppt-timer:get-view')!({ sender: ownContents })).toEqual(appView)
  })

  it('get-view refuses an untrusted sender (S-033)', () => {
    const { binding } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    expect(handlers.get('ppt-timer:get-view')!({ sender: foreignContents })).toBeUndefined()
  })

  it('dispatch forwards a valid action from the trusted sender', async () => {
    const { binding, dispatch } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    await handlers.get('ppt-timer:dispatch')!({ sender: ownContents }, { type: 'setTimingMode', mode: 'elapsed' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'setTimingMode', mode: 'elapsed' })
  })

  it('drops a dispatch from an untrusted sender without parsing it', async () => {
    const { binding, dispatch } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    const result = await handlers.get('ppt-timer:dispatch')!({ sender: foreignContents }, { type: 'setTimingMode', mode: 'elapsed' })
    expect(result).toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('rejects a malformed action from the trusted sender', async () => {
    const { binding, dispatch } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    const result = await handlers.get('ppt-timer:dispatch')!({ sender: ownContents }, { type: 'wipeDisk' })
    expect(result).toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('never carries a renderer-supplied URL into an openUpsell dispatch (S-033)', async () => {
    const { binding, dispatch } = makeBinding()
    bindPptTimerIpc(mainWindow, binding)
    await handlers.get('ppt-timer:dispatch')!({ sender: ownContents }, { type: 'openUpsell', url: 'https://evil.example' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'openUpsell' })
  })

  it('unbind removes both channels', () => {
    const { binding } = makeBinding()
    const unbind = bindPptTimerIpc(mainWindow, binding)
    unbind()
    expect(removeHandler).toHaveBeenCalledWith('ppt-timer:get-view')
    expect(removeHandler).toHaveBeenCalledWith('ppt-timer:dispatch')
    expect(handlers.size).toBe(0)
  })
})
