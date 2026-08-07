/**
 * Window activation policy for a second Electron launch.
 *
 * Electron owns the process lock; this module keeps the observable window
 * effects deterministic and testable without importing Electron. A launch
 * received before `ready-to-show` is remembered and applied once the existing
 * window is ready instead of showing an unpainted window.
 */
export type ActivatableWindow = {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  isVisible(): boolean
  show(): void
  focus(): void
}

export type SingleInstanceActivation = {
  requestActivation(): void
  windowReady(window: ActivatableWindow): void
  windowClosed(window: ActivatableWindow): void
}

export type SingleInstanceApp = {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

function activate(window: ActivatableWindow): void {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

export function createSingleInstanceActivation(): SingleInstanceActivation {
  let readyWindow: ActivatableWindow | null = null
  let pending = false

  return {
    requestActivation: () => {
      if (!readyWindow || readyWindow.isDestroyed()) {
        pending = true
        return
      }
      activate(readyWindow)
    },
    windowReady: (window) => {
      readyWindow = window
      if (!pending) return
      pending = false
      activate(window)
    },
    windowClosed: (window) => {
      if (readyWindow === window) readyWindow = null
    },
  }
}

/** Claim Electron's process lock before any window or helper is created. */
export function acquireSingleInstanceActivation(
  app: SingleInstanceApp,
  onSecondInstance: () => void,
): SingleInstanceActivation | null {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return null
  }
  const activation = createSingleInstanceActivation()
  app.on('second-instance', () => {
    onSecondInstance()
    activation.requestActivation()
  })
  return activation
}
