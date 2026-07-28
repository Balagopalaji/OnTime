import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../../..')
const readRel = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8')

describe('CI command parity for the standalone app (Stage 6)', () => {
  it('ci-local mirrors rebuild-guardrails.yml for the ppt-timer typecheck + test gates', () => {
    const ciLocal = readRel('scripts/ci-local.mjs')
    const guardrails = readRel('.github/workflows/rebuild-guardrails.yml')
    const appTypecheck = 'npm run typecheck --workspace apps/ppt-timer'
    const appTests = 'npm run test --workspace apps/ppt-timer'

    // Present in BOTH (the local gate must predict the CI gate).
    for (const file of [ciLocal, guardrails]) {
      expect(file).toContain(appTypecheck)
      expect(file).toContain(appTests)
    }
  })

  it('ppt-timer-build.yml is the Windows-only artifact lane with the required stages', () => {
    const wf = readRel('.github/workflows/ppt-timer-build.yml')
    // Windows-only (electron-builder --win + .NET helper build require Windows).
    expect(wf).toMatch(/runs-on:\s*windows-latest/)
    // Installs Node + .NET.
    expect(wf).toMatch(/actions\/setup-node@v4/)
    expect(wf).toMatch(/actions\/setup-dotnet@v4/)
    // Shared package typechecks/tests run in the artifact lane before packaging.
    for (const command of [
      'npm run typecheck --workspace @ontime/presentation-core',
      'npm run test --workspace @ontime/presentation-core',
      'npm run typecheck --workspace @ontime/ppt-bridge',
      'npm run test --workspace @ontime/ppt-bridge',
    ]) expect(wf).toContain(command)
    // Builds the shared CJS deps the app consumes.
    expect(wf).toContain('npm run build:cjs --workspace @ontime/presentation-core')
    expect(wf).toContain('npm run build:cjs --workspace @ontime/ppt-bridge')
    // App typecheck + tests before packaging.
    expect(wf).toContain('npm run typecheck --workspace apps/ppt-timer')
    expect(wf).toContain('npm run test --workspace apps/ppt-timer')
    // Canonical helper build, then package, then deterministic manifest.
    expect(wf).toContain('packages/ppt-bridge/scripts/build-windows.ps1')
    expect(wf).toContain('npm run dist')
    expect(wf).toContain('npm run manifest')
    // Triggers: manual + ppt-timer release tags.
    expect(wf).toMatch(/workflow_dispatch:/)
    expect(wf).toMatch(/ppt-timer-v\*/)
    expect(wf).toContain('Verify standalone beta tag matches package version')
    expect(wf).toContain('RELEASE_TAG')
    expect(wf).toContain("'ppt-timer-v' + version")
    // Uploads installer + checksum + manifest.
    expect(wf).toContain('*-win-x64-setup.exe')
    expect(wf).toContain('build.manifest.json')
  })

  it('verifies the real packaged app.asar resolves runtime deps and ships no forbidden assets', () => {
    const wf = readRel('.github/workflows/ppt-timer-build.yml')
    // Runs against the real unpacked/packaged output, not just static config text.
    expect(wf).toContain('dist_out/win-unpacked/resources')
    expect(wf).toContain('asar list')
    expect(wf).toContain('node ../../node_modules/@electron/asar/bin/asar.js list')
    expect(wf).not.toContain('npx --yes asar')
    // Both runtime workspace deps must actually resolve into the packaged app.
    expect(wf).toContain('node_modules/@ontime/ppt-bridge/dist-cjs/index.js')
    expect(wf).toContain('node_modules/@ontime/presentation-core/dist-cjs/index.js')
    // Build-only manifest tooling must not ship inside the packaged app.
    expect(wf).toContain('dist/main/build-manifest.js')
    // Exactly one helper, and no forbidden cross-product assets in the package.
    expect(wf).toContain("Expected exactly one packaged ppt-probe.exe")
    for (const forbidden of ['companion', 'frontend', 'viewer', 'firebase', 'cloud', 'socket.io', 'functions']) {
      expect(wf).toContain(forbidden)
    }
  })

  it('runs the Companion clean-checkout build pipeline before electron-builder', () => {
    const wf = readRel('.github/workflows/companion-build.yml')
    const viewer = wf.indexOf('npm run build:viewer')
    const app = wf.indexOf('npm run build\n')
    const builder = wf.indexOf('electron-builder --publish never')
    expect(viewer).toBeGreaterThanOrEqual(0)
    expect(app).toBeGreaterThan(viewer)
    expect(builder).toBeGreaterThan(app)
    expect(wf).toContain('dist/main.js')
    expect(wf).toContain('../frontend/dist-viewer/index.html')
    expect(wf).toContain('npx --no-install electron-builder')

  })

  it('keeps every root-workspace npm ci workflow on the lockfile-supported Node policy', () => {
    const lock = JSON.parse(readRel('package-lock.json')) as {
      packages?: Record<string, { engines?: { node?: string } }>
    }
    for (const packagePath of [
      'apps/ppt-timer/node_modules/electron',
      'apps/ppt-timer/node_modules/@electron/get',
    ]) {
      expect(lock.packages?.[packagePath]?.engines?.node?.replace(/\s/g, '')).toBe('>=22.12.0')
    }

    for (const workflowPath of [
      '.github/workflows/rebuild-guardrails.yml',
      '.github/workflows/companion-build.yml',
      '.github/workflows/controller-build.yml',
      '.github/workflows/ppt-timer-build.yml',
    ]) {
      const workflow = readRel(workflowPath)
      expect(workflow).toContain('npm ci')
      expect(workflow).toMatch(/node-version:\s*22\.12\.0/)
      expect(workflow).not.toMatch(/node-version:\s*20\b/)
    }
  })

  it('verifies actual helper PE versions before manifest generation', () => {
    const wf = readRel('.github/workflows/ppt-timer-build.yml')
    const verification = wf.indexOf('Verify helper PE version identity')
    const manifest = wf.indexOf('npm run manifest')
    expect(verification).toBeGreaterThanOrEqual(0)
    expect(manifest).toBeGreaterThan(verification)
    expect(wf).toContain('windows-file-version.mjs $expectedProductVersion')
    expect(wf).toContain('ProductVersion -ne $expectedProductVersion')
    expect(wf).toContain('FileVersion -ne $expectedFileVersion')
    expect(wf).not.toContain("@('ProductVersion', 'FileVersion')")
    expect(wf).toContain('ONTIME_PPT_TIMER_VERIFIED_HELPER_VERSION')
  })

  it('does not enable any signing step in the internal-beta workflow', () => {
    const wf = readRel('.github/workflows/ppt-timer-build.yml')
    expect(wf).not.toMatch(/codesign|azuresigntool|signingHashAlgorithms/i)
    // CSC auto-discovery is explicitly disabled.
    expect(wf).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY:\s*"false"/)
  })
})
