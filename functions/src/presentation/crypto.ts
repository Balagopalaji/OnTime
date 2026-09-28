import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

export function randomUrlSafe(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))) == challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const derived = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  return timingSafeEqualString(derived, codeChallenge)
}

/** Deterministic JSON with sorted object keys, for request hashing. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function requestHash(operation: string, request: unknown): string {
  return sha256Hex(`${operation}\n${canonicalJson(request)}`)
}

/**
 * Viewer-link token derived from the server secret and a stored nonce, so a
 * lost-response retry can return the same URL without ever storing the
 * plaintext token. Only the token's SHA-256 is stored as the link document ID.
 */
export function deriveViewerLinkToken(secret: string, sessionId: string, linkNonce: string): string {
  return createHmac('sha256', secret).update(`viewer-link|${sessionId}|${linkNonce}`, 'utf8').digest('base64url')
}

/** One read-only viewer principal per session generation (bounded Auth user growth; deleted by cleanup). */
export function presentationViewerUid(sessionId: string, viewerGeneration: number): string {
  return `ppv_${sha256Hex(`${sessionId}|${viewerGeneration}`).slice(0, 40)}`
}

export function linkTokenHash(token: string): string {
  return sha256Hex(`viewer-link-token|${token}`)
}

/** True when `linkNonce` under `secret` still derives the stored link document ID (false after a secret rotation). */
export function isCurrentLinkNonce(secret: string, sessionId: string, linkNonce: string, linkDocId: string | null): boolean {
  return linkDocId !== null && linkTokenHash(deriveViewerLinkToken(secret, sessionId, linkNonce)) === linkDocId
}
