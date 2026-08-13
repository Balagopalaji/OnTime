/**
 * Sandboxed preload (ISSUE-001 H5). Exposes ONLY typed getters/actions/
 * subscriptions via contextBridge. No filesystem, process, shell, or arbitrary
 * URL API reaches the renderer. Every subscription returns an unsubscribe fn.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppView, PreloadApi, RendererAction } from '../shared/ipc-contract.js'

const api: PreloadApi = {
  getView: () => ipcRenderer.invoke('ppt-timer:get-view'),
  subscribe: (listener) => {
    const handler = (_event: IpcRendererEvent, view: AppView): void => listener(view)
    ipcRenderer.on('ppt-timer:view', handler)
    return () => {
      ipcRenderer.off('ppt-timer:view', handler)
    }
  },
  dispatch: (action: RendererAction) => ipcRenderer.invoke('ppt-timer:dispatch', action),
}

contextBridge.exposeInMainWorld('ontime', api)
