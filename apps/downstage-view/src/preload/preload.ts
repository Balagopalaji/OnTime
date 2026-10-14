/**
 * Sandboxed preload. Exposes the two-method launcher bridge via contextBridge,
 * and only to local file content: this script also runs in the hosted viewer
 * page, which must never see any IPC surface.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { createPreloadApi, shouldExposeApi } from '../shared/preload-api.js'

if (shouldExposeApi(window.location.protocol)) {
  contextBridge.exposeInMainWorld('downstageView', createPreloadApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)))
}
