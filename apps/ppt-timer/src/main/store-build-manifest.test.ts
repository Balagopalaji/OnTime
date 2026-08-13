import { describe, expect, it } from 'vitest'
import {
  extractStorePackageIdentity,
  formatManifestJson,
  generateStorePackageManifest,
} from './build-manifest'

const MANIFEST = `<?xml version="1.0"?>
<Package xmlns:rescap="urn:test">
  <Identity Name="OnTime.PptVideoTimer.Feasibility" ProcessorArchitecture="x64"
    Publisher='CN=OnTime Store Feasibility' Version="1.0.0.0" />
  <Properties>
    <DisplayName>OnTime PowerPoint Video Timer</DisplayName>
    <PublisherDisplayName>OnTime Store Feasibility</PublisherDisplayName>
  </Properties>
  <Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>
  <Applications><Application Id="OnTime.PptVideoTimer.Feasibility" /></Applications>
</Package>`

describe('Store feasibility build manifest', () => {
  it('extracts exact identity and the one allowed capability from the real manifest shape', () => {
    expect(extractStorePackageIdentity(MANIFEST)).toEqual({
      name: 'OnTime.PptVideoTimer.Feasibility',
      publisher: 'CN=OnTime Store Feasibility',
      version: '1.0.0.0',
      architecture: 'x64',
      applicationId: 'OnTime.PptVideoTimer.Feasibility',
      displayName: 'OnTime PowerPoint Video Timer',
      publisherDisplayName: 'OnTime Store Feasibility',
      capabilities: ['runFullTrust'],
    })
  })

  it('rejects an additional capability', () => {
    const expanded = MANIFEST.replace(
      '</Capabilities>',
      '<Capability Name="internetClient"/></Capabilities>',
    )
    expect(() => extractStorePackageIdentity(expanded)).toThrow(
      'capabilities must be exactly runFullTrust',
    )
  })

  it('builds a deterministic manifest explicitly marked unsigned and not Store-ready', () => {
    const identity = extractStorePackageIdentity(MANIFEST)
    const result = generateStorePackageManifest({
      appVersion: '0.1.0-beta.1',
      storePackageVersion: '1.0.0.0',
      artifact: 'timer-store-feasibility.appx',
      artifactSha256: 'abc123',
      helperProductVersion: '0.1.0-beta.1',
      helperFileVersion: '0.1.0.1',
      helperTarget: 'net10.0-windows',
      identity,
    })
    expect(result).toMatchObject({
      packageFormat: 'appx-msix-family',
      signingState: 'unsigned-feasibility',
      readiness: 'not-store-ready',
      helperArchivePath: 'app/resources/bin/ppt-probe.exe',
      helperRuntimePath: 'resources/bin/ppt-probe.exe',
    })
    expect(formatManifestJson(result)).toBe(formatManifestJson(result))
  })

  it('rejects a package version that differs from the inspected identity', () => {
    expect(() => generateStorePackageManifest({
      appVersion: '0.1.0-beta.1',
      storePackageVersion: '1.0.1.0',
      artifact: 'timer.appx',
      artifactSha256: 'abc123',
      helperProductVersion: '0.1.0-beta.1',
      helperFileVersion: '0.1.0.1',
      helperTarget: 'net10.0-windows',
      identity: extractStorePackageIdentity(MANIFEST),
    })).toThrow('must match inspected manifest identity')
  })
})
