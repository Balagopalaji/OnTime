/**
 * Application controllers (ISSUE-001 H5). Pure coordination that wires the
 * session host, settings store, diagnostics, and window effects to the closed
 * {@link RendererAction} union — testable without Electron. `main.ts` supplies
 * the real effects (BrowserWindow, clipboard, shell.openExternal).
 */
import { safeOpenUpsell } from './security.js'
import { withSettingsField, type Settings } from './settings-schema.js'
import type { SessionHost } from './session-host.js'
import type {
  AppView,
  DisplayInfo,
  RendererAction,
  PanelMode,
  RemoteShareCommand,
  RemoteShareView,
  SizePreset,
  UpsellConfig,
} from '../shared/ipc-contract.js'

export type WindowEffects = {
  setAlwaysOnTop(enabled: boolean): void
  applyPreset(preset: Exclude<SizePreset, 'custom'>): void
  moveToDisplay(displayId: string): void
  setPanelMode(mode: PanelMode, totalVideoCount: number): void
  minimizeWindow(): void
  closeWindow(): void
}

export type AppControllersDeps = {
  host: SessionHost
  getSettings: () => Settings
  saveSettings: (settings: Settings) => Promise<void>
  displays: () => DisplayInfo[]
  upsell: UpsellConfig
  openExternal: (url: string) => Promise<void>
  copyToClipboard: (text: string) => Promise<void>
  getDiagnosticsReport: () => string
  effects: WindowEffects
  /** ISSUE-002 remote share (optional so the local-only app and tests need no sidecar). */
  remoteShare?: { view(): RemoteShareView; dispatch(command: RemoteShareCommand): Promise<void> }
}

export type AppControllers = {
  getView(): AppView
  dispatch(action: RendererAction): Promise<void>
}

export function createAppControllers(deps: AppControllersDeps): AppControllers {
  const getView = (): AppView => {
    const settings = deps.getSettings()
    const hostView = deps.host.getView()
    return {
      revision: hostView.revision,
      ctaAvailable: deps.upsell.ctaAvailable,
      state: hostView.state,
      timingMode: settings.timingMode,
      headlineMode: settings.headlineMode,
      alwaysOnTop: settings.alwaysOnTop,
      autoOpenVideoList: settings.autoOpenVideoList,
      preset: settings.sizePreset,
      displays: deps.displays(),
      selectedDisplayId: settings.selectedDisplayId,
      ...(deps.remoteShare ? { remoteShare: deps.remoteShare.view() } : {}),
    }
  }

  const persist = (next: Settings): void => {
    void deps.saveSettings(next)
  }

  const dispatch = async (action: RendererAction): Promise<void> => {
    const settings = deps.getSettings()
    switch (action.type) {
      case 'setTimingMode': {
        // Persist first: the host republishes synchronously and observers read settings.
        persist(withSettingsField(settings, { timingMode: action.mode }))
        deps.host.setTimingMode(action.mode)
        return
      }
      case 'setHeadlineMode': {
        persist(withSettingsField(settings, { headlineMode: action.mode }))
        deps.host.setHeadlineMode(action.mode)
        return
      }
      case 'setAlwaysOnTop': {
        deps.effects.setAlwaysOnTop(action.enabled)
        persist(withSettingsField(settings, { alwaysOnTop: action.enabled }))
        return
      }
      case 'setAutoOpenVideoList': {
        persist(withSettingsField(settings, { autoOpenVideoList: action.enabled }))
        return
      }
      case 'applyPreset': {
        deps.effects.applyPreset(action.preset)
        persist(withSettingsField(settings, { sizePreset: action.preset }))
        return
      }
      case 'moveToDisplay': {
        deps.effects.moveToDisplay(action.displayId)
        // Moving a window does not mean the operator chose a custom size.
        persist(withSettingsField(settings, { selectedDisplayId: action.displayId }))
        return
      }
      case 'setPanelMode': {
        deps.effects.setPanelMode(action.mode, action.totalVideoCount)
        return
      }
      case 'minimizeWindow': {
        deps.effects.minimizeWindow()
        return
      }
      case 'closeWindow': {
        deps.effects.closeWindow()
        return
      }
      case 'copyDiagnostics': {
        await deps.copyToClipboard(deps.getDiagnosticsReport())
        return
      }
      case 'openUpsell': {
        await safeOpenUpsell(deps.upsell, deps.openExternal)
        return
      }
      case 'remoteShare': {
        await deps.remoteShare?.dispatch(action.command)
        return
      }
      default:
        return
    }
  }

  return { getView, dispatch }
}
