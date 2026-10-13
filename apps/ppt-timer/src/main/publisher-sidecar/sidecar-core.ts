/**
 * Publisher sidecar core (runs inside the hidden utility process). It owns
 * no helper, COM, host, or renderer access: it only answers the strict
 * protocol, keeps one latest candidate while sharing, and exits on request
 * or on any protocol violation. Cloud publication plugs in at S6c.
 */
import type { RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import type { PortLike } from './port'
import {
  SIDECAR_PROTOCOL_MAJOR,
  parseHello,
  parseMainToSidecar,
  type MainToSidecar,
  sealedDataFits,
  type SidecarToMain,
  type StorageError,
} from './protocol'

type StorageOutcome = { ok: true } | { ok: false; error: StorageError }
type UnsealOutcome = { ok: true; data: string } | { ok: false; error: StorageError }

/** Credential storage brokered by main (safeStorage); the sidecar owns the data's meaning. */
export type SidecarStorage = {
  seal(data: string): Promise<StorageOutcome>
  unseal(): Promise<UnsealOutcome>
  clear(): Promise<StorageOutcome>
}

export const SIDECAR_CAPABILITIES = ['publish']
/** A storage reply that never arrives (dropped, rejected, or a stuck broker) settles as `io`. */
export const STORAGE_TIMEOUT_MS = 10_000

export function createSidecarCore(options: { port: PortLike; exit: (code: number) => void }) {
  const { port } = options
  let nonce: string | null = null
  let maxBytes = 0
  let state: 'awaiting-hello' | 'idle' | 'sharing' | 'closed' = 'awaiting-hello'
  let latest: RemoteSnapshotCandidateV1 | null = null
  let nextRequestId = 1
  const pendingStorage = new Map<number, (result: Extract<MainToSidecar, { requestId: number }>) => void>()
  const authListeners = new Set<(callback: { challengeId: string; code: string }) => void>()

  /** Correlated storage request; resolves `io` if the channel is gone. */
  const storageRequest = <T>(message: (requestId: number) => SidecarToMain, map: (r: Extract<MainToSidecar, { requestId: number }>) => T, closed: T) =>
    new Promise<T>((resolve) => {
      if (state === 'closed' || nonce === null) return resolve(closed)
      const requestId = nextRequestId++
      const timer = setTimeout(() => {
        pendingStorage.delete(requestId)
        resolve(closed)
      }, STORAGE_TIMEOUT_MS)
      pendingStorage.set(requestId, (result) => {
        clearTimeout(timer)
        resolve(map(result))
      })
      port.postMessage(message(requestId))
    })

  const send = (message: SidecarToMain) => port.postMessage(message)
  const terminate = (code: number) => {
    if (state === 'closed') return
    state = 'closed'
    latest = null
    for (const resolve of pendingStorage.values()) resolve({ kind: 'CLEAR_RESULT', nonce: nonce ?? '', requestId: 0, ok: false, error: 'io' })
    pendingStorage.clear()
    port.close()
    options.exit(code)
  }

  port.onMessage((data) => {
    if (state === 'closed') return
    if (nonce === null) {
      const hello = parseHello(data)
      if (!hello.ok) return terminate(2)
      nonce = hello.value.nonce
      maxBytes = hello.value.maxMessageBytes
      state = 'idle'
      return send({ kind: 'READY', nonce, protocolMajor: SIDECAR_PROTOCOL_MAJOR, capabilities: SIDECAR_CAPABILITIES })
    }
    const parsed = parseMainToSidecar(data, nonce, maxBytes)
    if (!parsed.ok) return terminate(2)
    const message = parsed.value
    switch (message.kind) {
      case 'SHARE_START':
        if (state !== 'sharing') {
          state = 'sharing'
          send({ kind: 'SHARE_STATE', nonce, state: 'sharing' })
        }
        return send({ kind: 'ACK', nonce, id: message.id })
      case 'SNAPSHOT_CANDIDATE':
        if (state !== 'sharing') return send({ kind: 'NACK', nonce, id: message.id, code: 'not-sharing' })
        latest = message.candidate
        return send({ kind: 'ACK', nonce, id: message.id })
      case 'SHARE_STOP':
        if (state === 'sharing') {
          state = 'idle'
          latest = null
          send({ kind: 'SHARE_STATE', nonce, state: 'idle' })
        }
        return send({ kind: 'ACK', nonce, id: message.id })
      case 'END_SESSION':
        return send({ kind: 'ACK', nonce, id: message.id })
      case 'AUTH_CALLBACK':
        for (const listener of authListeners) listener({ challengeId: message.challengeId, code: message.code })
        return send({ kind: 'ACK', nonce, id: message.id })
      case 'SEAL_RESULT':
      case 'UNSEAL_RESULT':
      case 'CLEAR_RESULT': {
        const resolve = pendingStorage.get(message.requestId)
        pendingStorage.delete(message.requestId)
        return resolve?.(message)
      }
      case 'SHUTDOWN':
        send({ kind: 'SHUTDOWN_COMPLETE', nonce })
        return terminate(0)
      default:
        return terminate(2)
    }
  })

  const ioError = { ok: false as const, error: 'io' as const }
  const outcome = (r: Extract<MainToSidecar, { requestId: number }>): StorageOutcome => (r.ok ? { ok: true } : { ok: false, error: r.error })
  const storage: SidecarStorage = {
    seal: (data) =>
      sealedDataFits(data)
        ? storageRequest((requestId) => ({ kind: 'SEAL_REQUEST', nonce: nonce as string, requestId, data }), outcome, ioError)
        : Promise.resolve({ ok: false, error: 'too-large' }),
    unseal: () =>
      storageRequest<UnsealOutcome>(
        (requestId) => ({ kind: 'UNSEAL_REQUEST', nonce: nonce as string, requestId }),
        (r) => (r.kind === 'UNSEAL_RESULT' && r.ok ? { ok: true, data: r.data } : r.ok ? ioError : { ok: false, error: r.error }),
        ioError,
      ),
    clear: () => storageRequest((requestId) => ({ kind: 'CLEAR_SEALED', nonce: nonce as string, requestId }), outcome, ioError),
  }

  return {
    latestCandidate: () => latest,
    storage,
    /** Ask main to open the (validated) approval page in the system browser. */
    requestApproval: (url: string) => {
      if (state !== 'closed' && nonce !== null) send({ kind: 'AUTH_REQUIRED', nonce, url })
    },
    /** Resolve with the one-time code for `challengeId` relayed from the app callback, or reject on timeout. */
    waitForCallback: (challengeId: string, timeoutMs: number) =>
      new Promise<string>((resolve, reject) => {
        const listener = (callback: { challengeId: string; code: string }) => {
          if (callback.challengeId !== challengeId) return
          authListeners.delete(listener)
          clearTimeout(timer)
          resolve(callback.code)
        }
        const timer = setTimeout(() => {
          authListeners.delete(listener)
          reject(new Error('approval-expired'))
        }, timeoutMs)
        authListeners.add(listener)
      }),
  }
}
