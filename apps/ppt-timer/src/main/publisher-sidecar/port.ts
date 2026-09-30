/** The minimal message-port surface both ends use (Electron MessagePortMain, parentPort, or a test channel). */
export type PortLike = {
  postMessage(message: unknown): void
  onMessage(listener: (data: unknown) => void): void
  close(): void
}
