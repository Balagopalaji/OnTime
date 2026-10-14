import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALLBACK_SCHEME } from './remote-share'

const appRoot = path.resolve(__dirname, '../..')
const configText = readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const storeBuildScript = readFileSync(
  path.join(appRoot, 'scripts/build-store-package.mjs'),
  'utf8',
)
const storeManifestScript = readFileSync(
  path.join(appRoot, 'scripts/build-store-manifest.mjs'),
  'utf8',
)

const winBlock = configText.slice(configText.indexOf('\nwin:'), configText.indexOf('\nnsis:'))
const appxBlock = configText.slice(configText.indexOf('\nappx:'), configText.indexOf('\n# Production code only'))

describe('electron-builder installer config (Stage 6 Batch A)', () => {
  it('pins the stable appId, productName, and exact artifact name', () => {
    expect(configText).toMatch(/appId:\s*com\.downstage\.ppttimer\b/)
    expect(configText).toMatch(/productName:\s*Downstage PPT Video Timer\b/)
    // Artifact name is fixed and version-parameterized (version flows from package.json).
    expect(configText).toContain(
      'artifactName: Downstage-PPT-Video-Timer-${version}-win-x64-setup.exe',
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
      'npm run build && node scripts/build-store-package.mjs',
    )
    expect(appxBlock).toContain(
      'artifactName: Downstage-PPT-Video-Timer-${version}-win-x64-store-feasibility.appx',
    )
    expect(configText).toMatch(/appxManifestCreated:\s*scripts\/patch-appx-manifest\.mjs/)
    expect(storeBuildScript).toContain("createRequire(join(appDir, 'package.json'))")
    expect(storeBuildScript).toContain("requireFromApp.resolve('electron-builder/out/cli/cli.js')")
    expect(storeManifestScript).toContain('buildStoreArtifactName(appVersion, storeConfig.version)')
    expect(storeManifestScript).not.toContain('readdirSync')
  })

  it('uses an explicit provisional identity and only the required full-trust capability', () => {
    expect(appxBlock).toMatch(/identityName:\s*Downstage\.PptVideoTimer\.Feasibility/)
    expect(appxBlock).toMatch(/applicationId:\s*Downstage\.PptVideoTimer\.Feasibility/)
    expect(appxBlock).toMatch(/publisher:\s*CN=Downstage Store Feasibility/)
    expect(appxBlock).toMatch(/publisherDisplayName:\s*Downstage Store Feasibility/)
    expect(appxBlock).toMatch(/displayName:\s*Downstage PPT Video Timer/)
    expect(appxBlock.match(/^\s+-\s+runFullTrust\s*$/gm)).toHaveLength(1)
    expect(appxBlock).not.toMatch(/internetClient|privateNetwork|broadFileSystemAccess|allowElevation/)
    expect(appxBlock).not.toMatch(/OnTime/)
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

  it('keeps the top-level protocols entry for the AppX feasibility target (ISSUE-002 S6d)', () => {
    // electron-builder's NSIS target ignores `protocols`; only AppX (uap:Protocol), mac and
    // Linux read it. The NSIS install registers the scheme through the include below.
    const block = configText.slice(configText.indexOf('\nprotocols:')).split('\n\n')[0]
    expect(configText.match(/^protocols:/gm)).toHaveLength(1)
    expect(block).toMatch(/\n  name: Downstage PPT Video Timer\n/)
    const schemes = [...block.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((match) => match[1])
    expect(schemes).toEqual([CALLBACK_SCHEME])
    expect(CALLBACK_SCHEME).toBe('downstage-ppt-timer')
  })

  describe('NSIS installer protocol registration (ISSUE-002 S6d)', () => {
    const nsisBlock = configText.slice(configText.indexOf('\nnsis:'))
    const includeRel = nsisBlock.match(/^\s+include:\s*(\S+)\s*$/m)?.[1]
    const includeText =
      includeRel && existsSync(path.join(appRoot, includeRel))
        ? readFileSync(path.join(appRoot, includeRel), 'utf8')
        : ''
    const macro = (name: string) =>
      includeText.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`))?.[1] ?? ''
    const key = `Software\\Classes\\${CALLBACK_SCHEME}`

    it('configures an nsis.include that exists under the build resources directory', () => {
      expect(includeRel).toBe('build/installer.nsh')
      expect(includeText).not.toBe('')
    })

    it('customInstall writes exactly the per-user callback scheme key with the %1 command', () => {
      const writes = [...macro('customInstall').matchAll(/^\s*WriteRegStr\s+(.+)$/gm)].map((m) =>
        m[1].trim(),
      )
      expect(writes).toEqual([
        `HKCU "${key}" "" "URL:Downstage PPT Timer"`,
        `HKCU "${key}" "URL Protocol" ""`,
        `HKCU "${key}\\DefaultIcon" "" "$INSTDIR\\\${APP_EXECUTABLE_FILENAME},0"`,
        `HKCU "${key}\\shell\\open\\command" "" '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "%1"'`,
      ])
      expect(macro('customInstall')).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE|SHCTX/)
    })

    it('customUnInstall removes that key and nothing else', () => {
      const deletes = [...macro('customUnInstall').matchAll(/^\s*DeleteRegKey\s+(.+)$/gm)].map((m) =>
        m[1].trim(),
      )
      expect(deletes).toEqual([`HKCU "${key}"`])
    })
  })

  it('keeps the Store feasibility manifest to one capability and no protocol-specific capability', () => {
    // A custom URL scheme is an AppX extension, not a capability.
    expect(appxBlock).not.toMatch(/protocols?:/)
    expect(storeManifestScript).not.toMatch(/protocol/i)
  })
})
