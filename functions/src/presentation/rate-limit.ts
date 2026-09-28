import { createHmac } from 'crypto'
import { isIP } from 'net'
import * as functions from 'firebase-functions'
import { COLLECTIONS, HOUR_MS, MINUTE_MS, serverSecret } from './config'
import { db } from './firestore'

/**
 * Distributed fixed-window rate limits (endpoints: "Distributed rate-limit
 * contract"). Buckets live in Firestore, keyed by a non-reversible HMAC of
 * operation | scope | windowStart, so every Functions instance shares them.
 */

export type LimitRule = { operation: string; limit: number; windowMs: number }

export const RATE_LIMITS = {
  publisherAuthPerIp: { operation: 'publisher-auth-ip', limit: 10, windowMs: MINUTE_MS },
  createPerOwner: { operation: 'create-owner', limit: 5, windowMs: MINUTE_MS },
  resumePerDevice: { operation: 'resume-device', limit: 10, windowMs: MINUTE_MS },
  refreshPerDevice: { operation: 'refresh-device', limit: 30, windowMs: MINUTE_MS },
  linkMutationPerSession: { operation: 'link-mutation-session', limit: 10, windowMs: MINUTE_MS },
  resolvePerIp: { operation: 'resolve-ip', limit: 30, windowMs: MINUTE_MS },
  /** Counts failed resolutions only, so a revoked-link holder cannot block valid viewers. */
  resolvePerSession: { operation: 'resolve-session', limit: 60, windowMs: MINUTE_MS },
  publishPerSession: { operation: 'publish-session', limit: 5, windowMs: 1_000 },
  endPerSession: { operation: 'end-session', limit: 10, windowMs: MINUTE_MS },
} satisfies Record<string, LimitRule>

export type BucketMeta = { scopeHash: string; operation: string; windowStartMs: number; windowMs: number; cleanupAfterMs: number }

/** Atomic read-increment-commit of one bucket; `allowed: false` when already at the limit. */
export type LimiterStore = { increment: (key: string, limit: number, meta: BucketMeta) => Promise<{ allowed: boolean }> }

export function fixedWindow(nowMs: number, windowMs: number): { windowStartMs: number; retryAfterMs: number } {
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs
  return { windowStartMs, retryAfterMs: windowStartMs + windowMs - nowMs }
}

function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

export function bucketKey(secret: string, operation: string, scope: string, windowStartMs: number): string {
  return hmacHex(secret, `${operation}|${scope}|${windowStartMs}`)
}

/**
 * Canonical rate-limit identity for a client address: IPv4 (including
 * IPv4-mapped IPv6) as-is, IPv6 truncated to its /64. Null when absent/invalid.
 */
export function normalizeClientIp(ip: string | undefined): string | null {
  if (!ip) return null
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  const candidate = mapped ? mapped[1] : ip
  const kind = isIP(candidate)
  if (kind === 4) return candidate
  if (kind !== 6) return null
  const lower = candidate.toLowerCase()
  const [head, tail = ''] = lower.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const hextets = lower.includes('::')
    ? [...headParts, ...Array<string>(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
    : headParts
  return `${hextets.slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`
}

/**
 * HMAC scope for a caller address so raw IPs are never stored. A missing or
 * invalid address fails closed rather than sharing one global bucket.
 */
export function ipScope(ip: string | undefined): string {
  // The Functions emulator proxies callables without a client address; treat it as loopback there only.
  const normalized = normalizeClientIp(ip) ?? (process.env.FUNCTIONS_EMULATOR === 'true' ? '127.0.0.1' : null)
  if (normalized === null) {
    functions.logger.error('presentation rate limiter missing client IP', { alert: 'rate-limiter-no-ip' })
    throw new functions.https.HttpsError('unavailable', 'Temporarily unavailable; retry shortly.')
  }
  return `ip:${hmacHex(serverSecret(), normalized)}`
}

export const firestoreLimiterStore: LimiterStore = {
  increment: (key, limit, meta) =>
    db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.rateLimits).doc(key)
      const snap = await tx.get(ref)
      const count = snap.exists ? (snap.get('count') as number) : 0
      if (count >= limit) return { allowed: false }
      tx.set(ref, { ...meta, count: count + 1 })
      return { allowed: true }
    }),
}

/**
 * Emulator-only scaling so multi-case contract suites from one loopback IP do
 * not trip production limits; the dedicated limiter suite runs unscaled.
 */
function effectiveLimit(limit: number): number {
  const multiplier = Number(process.env.PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER)
  return process.env.FUNCTIONS_EMULATOR === 'true' && Number.isInteger(multiplier) && multiplier > 1 ? limit * multiplier : limit
}

type EnforceOptions = {
  /** Publication proceeds on limiter failure (with an alert); auth/admission fails closed. */
  failOpen: boolean
  nowMs?: number
  store?: LimiterStore
  secret?: string
  alert?: (fields: { operation: string; alert: string }) => void
}

export async function enforceRateLimit(rule: LimitRule, scope: string, options: EnforceOptions): Promise<void> {
  const nowMs = options.nowMs ?? Date.now()
  const secret = options.secret ?? serverSecret()
  const { windowStartMs, retryAfterMs } = fixedWindow(nowMs, rule.windowMs)
  const meta: BucketMeta = {
    scopeHash: hmacHex(secret, scope),
    operation: rule.operation,
    windowStartMs,
    windowMs: rule.windowMs,
    cleanupAfterMs: windowStartMs + rule.windowMs + HOUR_MS,
  }
  let allowed: boolean
  try {
    ;({ allowed } = await (options.store ?? firestoreLimiterStore).increment(
      bucketKey(secret, rule.operation, scope, windowStartMs),
      effectiveLimit(rule.limit),
      meta,
    ))
  } catch {
    const fields = { operation: rule.operation, alert: 'rate-limiter-unavailable' }
    if (options.failOpen) {
      ;(options.alert ?? ((f) => functions.logger.error('presentation rate limiter unavailable', f)))(fields)
      return
    }
    throw new functions.https.HttpsError('unavailable', 'Temporarily unavailable; retry shortly.')
  }
  if (!allowed) {
    throw new functions.https.HttpsError('resource-exhausted', 'Rate limit exceeded.', { retryAfterMs })
  }
}
