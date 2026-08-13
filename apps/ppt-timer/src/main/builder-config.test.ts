import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = path.resolve(__dirname, '../..')
const configText = readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8')

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

  it('targets Windows x64 NSIS only', () => {
    expect(configText).toMatch(/win:/)
    expect(configText).toMatch(/target:\s*nsis\b/)
    expect(configText).toMatch(/arch:\s*\n\s*- x64\b/)
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
