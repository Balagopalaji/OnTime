import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from './ipc-contract.js'
import { createPreloadApi, shouldExposeApi } from './preload-api.js'

describe('createPreloadApi', () => {
  it('exposes only openLink and getLauncherInfo, each a single typed invoke', async () => {
    const invoke = vi.fn(async (_channel: string, ..._args: unknown[]) => ({ ok: true }))
    const api = createPreloadApi(invoke)
    expect(Object.keys(api).sort()).toEqual(['getLauncherInfo', 'openLink'])
    await api.openLink('link')
    await api.getLauncherInfo()
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.openLink, 'link'],
      [IPC_CHANNELS.getLauncherInfo],
    ])
  })
})

describe('shouldExposeApi', () => {
  it('exposes the bridge to the local launcher only, never to hosted viewer content', () => {
    expect(shouldExposeApi('file:')).toBe(true)
    expect(shouldExposeApi('https:')).toBe(false)
    expect(shouldExposeApi('http:')).toBe(false)
    expect(shouldExposeApi('about:')).toBe(false)
    expect(shouldExposeApi('')).toBe(false)
  })
})
