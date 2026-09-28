import { describe, expect, it, vi } from 'vitest'
import { RATE_LIMITS, bucketKey, enforceRateLimit, fixedWindow, normalizeClientIp, type LimiterStore } from './rate-limit'

const SECRET = 's'.repeat(32)

/** In-memory bucket store with the same read-increment-commit contract as the Firestore transaction. */
function memoryStore(): LimiterStore & { buckets: Map<string, number> } {
  const buckets = new Map<string, number>()
  return {
    buckets,
    increment: async (key, limit) => {
      const count = buckets.get(key) ?? 0
      if (count >= limit) return { allowed: false }
      buckets.set(key, count + 1)
      return { allowed: true }
    },
  }
}

describe('fixed-window rate limiting', () => {
  it('aligns windows and reports the time until the next window', () => {
    // Defect: a sliding or misaligned window lets bursts straddle two buckets.
    expect(fixedWindow(125_400, 60_000)).toEqual({ windowStartMs: 120_000, retryAfterMs: 54_600 })
  })

  it('derives non-reversible keys that separate operation, scope, and window', () => {
    // Defect: raw IPs/UIDs stored as document IDs, or buckets shared across operations.
    const key = bucketKey(SECRET, 'resolve-ip', '203.0.113.9', 120_000)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('203.0.113.9')
    expect(bucketKey(SECRET, 'resolve-ip', '203.0.113.9', 120_000)).toBe(key)
    expect(bucketKey(SECRET, 'resolve-session', '203.0.113.9', 120_000)).not.toBe(key)
    expect(bucketKey(SECRET, 'resolve-ip', '203.0.113.10', 120_000)).not.toBe(key)
    expect(bucketKey(SECRET, 'resolve-ip', '203.0.113.9', 180_000)).not.toBe(key)
  })

  it('allows exactly the limit per window, then resource-exhausted with retryAfterMs', async () => {
    const store = memoryStore()
    const rule = { operation: 'test-op', limit: 3, windowMs: 60_000 }
    for (let i = 0; i < 3; i += 1) {
      await enforceRateLimit(rule, 'scope-a', { failOpen: false, nowMs: 125_000, store, secret: SECRET })
    }
    await expect(
      enforceRateLimit(rule, 'scope-a', { failOpen: false, nowMs: 125_000, store, secret: SECRET }),
    ).rejects.toMatchObject({ code: 'resource-exhausted', details: { retryAfterMs: 55_000 } })
    // A different scope and the next window are independent.
    await enforceRateLimit(rule, 'scope-b', { failOpen: false, nowMs: 125_000, store, secret: SECRET })
    await enforceRateLimit(rule, 'scope-a', { failOpen: false, nowMs: 180_000, store, secret: SECRET })
  })

  it('fails closed with unavailable for sensitive operations when the store fails', async () => {
    // Defect: an auth/link limiter outage silently disables abuse protection.
    const store: LimiterStore = { increment: async () => Promise.reject(new Error('firestore down')) }
    await expect(
      enforceRateLimit(RATE_LIMITS.resolvePerIp, 'ip', { failOpen: false, nowMs: 1, store, secret: SECRET }),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('fails open with a high-severity alert for publication when the store fails', async () => {
    // Defect: a limiter outage disconnects an active show.
    const store: LimiterStore = { increment: async () => Promise.reject(new Error('firestore down')) }
    const alert = vi.fn()
    await expect(
      enforceRateLimit(RATE_LIMITS.publishPerSession, 'sess', { failOpen: true, nowMs: 1, store, secret: SECRET, alert }),
    ).resolves.toBeUndefined()
    expect(alert).toHaveBeenCalledWith({ operation: 'publish-session', alert: 'rate-limiter-unavailable' })
  })

  it.each([
    ['203.0.113.9', '203.0.113.9'],
    // Defect: a dual-stack IPv4-mapped address gets a different bucket than plain IPv4.
    ['::ffff:203.0.113.9', '203.0.113.9'],
    // Defect: rotating addresses within one IPv6 /64 bypasses the per-IP limit.
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:ffff::9', '2001:db8:0:0::/64'],
    // Defect: requests without an IP share one global bucket anyone can exhaust.
    [undefined, null],
    ['', null],
    ['not-an-ip', null],
  ])('normalizes client IP %j to %j', (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected)
  })

  it('uses the contractual default limits', () => {
    // Defect: silently loosened limits (endpoints: distributed rate-limit contract).
    expect(
      Object.fromEntries(Object.values(RATE_LIMITS).map((rule) => [rule.operation, [rule.limit, rule.windowMs]])),
    ).toEqual({
      'publisher-auth-ip': [10, 60_000],
      'create-owner': [5, 60_000],
      'resume-device': [10, 60_000],
      'refresh-device': [30, 60_000],
      'link-mutation-session': [10, 60_000],
      'resolve-ip': [30, 60_000],
      'resolve-session': [60, 60_000],
      'publish-session': [5, 1_000],
      'end-session': [10, 60_000],
    })
  })
})
