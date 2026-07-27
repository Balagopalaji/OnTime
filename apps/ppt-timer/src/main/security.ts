/**
 * Hardened BrowserWindow / navigation / external-link policy (ISSUE-001 H5,
 * S-024/S-033). Pure config + a guarded external opener so the security surface
 * is unit-testable without launching Electron.
 *
 * Policy: the renderer is local file content only — all in-app navigation and
 * all new windows are denied. The one allowed external destination is the
 * build-time OnTime website URL, opened in the system default browser, and only
 * when it resolves to an exact available HTTPS URL (CTA hidden otherwise).
 */
import type { UpsellConfig } from '../shared/ipc-contract.js'

export const BROWSER_SECURITY = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const

/** Deny all in-app navigation: the renderer is local file content (S-033). */
export function shouldDenyNavigation(): boolean {
  return true
}

/** Deny all new windows / popups inside the app (S-033). */
export function shouldDenyNewWindow(): boolean {
  return true
}

/**
 * Open the upsell URL via the provided opener only when the resolved config is
 * available. Returns true iff an opener was invoked.
 */
export async function safeOpenUpsell(
  config: UpsellConfig,
  openExternal: (url: string) => Promise<void>,
): Promise<boolean> {
  if (config.url !== null && config.ctaAvailable) {
    await openExternal(config.url)
    return true
  }
  return false
}
