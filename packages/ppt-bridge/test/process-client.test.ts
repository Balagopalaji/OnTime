import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPptBridgeClient, type BridgeDiagnosticEvent } from '../src/index.js'

const helper = fileURLToPath(new URL('./fake-helper.mjs', import.meta.url))
const candidate = (mode: string, extra: string[] = []) => ({
  executablePath: process.execPath,
  args: [helper, '--mode', mode, ...extra],
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class ControlledChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  readonly killSignals: NodeJS.Signals[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  private terminated = false
  private input = ''

  constructor(options: { respondToPoll?: boolean; exitOnGraceful?: boolean; exitOnKill?: boolean } = {}) {
    super()
    this.stdin.on('data', (chunk: Buffer | string) => {
      this.input += chunk.toString()
      let newline = this.input.indexOf('\n')
      while (newline >= 0) {
        const line = this.input.slice(0, newline).trim().toLowerCase()
        this.input = this.input.slice(newline + 1)
        if (line === 'poll' && options.respondToPoll) {
          this.stdout.write(`${JSON.stringify({ state: 'foreground', instanceId: 7001, pptActive: true, inSlideshow: true })}\n`)
        } else if (line === 'exit' && options.exitOnGraceful) {
          this.terminate(0, null)
        }
        newline = this.input.indexOf('\n')
      }
    })
    this.on('request-kill', (signal: NodeJS.Signals) => {
      if (options.exitOnKill) this.terminate(null, signal)
    })
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true
    this.killSignals.push(signal)
    this.emit('request-kill', signal)
    return true
  }

  terminate(code: number | null = null, signal: NodeJS.Signals | null = 'SIGKILL'): void {
    if (this.terminated) return
    this.terminated = true
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
    this.emit('close', code, signal)
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

afterEach(() => vi.useRealTimers())

describe('PptBridgeClient', () => {
  it('starts lazily and returns one validated observation', async () => {
    const client = createPptBridgeClient({ executableCandidates: [candidate('valid')] })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
  })

  it('reuses one persistent helper across sequential polls', async () => {
    const diagnostics: BridgeDiagnosticEvent[] = []
    const client = createPptBridgeClient({ executableCandidates: [candidate('valid')], diagnostics: (event) => diagnostics.push(event) })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    expect(diagnostics.filter((event) => event.kind === 'helper_start')).toHaveLength(1)
    await client.close()
  })

  it('shares the exact pending promise for concurrent callers', async () => {
    const client = createPptBridgeClient({ executableCandidates: [candidate('delay', ['--delay', '20'])] })
    const first = client.poll()
    expect(client.poll()).toBe(first)
    await expect(first).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
  })

  it('records only materially slow helper polls for diagnostics', async () => {
    const diagnostics: BridgeDiagnosticEvent[] = []
    const client = createPptBridgeClient({
      executableCandidates: [candidate('delay', ['--delay', '300'])],
      pollTimeoutMs: 1_000,
      diagnostics: (event) => diagnostics.push(event),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })
    await client.close()
    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'poll_slow', outcome: 'observation' }))
  })

  it('types missing helpers, malformed output, invalid payload, and oversized output', async () => {
    const missing = createPptBridgeClient({ executableCandidates: [{ executablePath: '/definitely/missing/helper' }] })
    await expect(missing.poll()).resolves.toMatchObject({ kind: 'helper_missing' })
    await missing.close()

    for (const mode of ['malformed', 'invalid', 'oversized']) {
      // This case validates response classification, not timeout behavior.
      // Leave enough headroom for the oversized helper while other Vitest files
      // run native/CJS build checks in parallel on slower Windows hosts.
      const client = createPptBridgeClient({ executableCandidates: [candidate(mode)], pollTimeoutMs: 2_000 })
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
    await expect(client.poll()).resolves.toMatchObject({ kind: 'timeout' })
    await wait(100)
    await client.close()
    expect(diagnostics.filter((event) => event.kind === 'helper_start')).toHaveLength(2)
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
      pollTimeoutMs: 1_000,
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

  it('P1-04 blocks replacement until forced termination is confirmed by delayed exit', async () => {
    vi.useFakeTimers()
    const diagnostics: BridgeDiagnosticEvent[] = []
    const children: ControlledChild[] = []
    const spawnProcess = vi.fn(() => {
      const child = new ControlledChild({ respondToPoll: children.length > 0, exitOnGraceful: children.length > 0 })
      children.push(child)
      return child.asChildProcess()
    })
    const client = createPptBridgeClient({
      executableCandidates: [{ executablePath: process.execPath }],
      pollTimeoutMs: 5,
      forcedTerminationWaitMs: 50,
      restartBackoffMs: [0],
      diagnostics: (event) => diagnostics.push(event),
      spawnProcess,
    })

    const first = client.poll()
    await vi.advanceTimersByTimeAsync(5)
    await expect(first).resolves.toMatchObject({ kind: 'timeout' })
    const second = client.poll()
    await vi.advanceTimersByTimeAsync(10)
    expect(spawnProcess).toHaveBeenCalledTimes(1)

    children[0]?.terminate(null, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(0)
    await expect(second).resolves.toMatchObject({ kind: 'observation' })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(diagnostics).toContainEqual({
      kind: 'helper_termination',
      generation: 1,
      context: 'generation_failure',
      result: 'confirmed',
      waitMs: 50,
    })
    await client.close()
  })

  it('P1-04 emits bounded unconfirmed termination before allowing restart', async () => {
    vi.useFakeTimers()
    const diagnostics: BridgeDiagnosticEvent[] = []
    const children: ControlledChild[] = []
    const spawnProcess = vi.fn(() => {
      const child = new ControlledChild({ respondToPoll: children.length > 0, exitOnGraceful: children.length > 0 })
      children.push(child)
      return child.asChildProcess()
    })
    const client = createPptBridgeClient({
      executableCandidates: [{ executablePath: process.execPath }],
      pollTimeoutMs: 5,
      forcedTerminationWaitMs: 20,
      restartBackoffMs: [0],
      diagnostics: (event) => diagnostics.push(event),
      spawnProcess,
    })

    const first = client.poll()
    await vi.advanceTimersByTimeAsync(5)
    await expect(first).resolves.toMatchObject({ kind: 'timeout' })
    const second = client.poll()
    await vi.advanceTimersByTimeAsync(19)
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(diagnostics.some((event) => event.kind === 'helper_termination')).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    await expect(second).resolves.toMatchObject({ kind: 'observation' })
    expect(diagnostics).toContainEqual({
      kind: 'helper_termination',
      generation: 1,
      context: 'generation_failure',
      result: 'unconfirmed',
      waitMs: 20,
    })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    await client.close()
  })

  it('P1-04 forced close stays pending until delayed exit confirms termination', async () => {
    vi.useFakeTimers()
    const diagnostics: BridgeDiagnosticEvent[] = []
    const child = new ControlledChild({ respondToPoll: true })
    const client = createPptBridgeClient({
      executableCandidates: [{ executablePath: process.execPath }],
      shutdownGraceMs: 5,
      forcedTerminationWaitMs: 50,
      diagnostics: (event) => diagnostics.push(event),
      spawnProcess: () => child.asChildProcess(),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })

    let resolved = false
    const closing = client.close().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(5)
    expect(child.killSignals).toEqual(['SIGKILL'])
    expect(resolved).toBe(false)

    child.terminate(null, 'SIGKILL')
    await closing
    expect(diagnostics).toContainEqual({
      kind: 'helper_termination',
      generation: 1,
      context: 'close',
      result: 'confirmed',
      waitMs: 50,
    })
  })

  it('P1-04 forced close resolves only after a bounded unconfirmed diagnostic', async () => {
    vi.useFakeTimers()
    const diagnostics: BridgeDiagnosticEvent[] = []
    const child = new ControlledChild({ respondToPoll: true })
    const client = createPptBridgeClient({
      executableCandidates: [{ executablePath: process.execPath }],
      shutdownGraceMs: 5,
      forcedTerminationWaitMs: 20,
      diagnostics: (event) => diagnostics.push(event),
      spawnProcess: () => child.asChildProcess(),
    })
    await expect(client.poll()).resolves.toMatchObject({ kind: 'observation' })

    let resolved = false
    const closing = client.close().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(24)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(diagnostics).toContainEqual({
      kind: 'helper_termination',
      generation: 1,
      context: 'close',
      result: 'unconfirmed',
      waitMs: 20,
    })
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
