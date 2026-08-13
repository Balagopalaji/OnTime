import { describe, expect, it } from 'vitest'
import { LAUNCHER_DEV_RENDERER_URL, selectLaunchTargets } from './launch-policy'

describe('standalone launch policy', () => {
  it('ignores inherited helper and renderer overrides in packaged builds', () => {
    expect(selectLaunchTargets({
      isPackaged: true,
      helperOverride: 'C:\\temp\\attacker-probe.exe',
      rendererOverride: 'https://attacker.example/timer',
    })).toEqual({ rendererUrl: null })
  })

  it('permits the dev helper override and only the launcher-owned renderer URL', () => {
    expect(selectLaunchTargets({
      isPackaged: false,
      helperOverride: 'C:\\dev\\ppt-probe.exe',
      rendererOverride: LAUNCHER_DEV_RENDERER_URL,
    })).toEqual({
      helperOverride: 'C:\\dev\\ppt-probe.exe',
      rendererUrl: LAUNCHER_DEV_RENDERER_URL,
    })
  })

  it.each([
    'https://attacker.example',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://localhost:5173/evil',
  ])('rejects non-launcher renderer override %s in development', (rendererOverride) => {
    expect(selectLaunchTargets({ isPackaged: false, rendererOverride })).toEqual({ rendererUrl: null })
  })
})
