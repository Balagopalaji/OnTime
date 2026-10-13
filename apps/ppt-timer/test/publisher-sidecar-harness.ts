// Test-only harness (not imported by production code): wires the real launcher to a real
// in-process sidecar core over a Node MessageChannel, standing in for utilityProcess.fork.
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { PortLike } from '../src/main/publisher-sidecar/port'
import type { SpawnedSidecar } from '../src/main/publisher-sidecar/launcher'
import { createSidecarCore } from '../src/main/publisher-sidecar/sidecar-core'

export function nodePort(port: MessagePort): PortLike {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', listener),
    close: () => port.close(),
  }
}

export type FakeProcess = SpawnedSidecar & {
  killed: boolean
  /** Simulate a sidecar crash (process exit without SHUTDOWN). */
  crash(): void
  /** Messages the sidecar received, in order (after protocol parsing). */
  received: unknown[]
}

/** Spawn factory whose "process" runs the real sidecar core in-process. */
export function inProcessSpawner(options: { ignoreShutdown?: boolean; silent?: boolean } = {}) {
  const spawned: FakeProcess[] = []
  const cores: Array<ReturnType<typeof createSidecarCore>> = []
  const spawn = (): FakeProcess => {
    const channel = new MessageChannel()
    const exitListeners: Array<(code: number | null) => void> = []
    let exited = false
    const fireExit = (code: number | null) => {
      if (exited) return
      exited = true
      channel.port2.close()
      for (const listener of exitListeners) listener(code)
    }
    const received: unknown[] = []
    const sidecarPort = nodePort(channel.port2)
    const handle: FakeProcess = {
      port: nodePort(channel.port1),
      killed: false,
      received,
      kill: () => {
        handle.killed = true
        fireExit(null)
      },
      onExit: (listener) => void exitListeners.push(listener),
      crash: () => fireExit(1),
    }
    if (!options.silent) {
      const core = createSidecarCore({
        port: {
          ...sidecarPort,
          onMessage: (listener) =>
            sidecarPort.onMessage((data) => {
              received.push(data)
              if (options.ignoreShutdown && (data as { kind?: string }).kind === 'SHUTDOWN') return
              listener(data)
            }),
        },
        exit: (code) => setImmediate(() => fireExit(code)),
      })
      cores.push(core)
    }
    spawned.push(handle)
    return handle
  }
  return { spawn, spawned, cores }
}
