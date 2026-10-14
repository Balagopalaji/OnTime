import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import type { RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts'
import { describe, expect, it, vi } from 'vitest'
import { nodePort } from '../../../test/publisher-sidecar-harness'
import type { LanConfig } from './lan-config'
import type { LanConnectResult, LanConnector, LanLink, LanPublishResult } from './lan-publisher'
import { createSidecarCore } from './sidecar-core'

const NONCE = 'n'.repeat(32)
const lanConfig: LanConfig = { companionUrl: 'http://127.0.0.1:4000', roomId: 'room-1' }
const candidate = (observedAtMs: number) =>
  ({ schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs, availability: 'source-unavailable', payload: { reason: 'no-slideshow' } }) as const
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

function fakeLink() {
  const published: RemoteSnapshotV1[] = []
  const ended: string[] = []
  const closeListeners: Array<() => void> = []
  const link: LanLink & { published: RemoteSnapshotV1[]; ended: string[]; closed: boolean } = {
    published,
    ended,
    closed: false,
    publish: async (snapshot) => {
      published.push(snapshot)
      return { accepted: true, order: 'apply', epoch: snapshot.epoch, sequence: snapshot.sequence, timestamp: Date.now() } satisfies LanPublishResult
    },
    end: async (sessionId) => void ended.push(sessionId),
    close: () => {
      link.closed = true
      closeListeners.forEach((l) => l())
    },
    onClose: (l) => void closeListeners.push(l),
  }
  return link
}

function connect(options: { lan?: { connect: LanConnector } | null } = {}) {
  const { port1, port2 } = new MessageChannel()
  const exit = vi.fn()
  createSidecarCore({
    port: nodePort(port2),
    exit,
    lan: options.lan === null ? undefined : options.lan ? { config: lanConfig, connect: options.lan.connect } : undefined,
  })
  const replies: Array<Record<string, unknown>> = []
  port1.on('message', (m) => replies.push(m))
  const send = (message: Record<string, unknown>) => port1.postMessage({ nonce: NONCE, ...message })
  send({ kind: 'HELLO', protocolMajor: 1, maxMessageBytes: 65_536, capabilities: ['publish'] })
  return { main: port1, send, replies, exit, lanStatuses: () => replies.filter((r) => r.kind === 'LAN_STATUS').map((r) => r.status) }
}

describe('sidecar core: LAN publishing alongside the cloud share', () => {
  it('sends no LAN status and opens no connection when LAN is not configured', async () => {
    // Defect: LAN is on by default, or leaks status for a feature that is off.
    const { send, replies, main } = connect()
    send({ kind: 'SHARE_START', id: 1 })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(1) })
    await tick()
    expect(replies.some((r) => r.kind === 'LAN_STATUS')).toBe(false)
    main.close()
  })

  it('publishes the same candidate to the LAN link while the cloud side reports its own status', async () => {
    // Defect: LAN waits on (or needs) cloud approval/config, or sees a different candidate.
    const link = fakeLink()
    const { send, lanStatuses, replies, main } = connect({ lan: { connect: async () => ({ ok: true, link }) } })
    send({ kind: 'SHARE_START', id: 1 })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(500) })
    await tick(30)
    expect(link.published).toHaveLength(1)
    expect(link.published[0]).toMatchObject({ ...candidate(500), epoch: 1, sequence: 1 })
    expect(lanStatuses()).toEqual(['connecting', 'live'])
    // Cloud is not configured here: its status is unaffected by LAN being live.
    expect(replies.filter((r) => r.kind === 'PUBLISH_STATUS')).toEqual([{ kind: 'PUBLISH_STATUS', nonce: NONCE, status: 'not-configured' }])
    expect(replies.filter((r) => r.kind === 'ACK').map((r) => r.id)).toEqual([1, 2])
    main.close()
  })

  it('a failing LAN never changes cloud status, ACKs, or the sharing state', async () => {
    // Defect: LAN connect errors, throws, or rejections break the cloud publisher or the command channel.
    const throwing: LanConnector = () => {
      throw new Error('boom: /Users/secret')
    }
    for (const lan of [throwing, async (): Promise<LanConnectResult> => ({ ok: false, permanent: true }), () => Promise.reject(new Error('x'))]) {
      const { send, replies, exit, lanStatuses, main } = connect({ lan: { connect: lan } })
      send({ kind: 'SHARE_START', id: 1 })
      send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(1) })
      send({ kind: 'SHARE_STOP', id: 3 })
      await tick(20)
      expect(exit).not.toHaveBeenCalled()
      expect(replies.filter((r) => r.kind === 'ACK').map((r) => r.id)).toEqual([1, 2, 3])
      expect(replies.filter((r) => r.kind === 'NACK' || r.kind === 'SAFE_ERROR')).toEqual([])
      expect(replies.filter((r) => r.kind === 'PUBLISH_STATUS').map((r) => r.status)).toEqual(['not-configured', 'paused'])
      expect(lanStatuses().every((s) => ['connecting', 'unavailable', 'retrying', 'paused'].includes(s as string))).toBe(true)
      expect(JSON.stringify(replies)).not.toContain('secret')
      main.close()
    }
  })

  it('SHARE_STOP pauses LAN (link closed, session not ended) and END_SESSION sends END', async () => {
    // Defect: Stop ends the LAN session for viewers, or End never reaches the hub.
    const link = fakeLink()
    const { send, lanStatuses, main } = connect({ lan: { connect: async () => ({ ok: true, link }) } })
    send({ kind: 'SHARE_START', id: 1 })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(1) })
    await tick(30)
    send({ kind: 'END_SESSION', id: 3 })
    await tick(30)
    expect(link.ended).toHaveLength(1)
    expect(lanStatuses().at(-1)).toBe('ended')
    expect(link.closed).toBe(true)
    main.close()

    const stopped = fakeLink()
    const second = connect({ lan: { connect: async () => ({ ok: true, link: stopped }) } })
    second.send({ kind: 'SHARE_START', id: 1 })
    second.send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(1) })
    await tick(30)
    second.send({ kind: 'SHARE_STOP', id: 3 })
    await tick(10)
    expect(stopped.closed).toBe(true)
    expect(stopped.ended).toEqual([])
    expect(second.lanStatuses().at(-1)).toBe('paused')
    second.main.close()
  })

  it('SHUTDOWN closes the LAN link before exit', async () => {
    // Defect: the utility process exits with a live loopback socket still admitted as publisher.
    const link = fakeLink()
    const { send, exit, main } = connect({ lan: { connect: async () => ({ ok: true, link }) } })
    send({ kind: 'SHARE_START', id: 1 })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(1) })
    await tick(30)
    send({ kind: 'SHUTDOWN', id: 4, deadlineMs: 1_000 })
    await tick(10)
    expect(link.closed).toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
    main.close()
  })

  it('does not offer candidates to LAN while not sharing', async () => {
    // Defect: candidates sent before SHARE_START are published.
    const link = fakeLink()
    const connector = vi.fn(async (): Promise<LanConnectResult> => ({ ok: true, link }))
    const { send, replies, main } = connect({ lan: { connect: connector } })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 1, candidate: candidate(1) })
    await tick(20)
    expect(connector).not.toHaveBeenCalled()
    expect(replies.at(-1)).toMatchObject({ kind: 'NACK', code: 'not-sharing' })
    main.close()
  })
})

describe('LAN transport boundary (ISSUE-002 S9c)', () => {
  const sources = readdirSync(__dirname).filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
  const specifiers = (file: string) => [...readFileSync(path.join(__dirname, file), 'utf8').matchAll(/(?:from\s+|import\(\s*|require\(\s*)'([^']+)'/g)].map((m) => m[1])

  it('only lan-socket.ts imports the Socket.IO client, and nothing in the sidecar imports the server, Companion, or interface contracts', () => {
    // Defect: the transport leaks into the publish logic (untestable, unbounded) or the sidecar grows a server/Companion dependency.
    const importing = sources.filter((file) => specifiers(file).some((spec) => /^socket\.io-client(\/|$)/.test(spec)))
    expect(importing).toEqual(['lan-socket.ts'])
    for (const file of sources) {
      for (const spec of specifiers(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^socket\.io(\/|$)|companion|interface-contracts|shared-types/)
      }
    }
  })

  it('the LAN modules never import cloud modules (cloud state is not mirrored into LAN)', () => {
    // Defect: LAN publishing reads cloud session/credential state instead of just publishing the same candidate.
    for (const file of ['lan-publisher.ts', 'lan-socket.ts', 'lan-config.ts']) {
      for (const spec of specifiers(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/cloud-client|share-session|auth|credential/)
      }
    }
  })

  it('the LAN publisher reuses the shared engine and formulas instead of forking timer math', () => {
    // Defect: a second copy of ordering/material-change/age logic that drifts from the cloud path.
    const source = readFileSync(path.join(__dirname, 'lan-publisher.ts'), 'utf8')
    expect(source).toContain("from './publisher'")
    expect(source).toContain('createPublisher(')
    expect(source).not.toMatch(/isMaterialChange|computeObservationAgeMs|estimateServerOffsetMs|compareSnapshotOrder/)
  })
})
