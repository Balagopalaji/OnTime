import { describe, expect, it } from 'vitest'
import { preloadBuildConfig } from '../../vite.preload.config'

type Chunk = { type: 'chunk'; fileName: string; code: string }
type BuildOutput = { output: Array<Chunk | { type: 'asset'; fileName: string }> }

describe('preload bundle', () => {
  it('is one self-contained CommonJS file that requires only electron (sandboxed preloads cannot load siblings)', async () => {
    const { build } = await import('vite')
    const result = (await build({
      ...preloadBuildConfig,
      configFile: false,
      build: { ...preloadBuildConfig.build, write: false },
    })) as unknown as BuildOutput | BuildOutput[]
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
    const chunks = outputs.filter((item): item is Chunk => item.type === 'chunk')
    expect(chunks.map((chunk) => chunk.fileName)).toEqual(['preload.js'])
    const code = chunks[0]?.code ?? ''
    const required = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
    expect([...new Set(required)]).toEqual(['electron'])
    expect(code).toContain('downstageView')
  }, 30_000)
})
