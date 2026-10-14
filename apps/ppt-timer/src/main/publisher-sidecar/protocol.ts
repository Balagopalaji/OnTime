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
const CHALLENGE_ID = /^[A-Za-z0-9_-]{22,64}$/
const AUTH_CODE = /^[A-Za-z0-9_-]{43}$/
/**
 * Sealed credential payloads are small JSON strings, opaque to main. They are
 * bounded by serialized UTF-8 size (escapes included), so any request or result
 * carrying one stays well inside the 64 KiB envelope.
 */
export const SEALED_DATA_MAX_BYTES = 16 * 1024
export const sealedDataFits = (data: string) => new TextEncoder().encode(JSON.stringify(data)).length <= SEALED_DATA_MAX_BYTES

export type SafeErrorCode = 'protocol-violation' | 'not-sharing' | 'invalid-candidate' | 'internal'
export type StorageError = 'encryption-unavailable' | 'not-found' | 'corrupt' | 'too-large' | 'io'
type StorageResult<K extends string> = { kind: K; nonce: string; requestId: number } & ({ ok: true } | { ok: false; error: StorageError })
export type ShareState = 'idle' | 'starting' | 'sharing' | 'stopping'
/** Safe cloud-share status for the visible share UI (no URLs, tokens, or error bodies). */
export const SHARE_STATUSES = [
  'connecting',
  'awaiting-approval',
  'live',
  'retrying',
  'paused',
  'ended',
  'signed-out',
  'storage-unavailable',
  'approval-failed',
  'not-configured',
] as const
export type ShareStatus = (typeof SHARE_STATUSES)[number]
/** Safe LAN-publish status (ISSUE-002 S9c): no URLs, room IDs, tokens, or error bodies. */
export const LAN_STATUSES = ['connecting', 'live', 'retrying', 'paused', 'ended', 'unavailable'] as const
export type LanStatus = (typeof LAN_STATUSES)[number]

export type Hello = { kind: 'HELLO'; nonce: string; protocolMajor: 1; maxMessageBytes: number; capabilities: string[] }
export type MainToSidecar =
  | Hello
  | { kind: 'SHARE_START'; nonce: string; id: number }
  | { kind: 'SHARE_STOP'; nonce: string; id: number }
  | { kind: 'END_SESSION'; nonce: string; id: number }
  /** Revoke this publisher device and clear its sealed credential. */
  | { kind: 'SIGN_OUT'; nonce: string; id: number }
  | { kind: 'SNAPSHOT_CANDIDATE'; nonce: string; id: number; candidate: RemoteSnapshotCandidateV1 }
  | { kind: 'SHUTDOWN'; nonce: string; id: number; deadlineMs: number }
  /** Relays the one-time approval code from the app's registered callback URI. */
  | { kind: 'AUTH_CALLBACK'; nonce: string; id: number; challengeId: string; code: string }
  | StorageResult<'SEAL_RESULT'>
  | ({ kind: 'UNSEAL_RESULT'; nonce: string; requestId: number } & ({ ok: true; data: string } | { ok: false; error: StorageError }))
  | StorageResult<'CLEAR_RESULT'>
export type SidecarToMain =
  | { kind: 'READY'; nonce: string; protocolMajor: 1; capabilities: string[] }
  | { kind: 'ACK'; nonce: string; id: number }
  | { kind: 'NACK'; nonce: string; id: number; code: SafeErrorCode }
  | { kind: 'SHARE_STATE'; nonce: string; state: ShareState }
  | { kind: 'SAFE_ERROR'; nonce: string; code: SafeErrorCode }
  | { kind: 'SHUTDOWN_COMPLETE'; nonce: string }
  | { kind: 'PUBLISH_STATUS'; nonce: string; status: ShareStatus }
  /** LAN publisher status, independent of the cloud `PUBLISH_STATUS`; only sent when LAN is configured. */
  | { kind: 'LAN_STATUS'; nonce: string; status: LanStatus }
  /** Validated viewer URL (token only in the fragment); main shows it only in the explicit share UI. */
  | { kind: 'VIEWER_LINK'; nonce: string; url: string }
  /** Validated HTTPS approval URL for `shell.openExternal`; carries only the challenge ID. */
  | { kind: 'AUTH_REQUIRED'; nonce: string; url: string }
  | { kind: 'SEAL_REQUEST'; nonce: string; requestId: number; data: string }
  | { kind: 'UNSEAL_REQUEST'; nonce: string; requestId: number }
  | { kind: 'CLEAR_SEALED'; nonce: string; requestId: number }

export type ProtocolError =
  | 'invalid-shape'
  | 'oversize'
  | 'unknown-kind'
  | 'unknown-key'
  | 'wrong-nonce'
  | 'incompatible-major'
  | 'invalid-field'
export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolError }

/** Required keys, then optional keys (whose presence each parser validates). */
type KeySpec = readonly [required: readonly string[], optional?: readonly string[]]
const RESULT_KEYS: KeySpec = [['kind', 'nonce', 'requestId', 'ok'], ['error']]
const MAIN_KEYS: Record<MainToSidecar['kind'], KeySpec> = {
  HELLO: [['kind', 'nonce', 'protocolMajor', 'maxMessageBytes', 'capabilities']],
  SHARE_START: [['kind', 'nonce', 'id']],
  SHARE_STOP: [['kind', 'nonce', 'id']],
  END_SESSION: [['kind', 'nonce', 'id']],
  SIGN_OUT: [['kind', 'nonce', 'id']],
  SNAPSHOT_CANDIDATE: [['kind', 'nonce', 'id', 'candidate']],
  SHUTDOWN: [['kind', 'nonce', 'id', 'deadlineMs']],
  AUTH_CALLBACK: [['kind', 'nonce', 'id', 'challengeId', 'code']],
  SEAL_RESULT: RESULT_KEYS,
  UNSEAL_RESULT: [['kind', 'nonce', 'requestId', 'ok'], ['error', 'data']],
  CLEAR_RESULT: RESULT_KEYS,
}
const SIDECAR_KEYS: Record<SidecarToMain['kind'], KeySpec> = {
  READY: [['kind', 'nonce', 'protocolMajor', 'capabilities']],
  ACK: [['kind', 'nonce', 'id']],
  NACK: [['kind', 'nonce', 'id', 'code']],
  SHARE_STATE: [['kind', 'nonce', 'state']],
  SAFE_ERROR: [['kind', 'nonce', 'code']],
  SHUTDOWN_COMPLETE: [['kind', 'nonce']],
  PUBLISH_STATUS: [['kind', 'nonce', 'status']],
  LAN_STATUS: [['kind', 'nonce', 'status']],
  VIEWER_LINK: [['kind', 'nonce', 'url']],
  AUTH_REQUIRED: [['kind', 'nonce', 'url']],
  SEAL_REQUEST: [['kind', 'nonce', 'requestId', 'data']],
  UNSEAL_REQUEST: [['kind', 'nonce', 'requestId']],
  CLEAR_SEALED: [['kind', 'nonce', 'requestId']],
}
export const MAIN_TO_SIDECAR_KINDS = Object.keys(MAIN_KEYS) as ReadonlyArray<MainToSidecar['kind']>
export const SIDECAR_TO_MAIN_KINDS = Object.keys(SIDECAR_KEYS) as ReadonlyArray<SidecarToMain['kind']>

const SAFE_CODES: readonly SafeErrorCode[] = ['protocol-violation', 'not-sharing', 'invalid-candidate', 'internal']
const SHARE_STATES: readonly ShareState[] = ['idle', 'starting', 'sharing', 'stopping']
const STORAGE_ERRORS: readonly StorageError[] = ['encryption-unavailable', 'not-found', 'corrupt', 'too-large', 'io']

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
  keys: Record<K, KeySpec>,
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
  const [required, optional = []] = keys[kind as K]
  const present = Object.keys(record)
  if (present.some((key) => !required.includes(key) && !optional.includes(key)) || required.some((key) => !(key in record))) {
    fail('unknown-key')
  }
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

function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail('invalid-field')
  return value as string
}

/** Storage results: `ok: true` carries nothing else (or only `data` for unseal); `ok: false` only an enumerated error. */
function storageOutcome(record: Record<string, unknown>, allowData: boolean): { ok: true; data?: string } | { ok: false; error: StorageError } {
  if (record.ok === true) {
    if ('error' in record) fail('invalid-field')
    if (!allowData) {
      if ('data' in record) fail('invalid-field')
      return { ok: true }
    }
    if (typeof record.data !== 'string' || !sealedDataFits(record.data)) fail('invalid-field')
    return { ok: true, data: record.data as string }
  }
  if (record.ok !== false || 'data' in record || !STORAGE_ERRORS.includes(record.error as StorageError)) fail('invalid-field')
  return { ok: false, error: record.error as StorageError }
}

/**
 * Approval URLs: HTTPS (or loopback HTTP for the emulator), the fixed approval
 * path, and exactly one `challenge` parameter — no token or other data. The
 * allowed origin is enforced by main before opening.
 */
export function isApprovalUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !loopback) return false
  if (url.username || url.password || url.hash || url.pathname !== '/publisher/device/approve') return false
  const params = [...url.searchParams.keys()]
  return params.length === 1 && params[0] === 'challenge' && CHALLENGE_ID.test(url.searchParams.get('challenge') ?? '')
}

const VIEWER_PATH = /^\/session\/[A-Za-z0-9_-]{1,128}\/view$/
const VIEWER_HASH = /^#token=[A-Za-z0-9_-]{32,128}$/

/** Viewer URLs: HTTPS (or loopback HTTP), `/session/<id>/view`, no query, token only in the fragment. */
export function isViewerUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !loopback) return false
  return !url.username && !url.password && !url.search && VIEWER_PATH.test(url.pathname) && VIEWER_HASH.test(url.hash)
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
    if (kind === 'SEAL_RESULT' || kind === 'CLEAR_RESULT' || kind === 'UNSEAL_RESULT') {
      const requestId = integer(record.requestId, 0, Number.MAX_SAFE_INTEGER)
      return { kind, nonce, requestId, ...storageOutcome(record, kind === 'UNSEAL_RESULT') } as MainToSidecar
    }
    const id = integer(record.id, 0, Number.MAX_SAFE_INTEGER)
    switch (kind) {
      case 'AUTH_CALLBACK':
        return { kind, nonce, id, challengeId: matching(record.challengeId, CHALLENGE_ID), code: matching(record.code, AUTH_CODE) }
      case 'SNAPSHOT_CANDIDATE': {
        const parsed = parseRemoteSnapshotCandidateV1(record.candidate)
        if (!parsed.ok) fail('invalid-field')
        return { kind, nonce, id, candidate: (parsed as { value: RemoteSnapshotCandidateV1 }).value }
      }
      case 'SHUTDOWN':
        return { kind, nonce, id, deadlineMs: integer(record.deadlineMs, 1, 60_000) }
      default:
        return { kind: kind as 'SHARE_START' | 'SHARE_STOP' | 'END_SESSION' | 'SIGN_OUT', nonce, id }
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
      case 'PUBLISH_STATUS':
        if (!SHARE_STATUSES.includes(record.status as ShareStatus)) fail('invalid-field')
        return { kind, nonce, status: record.status as ShareStatus }
      case 'LAN_STATUS':
        if (!LAN_STATUSES.includes(record.status as LanStatus)) fail('invalid-field')
        return { kind, nonce, status: record.status as LanStatus }
      case 'VIEWER_LINK':
        if (typeof record.url !== 'string' || !isViewerUrl(record.url)) fail('invalid-field')
        return { kind, nonce, url: record.url as string }
      case 'AUTH_REQUIRED':
        if (typeof record.url !== 'string' || !isApprovalUrl(record.url)) fail('invalid-field')
        return { kind, nonce, url: record.url as string }
      case 'SEAL_REQUEST':
        if (typeof record.data !== 'string' || !sealedDataFits(record.data)) fail('invalid-field')
        return { kind, nonce, requestId: integer(record.requestId, 0, Number.MAX_SAFE_INTEGER), data: record.data as string }
      case 'UNSEAL_REQUEST':
      case 'CLEAR_SEALED':
        return { kind, nonce, requestId: integer(record.requestId, 0, Number.MAX_SAFE_INTEGER) }
    }
  })
}
