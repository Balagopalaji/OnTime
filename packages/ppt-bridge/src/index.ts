import { PptBridgeClientImpl } from './process-client.js'

export * from './protocol.js'
export * from './validate-response.js'
export * from './diagnostics.js'
export {
  PptBridgeClientImpl,
  type PptBridgeClient,
  type PptBridgeClientOptions,
} from './process-client.js'

export function createPptBridgeClient(options: import('./process-client.js').PptBridgeClientOptions): import('./process-client.js').PptBridgeClient {
  return new PptBridgeClientImpl(options)
}

export { PowerPointSession } from './powerpoint-session.js'
export type {
  PowerPointSessionOptions,
  PowerPointSessionTransport,
} from './powerpoint-session.js'
