/**
 * Private main ↔ publisher-sidecar protocol (endpoints: "Private sidecar IPC
 * matrix"). A closed union with no PowerPoint, helper, or renderer command:
 * the sidecar can only receive lifecycle commands and strict snapshot
 * candidates. Every message carries the per-spawn nonce; both ends reject
 * unknown kinds/keys, a wrong nonce, an incompatible major, and oversize input.
 */
import { parseRemoteSnapshotCandidateV1, type RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'

export const SIDECAR_PROTOCOL_MAJOR = 1
export const SIDECAR_MAX_MESSAGE_BYTES = 64 * 1024

const NONCE = /^[A-Za-z0-9_-]{22,64}$/
const CAPABILITY = /^[a-z-]{1,32}$/

export type SafeErrorCode = 'protocol-violation' | 'not-sharing' | 'invalid-candidate' | 'internal'
export type ShareState = 'idle' | 'starting' | 'sharing' | 'stopping'

export type Hello = { kind: 'HELLO'; nonce: string; protocolMajor: 1; maxMessageBytes: number; capabilities: string[] }
export type MainToSidecar =
  | Hello
  | { kind: 'SHARE_START'; nonce: string; id: number }
  | { kind: 'SHARE_STOP'; nonce: string; id: number }
  | { kind: 'END_SESSION'; nonce: string; id: number }
  | { kind: 'SNAPSHOT_CANDIDATE'; nonce: string; id: number; candidate: RemoteSnapshotCandidateV1 }
  | { kind: 'SHUTDOWN'; nonce: string; id: number; deadlineMs: number }
export type SidecarToMain =
  | { kind: 'READY'; nonce: string; protocolMajor: 1; capabilities: string[] }
  | { kind: 'ACK'; nonce: string; id: number }
  | { kind: 'NACK'; nonce: string; id: number; code: SafeErrorCode }
  | { kind: 'SHARE_STATE'; nonce: string; state: ShareState }
  | { kind: 'SAFE_ERROR'; nonce: string; code: SafeErrorCode }
  | { kind: 'SHUTDOWN_COMPLETE'; nonce: string }

export type ProtocolError =
  | 'invalid-shape'
  | 'oversize'
  | 'unknown-kind'
  | 'unknown-key'
  | 'wrong-nonce'
  | 'incompatible-major'
  | 'invalid-field'
export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolError }

const MAIN_KEYS: Record<MainToSidecar['kind'], readonly string[]> = {
  HELLO: ['kind', 'nonce', 'protocolMajor', 'maxMessageBytes', 'capabilities'],
  SHARE_START: ['kind', 'nonce', 'id'],
  SHARE_STOP: ['kind', 'nonce', 'id'],
  END_SESSION: ['kind', 'nonce', 'id'],
  SNAPSHOT_CANDIDATE: ['kind', 'nonce', 'id', 'candidate'],
  SHUTDOWN: ['kind', 'nonce', 'id', 'deadlineMs'],
}
const SIDECAR_KEYS: Record<SidecarToMain['kind'], readonly string[]> = {
  READY: ['kind', 'nonce', 'protocolMajor', 'capabilities'],
  ACK: ['kind', 'nonce', 'id'],
  NACK: ['kind', 'nonce', 'id', 'code'],
  SHARE_STATE: ['kind', 'nonce', 'state'],
  SAFE_ERROR: ['kind', 'nonce', 'code'],
  SHUTDOWN_COMPLETE: ['kind', 'nonce'],
}
export const MAIN_TO_SIDECAR_KINDS = Object.keys(MAIN_KEYS) as ReadonlyArray<MainToSidecar['kind']>
export const SIDECAR_TO_MAIN_KINDS = Object.keys(SIDECAR_KEYS) as ReadonlyArray<SidecarToMain['kind']>

const SAFE_CODES: readonly SafeErrorCode[] = ['protocol-violation', 'not-sharing', 'invalid-candidate', 'internal']
const SHARE_STATES: readonly ShareState[] = ['idle', 'starting', 'sharing', 'stopping']

class Reject {
  readonly error: ProtocolError
  constructor(error: ProtocolError) {
    this.error = error
  }
}
const fail = (error: ProtocolError): never => {
  throw new Reject(error)
}

function run<T>(body: () => T): ProtocolResult<T> {
  try {
    return { ok: true, value: body() }
  } catch (caught) {
    if (caught instanceof Reject) return { ok: false, error: caught.error }
    throw caught
  }
}

function sameNonce(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Shape, size, kind, and exact keys; returns the record and its kind. */
function envelope<K extends string>(
  raw: unknown,
  keys: Record<K, readonly string[]>,
  onlyKind?: K,
  maxBytes: number = SIDECAR_MAX_MESSAGE_BYTES,
): { record: Record<string, unknown>; kind: K } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('invalid-shape')
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) fail('invalid-shape')
  let size: number
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length
  } catch {
    return fail('invalid-shape')
  }
  if (size > Math.min(maxBytes, SIDECAR_MAX_MESSAGE_BYTES)) fail('oversize')
  const record = raw as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(keys, kind)) fail('unknown-kind')
  if (onlyKind !== undefined && kind !== onlyKind) fail('unknown-kind')
  const allowed = keys[kind as K]
  if (Object.keys(record).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in record))) fail('unknown-key')
  return { record, kind: kind as K }
}

function nonceOf(record: Record<string, unknown>, expected: string | null): string {
  const nonce = record.nonce
  if (typeof nonce !== 'string' || !NONCE.test(nonce)) fail('invalid-field')
  if (expected !== null && !sameNonce(nonce as string, expected)) fail('wrong-nonce')
  return nonce as string
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('invalid-field')
  return value as number
}

function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8 || value.some((c) => typeof c !== 'string' || !CAPABILITY.test(c))) fail('invalid-field')
  return [...(value as string[])]
}

function major(value: unknown): 1 {
  if (value !== SIDECAR_PROTOCOL_MAJOR) fail('incompatible-major')
  return SIDECAR_PROTOCOL_MAJOR
}

export function parseHello(raw: unknown): ProtocolResult<Hello> {
  return run(() => {
    const { record } = envelope(raw, MAIN_KEYS, 'HELLO')
    const nonce = nonceOf(record, null)
    return {
      kind: 'HELLO',
      nonce,
      protocolMajor: major(record.protocolMajor),
      maxMessageBytes: integer(record.maxMessageBytes, 1_024, 1_048_576),
      capabilities: capabilities(record.capabilities),
    }
  })
}

/** `maxBytes` is the limit negotiated in HELLO (never above SIDECAR_MAX_MESSAGE_BYTES), in UTF-8 bytes. */
export function parseMainToSidecar(raw: unknown, expectedNonce: string, maxBytes = SIDECAR_MAX_MESSAGE_BYTES): ProtocolResult<MainToSidecar> {
  return run((): MainToSidecar => {
    const { record, kind } = envelope(raw, MAIN_KEYS, undefined, maxBytes)
    const nonce = nonceOf(record, expectedNonce)
    if (kind === 'HELLO') fail('unknown-kind')
    const id = integer(record.id, 0, Number.MAX_SAFE_INTEGER)
    switch (kind) {
      case 'SNAPSHOT_CANDIDATE': {
        const parsed = parseRemoteSnapshotCandidateV1(record.candidate)
        if (!parsed.ok) fail('invalid-field')
        return { kind, nonce, id, candidate: (parsed as { value: RemoteSnapshotCandidateV1 }).value }
      }
      case 'SHUTDOWN':
        return { kind, nonce, id, deadlineMs: integer(record.deadlineMs, 1, 60_000) }
      default:
        return { kind: kind as 'SHARE_START' | 'SHARE_STOP' | 'END_SESSION', nonce, id }
    }
  })
}

export function parseSidecarToMain(raw: unknown, expectedNonce: string): ProtocolResult<SidecarToMain> {
  return run((): SidecarToMain => {
    const { record, kind } = envelope(raw, SIDECAR_KEYS)
    const nonce = nonceOf(record, expectedNonce)
    const code = () => {
      if (!SAFE_CODES.includes(record.code as SafeErrorCode)) fail('invalid-field')
      return record.code as SafeErrorCode
    }
    switch (kind) {
      case 'READY':
        return { kind, nonce, protocolMajor: major(record.protocolMajor), capabilities: capabilities(record.capabilities) }
      case 'ACK':
        return { kind, nonce, id: integer(record.id, 0, Number.MAX_SAFE_INTEGER) }
      case 'NACK':
        return { kind, nonce, id: integer(record.id, 0, Number.MAX_SAFE_INTEGER), code: code() }
      case 'SHARE_STATE':
        if (!SHARE_STATES.includes(record.state as ShareState)) fail('invalid-field')
        return { kind, nonce, state: record.state as ShareState }
      case 'SAFE_ERROR':
        return { kind, nonce, code: code() }
      case 'SHUTDOWN_COMPLETE':
        return { kind, nonce }
    }
  })
}
