import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

// The one workspace package whose name legitimately contains a forbidden word
// ("viewer"): the dependency-free snapshot contracts the publisher sidecar loads at
// runtime (ISSUE-002). Everything else in the active config is still scanned.
const ALLOWED_RUNTIME_PACKAGE = '@ontime/remote-viewer-contracts'
// ISSUE-002 S9c: the sidecar's loopback LAN publisher is the one place a Socket.IO *client* runs in
// the standalone (`lan-socket.ts`; dependency-cruiser rule `ppt-timer-lan-transport`). It is a
// production dependency, not a devDependency, because the packaged utility process requires it.
// The Socket.IO server, Companion, and interface contracts remain forbidden.
const LAN_TRANSPORT_PACKAGE = 'socket.io-client'
const scannedConfig = activeConfig.split(ALLOWED_RUNTIME_PACKAGE).join('')

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
    // Only the named runtime packages may be mentioned under node_modules/@ontime.
    const named = [...activeConfig.matchAll(/node_modules\/@ontime\/([\w-]+)/g)].map((match) => match[1])
    expect([...new Set(named)].sort()).toEqual(['ppt-bridge', 'remote-viewer-contracts'])
  })

  it('references no Companion/frontend/viewer/cloud/socket assets in active config', () => {
    for (const forbidden of FORBIDDEN_REFERENCES) {
      expect(scannedConfig.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('app package.json declares only the allowed @ontime runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const deps = Object.keys(pkg.dependencies ?? {})
    // The publisher sidecar (utility process) and the main-process candidate adapter
    // load the contracts package at runtime, so it must ship (S6d), not be a devDependency.
    expect(deps.sort()).toEqual(['@ontime/ppt-bridge', '@ontime/presentation-core', ALLOWED_RUNTIME_PACKAGE, LAN_TRANSPORT_PACKAGE])
  })

  it('ships only the contracts package runtime payload (CJS build + package.json), not its sources or tests', () => {
    expect(activeConfig).toContain('!node_modules/@ontime/remote-viewer-contracts/src/**')
    expect(activeConfig).toContain('!node_modules/@ontime/remote-viewer-contracts/test/**')
    expect(activeConfig).not.toMatch(/!node_modules\/@ontime\/remote-viewer-contracts\/(dist-cjs|package\.json)/)
  })

  it('builds every runtime workspace package to CJS before the main compile', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    // powerpoint-display's build:cjs builds the contracts and timer-face CJS first.
    expect(pkg.scripts['build:cjs-deps']).toContain('@ontime/powerpoint-display')
    expect(readFileSync(path.join(appRoot, '../../packages/powerpoint-display/package.json'), 'utf8')).toContain(
      'npm run build:cjs --workspace @ontime/remote-viewer-contracts',
    )
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

  describe('publisher sidecar packaging (ISSUE-002 S6d)', () => {
    const srcMain = path.join(appRoot, 'src/main')
    const builtins = new Set(['electron'])
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    const packageName = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

    /** Runtime (non-type) module specifiers of a TypeScript source file. */
    const runtimeSpecifiers = (file: string): string[] => {
      const source = readFileSync(file, 'utf8')
      const found: string[] = []
      for (const [, typeOnly, clause, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s+'([^']+)'/g)) {
        if (typeOnly) continue
        const names = /^\{([^}]*)\}$/.exec(clause.trim())?.[1]
        if (names !== undefined && names.split(',').map((name) => name.trim()).filter(Boolean).every((name) => name.startsWith('type '))) continue
        found.push(spec)
      }
      for (const [, spec] of source.matchAll(/(?:import|require)\(\s*'([^']+)'\s*\)/g)) found.push(spec)
      return found
    }

    /** Bare specifiers reachable at runtime from the given entry sources. */
    const closure = (entries: string[]) => {
      const seen = new Set<string>()
      const bare = new Set<string>()
      const visit = (file: string) => {
        if (seen.has(file)) return
        seen.add(file)
        for (const spec of runtimeSpecifiers(file)) {
          if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec.replace(/\.js$/, '') + '.ts'))
          else if (!spec.startsWith('node:')) bare.add(packageName(spec))
        }
      }
      entries.forEach((entry) => visit(path.join(srcMain, entry)))
      return { files: [...seen], bare: [...bare].sort() }
    }

    it('declares every non-builtin module reachable from main and the sidecar worker as a production dependency', () => {
      const { bare } = closure(['main.ts', 'publisher-sidecar/worker.ts'])
      const missing = bare.filter((name) => !builtins.has(name) && !(name in pkg.dependencies))
      expect(missing).toEqual([])
      expect(bare).toContain(ALLOWED_RUNTIME_PACKAGE)
    })

    it('limits the sidecar worker to the contracts package and the LAN socket client (no Electron, helper, server, or child_process)', () => {
      const { bare, files } = closure(['publisher-sidecar/worker.ts'])
      expect(bare).toEqual([ALLOWED_RUNTIME_PACKAGE, LAN_TRANSPORT_PACKAGE])
      expect(files.some((file) => /session-host|helper-discovery|ppt-bridge/.test(file))).toBe(false)
    })

    it('starts the worker from the compiled main directory under the packaged dist glob', () => {
      const glue = readFileSync(path.join(srcMain, 'remote-share-electron.ts'), 'utf8')
      expect(glue).toContain("join(__dirname, 'publisher-sidecar/worker.js')")
      expect(existsSync(path.join(srcMain, 'publisher-sidecar/worker.ts'))).toBe(true)
      const build = JSON.parse(readFileSync(path.join(appRoot, 'tsconfig.build.json'), 'utf8')) as {
        compilerOptions: { rootDir: string; outDir: string }
        include: string[]
        exclude: string[]
      }
      expect(build.compilerOptions).toMatchObject({ rootDir: 'src', outDir: 'dist' })
      expect(build.include).toContain('src/main/**/*')
      // dist/main/publisher-sidecar/worker.js is inside `dist/**/*` and not excluded from the package.
      expect(activeConfig).toMatch(/- dist\/\*\*\/\*/)
      expect(activeConfig).not.toMatch(/!dist\/main\/publisher-sidecar/)
    })

    it('leaves protocol registration to the installer instead of the running app', () => {
      // electron-builder `protocols` owns the OS registration (NSIS per-user HKCU / AppX
      // extension); a runtime registration would also mutate the registry from dev or portable runs.
      const glue = readFileSync(path.join(srcMain, 'remote-share-electron.ts'), 'utf8')
      expect(glue).not.toContain('setAsDefaultProtocolClient')
      expect(glue).toContain("app.on('open-url'")
      expect(glue).toContain("app.on('second-instance'")
    })

    const builtMain = path.join(appRoot, 'dist/main')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry)
        return statSync(full).isDirectory() ? walk(full) : [full]
      })

    // Needs `npm run build --workspace apps/ppt-timer` (no Electron required).
    it.skipIf(!existsSync(path.join(builtMain, 'main.js')))('built dist contains the worker and requires only declared dependencies', () => {
      expect(existsSync(path.join(builtMain, 'publisher-sidecar/worker.js'))).toBe(true)
      expect(existsSync(path.join(builtMain, 'build-manifest.js'))).toBe(true) // present in dist, excluded from the package by config
      const required = new Set<string>()
      for (const file of walk(builtMain).filter((name) => name.endsWith('.js'))) {
        for (const [, spec] of readFileSync(file, 'utf8').matchAll(/require\("([^".][^"]*)"\)/g)) {
          if (!spec.startsWith('node:')) required.add(packageName(spec))
        }
      }
      expect([...required].filter((name) => !builtins.has(name) && !(name in pkg.dependencies))).toEqual([])
      expect(required.has(ALLOWED_RUNTIME_PACKAGE)).toBe(true)
      const worker = readFileSync(path.join(builtMain, 'publisher-sidecar/worker.js'), 'utf8')
      expect(worker).not.toMatch(/require\("(electron|child_process|node:child_process)"\)/)
    })
  })
})
