import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createPptBridgeClient, type BridgeDiagnosticEvent } from '../src/index.js'

const helper = fileURLToPath(new URL('./fake-helper.mjs', import.meta.url))
const candidate = (mode: string, extra: string[] = []) => ({
  executablePath: process.execPath,
  args: [helper, '--mode', mode, ...extra],
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('PptBridgeClient', () => {
  it('starts lazily and returns one validated observation', async () => {
    const client = createPptBridgeClient({ executableCandidates: [candidate('valid')] })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
  })

  it('shares the exact pending promise for concurrent callers', async () => {
    const client = createPptBridgeClient({ executableCandidates: [candidate('delay', ['--delay', '20'])] })
    const first = client.poll()
    expect(client.poll()).toBe(first)
    await expect(first).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
  })

  it('types missing helpers, malformed output, invalid payload, and oversized output', async () => {
    const missing = createPptBridgeClient({ executableCandidates: [{ executablePath: '/definitely/missing/helper' }] })
    await expect(missing.poll()).resolves.toMatchObject({ kind: 'helper_missing' })
    await missing.close()

    for (const mode of ['malformed', 'invalid', 'oversized']) {
      const client = createPptBridgeClient({ executableCandidates: [candidate(mode)], pollTimeoutMs: 200 })
      await expect(client.poll()).resolves.toMatchObject({ kind: mode === 'malformed' ? 'invalid_json' : mode === 'invalid' ? 'invalid_payload' : 'oversized_response' })
      await client.close()
    }
  })

  it('returns timeout, kills the obsolete generation, and ignores a late line', async () => {
    const diagnostics: BridgeDiagnosticEvent[] = []
    const client = createPptBridgeClient({
      executableCandidates: [candidate('late', ['--delay', '80'])],
      pollTimeoutMs: 15,
      restartBackoffMs: [1],
      diagnostics: (event) => diagnostics.push(event),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'timeout' })
    await wait(100)
    await client.close()
    expect(diagnostics.some((event) => event.kind === 'helper_timeout')).toBe(true)
  })

  it('sanitizes stderr diagnostics and closes idempotently with no helper left', async () => {
    const diagnostics: BridgeDiagnosticEvent[] = []
    const client = createPptBridgeClient({
      executableCandidates: [candidate('stderr')],
      diagnostics: (event) => diagnostics.push(event),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    const firstClose = client.close()
    expect(client.close()).toBe(firstClose)
    await firstClose
    expect(diagnostics.find((event) => event.kind === 'helper_stderr')).toMatchObject({ byteCount: expect.any(Number) })
    expect(JSON.stringify(diagnostics)).not.toContain('private diagnostic path')
    await expect(client.poll()).resolves.toMatchObject({ kind: 'closed' })
  })

  it('returns process_exit, then applies bounded restart before recovery', async () => {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'ppt-bridge-')), 'crash-once')
    writeFileSync(marker, '')
    const client = createPptBridgeClient({
      executableCandidates: [candidate('crash-once', ['--marker', marker])],
      pollTimeoutMs: 100,
      restartBackoffMs: [2],
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'process_exit' })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
  })

  it('settles a poll closed during restart backoff', async () => {
    const client = createPptBridgeClient({
      executableCandidates: [{ executablePath: '/definitely/missing/helper' }],
      restartBackoffMs: [100],
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'helper_missing' })
    const pending = client.poll()
    await client.close()
    await expect(pending).resolves.toMatchObject({ kind: 'closed' })
  })

  it('uses the forced close fallback when the helper ignores graceful exit', async () => {
    const diagnostics: BridgeDiagnosticEvent[] = []
    const client = createPptBridgeClient({
      executableCandidates: [candidate('ignore-exit')],
      shutdownGraceMs: 5,
      diagnostics: (event) => diagnostics.push(event),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
    expect(diagnostics).toContainEqual({ kind: 'helper_close', phase: 'forced' })
  })
})
