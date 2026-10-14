/**
 * ISSUE-002 S9c integration: the real sidecar LAN client (token mint over HTTP,
 * Socket.IO admit/publish/end, reconnect) against the REAL Companion
 * remote-snapshot hub (`companion/src/remote-snapshot.ts`) on a real loopback
 * HTTP + Socket.IO server. Only Companion's pairing/JWT `JOIN_ROOM` is stubbed
 * (a `TEST_JOIN_ROOM` event that joins the Socket.IO room and bootstraps like
 * main.ts does); that path has its own coverage in Companion's tests.
 *
 * This is the one ppt-timer file allowed to import Companion source and the
 * Socket.IO server (see `.dependency-cruiser.cjs` and the rebuild guardrails).
 */
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MessageChannel } from 'node:worker_threads'
import { createRequire } from 'node:module'
import path from 'node:path'
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client'
import { parseRemoteSnapshotV1, type RemoteSnapshotCandidateV1, type RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodePort } from '../../../test/publisher-sidecar-harness'
import { createRemoteSnapshotHub } from '../../../../../companion/src/remote-snapshot'
import type { LanConfig } from './lan-config'
import { createLanPublisher, type LanStatus } from './lan-publisher'
import { createLanConnector, type LanFetch } from './lan-socket'
import { createSidecarCore } from './sidecar-core'

// The Socket.IO *server* is Companion's own dependency (not a ppt-timer dependency): load the copy
// Companion installs, exactly as the hub runs in production.
const companionRequire = createRequire(path.resolve(__dirname, '../../../../../companion/package.json'))
type ServerSocket = {
  data: Record<string, unknown>
  join(room: string): unknown
  on(event: string, handler: (payload: never) => void): unknown
  disconnect(close?: boolean): unknown
}
type SocketServerLike = {
  to(room: string): { emit(event: string, payload: unknown): unknown }
  on(event: 'connection', handler: (socket: ServerSocket) => void): unknown
  sockets: { sockets: Map<string, ServerSocket> }
  close(): Promise<void> | void
}
const { Server: SocketServer } = companionRequire('socket.io') as { Server: new (http: HttpServer) => SocketServerLike }

const NONCE = 'n'.repeat(32)
const ROOM = 'room-lan-1'
const header = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1 } as const
const candidate = (observedAtMs: number, reason: 'no-presentation' | 'no-slideshow' = 'no-slideshow'): RemoteSnapshotCandidateV1 => ({
  ...header,
  observedAtMs,
  availability: 'source-unavailable',
  payload: { reason },
})

const isLoopback = (address?: string | null) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
const until = async (condition: () => boolean, label: string, timeoutMs = 4_000) => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

type Companion = Awaited<ReturnType<typeof startCompanion>>

async function startCompanion() {
  const tokens: string[] = []
  let counter = 0
  const hubRef: { current?: ReturnType<typeof createRemoteSnapshotHub> } = {}
  const httpServer: HttpServer = createServer((req, res) => {
    if (hubRef.current?.handleHttp(req, res)) return
    res.writeHead(404).end()
  })
  const io = new SocketServer(httpServer)
  const hub = createRemoteSnapshotHub({
    now: () => Date.now(),
    isLoopback,
    emitToRoom: (roomId, event, payload) => void io.to(roomId).emit(event, payload),
    generateToken: () => {
      const token = `test-token-${(counter += 1)}-${'x'.repeat(24)}`
      tokens.push(token)
      return token
    },
  })
  hubRef.current = hub
  io.on('connection', (socket) => {
    hub.registerSocket(socket as never)
    socket.on('TEST_JOIN_ROOM', ((roomId: string) => {
      void socket.join(roomId)
      hub.bootstrapViewer(socket as never, roomId)
    }) as never)
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as AddressInfo).port
  const config: LanConfig = { companionUrl: `http://127.0.0.1:${port}`, roomId: ROOM }
  const viewers: ClientSocket[] = []
  return {
    config,
    tokens,
    io,
    /** A paired LAN viewer stand-in: joins the room and records every snapshot/ended envelope. */
    async viewer() {
      const socket = connectClient(config.companionUrl, { transports: ['websocket'], forceNew: true, reconnection: false })
      const snapshots: RemoteSnapshotV1[] = []
      const ended: Array<{ sessionId: string }> = []
      socket.on('REMOTE_SNAPSHOT', (envelope: { snapshot: unknown }) => {
        const parsed = parseRemoteSnapshotV1(envelope.snapshot)
        if (parsed.ok) snapshots.push(parsed.value)
      })
      socket.on('REMOTE_SNAPSHOT_ENDED', (envelope: { sessionId: string }) => ended.push(envelope))
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()))
      socket.emit('TEST_JOIN_ROOM', ROOM)
      viewers.push(socket)
      return { snapshots, ended }
    },
    async stop() {
      viewers.forEach((viewer) => viewer.disconnect())
      await io.close()
    },
  }
}

let companion: Companion
beforeEach(async () => {
  companion = await startCompanion()
})
afterEach(async () => {
  await companion.stop()
})

const realFetch: LanFetch = (url, init) => fetch(url, init)

describe('LAN publisher against the real Companion hub', () => {
  it('mints a fresh token, admits, publishes the same candidates to viewers, and ends', async () => {
    // Defect: the wire shapes between sidecar and hub drift (the hub only logs a rejection and viewers see nothing).
    const statuses: LanStatus[] = []
    const lan = createLanPublisher({ config: companion.config, connect: createLanConnector({ fetch: realFetch }), onStatus: (s) => statuses.push(s) })
    const viewer = await companion.viewer()
    lan.start()
    lan.offer(candidate(Date.now() - 100))
    await until(() => viewer.snapshots.length === 1, 'first broadcast')
    const first = viewer.snapshots[0]
    expect(first).toMatchObject({ ...header, availability: 'source-unavailable', payload: { reason: 'no-slideshow' }, epoch: 1, sequence: 1 })
    await until(() => statuses.includes('live'), 'live status')
    expect(companion.tokens).toHaveLength(1)

    lan.offer(candidate(Date.now(), 'no-presentation'))
    await until(() => viewer.snapshots.length === 2, 'second broadcast')
    expect(viewer.snapshots[1]).toMatchObject({ sessionId: first.sessionId, epoch: 1, sequence: 2, payload: { reason: 'no-presentation' } })

    // A viewer that joins later is bootstrapped with the cached latest snapshot.
    const late = await companion.viewer()
    await until(() => late.snapshots.length === 1, 'bootstrap')
    expect(late.snapshots[0]).toMatchObject({ sequence: 2 })

    await lan.end()
    await until(() => viewer.ended.length === 1 && late.ended.length === 1, 'ended envelope')
    expect(viewer.ended[0]).toEqual(expect.objectContaining({ sessionId: first.sessionId }))
    expect(statuses.at(-1)).toBe('ended')
  })

  it('reconnects with a fresh one-time token after the Companion drops the publisher and keeps the sequence', async () => {
    // Defect: a reused (spent) token or a restarted sequence after a dropped socket.
    const lan = createLanPublisher({ config: companion.config, connect: createLanConnector({ fetch: realFetch }), onStatus: () => undefined, random: () => 0 })
    const viewer = await companion.viewer()
    lan.start()
    lan.offer(candidate(Date.now()))
    await until(() => viewer.snapshots.length === 1, 'first broadcast')
    for (const socket of companion.io.sockets.sockets.values()) {
      if (socket.data.remotePublisherRoomId) socket.disconnect(true)
    }
    await until(() => companion.tokens.length === 2, 'second token mint')
    lan.offer(candidate(Date.now(), 'no-presentation'))
    await until(() => viewer.snapshots.length === 2, 'broadcast after reconnect', 6_000)
    expect(viewer.snapshots[1]).toMatchObject({ sessionId: viewer.snapshots[0].sessionId, epoch: 1, sequence: 2 })
    lan.pause()
  })

  it('a second share after Stop publishes a higher epoch in the same LAN session (viewers reset, not regress)', async () => {
    // Defect: restart reuses epoch 1 and the hub rejects every later publish as a duplicate/regression.
    const lan = createLanPublisher({ config: companion.config, connect: createLanConnector({ fetch: realFetch }), onStatus: () => undefined })
    const viewer = await companion.viewer()
    lan.start()
    lan.offer(candidate(Date.now()))
    await until(() => viewer.snapshots.length === 1, 'first broadcast')
    lan.pause()
    lan.start()
    lan.offer(candidate(Date.now(), 'no-presentation'))
    await until(() => viewer.snapshots.length === 2, 'broadcast after restart')
    expect(viewer.snapshots[1]).toMatchObject({ sessionId: viewer.snapshots[0].sessionId, epoch: 2, sequence: 1 })
    lan.pause()
  })

  it('a restarted sidecar (new session) after End is a new LAN session; the ended one is never resurrected', async () => {
    // Defect: End leaves the ID reusable and the hub's tombstone silently drops the next share.
    const lan = createLanPublisher({ config: companion.config, connect: createLanConnector({ fetch: realFetch }), onStatus: () => undefined })
    const viewer = await companion.viewer()
    lan.start()
    lan.offer(candidate(Date.now()))
    await until(() => viewer.snapshots.length === 1, 'first broadcast')
    await lan.end()
    await until(() => viewer.ended.length === 1, 'ended')
    lan.start()
    lan.offer(candidate(Date.now()))
    await until(() => viewer.snapshots.length === 2, 'second session broadcast')
    expect(viewer.snapshots[1].sessionId).not.toBe(viewer.snapshots[0].sessionId)
    lan.pause()
  })

  it('reports transient failure when Companion is not listening, and nothing throws', async () => {
    // Defect: ECONNREFUSED is treated as permanent or surfaces as an unhandled rejection.
    const connector = createLanConnector({ fetch: realFetch, requestTimeoutMs: 500 })
    const outcome = await connector({ companionUrl: 'http://127.0.0.1:1', roomId: ROOM })
    expect(outcome).toEqual({ ok: false, permanent: false })
  })

  it('treats a refused token mint (browser-style 403) as permanent and a 5xx as transient', async () => {
    // Defect: a misconfigured (non-loopback/forbidden) target is retried forever.
    const status = (code: number): LanFetch => async () => ({ status: code, json: async () => ({}) })
    expect(await createLanConnector({ fetch: status(403) })(companion.config)).toEqual({ ok: false, permanent: true })
    expect(await createLanConnector({ fetch: status(503) })(companion.config)).toEqual({ ok: false, permanent: false })
    expect(companion.tokens).toHaveLength(0)
  })

  it('sends no browser headers on the token mint (the hub refuses Origin / Sec-Fetch-Site)', async () => {
    // Defect: the runtime fetch adds Origin, so the real hub would refuse every mint.
    const seen: Record<string, string>[] = []
    const spying: LanFetch = (url, init) => {
      seen.push(init.headers)
      return realFetch(url, init)
    }
    const outcome = await createLanConnector({ fetch: spying })(companion.config)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) outcome.link.close()
    expect(Object.keys(seen[0]).map((k) => k.toLowerCase()).sort()).toEqual(['content-type'])
    expect(companion.tokens).toHaveLength(1)
  })

  it('through the sidecar core: SHARE_START + candidates reach LAN viewers with no cloud configured, and END_SESSION ends them', async () => {
    // Defect: LAN only works when the cloud share is configured/approved, or End never reaches viewers.
    const { port1, port2 } = new MessageChannel()
    createSidecarCore({
      port: nodePort(port2),
      exit: () => undefined,
      lan: { config: companion.config, connect: createLanConnector({ fetch: realFetch }) },
    })
    const replies: Array<Record<string, unknown>> = []
    port1.on('message', (m) => replies.push(m))
    const send = (message: Record<string, unknown>) => port1.postMessage({ nonce: NONCE, ...message })
    const viewer = await companion.viewer()
    send({ kind: 'HELLO', protocolMajor: 1, maxMessageBytes: 65_536, capabilities: ['publish'] })
    send({ kind: 'SHARE_START', id: 1 })
    send({ kind: 'SNAPSHOT_CANDIDATE', id: 2, candidate: candidate(Date.now()) })
    await until(() => viewer.snapshots.length === 1, 'LAN broadcast via sidecar core')
    await until(() => replies.some((r) => r.kind === 'LAN_STATUS' && r.status === 'live'), 'LAN live status')
    expect(replies.filter((r) => r.kind === 'PUBLISH_STATUS').map((r) => r.status)).toEqual(['not-configured'])
    send({ kind: 'END_SESSION', id: 3 })
    await until(() => viewer.ended.length === 1, 'LAN ended via sidecar core')
    await until(() => replies.some((r) => r.kind === 'LAN_STATUS' && r.status === 'ended'), 'LAN ended status')
    port1.close()
  })
})
