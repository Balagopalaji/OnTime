import { IPC_CHANNELS, MAX_LINK_TEXT_LENGTH, type LauncherInfo, type OpenLinkResult } from '../shared/ipc-contract.js'
import { isTrustedLauncherSender } from './security.js'

type IpcEvent = { senderFrame?: { url: string } | null }
type IpcMainLike = { handle(channel: string, handler: (event: IpcEvent, ...args: unknown[]) => unknown): unknown }
type ControllerLike = {
  open(text: string): Promise<OpenLinkResult>
  launcherInfo(): LauncherInfo
}

/** Registers the only two renderer-callable handlers; both are launcher-only. */
export function registerViewerIpc(ipcMain: IpcMainLike, controller: ControllerLike, launcherUrl: string): void {
  const trusted = (event: IpcEvent): boolean => isTrustedLauncherSender(event.senderFrame?.url, launcherUrl)

  ipcMain.handle(IPC_CHANNELS.openLink, async (event, text): Promise<OpenLinkResult> => {
    if (!trusted(event)) return { ok: false, code: 'untrusted-sender' }
    if (typeof text !== 'string' || text.length > MAX_LINK_TEXT_LENGTH) return { ok: false, code: 'malformed' }
    return controller.open(text)
  })

  ipcMain.handle(IPC_CHANNELS.getLauncherInfo, (event): LauncherInfo => (trusted(event) ? controller.launcherInfo() : { webOrigin: null }))
}
