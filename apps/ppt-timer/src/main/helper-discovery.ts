/**
 * Safe helper executable discovery (ISSUE-001). Resolves canonical launch
 * candidates for the .NET STA probe without ever throwing: a dev override path
 * (`PPT_PROBE_PATH`, resolved by electron-dev.js to the canonical build output),
 * then the packaged slot at `<resourcesPath>/bin/ppt-probe.exe`. Only candidates
 * that exist on disk are returned; on non-Windows hosts nothing is found and the
 * app truthfully shows the unavailable state.
 *
 * The packaged helper ships exactly once under `resources/bin/ppt-probe.exe`
 * (Stage 6 electron-builder extraResources), matching Companion's packaged path.
 *
 * The first-existing candidate policy itself is owned by `@ontime/ppt-bridge`
 * (`PptBridgeClientImpl`); this module only feeds it safe, existing paths.
 */
import { existsSync } from 'node:fs'
import type { HelperLaunchCandidate } from '@ontime/ppt-bridge'

const EXE_NAME = 'ppt-probe.exe'
// electron-builder extraResources copies the helper to resources/bin/ (see
// electron-builder.yml). `process.resourcesPath` is the resources root.
const PACKAGED_HELPER_DIR = 'bin'

export type DiscoveryOptions = {
  resourcesPath?: string
  envPath?: string
  exists?: (path: string) => boolean
}

export function discoverHelperCandidates(options: DiscoveryOptions = {}): HelperLaunchCandidate[] {
  const exists = options.exists ?? existsSync
  const paths: string[] = []
  if (options.envPath && options.envPath.length > 0) paths.push(options.envPath)
  if (options.resourcesPath && options.resourcesPath.length > 0)
    paths.push(`${options.resourcesPath}/${PACKAGED_HELPER_DIR}/${EXE_NAME}`)
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
