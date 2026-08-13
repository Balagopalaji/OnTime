import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractAppVersion,
  extractElectronVersion,
  extractHelperTarget,
  formatManifestJson,
  formatSha256File,
  generateInstallerManifest,
  sha256Hex,
  verifyHelperVersion,
} from './build-manifest'

const appRoot = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(appRoot, '../..')

describe('build manifest + checksum helpers', () => {
  it('reads the version from package.json text (version as source)', () => {
    expect(extractAppVersion('{"version":"1.2.3"}')).toBe('1.2.3')
    expect(() => extractAppVersion('{"version":42}')).toThrow()
    expect(() => extractAppVersion('{}')).toThrow()
  })

  it('reads the electron devDependency version from package.json text', () => {
    expect(
      extractElectronVersion('{"devDependencies":{"electron":"^31.7.4"}}'),
    ).toBe('^31.7.4')
    expect(() => extractElectronVersion('{}')).toThrow()
  })

  it('extracts the helper <TargetFramework> from csproj text', () => {
    expect(
      extractHelperTarget(
        '<Project><PropertyGroup><TargetFramework>net10.0-windows</TargetFramework></PropertyGroup></Project>',
      ),
    ).toBe('net10.0-windows')
    expect(
      extractHelperTarget('<TargetFramework>\n  net6.0-windows \n</TargetFramework>'),
    ).toBe('net6.0-windows')
    expect(() => extractHelperTarget('<Project />')).toThrow()
  })

  it('records only an independently verified helper version that exactly matches the app', () => {
    expect(verifyHelperVersion('0.1.0-beta.1', '0.1.0-beta.1')).toBe('0.1.0-beta.1')
    expect(() => verifyHelperVersion('0.1.0-beta.1', undefined)).toThrow('verified helper version is required')
    expect(() => verifyHelperVersion('0.1.0-beta.1', '0.1.0-beta.1+revision')).toThrow('does not match')
  })

  it('computes lowercase hex SHA-256 matching the known digest of "abc"', () => {
    expect(sha256Hex(Buffer.from('abc', 'utf8'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('formats a deterministic sha256 checksum file body', () => {
    expect(formatSha256File('setup.exe', 'deadbeef')).toBe('deadbeef *setup.exe\n')
    expect(formatSha256File('setup.exe', 'deadbeef')).toBe('deadbeef *setup.exe\n')
  })

  it('assembles a deterministic manifest pinned to the canonical packaged helper path', () => {
    const input = {
      version: '0.1.0',
      helperVersion: '0.1.0',
      electronVersion: '^31.7.4',
      helperTarget: 'net10.0-windows',
      artifact: 'OnTime-PowerPoint-Video-Timer-0.1.0-win-x64-setup.exe',
      artifactSha256: 'cafebabe',
    }
    const manifest = generateInstallerManifest(input)
    expect(manifest).toEqual({
      product: 'OnTime PowerPoint Video Timer',
      version: '0.1.0',
      helperVersion: '0.1.0',
      artifact: input.artifact,
      artifactSha256: 'cafebabe',
      architecture: 'win-x64',
      installer: 'nsis-assisted-per-user',
      electronVersion: '^31.7.4',
      helperTarget: 'net10.0-windows',
      helperArtifact: 'ppt-probe.exe',
      helperPath: 'resources/bin/ppt-probe.exe',
      signingState: 'unsigned',
    })
  })

  it('is deterministic: identical inputs yield deep-equal manifests (no time/random)', () => {
    const input = {
      version: '0.1.0',
      helperVersion: '0.1.0',
      electronVersion: '^31.7.4',
      helperTarget: 'net10.0-windows',
      artifact: 'setup.exe',
      artifactSha256: 'aa',
    }
    expect(generateInstallerManifest(input)).toEqual(generateInstallerManifest(input))
  })

  it('formats the manifest JSON with keys in true alphabetical order and a trailing newline', () => {
    const manifest = generateInstallerManifest({
      version: '0.1.0',
      helperVersion: '0.1.0',
      electronVersion: '31.7.7',
      helperTarget: 'net10.0-windows',
      artifact: 'setup.exe',
      artifactSha256: 'aa',
    })
    const json = formatManifestJson(manifest)
    const keysInOutputOrder = [...json.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1])
    expect(keysInOutputOrder).toEqual([...keysInOutputOrder].sort())
    expect(keysInOutputOrder).toEqual(Object.keys(manifest).sort())
    expect(json.endsWith('\n')).toBe(true)
    expect(json.endsWith('\n\n')).toBe(false)
    expect(formatManifestJson(manifest)).toBe(json)
  })

  it('reads real source values for version + electron from the app package.json', () => {
    const pkg = readFileSync(path.join(appRoot, 'package.json'), 'utf8')
    expect(extractAppVersion(pkg)).toMatch(/^0\.1\.0-beta\.1$/)
    expect(extractElectronVersion(pkg)).toBe('43.2.0')
  })

  it('executes the real manifest entrypoint with a filesystem module path', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'ontime-manifest-'))
    try {
      const distOut = path.join(tempRoot, 'dist_out')
      mkdirSync(distOut)
      const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
        version: string
      }
      const installer = 'OnTime-PowerPoint-Video-Timer-' + pkg.version + '-win-x64-setup.exe'
      writeFileSync(path.join(distOut, installer), Buffer.from('manifest integration smoke', 'utf8'))

      const modulePath = path.join(tempRoot, 'build-manifest.js')
      writeFileSync(
        modulePath,
        [
          "import { createHash } from 'node:crypto'",
          'export const extractAppVersion = (text) => JSON.parse(text).version',
          'export const extractElectronVersion = (text) => JSON.parse(text).devDependencies.electron',
          "export const extractHelperTarget = (text) => text.match(/<TargetFramework>\\s*([^<\\s]+)\\s*<\\/TargetFramework>/)[1]",
          "export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')",
          "export const formatSha256File = (name, hash) => hash + ' *' + name + '\\n'",
          "export const generateInstallerManifest = (input) => ({ product: 'OnTime PowerPoint Video Timer', version: input.version, helperVersion: input.helperVersion, artifact: input.artifact, artifactSha256: input.artifactSha256, architecture: 'win-x64', installer: 'nsis-assisted-per-user', electronVersion: input.electronVersion, helperTarget: input.helperTarget, helperArtifact: 'ppt-probe.exe', helperPath: 'resources/bin/ppt-probe.exe', signingState: 'unsigned' })",
          "export const verifyHelperVersion = (expected, verified) => { if (!verified) throw new Error('verified helper version is required'); if (expected !== verified) throw new Error('does not match'); return verified }",
          "export const formatManifestJson = (manifest) => JSON.stringify(manifest, Object.keys(manifest).sort(), 2) + '\\n'",
          '',
        ].join('\n'),
      )

      execFileSync(process.execPath, [path.join(appRoot, 'scripts/build-manifest.mjs')], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ONTIME_PPT_TIMER_DIST_OUT: distOut,
          ONTIME_PPT_TIMER_BUILD_MANIFEST_MODULE: modulePath,
          ONTIME_PPT_TIMER_VERIFIED_HELPER_VERSION: pkg.version,
        },
        stdio: 'pipe',
      })

      const manifestText = readFileSync(path.join(distOut, 'build.manifest.json'), 'utf8')
      expect(manifestText).toContain('"helperVersion": "' + pkg.version + '"')
      expect(readFileSync(path.join(distOut, installer) + '.sha256', 'utf8')).toMatch(
        /^[0-9a-f]{64} \*.+-setup\.exe\n$/,
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
