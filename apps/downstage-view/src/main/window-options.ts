import type { BrowserWindowConstructorOptions } from 'electron'
import { BROWSER_SECURITY } from './security.js'

/**
 * In-memory partition (no `persist:` prefix): nothing the hosted viewer stores,
 * including its tab-scoped link token, survives quitting the app.
 */
export const VIEWER_PARTITION = 'downstage-view'

export const WINDOW_TITLE = 'Downstage View'

/**
 * An ordinary framed window. It is a monitoring surface, so it is never
 * always-on-top, fullscreen, or kiosk and cannot cover a show output.
 */
export function createWindowOptions(options: { preloadPath: string }): BrowserWindowConstructorOptions {
  return {
    width: 560,
    height: 260,
    minWidth: 320,
    minHeight: 160,
    resizable: true,
    show: false,
    title: WINDOW_TITLE,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      ...BROWSER_SECURITY,
      preload: options.preloadPath,
      partition: VIEWER_PARTITION,
      spellcheck: false,
    },
  }
}
