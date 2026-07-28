/**
 * Launch-time trust boundary for the standalone main process. Development
 * overrides are accepted only from the repository launcher; packaged builds
 * always use their local renderer and packaged helper.
 */
export const LAUNCHER_DEV_RENDERER_URL = 'http://localhost:5173'

export type LaunchPolicyInput = {
  isPackaged: boolean
  helperOverride?: string
  rendererOverride?: string
}

export type LaunchTargets = {
  helperOverride?: string
  rendererUrl: string | null
}

export function selectLaunchTargets(input: LaunchPolicyInput): LaunchTargets {
  if (input.isPackaged) return { rendererUrl: null }

  return {
    helperOverride: input.helperOverride && input.helperOverride.length > 0 ? input.helperOverride : undefined,
    // Deliberately exact rather than a localhost pattern: electron-dev.js owns
    // this one endpoint, and no inherited URL can broaden the renderer trust
    // boundary or preload/IPC surface.
    rendererUrl: input.rendererOverride === LAUNCHER_DEV_RENDERER_URL ? LAUNCHER_DEV_RENDERER_URL : null,
  }
}
