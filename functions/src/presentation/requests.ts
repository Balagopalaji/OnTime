import * as functions from 'firebase-functions'

/**
 * Strict callable request parsing: plain object, no unknown keys, bounded
 * formats. Every failure is `invalid-argument` naming only the field.
 */

export const PATTERNS = {
  clientRequestId: /^[A-Za-z0-9_-]{8,64}$/,
  challengeId: /^[A-Za-z0-9_-]{22,64}$/,
  /** RFC 7636 S256 challenge: 32-byte SHA-256 in unpadded base64url. */
  codeChallenge: /^[A-Za-z0-9_-]{43}$/,
  /** RFC 7636 verifier alphabet and length. */
  codeVerifier: /^[A-Za-z0-9._~-]{43,128}$/,
  /** One-time approval code delivered only through the app callback URI. */
  authorizationCode: /^[A-Za-z0-9_-]{43}$/,
  callbackScheme: /^[a-z][a-z0-9+.-]{1,63}$/,
  devicePublicKey: /^[A-Za-z0-9_-]{32,2048}$/,
  deviceUid: /^ppd_[A-Za-z0-9_-]{16,64}$/,
  sessionId: /^[A-Za-z0-9_-]{1,128}$/,
  roomId: /^[A-Za-z0-9_-]{1,128}$/,
  viewerToken: /^[A-Za-z0-9_-]{32,128}$/,
  decision: /^(approve|deny)$/,
} as const

export type FieldSpec = { pattern: RegExp; optional?: boolean }

function invalid(field: string): never {
  throw new functions.https.HttpsError('invalid-argument', `Invalid request field: ${field}`)
}

export function parseRequest<K extends string>(
  data: unknown,
  spec: Record<K, FieldSpec>,
): { [P in K]: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid('request')
  const proto = Object.getPrototypeOf(data)
  if (proto !== Object.prototype && proto !== null) invalid('request')
  const record = data as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) invalid(key)
  }
  const out: Record<string, string> = {}
  for (const key of Object.keys(spec) as K[]) {
    const value = record[key]
    const { pattern, optional } = spec[key]
    if (value === undefined || value === null) {
      if (optional) continue
      invalid(key)
    }
    if (typeof value !== 'string' || !pattern.test(value)) invalid(key)
    out[key] = value
  }
  return out as { [P in K]: string }
}
