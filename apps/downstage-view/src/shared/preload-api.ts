import { IPC_CHANNELS, type LauncherInfo, type OpenLinkResult, type PreloadApi } from './ipc-contract.js'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

/** The typed bridge, built over an injected `ipcRenderer.invoke` so it is unit-testable. */
export function createPreloadApi(invoke: Invoke): PreloadApi {
  return {
    openLink: (text) => invoke(IPC_CHANNELS.openLink, text) as Promise<OpenLinkResult>,
    getLauncherInfo: () => invoke(IPC_CHANNELS.getLauncherInfo) as Promise<LauncherInfo>,
  }
}

/**
 * The preload also runs inside the hosted viewer page; the bridge is exposed
 * to local launcher content only, so remote page code never sees it.
 */
export function shouldExposeApi(protocol: string): boolean {
  return protocol === 'file:'
}
