/**
 * Electron main-process composition root (ISSUE-001 H5, S-019/S-020/S-022/
 * S-024/S-025/S-033). Effectful glue ONLY: it wires the pure modules (settings
 * store, session host, controllers, placement, diagnostics, security policy) to
 * real Electron APIs (BrowserWindow, screen, clipboard, shell) and the
 * before-quit shutdown gate. All timing math, projection, validation, and
 * geometry live in the imported modules; this file computes nothing on its own.
 */
import { app, BrowserWindow, clipboard, Menu, screen, shell, type Display } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { UPSELL_URL_CONSTANT } from './config.js'
import { createAppControllers, type WindowEffects } from './controllers.js'
import { DiagnosticsBuffer, isOverlayDebug, type AppDiagEvent, type DiagMeta } from './diagnostics.js'
import { discoverHelperCandidates } from './helper-discovery.js'
import { bindPptTimerIpc } from './ipc.js'
import {
  attachOverlayDebug,
  attachAlwaysOnTopChangedDebug,
  classifyPlacementOutcome,
  createAlwaysOnTopSetterMarker,
  displayEventEvent,
  placementDecisionEvent,
  programmaticBoundsEvent,
  setAlwaysOnTopWithDebug,
  type DisplaySnapshot as DebugDisplaySnapshot,
  type ProgrammaticBoundsReason,
} from './overlay-debug.js'
import { attachWindowMessageDebugLifecycle } from './overlay-debug-lifecycle.js'
import { BROWSER_SECURITY } from './security.js'
import { createSessionHost } from './session-host.js'
import { selectLaunchTargets } from './launch-policy.js'
import { MIN_WINDOW_SIZE, type Settings, type WindowBounds } from './settings-schema.js'
import { createSettingsStore, type SettingsFs } from './settings-store.js'
import { createWindowResizePolicy, settingsForResizeEvent } from './window-resize-policy.js'
import {
  applyPreset as placePreset,
  isSubstantiallyVisible,
  moveToDisplay as placeMoveToDisplay,
  restoreBounds,
  type DisplaySnapshot,
  type Rectangle,
} from './window-placement.js'
import { resolveUpsellUrl, type DisplayInfo } from '../shared/ipc-contract.js'

// Grace period before a hung helper close is abandoned so a stuck COM call can
// never wedge quit (S-024). The non-Windows path resolves within a microtask.
const SHUTDOWN_TIMEOUT_MS = 2_000

const displayLabel = (display: Display): string =>
  `Display ${String(display.id)} (${display.size.width}×${display.size.height})`

const toDisplayInfo = (display: Display): DisplayInfo => ({ id: String(display.id), label: displayLabel(display) })

const toSnapshot = (display: Display): DisplaySnapshot => ({
  id: String(display.id),
  label: displayLabel(display),
  workArea: display.workArea,
})

const boundsToWindow = (bounds: Rectangle): WindowBounds => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
})

const boundsEqual = (a: Rectangle, b: Rectangle): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

async function main(): Promise<void> {
  let mainWindow: BrowserWindow | null = null
  let quitting = false

  const diagnostics = new DiagnosticsBuffer()

  // Opt-in Windows overlay diagnostics (ISSUE-001 Presenter View faults). When
  // PPT_TIMER_DEBUG is unset this entire surface is inert: no listeners, no
  // reads, no console output, so normal behavior is unchanged.
  const overlayDebug = isOverlayDebug()
  const alwaysOnTopSetterMarker = createAlwaysOnTopSetterMarker()

  const listDisplayInfos = (): DisplayInfo[] => screen.getAllDisplays().map(toDisplayInfo)
  const listSnapshots = (): DisplaySnapshot[] => screen.getAllDisplays().map(toSnapshot)
  const primarySnapshot = (): DisplaySnapshot => toSnapshot(screen.getPrimaryDisplay())

  // ---- Overlay debug readers (passive getters ONLY; never activate the window)
  // Each reads state Electron already maintains — getBounds/isVisible/isFocused
  // etc. — and the matched display's work area + scale factor. No reader here
  // ever calls focus/show/hide/moveTop/setAlwaysOnTop/setBounds: gathering state
  // to log must not reorder the z-band or steal focus (which would itself change
  // the fault under observation and can pause PowerPoint media).
  /** Map an Electron Display to the debug-display shape (passive read). */
  const toDebugDisplay = (display: Display): DebugDisplaySnapshot => {
    const wa = display.workArea
    return { displayId: String(display.id), scaleFactor: display.scaleFactor, wx: wa.x, wy: wa.y, ww: wa.width, wh: wa.height }
  }

  /** Map an Electron Rectangle to the debug-bounds shape ({bx,by,bw,bh}). */
  const toDebugBounds = (r: Rectangle): { bx: number; by: number; bw: number; bh: number } => ({
    bx: r.x,
    by: r.y,
    bw: r.width,
    bh: r.height,
  })

  /** Push a debug event into the ring + console only when the flag is set. */
  const logDebug = (event: AppDiagEvent): void => {
    if (!overlayDebug) return
    diagnostics.push(event)
    console.debug('[ppt-timer:overlay-debug]', event)
  }

  const fs: SettingsFs = {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, data) => writeFile(path, data, 'utf8'),
    rename: (from, to) => rename(from, to),
  }
  const store = createSettingsStore({ filePath: join(app.getPath('userData'), 'settings.json'), fs })

  const loaded = await store.load()
  let currentSettings: Settings = loaded.settings
  const resizePolicy = createWindowResizePolicy()
  if (loaded.recovered) diagnostics.push({ kind: 'settings_recovered', quarantinedPath: loaded.quarantinedPath })

  // Live window bounds are the authority once a window exists, so a settings
  // write triggered by any control cannot clobber the user's latest drag/resize.
  const liveBounds = (): WindowBounds | null => {
    if (!mainWindow || mainWindow.isDestroyed()) return currentSettings.windowBounds
    return boundsToWindow(mainWindow.getBounds())
  }
  // Settings writes are best-effort; a failed persist is logged, never thrown,
  // so a transient disk error cannot produce an unhandled rejection or crash.
  const reportWriteError = (error: unknown): void => console.error('[ppt-timer] settings write failed', error)
  const writeSettings = (next: Settings): Promise<void> => {
    currentSettings = next
    return store.save(next)
  }
  // Controllers own timing/always-on-top/preset/display fields; window geometry
  // is injected here so both persistence paths funnel through one source. The
  // returned promise never rejects, so controllers' fire-and-forget save is safe.
  const saveFromController = (next: Settings): Promise<void> =>
    writeSettings({ ...next, windowBounds: liveBounds() }).catch(reportWriteError)
  const persistBounds = (userResize = false): void => {
    const bounds = liveBounds()
    void writeSettings(settingsForResizeEvent(currentSettings, bounds, userResize)).catch(reportWriteError)
    if (bounds) diagnostics.push({ kind: 'window_bounds', x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  }
  const setProgrammaticBounds = (bounds: Rectangle, reason?: ProgrammaticBoundsReason): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const current = mainWindow.getBounds()
    resizePolicy.beforeProgrammaticBounds(current, bounds)
    mainWindow.setBounds(bounds)
    // Record before/after for the debug report. The display id is read AFTER the
    // setBounds from the matched display (passive read); no activation occurs.
    if (reason && overlayDebug) {
      const after = mainWindow.getBounds()
      const displayId = screen.getDisplayMatching(after).id
      logDebug(programmaticBoundsEvent(reason, toDebugBounds(current), toDebugBounds(after), String(displayId)))
    }
  }

  const upsell = resolveUpsellUrl(UPSELL_URL_CONSTANT)

  const launchTargets = selectLaunchTargets({
    isPackaged: app.isPackaged,
    helperOverride: process.env.PPT_PROBE_PATH,
    rendererOverride: process.env.VITE_DEV_SERVER_URL,
  })
  const candidates = discoverHelperCandidates({
    resourcesPath: process.resourcesPath,
    envPath: launchTargets.helperOverride,
  })

  const host = createSessionHost({
    candidates,
    timingMode: currentSettings.timingMode,
    diagnostics,
    onView: () => pushView(),
  })

  const workAreaForWindow = (): Rectangle => {
    const reference = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : primarySnapshot().workArea
    return screen.getDisplayMatching(reference).workArea
  }

  const effects: WindowEffects = {
    setAlwaysOnTop: (enabled) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      setAlwaysOnTopWithDebug(mainWindow, enabled, overlayDebug, logDebug, alwaysOnTopSetterMarker)
    },
    applyPreset: (preset) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      setProgrammaticBounds(placePreset(mainWindow.getBounds(), preset, workAreaForWindow()), 'preset')
    },
    moveToDisplay: (displayId) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const target = listSnapshots().find((snapshot) => snapshot.id === displayId)
      if (!target) return
      const bounds = mainWindow.getBounds()
      setProgrammaticBounds(placeMoveToDisplay(target, { width: bounds.width, height: bounds.height }), 'moveToDisplay')
      diagnostics.push({
        kind: 'display_change',
        displayId,
        scaleFactor: screen.getDisplayMatching(target.workArea).scaleFactor,
        displayCount: screen.getAllDisplays().length,
      })
    },
  }

  const diagMeta = (): DiagMeta => ({
    // Electron reads this from the packaged app's package.json version field.
    appVersion: app.getVersion(),
    // The native payload reports its publish-time product version; before its
    // first response, the app version is the only truthful expected value.
    helperVersion: host.getHelperVersion() ?? app.getVersion(),
    // Validated observation protocol version (S-026, D-2): carried from the
    // latest helper response and cleared on terminal / no-signal transitions.
    protocolVersion: host.getProtocolVersion(),
    signingStatus: 'unsigned-beta',
    windowsBitness: process.arch,
  })

  const controllers = createAppControllers({
    host,
    getSettings: () => currentSettings,
    saveSettings: saveFromController,
    displays: listDisplayInfos,
    upsell,
    openExternal: (url) => shell.openExternal(url),
    copyToClipboard: async (text) => clipboard.writeText(text),
    getDiagnosticsReport: () => diagnostics.buildReport(diagMeta()),
    effects,
  })

  const pushView = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ppt-timer:view', controllers.getView())
  }

  // S-022: keep saved bounds only when substantially visible; otherwise recenter
  // on the saved display or primary. Revalidated on every display change below.
  const revalidatePlacement = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getBounds()
    const displays = listSnapshots()
    const restored = restoreBounds({
      saved: boundsToWindow(bounds),
      savedDisplayId: currentSettings.selectedDisplayId,
      displays,
      primary: primarySnapshot(),
    })
    // Overlay debug: classify the decision (kept/clamped/recentered) WITHOUT
    // changing placement policy — purely by observing saved visibility and the
    // restored bounds. `visibleOnDisplayId` is the display the pre-restore bounds
    // were substantially visible on (null ⇒ none ⇒ restore will recenter).
    if (overlayDebug) {
      const visibleOn = displays.find((display) => isSubstantiallyVisible(bounds, display.workArea)) ?? null
      const target = displays.find((display) => isSubstantiallyVisible(restored, display.workArea)) ?? primarySnapshot()
      const outcome = classifyPlacementOutcome(toDebugBounds(bounds), toDebugBounds(restored), visibleOn?.id ?? null)
      logDebug(placementDecisionEvent(outcome, visibleOn?.id ?? null, target.id, toDebugBounds(restored)))
    }
    if (!boundsEqual(restored, bounds)) setProgrammaticBounds(restored, 'revalidate')
    pushView() // the display list changed; refresh the renderer's selector
  }

  const createWindow = (): void => {
    const bounds = restoreBounds({
      saved: currentSettings.windowBounds,
      savedDisplayId: currentSettings.selectedDisplayId,
      displays: listSnapshots(),
      primary: primarySnapshot(),
    })

    mainWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: MIN_WINDOW_SIZE.width,
      minHeight: MIN_WINDOW_SIZE.height,
      alwaysOnTop: currentSettings.alwaysOnTop,
      title: 'OnTime PowerPoint Timer',
      backgroundColor: '#0b0b0f',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        ...BROWSER_SECURITY,
      },
    })

    // S-033 hardened navigation: the renderer is local content only. Deny every
    // in-app navigation and every new window; the only external destination is
    // the exact upsell URL, opened out-of-process via shell.openExternal.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

    mainWindow.on('ready-to-show', () => mainWindow?.show())
    mainWindow.on('moved', persistBounds)
    mainWindow.on('resized', () => persistBounds(!resizePolicy.consumeResize()))
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Opt-in overlay diagnostics (PPT_TIMER_DEBUG=1). The listener wiring lives
    // in attachOverlayDebug (pure module); here we inject the Electron window +
    // screen and a literal-name bind so the per-literal `.on` overloads resolve.
    // Listeners are registered ONLY when the flag is set, so a normal run
    // attaches nothing. Each handler reads passive state and pushes a debug
    // event; none activate the window (see overlay-debug.ts constraints).
    if (overlayDebug) {
      const win0 = mainWindow
      const disposeOverlayDebug = attachOverlayDebug(win0, screen, (event, listener) => {
        switch (event) {
          case 'ready-to-show': win0.on('ready-to-show', listener); return () => win0.off('ready-to-show', listener)
          case 'show': win0.on('show', listener); return () => win0.off('show', listener)
          case 'hide': win0.on('hide', listener); return () => win0.off('hide', listener)
          case 'focus': win0.on('focus', listener); return () => win0.off('focus', listener)
          case 'blur': win0.on('blur', listener); return () => win0.off('blur', listener)
          case 'restore': win0.on('restore', listener); return () => win0.off('restore', listener)
          case 'minimize': win0.on('minimize', listener); return () => win0.off('minimize', listener)
          case 'moved': win0.on('moved', listener); return () => win0.off('moved', listener)
          case 'resized': win0.on('resized', listener); return () => win0.off('resized', listener)
        }
      }, logDebug, currentSettings.alwaysOnTop)
      const disposeAlwaysOnTopChanged = attachAlwaysOnTopChangedDebug(win0, alwaysOnTopSetterMarker, logDebug)
      const disposeWindowMessages = process.platform === 'win32' ? attachWindowMessageDebugLifecycle(win0, logDebug) : () => undefined
      // Native hooks are removed at `close`; JS listeners wait for `closed` so
      // a cancelled close does not disable diagnostics for the live window.
      win0.once('closed', () => {
        disposeWindowMessages()
        disposeAlwaysOnTopChanged()
        disposeOverlayDebug()
      })
    }

    bindPptTimerIpc(mainWindow, controllers)

    if (launchTargets.rendererUrl) void mainWindow.loadURL(launchTargets.rendererUrl)
    else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Await the helper close before exiting so no STA child outlives Electron
  // (S-024). Idempotent; a hung close is abandoned after the grace period.
  const runShutdown = async (): Promise<void> => {
    await Promise.race([
      host.shutdown().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ])
  }

  app.on('before-quit', (event) => {
    // Always prevent the default quit until the helper close settles; a repeated
    // quit during the pending window must not bypass the gate or its grace
    // period (S-024). The shutdown itself is idempotent via `quitting`.
    event.preventDefault()
    if (quitting) return
    quitting = true
    diagnostics.push({ kind: 'app_shutdown' })
    void runShutdown().finally(() => app.exit(0))
  })

  // Closing the only window closes the helper and exits; no tray/background.
  app.on('window-all-closed', () => app.quit())

  await app.whenReady()

  // Remove the generic Windows Electron application menu (File/Edit/View/Window/
  // Help). A timer overlay has no document/edit surface, and the default menu's
  // fullscreen/toggle entries are irrelevant; clearing it also removes an
  // accidental accelerator surface. Uses the supported Menu API (null ⇒ no app
  // menu; windows keep their system icon/min/max/close controls).
  Menu.setApplicationMenu(null)

  // The `screen` module is only usable after the app is ready; register the
  // placement-revalidation listeners here (S-022 display add/remove/DPI change).
  screen.on('display-added', (_event, display) => {
    revalidatePlacement()
    if (overlayDebug) logDebug(displayEventEvent('display-added', toDebugDisplay(display), screen.getAllDisplays().length))
  })
  screen.on('display-removed', (_event, display) => {
    revalidatePlacement()
    if (overlayDebug) logDebug(displayEventEvent('display-removed', toDebugDisplay(display), screen.getAllDisplays().length))
  })
  screen.on('display-metrics-changed', (_event, display) => {
    revalidatePlacement()
    if (overlayDebug) logDebug(displayEventEvent('display-metrics-changed', toDebugDisplay(display), screen.getAllDisplays().length))
  })

  diagnostics.push({ kind: 'app_launch' })
  createWindow()
  host.start()
}

void main()
