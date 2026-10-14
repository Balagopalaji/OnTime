import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Static assertions on electron-builder.yml (ISSUE-002 S8b macOS, S8c Windows).
// Nothing here builds, signs, or notarizes; it pins the shape of the packaging
// config so a later edit cannot quietly widen the shell's privileges.

const appRoot = path.resolve(__dirname, '../..')
const pttRoot = path.resolve(appRoot, '../ppt-timer')
const configPath = path.join(appRoot, 'electron-builder.yml')
const configText = readFileSync(configPath, 'utf8')
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  devDependencies: Record<string, string>
  dependencies?: Record<string, string>
}
const pttPackageJson = JSON.parse(readFileSync(path.join(pttRoot, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>
}

// js-yaml is a dependency of electron-builder; resolve it from there rather than
// declaring a second YAML parser for the app.
const requireFromBuilder = createRequire(
  createRequire(path.join(appRoot, 'package.json')).resolve('app-builder-lib/package.json'),
)
const yaml = requireFromBuilder('js-yaml') as { load: (text: string) => unknown }

interface Target {
  target: string
  arch?: string[]
}
interface BuilderConfig {
  appId: string
  productName: string
  artifactName?: string
  directories: { output: string }
  files: string[]
  asar?: boolean
  npmRebuild?: boolean
  mac: {
    category?: string
    target: Array<Target | string>
    hardenedRuntime?: boolean
    gatekeeperAssess?: boolean
    entitlements?: string
    entitlementsInherit?: string
    artifactName?: string
    [key: string]: unknown
  }
  win: { target: Array<Target | string>; artifactName?: string; [key: string]: unknown }
  nsis: Record<string, unknown>
  [key: string]: unknown
}
const config = yaml.load(configText) as BuilderConfig

const activeText = configText
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

const targetOf = (entry: Target | string): Target => (typeof entry === 'string' ? { target: entry } : entry)

describe('electron-builder schema', () => {
  it('validates against the pinned electron-builder configuration schema', async () => {
    const { getConfig, validateConfiguration } = requireFromBuilder('app-builder-lib/out/util/config/config') as {
      getConfig: (dir: string, configPath: string | null, base: unknown) => Promise<unknown>
      validateConfiguration: (cfg: unknown, logger: unknown) => Promise<void>
    }
    const { DebugLogger } = requireFromBuilder('builder-util') as { DebugLogger: new (enabled: boolean) => unknown }
    const loaded = await getConfig(appRoot, configPath, null)
    await expect(validateConfiguration(loaded, new DebugLogger(false))).resolves.toBeUndefined()
  })
})

describe('shared identity and shell-only inputs', () => {
  it('pins appId and productName', () => {
    expect(config.appId).toBe('com.downstage.view')
    expect(config.productName).toBe('Downstage View')
    expect(config.appId).not.toBe('com.downstage.ppttimer')
  })

  it('takes the version from package.json only', () => {
    expect(config).not.toHaveProperty('version')
    expect(activeText).not.toMatch(/^\s*buildVersion:/m)
  })

  it('packages only the compiled shell: dist plus package.json, no node_modules, no sources', () => {
    expect(config.files).toEqual(['dist/**/*', '!**/*.map', '!**/*.test.*', 'package.json'])
    expect(config.npmRebuild).toBe(false)
    expect(config.asar).not.toBe(false)
  })

  it('declares no runtime dependencies for electron-builder to copy', () => {
    expect(packageJson.dependencies ?? {}).toEqual({})
  })

  it('ships no helper, native payload, or extra resources', () => {
    for (const key of ['extraResources', 'extraFiles', 'asarUnpack', 'electronDist', 'nodeGypRebuild']) {
      expect(config).not.toHaveProperty(key)
    }
    expect(activeText).not.toMatch(/ppt-probe|ppt-bridge|powershell|\.exe\b|\.dll\b|\.node\b|packages\//i)
  })

  it('registers no protocol or file association (S8a has no deep link)', () => {
    for (const key of ['protocols', 'fileAssociations']) {
      expect(config).not.toHaveProperty(key)
      expect(config.mac).not.toHaveProperty(key)
      expect(config.win).not.toHaveProperty(key)
    }
    expect(activeText).not.toMatch(/downstage-ppt-timer|CFBundleURL|uap:Protocol/)
  })

  it('has no publish/auto-update block', () => {
    expect(config).not.toHaveProperty('publish')
    expect(activeText).not.toMatch(/provider:\s*(github|generic|s3)/)
  })

  it('writes installers to dist_out', () => {
    expect(config.directories.output).toBe('dist_out')
  })

  it('pins the same electron-builder and asar versions as ppt-timer, exactly', () => {
    expect(packageJson.devDependencies['electron-builder']).toBe('26.11.1')
    expect(packageJson.devDependencies['electron-builder']).toBe(pttPackageJson.devDependencies['electron-builder'])
    expect(packageJson.devDependencies['@electron/asar']).toBe(pttPackageJson.devDependencies['@electron/asar'])
    expect(packageJson.devDependencies.electron).toBe(pttPackageJson.devDependencies.electron)
    for (const name of ['electron-builder', '@electron/asar']) {
      expect(packageJson.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})

describe('S8b macOS named-tester build', () => {
  const entitlementsFile = path.join(appRoot, String(config.mac.entitlements))

  it('produces dmg and zip for arm64 and x64', () => {
    const targets = config.mac.target.map(targetOf)
    expect(targets.map((t) => t.target).sort()).toEqual(['dmg', 'zip'])
    for (const target of targets) expect([...(target.arch ?? [])].sort()).toEqual(['arm64', 'x64'])
    expect(config.mac.artifactName).toBe('Downstage-View-${version}-mac-${arch}.${ext}')
    expect(config.mac.category).toBe('public.app-category.productivity')
  })

  it('is notarization-ready: hardened runtime, entitlements, no Gatekeeper assessment', () => {
    expect(config.mac.hardenedRuntime).toBe(true)
    expect(config.mac.gatekeeperAssess).toBe(false)
    expect(config.mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(config.mac.entitlementsInherit).toBe(config.mac.entitlements)
    expect(existsSync(entitlementsFile)).toBe(true)
  })

  it('keeps every signing and notarization input out of the file (env-driven only)', () => {
    for (const key of ['identity', 'notarize', 'teamId', 'appleId', 'appleIdPassword', 'provisioningProfile', 'type']) {
      expect(config.mac).not.toHaveProperty(key)
    }
    expect(activeText).not.toMatch(/CSC_|APPLE_|Developer ID|app-specific|password|\.p12|\.p8/i)
  })

  it('declares no usage descriptions (no camera, microphone, contacts, location, etc.)', () => {
    expect(config.mac).not.toHaveProperty('extendInfo')
    expect(activeText).not.toMatch(/NS[A-Za-z]+UsageDescription/)
    expect(activeText).not.toMatch(/mac:[\s\S]*binaries:/)
  })

  it('entitlements grant only what hardened-runtime Electron needs to launch', () => {
    const plist = readFileSync(entitlementsFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort()
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
    ])
    expect(plist.match(/<true\/>/g)).toHaveLength(2)
    expect(plist).not.toMatch(/<false\/>/)
    expect(plist).not.toMatch(
      /camera|audio-input|personal-information|addressbook|calendars|location|photos|bluetooth|usb|print|device|files\.|network\.|app-sandbox|disable-library-validation|dyld-environment|disable-executable-page-protection|debugger|automation/,
    )
  })

  it('exposes dist scripts: signed-if-credentialed, and an explicit unsigned local flag', () => {
    expect(packageJson.scripts['dist:mac']).toBe('npm run build && electron-builder --mac')
    expect(packageJson.scripts['dist:mac:unsigned']).toBe(
      'npm run build && electron-builder --mac -c.mac.identity=null -c.mac.notarize=false',
    )
    expect(packageJson.scripts['dist:mac']).not.toMatch(/identity|notarize/)
  })
})

describe('S8c Windows per-user installer', () => {
  it('builds an x64 NSIS installer only (ppt-timer pattern; no arm64 there either)', () => {
    const pttConfig = readFileSync(path.join(pttRoot, 'electron-builder.yml'), 'utf8')
    expect(pttConfig).not.toMatch(/arm64/)
    expect(config.win.target.map(targetOf)).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(config.win.artifactName).toBe('Downstage-View-${version}-win-${arch}-setup.${ext}')
  })

  it('is an assisted per-user install with no data deletion surprise', () => {
    expect(config.nsis).toEqual({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
    })
  })

  it('has no signing inputs in the file', () => {
    for (const key of [
      'publisherName',
      'certificateFile',
      'certificatePassword',
      'certificateSubjectName',
      'certificateSha1',
      'azureSignOptions',
      'signtoolOptions',
      'signingHashAlgorithms',
      'sign',
      'requestedExecutionLevel',
    ]) {
      expect(config.win).not.toHaveProperty(key)
    }
  })

  it('exposes dist:win and the package audit script', () => {
    expect(packageJson.scripts['dist:win']).toBe('npm run build && electron-builder --win')
    expect(packageJson.scripts.dist).toBe('npm run build && electron-builder')
    expect(packageJson.scripts['audit:package']).toBe('node scripts/package-audit.cjs dist_out')
  })

  it('keeps mac before win in the file (S8c serialized after S8b)', () => {
    expect(configText.indexOf('\nmac:')).toBeGreaterThan(-1)
    expect(configText.indexOf('\nwin:')).toBeGreaterThan(configText.indexOf('\nmac:'))
  })
})
