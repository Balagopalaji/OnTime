/**
 * Publisher sidecar core (runs inside the hidden utility process). It owns
 * no helper, COM, host, or renderer access: it only answers the strict
 * protocol, keeps one latest candidate while sharing, and exits on request
 * or on any protocol violation. Cloud publication plugs in at S6c.
 */
import type { RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import type { PortLike } from './port'
import { SIDECAR_PROTOCOL_MAJOR, parseHello, parseMainToSidecar, type SidecarToMain } from './protocol'

export const SIDECAR_CAPABILITIES = ['publish']

export function createSidecarCore(options: { port: PortLike; exit: (code: number) => void }) {
  const { port } = options
  let nonce: string | null = null
  let maxBytes = 0
  let state: 'awaiting-hello' | 'idle' | 'sharing' | 'closed' = 'awaiting-hello'
  let latest: RemoteSnapshotCandidateV1 | null = null

  const send = (message: SidecarToMain) => port.postMessage(message)
  const terminate = (code: number) => {
    if (state === 'closed') return
    state = 'closed'
    latest = null
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
      case 'SHUTDOWN':
        send({ kind: 'SHUTDOWN_COMPLETE', nonce })
        return terminate(0)
      default:
        return terminate(2)
    }
  })

  return {
    latestCandidate: () => latest,
  }
}
