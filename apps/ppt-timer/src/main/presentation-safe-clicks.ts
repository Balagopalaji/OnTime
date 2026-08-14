export interface PresentationSafeWindowOptions {
  focusable: boolean
  skipTaskbar: boolean
}

/**
 * Keep the Windows overlay pointer-interactive without taking keyboard focus
 * from PowerPoint. Other platforms retain Electron's normal window behavior.
 */
export function presentationSafeWindowOptions(platform = process.platform): PresentationSafeWindowOptions {
  const enabled = platform === 'win32'
  return { focusable: !enabled, skipTaskbar: enabled }
}
