import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = path.resolve(__dirname, '../..')
const configText = readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8')

// Strip full-line YAML comments so documentation prose (which may legitimately
// mention "Companion" as a cross-reference) does not affect the security/
// allowlist assertions. Inline active config is what gets bundled.
const activeConfig = configText
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

// Forbidden cross-product assets. The standalone is a strict Windows-only viewer
// of PowerPoint state; it must never bundle Companion/frontend/viewer/cloud/socket
// runtime (boundary rule `ppt-timer-standalone`).
const FORBIDDEN_REFERENCES = [
  'companion',
  'frontend',
  'viewer',
  'firebase',
  'cloud',
  'socket.io',
  'functions',
]

describe('packaged installer content (security / allowlist)', () => {
  it('declares the helper exactly once, from the canonical output, to resources/bin', () => {
    // Exactly one extraResources source (one helper copy -> resources/bin).
    const fromMatches = activeConfig.match(/from:\s*\S+/g) ?? []
    expect(fromMatches.length).toBe(1)
    expect(activeConfig).toContain('from: ../../packages/ppt-bridge/bin/win-x64')
    // Packaged under resources/bin (matches Companion's packaged path).
    expect(activeConfig).toMatch(/to:\s*bin\b/)
    // Filter guarantees only ppt-probe.exe.
    expect(activeConfig).toMatch(/filter:\s*\n\s*-\s*ppt-probe\.exe\b/)
    // The workspace runtime dependency must not contribute generated helper
    // outputs; the canonical extraResource above is the only shipped copy.
    expect(activeConfig).toContain("!node_modules/@ontime/ppt-bridge/bin/**")
    expect(activeConfig).toContain("!node_modules/@ontime/ppt-bridge/native/**")
  })

  it('ships production app code, explicit node_modules (Controller convention), and package.json', () => {
    // electron-builder always copies production-dependency node_modules
    // regardless of `files`; list it explicitly (matching Controller/Companion)
    // rather than rely on that implicit default silently for a workspace app
    // whose runtime deps (@ontime/ppt-bridge, @ontime/presentation-core) are
    // hoisted/symlinked, not local to apps/ppt-timer/node_modules.
    expect(activeConfig).toMatch(/- dist\/\*\*\/\*/)
    expect(activeConfig).toMatch(/- node_modules\/\*\*\/\*/)
    expect(activeConfig).toContain('- package.json')
  })

  it('excludes build-only dist/main/build-manifest.js from the packaged app', () => {
    expect(activeConfig).toMatch(/!dist\/main\/build-manifest\.js/)
  })

  it('never bundles a whole workspace directory blindly (no unscoped packages/* glob)', () => {
    // Every packages/ or node_modules/@ontime reference must name a specific
    // package (ppt-bridge/presentation-core); a bare wildcard would silently
    // sweep in every workspace, including forbidden ones.
    expect(activeConfig).not.toMatch(/packages\/\*(?!\*)/)
    expect(activeConfig).not.toMatch(/\.\.\/\.\.\/packages\/(?!ppt-bridge)/)
  })

  it('references no Companion/frontend/viewer/cloud/socket assets in active config', () => {
    for (const forbidden of FORBIDDEN_REFERENCES) {
      expect(activeConfig.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('app package.json declares only the allowed @ontime runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const deps = Object.keys(pkg.dependencies ?? {})
    expect(deps.sort()).toEqual(['@ontime/ppt-bridge', '@ontime/presentation-core'])
  })

  it('app package.json devDependencies pin electron and electron-builder to exact versions', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
      devDependencies?: { '@electron/asar'?: string; 'electron-builder'?: string; electron?: string }
    }
    // Release-toolchain policy: exact (non-range) pins for the packaging toolchain,
    // so a lockfile-only bump can never silently change what `npm run dist` produces.
    // Stage 6 H6 remediation (P1-08): pinned to a currently supported Electron
    // major (latest three stable majors per https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
    // and its compatible latest-stable Electron Builder line (not the v27 next/breaking line).
    expect(pkg.devDependencies?.['@electron/asar']).toBe('3.4.1')
    expect(pkg.devDependencies?.['electron-builder']).toBe('26.11.1')
    expect(pkg.devDependencies?.electron).toBe('43.2.0')
    expect(pkg.devDependencies?.['electron-builder']).not.toMatch(/^[\^~]/)
    expect(pkg.devDependencies?.electron).not.toMatch(/^[\^~]/)
  })

  it('uses package-backed Electron and helper payload versions, not disconnected constants', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string }
    const config = readFileSync(path.join(appRoot, 'src/main/config.ts'), 'utf8')
    const main = readFileSync(path.join(appRoot, 'src/main/main.ts'), 'utf8')
    expect(pkg.version).toMatch(/^0\.1\.0-beta\.1$/)
    expect(config).not.toContain('APP_VERSION')
    expect(config).not.toContain('HELPER_VERSION')
    expect(main).toContain('appVersion: app.getVersion()')
    expect(main).toContain('helperVersion: host.getHelperVersion() ?? app.getVersion()')
  })
})
