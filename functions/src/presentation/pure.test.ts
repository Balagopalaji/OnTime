import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  deriveViewerLinkToken,
  isCurrentLinkNonce,
  linkTokenHash,
  requestHash,
  verifyPkceS256,
} from './crypto'
import { PATTERNS, parseRequest } from './requests'

describe('verifyPkceS256', () => {
  // RFC 7636 Appendix B test vector.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

  it('accepts the RFC 7636 S256 vector', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it.each([
    // Defect: a plain (non-hashed) comparison accepts the challenge as its own verifier.
    [challenge, challenge],
    [`${verifier}x`, challenge],
    [verifier, challenge.slice(0, -1)],
  ])('rejects verifier %s for challenge %s', (v, c) => {
    expect(verifyPkceS256(v, c)).toBe(false)
  })
})

describe('request hashing', () => {
  it('is independent of key order and ignores undefined fields', () => {
    // Defect: a retry serialised with different key order is treated as a mismatch.
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: undefined } })).toBe('{"a":{"d":[1,{"e":3,"f":2}]},"b":1}')
    expect(requestHash('op', { a: 1, b: 2 })).toBe(requestHash('op', { b: 2, a: 1 }))
  })

  it('separates operations and values', () => {
    // Defect: the same clientRequestId reused across operations returns another operation's result.
    expect(requestHash('create', { a: 1 })).not.toBe(requestHash('resume', { a: 1 }))
    expect(requestHash('create', { a: 1 })).not.toBe(requestHash('create', { a: 2 }))
  })
})

describe('viewer link tokens', () => {
  it('derive deterministically from secret, session, and nonce', () => {
    // Defect: a lost-response retry cannot return the same URL, or tokens collide across sessions.
    const token = deriveViewerLinkToken('s'.repeat(32), 'sess1', 'nonce1')
    expect(deriveViewerLinkToken('s'.repeat(32), 'sess1', 'nonce1')).toBe(token)
    expect(deriveViewerLinkToken('s'.repeat(32), 'sess2', 'nonce1')).not.toBe(token)
    expect(deriveViewerLinkToken('s'.repeat(32), 'sess1', 'nonce2')).not.toBe(token)
    expect(deriveViewerLinkToken('t'.repeat(32), 'sess1', 'nonce1')).not.toBe(token)
    expect(PATTERNS.viewerToken.test(token)).toBe(true)
  })

  it('recognises a stored link only under the secret that minted it', () => {
    // Defect: after a secret rotation, issue/replay hands out a URL whose hash matches no link.
    const token = deriveViewerLinkToken('s'.repeat(32), 'sess1', 'nonce1')
    const docId = linkTokenHash(token)
    expect(isCurrentLinkNonce('s'.repeat(32), 'sess1', 'nonce1', docId)).toBe(true)
    expect(isCurrentLinkNonce('r'.repeat(32), 'sess1', 'nonce1', docId)).toBe(false)
    expect(isCurrentLinkNonce('s'.repeat(32), 'sess1', 'nonce1', null)).toBe(false)
  })

  it('stores only a hash that differs from the token', () => {
    const token = deriveViewerLinkToken('s'.repeat(32), 'sess1', 'nonce1')
    expect(linkTokenHash(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(linkTokenHash(token)).not.toContain(token)
  })
})

describe('parseRequest', () => {
  const spec = {
    clientRequestId: { pattern: PATTERNS.clientRequestId },
    roomId: { pattern: PATTERNS.roomId, optional: true },
  }

  it('returns only the declared fields', () => {
    expect(parseRequest({ clientRequestId: 'req_12345678' }, spec)).toEqual({ clientRequestId: 'req_12345678' })
    expect(parseRequest({ clientRequestId: 'req_12345678', roomId: 'room-1' }, spec)).toEqual({
      clientRequestId: 'req_12345678',
      roomId: 'room-1',
    })
  })

  it.each([
    // Defect: extra fields (e.g. forged ownerUid) pass through to the transaction.
    [{ clientRequestId: 'req_12345678', ownerUid: 'victim' }, 'ownerUid'],
    [JSON.parse('{"clientRequestId":"req_12345678","__proto__":{"x":1}}'), '__proto__'],
    [{}, 'clientRequestId'],
    [{ clientRequestId: 'short' }, 'clientRequestId'],
    [{ clientRequestId: 12345678 }, 'clientRequestId'],
    [{ clientRequestId: 'req_12345678', roomId: 'rooms/abc' }, 'roomId'],
    [null, 'request'],
    [['clientRequestId'], 'request'],
  ])('rejects %j naming %s', (data, field) => {
    expect(() => parseRequest(data, spec)).toThrowError(`Invalid request field: ${field}`)
  })
})
