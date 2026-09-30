import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { inProcessSpawner, nodePort } from '../../../test/publisher-sidecar-harness'
import { createSidecarLauncher, type SpawnedSidecar } from './launcher'
import { createPublisherLifecycle, type PublisherStatus } from './lifecycle'
import { MAIN_TO_SIDECAR_KINDS, SIDECAR_TO_MAIN_KINDS } from './protocol'
import { createSidecarCore } from './sidecar-core'

const NONCE = 'n'.repeat(32)
const candidate = (observedAtMs: number) => ({
  schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs, availability: 'connecting', payload: null,
}) as const
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('sidecar core (runs in the utility process)', () => {
  function connect() {
    const { port1, port2 } = new MessageChannel()
    const exit = vi.fn()
    const core = createSidecarCore({ port: nodePort(port2), exit })
    const replies: Array<Record<string, unknown>> = []
    port1.on('message', (m) => replies.push(m))
    return { main: port1, core, exit, replies }
  }

  it('answers a valid HELLO with READY echoing the nonce, then acknowledges commands', async () => {
    const { main, core, replies } = connect()
    main.postMessage({ kind: 'HELLO', nonce: NONCE, protocolMajor: 1, maxMessageBytes: 65_536, capabilities: ['publish'] })
    main.postMessage({ kind: 'SHARE_START', nonce: NONCE, id: 1 })
    main.postMessage({ kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 2, candidate: candidate(1) })
    main.postMessage({ kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 3, candidate: candidate(2) })
    await tick()
    expect(replies).toEqual([
      { kind: 'READY', nonce: NONCE, protocolMajor: 1, capabilities: ['publish'] },
      { kind: 'SHARE_STATE', nonce: NONCE, state: 'sharing' },
      { kind: 'ACK', nonce: NONCE, id: 1 },
      { kind: 'ACK', nonce: NONCE, id: 2 },
      { kind: 'ACK', nonce: NONCE, id: 3 },
    ])
    // One latest candidate is kept; older ones are replaced, never queued.
    expect(core.latestCandidate()).toEqual(candidate(2))
    main.close()
  })

  it('refuses candidates while not sharing', async () => {
    const { main, replies } = connect()
    main.postMessage({ kind: 'HELLO', nonce: NONCE, protocolMajor: 1, maxMessageBytes: 65_536, capabilities: [] })
    main.postMessage({ kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 9, candidate: candidate(1) })
    await tick()
    expect(replies.at(-1)).toEqual({ kind: 'NACK', nonce: NONCE, id: 9, code: 'not-sharing' })
    main.close()
  })

  it.each([
    ['a non-HELLO first message', { kind: 'SHARE_START', nonce: NONCE, id: 1 }],
    ['an incompatible major', { kind: 'HELLO', nonce: NONCE, protocolMajor: 2, maxMessageBytes: 65_536, capabilities: [] }],
  ])('terminates on %s without replying', async (_label, first) => {
    const { main, exit, replies } = connect()
    main.postMessage(first)
    await tick()
    expect(replies).toEqual([])
    expect(exit).toHaveBeenCalledWith(2)
    main.close()
  })

  it('terminates the channel on a wrong nonce or an unknown kind after the handshake', async () => {
    for (const bad of [{ kind: 'SHARE_START', nonce: 'x'.repeat(32), id: 1 }, { kind: 'NEXT_SLIDE', nonce: NONCE, id: 1 }]) {
      const { main, exit } = connect()
      main.postMessage({ kind: 'HELLO', nonce: NONCE, protocolMajor: 1, maxMessageBytes: 65_536, capabilities: [] })
      main.postMessage(bad)
      await tick()
      expect(exit).toHaveBeenCalledWith(2)
      main.close()
    }
  })

  it('enforces the negotiated maximum size, measured in UTF-8 bytes', async () => {
    // Defect: HELLO advertises a limit nobody enforces, and multi-byte text slips past a character count.
    const { main, exit } = connect()
    main.postMessage({ kind: 'HELLO', nonce: NONCE, protocolMajor: 1, maxMessageBytes: 1_024, capabilities: [] })
    main.postMessage({ kind: 'SHARE_START', nonce: NONCE, id: 1 })
    const label = '€'.repeat(400) // 400 characters, 1 200 UTF-8 bytes
    main.postMessage({
      kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 2,
      candidate: { ...candidate(1), availability: 'active', payload: { reason: 'presentation', presentationState: 'no-video', slideNumber: 1, slideCount: 1, displayTitle: label, headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [] } },
    })
    await tick()
    expect(exit).toHaveBeenCalledWith(2)
    main.close()
  })

  it('shuts down on request: SHUTDOWN_COMPLETE then exit 0', async () => {
    const { main, exit, replies } = connect()
    main.postMessage({ kind: 'HELLO', nonce: NONCE, protocolMajor: 1, maxMessageBytes: 65_536, capabilities: [] })
    main.postMessage({ kind: 'SHUTDOWN', nonce: NONCE, id: 4, deadlineMs: 1_000 })
    await tick()
    expect(replies.at(-1)).toEqual({ kind: 'SHUTDOWN_COMPLETE', nonce: NONCE })
    expect(exit).toHaveBeenCalledWith(0)
  })
})

describe('launcher (main side, real protocol over a MessageChannel)', () => {
  it('handshakes with a fresh nonce and exchanges acknowledged commands', async () => {
    const { spawn } = inProcessSpawner()
    const launcher = createSidecarLauncher({ spawn, nonce: () => NONCE })
    const connection = await launcher.start()
    expect(await connection.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: candidate(1) })).toEqual({ ok: false, code: 'not-sharing' })
    expect(await connection.send({ kind: 'SHARE_START' })).toEqual({ ok: true })
    expect(await connection.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: candidate(2) })).toEqual({ ok: true })
    expect(await connection.shutdown(1_000)).toBe('clean')
  })

  it('kills a sidecar that never completes the handshake', async () => {
    const { spawn, spawned } = inProcessSpawner({ silent: true })
    const launcher = createSidecarLauncher({ spawn, nonce: () => NONCE, handshakeTimeoutMs: 50 })
    await expect(launcher.start()).rejects.toThrow('handshake-timeout')
    expect(spawned[0].killed).toBe(true)
  })

  it('kills a sidecar that answers with the wrong nonce', async () => {
    const channel = new MessageChannel()
    let killed = false
    const spawn = (): SpawnedSidecar => {
      channel.port2.on('message', () => channel.port2.postMessage({ kind: 'READY', nonce: 'w'.repeat(32), protocolMajor: 1, capabilities: [] }))
      return { port: nodePort(channel.port1), kill: () => void (killed = true), onExit: () => {} }
    }
    const launcher = createSidecarLauncher({ spawn, nonce: () => NONCE, handshakeTimeoutMs: 200 })
    await expect(launcher.start()).rejects.toThrow('handshake-rejected')
    expect(killed).toBe(true)
    channel.port1.close()
  })

  it('kills a sidecar that ignores SHUTDOWN once the deadline passes', async () => {
    const { spawn, spawned } = inProcessSpawner({ ignoreShutdown: true })
    const connection = await createSidecarLauncher({ spawn, nonce: () => NONCE }).start()
    expect(await connection.shutdown(50)).toBe('killed')
    expect(spawned[0].killed).toBe(true)
  })

  it('treats any invalid message from the sidecar as a protocol violation and kills it', async () => {
    const channel = new MessageChannel()
    let killed = false
    const exits: string[] = []
    const spawn = (): SpawnedSidecar => {
      channel.port2.on('message', (m: { kind: string }) => {
        if (m.kind === 'HELLO') {
          channel.port2.postMessage({ kind: 'READY', nonce: NONCE, protocolMajor: 1, capabilities: [] })
          channel.port2.postMessage({ kind: 'RUN_COMMAND', nonce: NONCE, command: 'powerpoint.next' })
        }
      })
      return { port: nodePort(channel.port1), kill: () => void (killed = true), onExit: () => {} }
    }
    const connection = await createSidecarLauncher({ spawn, nonce: () => NONCE }).start()
    connection.onExit((reason) => exits.push(reason))
    await tick()
    expect(killed).toBe(true)
    expect(exits).toEqual(['protocol-violation'])
    channel.port1.close()
  })
})

describe('publisher lifecycle (main side)', () => {
  it('shares, coalesces candidates to the latest while one is in flight, and stops', async () => {
    const { spawn, spawned } = inProcessSpawner()
    const statuses: PublisherStatus[] = []
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), onStatus: (s) => statuses.push(s) })
    await lifecycle.startSharing()
    lifecycle.offerCandidate(candidate(1))
    lifecycle.offerCandidate(candidate(2))
    lifecycle.offerCandidate(candidate(3))
    await tick()
    const sent = spawned[0].received.filter((m) => (m as { kind: string }).kind === 'SNAPSHOT_CANDIDATE').map((m) => (m as { candidate: { observedAtMs: number } }).candidate.observedAtMs)
    expect(sent).toEqual([1, 3])
    await lifecycle.stopSharing()
    expect(statuses).toEqual(['starting', 'sharing', 'stopping', 'idle'])
    expect(spawned[0].received.map((m) => (m as { kind: string }).kind).slice(-2)).toEqual(['SHARE_STOP', 'SHUTDOWN'])
  })

  it('respawns a crashed sidecar with backoff and replays the latest candidate; the host is never touched', async () => {
    const { spawn, spawned } = inProcessSpawner()
    const statuses: PublisherStatus[] = []
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), respawnDelaysMs: [10, 10], onStatus: (s) => statuses.push(s) })
    await lifecycle.startSharing()
    lifecycle.offerCandidate(candidate(7))
    await tick()
    spawned[0].crash()
    await new Promise((r) => setTimeout(r, 60))
    expect(spawned).toHaveLength(2)
    expect(spawned[1].received.map((m) => (m as { kind: string }).kind)).toEqual(['HELLO', 'SHARE_START', 'SNAPSHOT_CANDIDATE'])
    expect(statuses).toEqual(['starting', 'sharing', 'restarting', 'sharing'])
    await lifecycle.shutdown(500)
  })

  it('gives up after the respawn budget and reports failed without throwing', async () => {
    const { spawn, spawned } = inProcessSpawner()
    const statuses: PublisherStatus[] = []
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), respawnDelaysMs: [5], onStatus: (s) => statuses.push(s) })
    await lifecycle.startSharing()
    spawned[0].crash()
    await new Promise((r) => setTimeout(r, 40))
    spawned[1].crash()
    await new Promise((r) => setTimeout(r, 40))
    expect(spawned).toHaveLength(2)
    expect(statuses.at(-1)).toBe('failed')
    expect(() => lifecycle.offerCandidate(candidate(1))).not.toThrow()
  })

  it('recovers from a stop immediately followed by a start (no orphaned sidecar)', async () => {
    // Defect: stopSharing resumes after its awaits and nulls the newer connection.
    const { spawn, spawned } = inProcessSpawner()
    const statuses: PublisherStatus[] = []
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), onStatus: (s) => statuses.push(s) })
    await lifecycle.startSharing()
    const stopping = lifecycle.stopSharing()
    const restarting = lifecycle.startSharing()
    await Promise.all([stopping, restarting])
    lifecycle.offerCandidate(candidate(42))
    await tick()
    expect(lifecycle.status()).toBe('sharing')
    const last = spawned.at(-1)!
    expect(last.received.map((m) => (m as { kind: string }).kind)).toContain('SNAPSHOT_CANDIDATE')
    expect(spawned.filter((p) => !p.killed && !(p.received as Array<{ kind: string }>).some((m) => m.kind === 'SHUTDOWN'))).toHaveLength(1)
    await lifecycle.shutdown(500)
  })

  it('does not hang in starting when the sidecar refuses SHARE_START', async () => {
    // Defect: a NACKed SHARE_START leaves status "starting" forever with a live sidecar.
    const channel = new MessageChannel()
    let killed = false
    const spawn = (): SpawnedSidecar => {
      channel.port2.on('message', (m: { kind: string; id?: number }) => {
        if (m.kind === 'HELLO') channel.port2.postMessage({ kind: 'READY', nonce: NONCE, protocolMajor: 1, capabilities: [] })
        else if (m.kind === 'SHARE_START') channel.port2.postMessage({ kind: 'NACK', nonce: NONCE, id: m.id, code: 'internal' })
      })
      return { port: nodePort(channel.port1), kill: () => void (killed = true), onExit: () => {} }
    }
    const statuses: PublisherStatus[] = []
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn, nonce: () => NONCE }), respawnDelaysMs: [], onStatus: (s) => statuses.push(s) })
    await lifecycle.startSharing()
    await new Promise((r) => setTimeout(r, 2_200))
    expect(statuses.at(-1)).toBe('failed')
    expect(killed).toBe(true)
    channel.port1.close()
  }, 5_000)

  it('refreshes the respawn budget after a stable sharing period', async () => {
    const { spawn, spawned } = inProcessSpawner()
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), respawnDelaysMs: [5], stableAfterMs: 20, onStatus: () => {} })
    await lifecycle.startSharing()
    spawned[0].crash()
    await new Promise((r) => setTimeout(r, 60))
    spawned[1].crash()
    await new Promise((r) => setTimeout(r, 60))
    expect(spawned).toHaveLength(3)
    expect(lifecycle.status()).toBe('sharing')
    await lifecycle.shutdown(500)
  })

  it('returns to idle when shut down while restarting', async () => {
    const { spawn, spawned } = inProcessSpawner()
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn }), respawnDelaysMs: [1_000] })
    await lifecycle.startSharing()
    spawned[0].crash()
    await tick()
    expect(lifecycle.status()).toBe('restarting')
    expect(await lifecycle.shutdown(100)).toBe('not-running')
    expect(lifecycle.status()).toBe('idle')
  })

  it('reports not-running when shut down without sharing', async () => {
    const lifecycle = createPublisherLifecycle({ launcher: createSidecarLauncher({ spawn: inProcessSpawner().spawn }) })
    expect(await lifecycle.shutdown(100)).toBe('not-running')
  })
})

describe('sidecar boundaries (RPV-001, RPV-005, RPV-010)', () => {
  const dir = __dirname
  const SIDECAR_SIDE = ['worker.ts', 'sidecar-core.ts', 'protocol.ts', 'port.ts']

  it('the sidecar side never imports helper, COM, host, renderer IPC, Electron, or child_process code', () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(path.join(dir, file), 'utf8')
      for (const [, spec] of source.matchAll(/(?:from\s+|import\(\s*|require\(\s*)'([^']+)'/g)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/ppt-bridge|presentation-core|helper-discovery|session-host|\/ipc|ipc-contract|child_process|^electron$|renderer|preload/)
        if (spec.startsWith('./')) visit(`${spec.slice(2).replace(/\.js$/, '')}.ts`)
      }
    }
    SIDECAR_SIDE.forEach(visit)
    expect([...seen].sort()).toEqual(expect.arrayContaining(SIDECAR_SIDE))
  })

  it('the only workspace package the sidecar side loads is the dependency-free contracts package', () => {
    const contracts = JSON.parse(readFileSync(path.resolve(dir, '../../../../../packages/remote-viewer-contracts/package.json'), 'utf8'))
    expect(contracts.dependencies ?? {}).toEqual({})
    const packageImports = SIDECAR_SIDE.flatMap((file) =>
      [...readFileSync(path.join(dir, file), 'utf8').matchAll(/(?:from\s+|import\(\s*|require\(\s*)'(@ontime\/[^']+)'/g)].map((m) => m[1]),
    )
    expect([...new Set(packageImports)]).toEqual(['@ontime/remote-viewer-contracts'])
  })

  it('the protocol has no viewer-to-PowerPoint or renderer command message', () => {
    expect([...MAIN_TO_SIDECAR_KINDS].sort()).toEqual(['END_SESSION', 'HELLO', 'SHARE_START', 'SHARE_STOP', 'SHUTDOWN', 'SNAPSHOT_CANDIDATE'])
    expect([...SIDECAR_TO_MAIN_KINDS].sort()).toEqual(['ACK', 'NACK', 'READY', 'SAFE_ERROR', 'SHARE_STATE', 'SHUTDOWN_COMPLETE'])
  })
})
