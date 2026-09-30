/**
 * Utility-process entry for the hidden publisher sidecar. Electron delivers
 * one private MessagePort from main over `process.parentPort`; the sidecar
 * speaks only the strict protocol on it. No window, helper, COM, or host code.
 */
import { createSidecarCore } from './sidecar-core'

type ElectronPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  start(): void
  close(): void
}
type ParentPort = { once(event: 'message', listener: (event: { ports: ElectronPort[] }) => void): void }

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

parentPort?.once('message', (event) => {
  const [port] = event.ports
  if (!port) process.exit(2)
  createSidecarCore({
    port: {
      postMessage: (message) => port.postMessage(message),
      onMessage: (listener) => port.on('message', (e) => listener(e.data)),
      close: () => port.close(),
    },
    exit: (code) => setImmediate(() => process.exit(code)),
  })
  port.start()
})
