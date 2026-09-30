/**
 * Main-side Electron spawn for the publisher sidecar: `utilityProcess.fork`
 * (available after app ready) plus one transferred `MessageChannelMain` port.
 * No localhost listener is created.
 */
import { MessageChannelMain, utilityProcess } from 'electron'
import type { SpawnedSidecar } from './launcher'

export function electronSidecarSpawner(entryPath: string): () => SpawnedSidecar {
  return () => {
    const child = utilityProcess.fork(entryPath, [], { serviceName: 'Downstage Publisher', stdio: 'ignore' })
    const { port1, port2 } = new MessageChannelMain()
    child.postMessage({ kind: 'port' }, [port2])
    port1.start()
    return {
      port: {
        postMessage: (message) => port1.postMessage(message),
        onMessage: (listener) => port1.on('message', (event) => listener(event.data)),
        close: () => port1.close(),
      },
      kill: () => void child.kill(),
      onExit: (listener) => void child.once('exit', (code) => listener(code)),
    }
  }
}
