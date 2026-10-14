/**
 * Hardened window, navigation, and permission policy for the read-only
 * viewer. Pure config plus small adapters over injected Electron objects, so
 * the whole security surface is unit-testable without launching Electron.
 *
 * Policy: the window shows (1) the local launcher page and (2) one hosted
 * viewer page on the configured web origin. After the first load it may only
 * ever navigate to viewer pages on that origin; every popup, webview,
 * permission request, and external destination is denied.
 */
import { isViewerPageUrl } from '../shared/viewer-link.js'

export const BROWSER_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
} as const

type Preventable = { preventDefault(): void }
// Electron 43 passes navigation details (with `url`) as the event; the legacy
// signature passed the url as a second argument. Accept both.
type FrameNavigationEvent = Preventable & { url?: string }
type GuardedContents = {
  on(event: string, listener: (event: FrameNavigationEvent, url?: string) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
}

export function createNavigationPolicy(options: { webOrigin: string }) {
  const allowNavigation = (url: string): boolean => isViewerPageUrl(url, options.webOrigin)
  const windowOpenHandler = (_details: { url: string }): { action: 'deny' } => ({ action: 'deny' })
  return {
    allowNavigation,
    windowOpenHandler,
    /** Install the guards on a window's web contents. */
    attach(contents: GuardedContents): void {
      const guard = (event: FrameNavigationEvent, legacyUrl?: string): void => {
        if (!allowNavigation(event.url ?? legacyUrl ?? '')) event.preventDefault()
      }
      contents.on('will-navigate', guard)
      contents.on('will-redirect', guard)
      // will-navigate/will-redirect fire for the main frame only; this covers any
      // sub-frame (iframe) navigation off the allowed viewer origin as well.
      contents.on('will-frame-navigate', guard)
      contents.on('will-attach-webview', (event) => event.preventDefault())
      contents.setWindowOpenHandler(windowOpenHandler)
    },
  }
}

type PermissionSession = {
  setPermissionRequestHandler(handler: (...args: any[]) => void): unknown
  setPermissionCheckHandler(handler: () => boolean): unknown
}

/** A viewer needs no camera, microphone, notifications, clipboard, or any other permission. */
export function denyAllPermissions(session: PermissionSession): void {
  session.setPermissionRequestHandler((_contents: unknown, _permission: unknown, callback: (granted: boolean) => void) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

/** The bridge may be used only by the local launcher document, never by hosted content. */
export function isTrustedLauncherSender(senderUrl: string | undefined, launcherUrl: string): boolean {
  if (!senderUrl) return false
  try {
    const sender = new URL(senderUrl)
    const launcher = new URL(launcherUrl)
    return sender.protocol === 'file:' && sender.pathname === launcher.pathname
  } catch {
    return false
  }
}
