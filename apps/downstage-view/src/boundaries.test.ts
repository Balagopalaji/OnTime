import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = __dirname
const appRoot = join(here, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Code only: comments may legitimately name what the viewer must not contain. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
const code = (file: string) => stripComments(readFileSync(file, 'utf8'))

const posix = (path: string) => path.split('\\').join('/')
const rel = (file: string) => posix(relative(here, file))

const sources = walk(here).filter((file) => /\.(ts|html|css)$/.test(file) && !/\.test\.ts$/.test(file))
const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>

/** Anything that would make the viewer a PowerPoint host, a publisher, or a controller. */
const FORBIDDEN = [
  /@ontime\/(?!downstage-view)/,
  /ppt-bridge/i,
  /presentation-core/i,
  /ppt-probe/i,
  /powerpoint/i,
  /publisher/i,
  /sidecar/i,
  /\bCOM\b/,
  /ffi-napi|koffi|edge-js|winax|node-addon/i,
  /firebase/i,
  /socket\.io/i,
  /apps\/ppt-timer/,
  /local-sync|interface-contracts|companion/i,
  /child_process|utilityProcess|\bspawn\(/,
]

describe('Downstage View boundaries (RPV-005)', () => {
  it('finds its own sources', () => {
    expect(sources.map((file) => rel(file)).sort()).toEqual(
      expect.arrayContaining(['main/main.ts', 'preload/preload.ts', 'renderer/index.html', 'renderer/launcher.ts']),
    )
  })

  it.each(FORBIDDEN.map((pattern) => [String(pattern), pattern] as const))('no source references %s', (_name, pattern) => {
    const offenders = sources.filter((file) => pattern.test(code(file))).map((file) => rel(file))
    expect(offenders).toEqual([])
  })

  it('declares no runtime dependencies and no workspace package at all', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(Object.keys(manifest[section] ?? {}).filter((name) => name.startsWith('@ontime/'))).toEqual([])
    }
  })

  it('does not reimplement the timer or its face (reuses the hosted viewer route)', () => {
    const offenders = sources.filter((file) => /timer-face|remote-viewer-contracts|elapsedOffset|remainingMs|setInterval/.test(code(file)))
    expect(offenders.map((file) => rel(file))).toEqual([])
  })

  it('grants no control authority: no ipcMain handler beyond the launcher bridge, no shell/clipboard writes', () => {
    for (const file of sources.filter((item) => posix(item).includes('/main/'))) {
      const text = code(file)
      expect(text, rel(file)).not.toMatch(/shell\.openExternal|clipboard\.write|ipcMain\.on\(/)
    }
  })
})
