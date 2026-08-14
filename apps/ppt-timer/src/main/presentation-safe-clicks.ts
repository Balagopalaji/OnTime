export const PRESENTATION_SAFE_CLICKS_ENV = 'PPT_TIMER_PRESENTATION_SAFE_CLICKS'

export interface PresentationSafeWindowOptions {
  focusable: boolean
  skipTaskbar: boolean
}

/**
 * Keep the experiment Windows-only and opt-in. A non-focusable Electron window
 * can receive pointer input without taking keyboard focus from PowerPoint.
 */
export function presentationSafeWindowOptions(
  platform = process.platform,
  value = process.env[PRESENTATION_SAFE_CLICKS_ENV],
): PresentationSafeWindowOptions {
  const enabled = platform === 'win32' && value === '1'
  return { focusable: !enabled, skipTaskbar: enabled }
}
