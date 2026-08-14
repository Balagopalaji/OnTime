import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildStoreArtifactName,
  patchAppxManifestVersion,
  validateStorePackageVersion,
} from './store-package-version'

const appRoot = path.resolve(__dirname, '../..')

describe('provisional Store package version', () => {
  it('keeps a separately reviewed nonzero dot-quad with Store-reserved revision zero', () => {
    const config = JSON.parse(readFileSync(path.join(appRoot, 'store-package.json'), 'utf8')) as {
      version?: unknown
      status?: unknown
    }
    expect(config.status).toBe('provisional-store-feasibility')
    expect(validateStorePackageVersion(config.version)).toBe('1.0.1.0')
  })

  it.each([
    '0.1.0.0',
    '1.0.0.1',
    '1.0.0',
    '1.0.beta.0',
    '65536.0.0.0',
    '1.65536.0.0',
  ])('rejects non-Store package version %s', (version) => {
    expect(() => validateStorePackageVersion(version)).toThrow()
  })

  it('patches only the package Identity version', () => {
    const manifest = '<Package><Identity Name="Example" Version="0.1.0.0"/><Other Version="9.9.9.9"/></Package>'
    expect(patchAppxManifestVersion(manifest, '1.0.0.0')).toBe(
      '<Package><Identity Name="Example" Version="1.0.0.0"/><Other Version="9.9.9.9"/></Package>',
    )
  })

  it('includes the independent Store version in the artifact filename', () => {
    expect(buildStoreArtifactName('0.1.0-beta.1', '1.0.1.0')).toBe(
      'Downstage-PPT-Video-Timer-0.1.0-beta.1-win-x64-store-v1.0.1.0.appx',
    )
    expect(() => buildStoreArtifactName('../beta', '1.0.1.0')).toThrow(
      'Application version must be safe for the Store artifact filename',
    )
  })

  it('rejects a manifest without an Identity version', () => {
    expect(() => patchAppxManifestVersion('<Package/>', '1.0.0.0')).toThrow(
      'AppxManifest.xml is missing Identity Version',
    )
  })
})
