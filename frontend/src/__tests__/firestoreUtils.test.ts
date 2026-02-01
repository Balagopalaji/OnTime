import { describe, expect, it } from 'vitest'
import { toMillis } from '../lib/firestore-utils'

describe('firestore-utils toMillis', () => {
  it('returns number for numeric input', () => {
    expect(toMillis(1234)).toBe(1234)
  })

  it('returns number for Timestamp-like input', () => {
    const ts = { toMillis: () => 5678 }
    expect(toMillis(ts)).toBe(5678)
  })

  it('returns null for unsupported input', () => {
    expect(toMillis(null)).toBeNull()
    expect(toMillis(undefined)).toBeNull()
    expect(toMillis({})).toBeNull()
  })
})
