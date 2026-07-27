/**
 * Safe helper executable discovery (ISSUE-001 H5). Resolves canonical launch
 * candidates for the .NET STA probe without ever throwing: a dev override path,
 * then a packaged `resourcesPath` slot (the packaged helper lands in H6). Only
 * candidates that exist on disk are returned; on non-Windows hosts nothing is
 * found and the app truthfully shows the unavailable state.
 *
 * The first-existing candidate policy itself is owned by `@ontime/ppt-bridge`
 * (`PptBridgeClientImpl`); this module only feeds it safe, existing paths.
 */
import { existsSync } from 'node:fs'
import type { HelperLaunchCandidate } from '@ontime/ppt-bridge'

const EXE_NAME = 'ppt-probe.exe'

export type DiscoveryOptions = {
  resourcesPath?: string
  envPath?: string
  exists?: (path: string) => boolean
}

export function discoverHelperCandidates(options: DiscoveryOptions = {}): HelperLaunchCandidate[] {
  const exists = options.exists ?? existsSync
  const paths: string[] = []
  if (options.envPath && options.envPath.length > 0) paths.push(options.envPath)
  if (options.resourcesPath && options.resourcesPath.length > 0) paths.push(`${options.resourcesPath}/${EXE_NAME}`)
  return paths
    .map((executablePath) => ({ executablePath }))
    .filter((candidate) => {
      try {
        return exists(candidate.executablePath)
      } catch {
        return false
      }
    })
}
