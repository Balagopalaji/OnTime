import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = path.resolve(__dirname, '../..')
const configText = readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}

const winBlock = configText.slice(configText.indexOf('\nwin:'), configText.indexOf('\nnsis:'))
const appxBlock = configText.slice(configText.indexOf('\nappx:'), configText.indexOf('\n# Production code only'))

describe('electron-builder installer config (Stage 6 Batch A)', () => {
  it('pins the stable appId, productName, and exact artifact name', () => {
    expect(configText).toMatch(/appId:\s*com\.ontime\.ppttimer\b/)
    expect(configText).toMatch(/productName:\s*OnTime PowerPoint Video Timer\b/)
    // Artifact name is fixed and version-parameterized (version flows from package.json).
    expect(configText).toContain(
      'artifactName: OnTime-PowerPoint-Video-Timer-${version}-win-x64-setup.exe',
    )
  })

  it('does NOT hardcode a version (package.json is the single version source)', () => {
    expect(configText).not.toMatch(/^\s*version:/m)
  })

  it('keeps the default Windows target exactly x64 NSIS', () => {
    expect(winBlock).toMatch(/target:\s*nsis\b/)
    expect(winBlock).toMatch(/arch:\s*\n\s*- x64\b/)
    expect(winBlock).not.toMatch(/target:\s*appx\b/)
    expect(packageJson.scripts?.dist).toBe('npm run build && electron-builder')
  })

  it('adds AppX/MSIX-family packaging only through an explicit feasibility command', () => {
    expect(packageJson.scripts?.['dist:store-feasibility']).toBe(
      'npm run build && electron-builder --win appx --x64',
    )
    expect(appxBlock).toContain(
      'artifactName: OnTime-PowerPoint-Video-Timer-${version}-win-x64-store-feasibility.appx',
    )
    expect(configText).toMatch(/appxManifestCreated:\s*scripts\/patch-appx-manifest\.mjs/)
  })

  it('uses an explicit provisional identity and only the required full-trust capability', () => {
    expect(appxBlock).toMatch(/identityName:\s*OnTime\.PptVideoTimer\.Feasibility/)
    expect(appxBlock).toMatch(/applicationId:\s*OnTime\.PptVideoTimer\.Feasibility/)
    expect(appxBlock).toMatch(/publisher:\s*CN=OnTime Store Feasibility/)
    expect(appxBlock).toMatch(/publisherDisplayName:\s*OnTime Store Feasibility/)
    expect(appxBlock).toMatch(/displayName:\s*OnTime PowerPoint Video Timer/)
    expect(appxBlock.match(/^\s+-\s+runFullTrust\s*$/gm)).toHaveLength(1)
    expect(appxBlock).not.toMatch(/internetClient|privateNetwork|broadFileSystemAccess|allowElevation/)
    expect(appxBlock).not.toMatch(/Downstage/)
  })

  it('is an assisted per-user install that preserves settings on uninstall', () => {
    const nsisBlock = configText.slice(configText.indexOf('nsis:'))
    expect(nsisBlock).toMatch(/oneClick:\s*false/)
    expect(nsisBlock).toMatch(/perMachine:\s*false/)
    expect(nsisBlock).toMatch(/allowToChangeInstallationDirectory:\s*true/)
    // S-032: settings survive normal uninstall.
    expect(nsisBlock).toMatch(/deleteAppDataOnUninstall:\s*false/)
  })

  it('has no auto-update (no publish block) — upgrade is user-initiated (S-031)', () => {
    expect(configText).not.toMatch(/^\s*publish:/m)
    expect(configText).not.toMatch(/provider:\s*github/m)
  })

  it('has no signing configuration (internal unsigned beta)', () => {
    expect(configText).not.toMatch(/publisherName:/m)
    expect(configText).not.toMatch(/certificateFile:/m)
  })

  it('outputs to dist_out', () => {
    expect(configText).toMatch(/output:\s*dist_out\b/)
  })
})
