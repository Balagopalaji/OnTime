import { existsSync, statSync } from 'node:fs'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { emitDiagnostic, type BridgeDiagnosticSink } from './diagnostics.js'
import { validatePowerPointResponse } from './validate-response.js'
import {
  MAX_RESPONSE_BYTES,
  type BridgePollOutcome,
  type HelperLaunchCandidate,
  type ValidationWarning,
} from './protocol.js'

type SpawnProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

type Pending = {
  promise: Promise<BridgePollOutcome>
  resolve: (outcome: BridgePollOutcome) => void
  timer?: NodeJS.Timeout
  generation?: number
}

export type PptBridgeClientOptions = {
  executableCandidates: readonly HelperLaunchCandidate[]
  pollTimeoutMs?: number
  shutdownGraceMs?: number
  restartBackoffMs?: readonly number[]
  diagnostics?: BridgeDiagnosticSink
  spawnProcess?: SpawnProcess
}

export type PptBridgeClient = {
  poll(): Promise<BridgePollOutcome>
  close(): Promise<void>
}

const emptyExtensions = {
  rootUnknownFieldCount: 0,
  videoUnknownFieldCount: 0,
  editSlideVideoUnknownFieldCount: 0,
}

function outcomeBase() {
  return { warnings: [] as ValidationWarning[], extensions: { ...emptyExtensions } }
}

function signalCategory(signal: NodeJS.Signals | null): 'sigterm' | 'sigkill' | 'other' | undefined {
  if (signal === 'SIGTERM') return 'sigterm'
  if (signal === 'SIGKILL') return 'sigkill'
  if (signal) return 'other'
  return undefined
}

export class PptBridgeClientImpl implements PptBridgeClient {
  private readonly candidates: readonly HelperLaunchCandidate[]
  private readonly pollTimeoutMs: number
  private readonly shutdownGraceMs: number
  private readonly restartBackoffMs: readonly number[]
  private readonly diagnostics?: BridgeDiagnosticSink
  private readonly spawnProcess: SpawnProcess
  private child: ChildProcess | null = null
  private generation = 0
  private stdoutBuffer = Buffer.alloc(0)
  private pending: Pending | null = null
  private restartAttempt = 0
  private restartTimer: NodeJS.Timeout | null = null
  private restartResolve: (() => void) | null = null
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(options: PptBridgeClientOptions) {
    this.candidates = options.executableCandidates
    this.pollTimeoutMs = options.pollTimeoutMs ?? 8_000
    this.shutdownGraceMs = options.shutdownGraceMs ?? 500
    this.restartBackoffMs = options.restartBackoffMs?.length ? options.restartBackoffMs : [1_000, 2_000, 5_000]
    this.diagnostics = options.diagnostics
    this.spawnProcess = options.spawnProcess ?? ((path, args, spawnOptions) => nodeSpawn(path, [...args], spawnOptions))
  }

  poll(): Promise<BridgePollOutcome> {
    if (this.closed) return Promise.resolve({ kind: 'closed', ...outcomeBase() })
    if (this.pending) return this.pending.promise

    let resolve!: (outcome: BridgePollOutcome) => void
    const promise = new Promise<BridgePollOutcome>((res) => {
      resolve = res
    })
    this.pending = { promise, resolve }
    void this.beginPoll(this.pending)
    return promise
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    emitDiagnostic(this.diagnostics, { kind: 'helper_close', phase: 'requested' })
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.restartResolve?.()
    this.restartResolve = null
    const pending = this.pending
    if (pending) this.settle(pending, { kind: 'closed', ...outcomeBase() })
    const child = this.child
    this.closePromise = child ? this.shutdownChild(child) : Promise.resolve()
    return this.closePromise
  }

  private async beginPoll(pending: Pending): Promise<void> {
    if (this.closed) {
      this.settle(pending, { kind: 'closed', ...outcomeBase() })
      return
    }

    if (this.restartAttempt > 0) {
      const delay = this.restartBackoffMs[Math.min(this.restartAttempt - 1, this.restartBackoffMs.length - 1)] ?? 0
      emitDiagnostic(this.diagnostics, { kind: 'helper_restart', attempt: this.restartAttempt, delayMs: delay })
      await new Promise<void>((resolve) => {
        this.restartResolve = resolve
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          this.restartResolve = null
          resolve()
        }, delay)
      })
      if (this.closed) {
        this.settle(pending, { kind: 'closed', ...outcomeBase() })
        return
      }
    }

    if (this.child && !this.child.killed && this.child.exitCode === null) {
      this.sendPoll(pending, this.generation)
      return
    }

    const candidate = this.candidates.find((item) => {
      try {
        return existsSync(item.executablePath) && statSync(item.executablePath).isFile()
      } catch {
        return false
      }
    })
    if (!candidate) {
      this.restartAttempt = Math.min(this.restartAttempt + 1, this.restartBackoffMs.length)
      this.settle(pending, { kind: 'helper_missing', ...outcomeBase() })
      return
    }

    if (!this.startChild(candidate)) {
      this.settle(pending, { kind: 'process_exit', generation: this.generation, ...outcomeBase() })
      return
    }
    this.sendPoll(pending, this.generation)
  }

  private startChild(candidate: HelperLaunchCandidate): boolean {
    const generation = ++this.generation
    this.stdoutBuffer = Buffer.alloc(0)
    let child: ChildProcess
    try {
      child = this.spawnProcess(candidate.executablePath, candidate.args ?? [], {
        stdio: 'pipe',
        windowsHide: true,
      })
    } catch {
      this.restartAttempt = Math.min(this.restartAttempt + 1, this.restartBackoffMs.length)
      return false
    }

    this.child = child
    emitDiagnostic(this.diagnostics, { kind: 'helper_start', generation })
    child.stdout?.on('data', (chunk: Buffer | string) => this.onStdout(generation, chunk))
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.child !== child || this.generation !== generation) return
      const byteCount = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
      emitDiagnostic(this.diagnostics, { kind: 'helper_stderr', generation, byteCount })
    })
    child.once('error', () => {
      if (this.child !== child || this.generation !== generation) return
      this.failGeneration(generation, { kind: 'process_exit', generation, ...outcomeBase() })
    })
    child.once('exit', (code, signal) => {
      const expected = this.closed
      emitDiagnostic(this.diagnostics, { kind: 'helper_exit', generation, expected, ...(code === null ? {} : { code }), ...(signalCategory(signal) ? { signal: signalCategory(signal) } : {}) })
      if (this.child !== child || this.generation !== generation) return
      this.child = null
      this.stdoutBuffer = Buffer.alloc(0)
      if (!this.closed) this.restartAttempt = Math.min(this.restartAttempt + 1, this.restartBackoffMs.length)
      if (this.pending?.generation === generation) {
        this.settle(this.pending, { kind: 'process_exit', generation, ...(code === null ? {} : { code }), ...outcomeBase() })
      }
    })
    return true
  }

  private sendPoll(pending: Pending, generation: number): void {
    const child = this.child
    if (this.closed || !child || this.generation !== generation || child.exitCode !== null) {
      this.settle(pending, this.closed ? { kind: 'closed', ...outcomeBase() } : { kind: 'process_exit', generation, ...outcomeBase() })
      return
    }
    pending.generation = generation
    pending.timer = setTimeout(() => {
      if (this.pending !== pending || this.generation !== generation) return
      emitDiagnostic(this.diagnostics, { kind: 'helper_timeout', generation, timeoutMs: this.pollTimeoutMs })
      this.failGeneration(generation, { kind: 'timeout', generation, ...outcomeBase() })
    }, this.pollTimeoutMs)

    try {
      child.stdin?.write('poll\n', (error?: Error | null) => {
        if (error && this.pending === pending && this.generation === generation) {
          this.failGeneration(generation, { kind: 'process_exit', generation, ...outcomeBase() })
        }
      })
    } catch {
      this.failGeneration(generation, { kind: 'process_exit', generation, ...outcomeBase() })
    }
  }

  private onStdout(generation: number, chunk: Buffer | string): void {
    if (!this.child || this.generation !== generation) return
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    if (this.stdoutBuffer.length > MAX_RESPONSE_BYTES + 1 && !this.stdoutBuffer.includes(10)) {
      this.failGeneration(generation, { kind: 'oversized_response', generation, ...outcomeBase() })
      return
    }
    let newline = this.stdoutBuffer.indexOf(10)
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      const trimmed = line[line.length - 1] === 13 ? line.subarray(0, line.length - 1) : line
      if (!this.pending || this.pending.generation !== generation) {
        this.failGeneration(generation, { kind: 'invalid_payload', generation, ...outcomeBase() })
        return
      }
      const outcome = validatePowerPointResponse(trimmed)
      this.emitValidationDiagnostics(outcome.warnings)
      if (outcome.kind === 'invalid_json' || outcome.kind === 'invalid_payload' || outcome.kind === 'oversized_response') {
        this.failGeneration(generation, { ...outcome, generation })
        return
      }
      if (outcome.kind === 'observation' || outcome.kind === 'powerpoint_not_running' || outcome.kind === 'no_slideshow' || outcome.kind === 'com_unavailable') {
        this.restartAttempt = 0
      }
      this.settle(this.pending, outcome)
      newline = this.stdoutBuffer.indexOf(10)
    }
    if (this.stdoutBuffer.length > MAX_RESPONSE_BYTES) {
      this.failGeneration(generation, { kind: 'oversized_response', generation, ...outcomeBase() })
    }
  }

  private emitValidationDiagnostics(warnings: ValidationWarning[]): void {
    for (const item of warnings) {
      emitDiagnostic(this.diagnostics, { kind: 'validation_warning', code: item.code, path: item.path })
    }
  }

  private settle(pending: Pending, outcome: BridgePollOutcome): void {
    if (this.pending !== pending) return
    if (pending.timer) clearTimeout(pending.timer)
    this.pending = null
    if (outcome.kind !== 'observation') {
      if (outcome.kind === 'powerpoint_not_running' || outcome.kind === 'no_slideshow' || outcome.kind === 'com_unavailable' || outcome.kind === 'helper_missing' || outcome.kind === 'timeout' || outcome.kind === 'process_exit' || outcome.kind === 'closed') {
        emitDiagnostic(this.diagnostics, { kind: 'availability', outcome: outcome.kind })
      } else if (outcome.kind === 'invalid_json' || outcome.kind === 'invalid_payload' || outcome.kind === 'oversized_response') {
        emitDiagnostic(this.diagnostics, { kind: 'output_failure', outcome: outcome.kind })
      }
    }
    pending.resolve(outcome)
  }

  private failGeneration(generation: number, outcome: BridgePollOutcome): void {
    if (this.generation !== generation) return
    const pending = this.pending?.generation === generation ? this.pending : null
    if (pending) this.settle(pending, outcome)
    const child = this.child
    this.child = null
    this.generation += 1
    this.stdoutBuffer = Buffer.alloc(0)
    if (child) {
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      child.removeAllListeners()
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }
    if (!this.closed) this.restartAttempt = Math.min(this.restartAttempt + 1, this.restartBackoffMs.length)
  }

  private async shutdownChild(child: ChildProcess): Promise<void> {
    const exited = new Promise<boolean>((resolve) => {
      let done = false
      const finish = (value: boolean) => {
        if (done) return
        done = true
        resolve(value)
      }
      const timer = setTimeout(() => finish(false), this.shutdownGraceMs)
      child.once('exit', () => {
        clearTimeout(timer)
        finish(true)
      })
      try { child.stdin?.write('exit\n') } catch { /* force below */ }
    })
    if (await exited) {
      emitDiagnostic(this.diagnostics, { kind: 'helper_close', phase: 'graceful' })
    } else {
      emitDiagnostic(this.diagnostics, { kind: 'helper_close', phase: 'forced' })
      try { child.kill('SIGKILL') } catch { /* already exited */ }
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    child.removeAllListeners()
    if (this.child === child) this.child = null
    this.stdoutBuffer = Buffer.alloc(0)
  }
}
