/**
 * Classifies BrowserWindow `resized` events without importing Electron.
 *
 * BrowserWindow has no reliable event-origin marker. Every programmatic bounds
 * operation registers one resize only when dimensions actually change; the next
 * `resized` event consumes that registration. A later unregistered event is a
 * user resize and therefore changes the persisted size preset to `custom`.
 */
import { withSettingsField, type Settings, type WindowBounds } from './settings-schema.js'
import type { Rectangle } from './window-placement.js'

export type WindowResizePolicy = {
  beforeProgrammaticBounds(current: Rectangle, next: Rectangle): void
  consumeResize(): boolean
}

/** Apply the exact persistence rule for one BrowserWindow `resized` event. */
export function settingsForResizeEvent(
  settings: Settings,
  windowBounds: WindowBounds | null,
  userResize: boolean,
): Settings {
  return withSettingsField(settings, {
    windowBounds,
    ...(userResize ? { sizePreset: 'custom' as const } : {}),
  })
}

export function createWindowResizePolicy(): WindowResizePolicy {
  let suppressNextResize = false

  return {
    beforeProgrammaticBounds(current, next) {
      suppressNextResize = current.width !== next.width || current.height !== next.height
    },
    consumeResize() {
      const suppressed = suppressNextResize
      suppressNextResize = false
      return suppressed
    },
  }
}
