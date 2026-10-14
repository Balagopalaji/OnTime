import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditAsarEntries, auditUnpackedApp } from '../../scripts/package-audit.cjs'

// Packaged-content proof for S8b/S8c. The audit module is also the CLI run
// against real electron-builder output (`npm run audit:package`); here it is
// exercised on the exact file set the `files` globs select from the build
// output, and on synthetic bad trees to prove it can fail.

const appRoot = path.resolve(__dirname, '../..')
const distRoot = path.join(appRoot, 'dist')

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    const rel = `${prefix}${name}`
    return statSync(full).isDirectory() ? walk(full, `${rel}/`) : [rel]
  })
}

const SHELL_ENTRIES = [
  'package.json',
  'dist/main/main.js',
  'dist/main/config.js',
  'dist/main/controller.js',
  'dist/main/ipc.js',
  'dist/main/security.js',
  'dist/main/window-options.js',
  'dist/preload/preload.js',
  'dist/renderer/index.html',
  'dist/renderer/assets/index-abc123.js',
  'dist/renderer/assets/index-abc123.css',
  'dist/shared/ipc-contract.js',
  'dist/shared/preload-api.js',
  'dist/shared/viewer-link.js',
]

describe('asar content audit', () => {
  it('accepts exactly the shell: dist main/preload/renderer/shared plus package.json', () => {
    expect(auditAsarEntries(SHELL_ENTRIES)).toEqual([])
    // asar listings carry a leading slash and directory entries.
    expect(auditAsarEntries(SHELL_ENTRIES.map((entry) => `/${entry}`).concat(['/dist', '/dist/main']))).toEqual([])
    expect(auditAsarEntries(SHELL_ENTRIES.map((entry) => entry.split('/').join('\\')))).toEqual([])
  })

  it('rejects workspace packages, node_modules, and sources', () => {
    const bad = [
      'node_modules/@ontime/presentation-core/dist-cjs/index.js',
      'node_modules/@ontime/remote-viewer-contracts/package.json',
      'node_modules/left-pad/index.js',
      'src/main/main.ts',
      'dist/main/main.test.js',
      'dist/main/main.js.map',
      'dist/main/main.ts',
      'tsconfig.json',
      'electron-builder.yml',
    ]
    for (const entry of bad) expect(auditAsarEntries([...SHELL_ENTRIES, entry]), entry).not.toEqual([])
  })

  it('rejects ppt-probe, helpers, COM/PowerShell glue, and native payloads', () => {
    const bad = [
      'bin/ppt-probe.exe',
      'dist/main/ppt-probe.js',
      'dist/main/powerpoint-helper.js',
      'dist/main/com-bridge.js',
      'dist/main/probe.ps1',
      'dist/main/build/Release/addon.node',
      'dist/main/helper.dll',
      'dist/main/helper.exe',
      'dist/main/native/addon.cc',
    ]
    for (const entry of bad) expect(auditAsarEntries([...SHELL_ENTRIES, entry]), entry).not.toEqual([])
  })

  it('requires the shell entry points to be present', () => {
    expect(auditAsarEntries(SHELL_ENTRIES.filter((entry) => entry !== 'dist/preload/preload.js'))).toEqual([
      'missing required entry: dist/preload/preload.js',
    ])
    expect(auditAsarEntries([])).toContain('missing required entry: package.json')
  })

  it('passes on the real build output when it has been built', () => {
    if (!existsSync(path.join(distRoot, 'main/main.js'))) return // build runs before dist/audit; tests may run first
    const selected = ['package.json', ...walk(distRoot).map((file) => `dist/${file}`)].filter(
      (file) => !/\.map$|\.test\./.test(file),
    )
    expect(auditAsarEntries(selected)).toEqual([])
  })
})

describe('Windows unpacked app audit (S8c no-helper)', () => {
  const win = (extra: string[] = []): string[] => [
    'Downstage View.exe',
    'ffmpeg.dll',
    'libEGL.dll',
    'chrome_100_percent.pak',
    'locales/en-US.pak',
    'resources/app.asar',
    ...extra,
  ]

  it('accepts one app exe and a bare resources/app.asar', () => {
    expect(auditUnpackedApp(win(), { platform: 'win32' })).toEqual([])
  })

  it('rejects any other .exe, ppt-probe, extraResources, or unpacked asar content', () => {
    for (const extra of [
      'resources/bin/ppt-probe.exe',
      'resources/ppt-probe.exe',
      'ppt-probe.exe',
      'helper.exe',
      'resources/helper.exe',
      'resources/bin/helper.txt',
      'resources/app.asar.unpacked/native.node',
      'resources/something.dll',
      'resources/extra.json',
      'resources/elevate.exe',
    ]) {
      expect(auditUnpackedApp(win([extra]), { platform: 'win32' }), extra).not.toEqual([])
    }
  })

  it('rejects a missing or renamed app exe and a missing asar', () => {
    expect(auditUnpackedApp(win().filter((f) => f !== 'Downstage View.exe'), { platform: 'win32' })).not.toEqual([])
    expect(auditUnpackedApp(win().filter((f) => f !== 'resources/app.asar'), { platform: 'win32' })).not.toEqual([])
  })
})

describe('macOS unpacked app audit', () => {
  const mac = (extra: string[] = []): string[] => [
    'Downstage View.app/Contents/Info.plist',
    'Downstage View.app/Contents/MacOS/Downstage View',
    'Downstage View.app/Contents/Resources/app.asar',
    'Downstage View.app/Contents/Resources/electron.icns',
    'Downstage View.app/Contents/Resources/en.lproj/InfoPlist.strings',
    'Downstage View.app/Contents/Frameworks/Electron Framework.framework/Electron Framework',
    'Downstage View.app/Contents/Frameworks/Downstage View Helper.app/Contents/MacOS/Downstage View Helper',
    ...extra,
  ]

  it('accepts the Electron bundle with only app.asar as app payload', () => {
    expect(auditUnpackedApp(mac(), { platform: 'darwin' })).toEqual([])
  })

  it('rejects helpers, unpacked asar, native modules, and ppt-probe in Resources', () => {
    for (const extra of [
      'Downstage View.app/Contents/Resources/bin/ppt-probe.exe',
      'Downstage View.app/Contents/Resources/app.asar.unpacked/x.node',
      'Downstage View.app/Contents/Resources/helper',
      'Downstage View.app/Contents/Resources/native.node',
      'Downstage View.app/Contents/MacOS/ppt-probe',
    ]) {
      expect(auditUnpackedApp(mac([extra]), { platform: 'darwin' }), extra).not.toEqual([])
    }
  })
})
