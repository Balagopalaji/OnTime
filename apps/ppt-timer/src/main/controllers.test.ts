import { describe, expect, it, vi } from 'vitest'
import { createAppControllers, type AppControllersDeps } from './controllers'
import { DEFAULT_SETTINGS } from './settings-schema'
import { settingsForResizeEvent } from './window-resize-policy'
import type { SessionHost } from './session-host'
import type { PowerPointViewState } from '@ontime/presentation-core'

const connectingState: PowerPointViewState = { kind: 'connecting', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false }

function makeDeps(overrides: Partial<AppControllersDeps> = {}): AppControllersDeps {
  const fakeHost: SessionHost = {
    start: vi.fn(),
    getView: vi.fn(() => ({ revision: 3, state: connectingState })),
    setTimingMode: vi.fn(),
    getProtocolVersion: vi.fn(() => null),
    getHelperVersion: vi.fn(() => null),
    shutdown: vi.fn(async () => undefined),
  }
  return {
    host: fakeHost,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    saveSettings: vi.fn(async () => undefined),
    displays: () => [{ id: '1', label: 'Display 1' }],
    upsell: { url: 'https://ontime.app', ctaAvailable: true },
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    getDiagnosticsReport: () => 'report',
    effects: {
      setAlwaysOnTop: vi.fn(),
      applyPreset: vi.fn(),
      moveToDisplay: vi.fn(),
      minimizeWindow: vi.fn(),
      closeWindow: vi.fn(),
    },
    ...overrides,
  }
}

describe('getView composes the AppView (S-014/S-033)', () => {
  it('reflects host revision/state, settings, displays, and cta availability', () => {
    const deps = makeDeps()
    const c = createAppControllers(deps)
    const view = c.getView()
    expect(view.revision).toBe(3)
    expect(view.state.kind).toBe('connecting')
    expect(view.ctaAvailable).toBe(true)
    expect(view.timingMode).toBe('remaining')
    expect(view.alwaysOnTop).toBe(true)
    expect(view.preset).toBe('compact')
    expect(view.displays).toEqual([{ id: '1', label: 'Display 1' }])
  })

  it('reports ctaAvailable false when no upsell URL is configured', () => {
    const deps = makeDeps({ upsell: { url: null, ctaAvailable: false } })
    expect(createAppControllers(deps).getView().ctaAvailable).toBe(false)
  })
})

describe('dispatch routes actions to effects + persistence', () => {
  it('setTimingMode updates the host and persists', async () => {
    const deps = makeDeps()
    await createAppControllers(deps).dispatch({ type: 'setTimingMode', mode: 'elapsed' })
    expect(deps.host.setTimingMode).toHaveBeenCalledWith('elapsed')
    expect(deps.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ timingMode: 'elapsed' }))
  })

  it('setAlwaysOnTop applies the effect and persists', async () => {
    const deps = makeDeps()
    await createAppControllers(deps).dispatch({ type: 'setAlwaysOnTop', enabled: false })
    expect(deps.effects.setAlwaysOnTop).toHaveBeenCalledWith(false)
    expect(deps.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ alwaysOnTop: false }))
  })

  it('applyPreset applies the effect and persists the preset', async () => {
    const deps = makeDeps()
    await createAppControllers(deps).dispatch({ type: 'applyPreset', preset: 'large' })
    expect(deps.effects.applyPreset).toHaveBeenCalledWith('large')
    expect(deps.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sizePreset: 'large' }))
  })

  it('moveToDisplay applies the effect and persists the display id without changing the preset', async () => {
    const deps = makeDeps({ getSettings: () => ({ ...DEFAULT_SETTINGS, sizePreset: 'large' }) })
    await createAppControllers(deps).dispatch({ type: 'moveToDisplay', displayId: '2' })
    expect(deps.effects.moveToDisplay).toHaveBeenCalledWith('2')
    expect(deps.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedDisplayId: '2', sizePreset: 'large' }))
  })

  it('keeps a manual resize custom through another action and a controller restart', async () => {
    let currentSettings = { ...DEFAULT_SETTINGS }
    const saveSettings = vi.fn(async (next) => { currentSettings = next })
    const deps = makeDeps({ getSettings: () => currentSettings, saveSettings })
    const controllers = createAppControllers(deps)

    // Simulate the main-process resize event, which is the single settings owner.
    currentSettings = settingsForResizeEvent(currentSettings, {
      x: 10,
      y: 20,
      width: 777,
      height: 444,
    }, true)
    expect(controllers.getView().preset).toBe('custom')

    await controllers.dispatch({ type: 'setAlwaysOnTop', enabled: false })
    expect(currentSettings).toMatchObject({ sizePreset: 'custom', alwaysOnTop: false })

    // A fresh controller reads the same persisted settings rather than a stale
    // launch-time copy, so restart preserves the custom size choice.
    expect(createAppControllers(deps).getView().preset).toBe('custom')
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ sizePreset: 'custom' }))
  })

  it('copyDiagnostics writes the report to the clipboard', async () => {
    const deps = makeDeps({ getDiagnosticsReport: () => 'DIAG-REPORT' })
    await createAppControllers(deps).dispatch({ type: 'copyDiagnostics' })
    expect(deps.copyToClipboard).toHaveBeenCalledWith('DIAG-REPORT')
  })

  it('routes local window controls without persisting settings', async () => {
    const deps = makeDeps()
    const controllers = createAppControllers(deps)
    await controllers.dispatch({ type: 'minimizeWindow' })
    await controllers.dispatch({ type: 'closeWindow' })
    expect(deps.effects.minimizeWindow).toHaveBeenCalledOnce()
    expect(deps.effects.closeWindow).toHaveBeenCalledOnce()
    expect(deps.saveSettings).not.toHaveBeenCalled()
  })

  it('openUpsell opens the configured URL externally when available', async () => {
    const deps = makeDeps()
    await createAppControllers(deps).dispatch({ type: 'openUpsell' })
    expect(deps.openExternal).toHaveBeenCalledWith('https://ontime.app')
  })

  it('openUpsell is a no-op when the CTA is unavailable', async () => {
    const deps = makeDeps({ upsell: { url: null, ctaAvailable: false } })
    await createAppControllers(deps).dispatch({ type: 'openUpsell' })
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})
