/**
 * Main-side sidecar launcher: spawns the hidden utility process, performs the
 * nonce handshake with a timeout, correlates ACK/NACK, surfaces safe events,
 * and bounds shutdown (kill after the deadline). Any invalid message from the
 * sidecar kills it; nothing here can reach the PowerPoint host.
 */
import { randomBytes } from 'node:crypto'
import type { CredentialBroker } from './credential-store'
import type { PortLike } from './port'
import {
  SIDECAR_MAX_MESSAGE_BYTES,
  SIDECAR_PROTOCOL_MAJOR,
  parseSidecarToMain,
  type MainToSidecar,
  type SafeErrorCode,
  type SidecarToMain,
} from './protocol'

export type SpawnedSidecar = { port: PortLike; kill(): void; onExit(listener: (code: number | null) => void): void }

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'nonce' | 'id'> : never
export type SidecarCommand = WithoutEnvelope<
  Extract<MainToSidecar, { kind: 'SHARE_START' | 'SHARE_STOP' | 'END_SESSION' | 'SIGN_OUT' | 'SNAPSHOT_CANDIDATE' | 'AUTH_CALLBACK' }>
>
const EVENT_KINDS = ['SHARE_STATE', 'SAFE_ERROR', 'AUTH_REQUIRED', 'PUBLISH_STATUS', 'VIEWER_LINK'] as const
export type SidecarEvent = Extract<SidecarToMain, { kind: (typeof EVENT_KINDS)[number] }>
const isEvent = (message: SidecarToMain): message is SidecarEvent => (EVENT_KINDS as readonly string[]).includes(message.kind)
export type SendResult = { ok: true } | { ok: false; code: SafeErrorCode }

export type SidecarConnection = {
  send(command: SidecarCommand): Promise<SendResult>
  onEvent(listener: (event: SidecarEvent) => void): void
  onExit(listener: (reason: 'exited' | 'protocol-violation') => void): void
  shutdown(deadlineMs: number): Promise<'clean' | 'killed'>
}

export function createSidecarLauncher(options: {
  spawn: () => SpawnedSidecar
  nonce?: () => string
  handshakeTimeoutMs?: number
  /** safeStorage broker for SEAL/UNSEAL/CLEAR requests; absent → encryption unavailable. */
  broker?: CredentialBroker
}) {
  const broker = options.broker
  const makeNonce = options.nonce ?? (() => randomBytes(24).toString('base64url'))
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000

  return {
    start(): Promise<SidecarConnection> {
      const nonce = makeNonce()
      const child = options.spawn()
      let ready = false
      let alive = true
      let nextId = 1
      const pending = new Map<number, (result: SendResult) => void>()
      const eventListeners: Array<(event: SidecarEvent) => void> = []
      const exitListeners: Array<(reason: 'exited' | 'protocol-violation') => void> = []
      const exitWaiters: Array<() => void> = []
      let exitReason: 'exited' | 'protocol-violation' | null = null

      const finish = (reason: 'exited' | 'protocol-violation') => {
        if (exitReason !== null) return
        exitReason = reason
        alive = false
        child.port.close()
        for (const resolve of pending.values()) resolve({ ok: false, code: 'internal' })
        pending.clear()
        for (const listener of exitListeners) listener(reason)
        for (const waiter of exitWaiters.splice(0)) waiter()
      }

      return new Promise<SidecarConnection>((resolve, reject) => {
        let settled = false
        const fail = (reason: string) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(new Error(reason))
        }
        const timer = setTimeout(() => {
          fail('handshake-timeout')
          child.kill()
        }, handshakeTimeoutMs)

        const connection: SidecarConnection = {
          send(command) {
            if (!alive) return Promise.resolve({ ok: false, code: 'internal' })
            const id = nextId++
            return new Promise<SendResult>((done) => {
              pending.set(id, done)
              child.port.postMessage({ ...command, nonce, id })
            })
          },
          onEvent: (listener) => void eventListeners.push(listener),
          onExit: (listener) => void exitListeners.push(listener),
          shutdown(deadlineMs) {
            if (!alive) return Promise.resolve('clean')
            return new Promise((done) => {
              const killTimer = setTimeout(() => {
                done('killed')
                child.kill()
              }, deadlineMs)
              exitWaiters.push(() => {
                clearTimeout(killTimer)
                done('clean')
              })
              child.port.postMessage({ kind: 'SHUTDOWN', nonce, id: nextId++, deadlineMs })
            })
          },
        }

        child.onExit(() => {
          if (!ready) fail('handshake-rejected')
          finish('exited')
        })

        child.port.onMessage((data) => {
          const parsed = parseSidecarToMain(data, nonce)
          if (!ready) {
            if (settled) return
            if (!parsed.ok || parsed.value.kind !== 'READY') {
              fail('handshake-rejected')
              child.kill()
              return
            }
            settled = true
            clearTimeout(timer)
            ready = true
            resolve(connection)
            return
          }
          if (!parsed.ok || parsed.value.kind === 'READY') {
            child.kill()
            finish('protocol-violation')
            return
          }
          const message = parsed.value
          if (message.kind === 'ACK' || message.kind === 'NACK') {
            const done = pending.get(message.id)
            pending.delete(message.id)
            done?.(message.kind === 'ACK' ? { ok: true } : { ok: false, code: message.code })
          } else if (isEvent(message)) {
            for (const listener of eventListeners) listener(message)
          } else if (message.kind === 'SEAL_REQUEST' || message.kind === 'UNSEAL_REQUEST' || message.kind === 'CLEAR_SEALED') {
            const unavailable = { ok: false as const, error: 'encryption-unavailable' as const }
            const reply = (kind: 'SEAL_RESULT' | 'UNSEAL_RESULT' | 'CLEAR_RESULT', operation: Promise<object> | undefined) =>
              void (operation ?? Promise.resolve(unavailable))
                .catch(() => ({ ok: false, error: 'io' }))
                .then((outcome) => {
                  if (alive) child.port.postMessage({ kind, nonce, requestId: message.requestId, ...outcome })
                })
            if (message.kind === 'SEAL_REQUEST') reply('SEAL_RESULT', broker?.seal(message.data))
            else if (message.kind === 'UNSEAL_REQUEST') reply('UNSEAL_RESULT', broker?.unseal())
            else reply('CLEAR_RESULT', broker?.clear())
          }
        })

        child.port.postMessage({
          kind: 'HELLO',
          nonce,
          protocolMajor: SIDECAR_PROTOCOL_MAJOR,
          maxMessageBytes: SIDECAR_MAX_MESSAGE_BYTES,
          capabilities: ['publish'],
        })
      })
    },
  }
}

export type SidecarLauncher = ReturnType<typeof createSidecarLauncher>
