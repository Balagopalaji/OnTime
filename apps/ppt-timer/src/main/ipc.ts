/**
 * IPC binding + sender validation (ISSUE-001 H5, S-033). The main process accepts
 * `ppt-timer:*` messages only from its own main window's web contents; every
 * dispatch payload is validated against the closed {@link RendererAction} union
 * (unknown values/arbitrary URLs are rejected).
 */
import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { parseRendererAction, type AppView, type RendererAction } from '../shared/ipc-contract.js'

export type IpcBinding = {
  getView(): AppView
  dispatch(action: RendererAction): Promise<void>
}

export function isAllowedSender(sender: WebContents, expected: WebContents): boolean {
  return sender === expected
}

export function bindPptTimerIpc(mainWindow: BrowserWindow, binding: IpcBinding): () => void {
  ipcMain.handle('ppt-timer:get-view', (event) => {
    // Both channels are restricted to the main window's own contents (S-033);
    // no other WebContents may read presentation state or drive actions.
    if (!isAllowedSender(event.sender, mainWindow.webContents)) return undefined
    return binding.getView()
  })
  ipcMain.handle('ppt-timer:dispatch', (event, raw: unknown) => {
    if (!isAllowedSender(event.sender, mainWindow.webContents)) return undefined
    const parsed = parseRendererAction(raw)
    if (!parsed.ok) return undefined
    return binding.dispatch(parsed.action)
  })
  return () => {
    ipcMain.removeHandler('ppt-timer:get-view')
    ipcMain.removeHandler('ppt-timer:dispatch')
  }
}
