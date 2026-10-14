/**
 * Downstage View main process: a read-only desktop shell around the hosted
 * cloud viewer route. Wiring only; the decisions live in the unit-tested
 * modules (config, controller, security, window-options, ipc).
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readViewerConfig } from './config.js'
import { createViewerController } from './controller.js'
import { registerViewerIpc } from './ipc.js'
import { createNavigationPolicy, denyAllPermissions } from './security.js'
import { createWindowOptions, VIEWER_PARTITION, WINDOW_TITLE } from './window-options.js'

const config = readViewerConfig(process.env)
const rendererIndex = join(__dirname, '../renderer/index.html')
const launcherUrl = pathToFileURL(rendererIndex).href

let mainWindow: BrowserWindow | null = null

const controller = createViewerController({
  config,
  loadViewer: async (url) => {
    await mainWindow?.loadURL(url)
  },
  loadLauncher: async () => {
    await mainWindow?.loadFile(rendererIndex)
  },
})

function createWindow(): void {
  const window = new BrowserWindow(createWindowOptions({ preloadPath: join(__dirname, '../preload/preload.js') }))
  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })
  void window.loadFile(rendererIndex)
}

function buildMenu(): Menu {
  const openFromClipboard = async (): Promise<void> => {
    const result = await controller.open(clipboard.readText())
    if (!result.ok) {
      dialog.showErrorBox(WINDOW_TITLE, 'The clipboard does not contain a valid Downstage viewer link for this server.')
    }
  }
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Open Link from Clipboard', accelerator: 'CmdOrCtrl+Shift+V', click: () => void openFromClipboard() },
      { label: 'Open Another Link…', accelerator: 'CmdOrCtrl+L', click: () => void controller.showLauncher() },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ],
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    file,
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  app.on('web-contents-created', (_event, contents) => {
    // Without a configured origin nothing is ever allowed to navigate away from the launcher.
    createNavigationPolicy({ webOrigin: config?.webOrigin ?? 'null' }).attach(contents)
  })

  void app.whenReady().then(() => {
    denyAllPermissions(session.fromPartition(VIEWER_PARTITION))
    registerViewerIpc(ipcMain, controller, launcherUrl)
    Menu.setApplicationMenu(buildMenu())
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
