import { describe, expect, it, vi } from 'vitest'

const baseInput = () => ({
  roomId: 'room-1',
  domain: 'room' as const,
  cloudTs: 1000,
  companionTs: 900,
  authoritySource: 'cloud' as const,
  mode: 'auto' as const,
  effectiveMode: 'cloud' as const,
  isCompanionLive: true,
  cloudOnline: true,
  confidenceWindowMs: 2000,
})

describe('arbitrate', () => {
  it('prefers hold source within window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const input = {
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1500,
      holdActive: true,
      authoritySource: 'companion' as const,
    }

    const decision = arbitrate(input)
    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('hold active')
  })

  it('skew guard overrides hold window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const input = {
      ...baseInput(),
      cloudTs: 0,
      companionTs: 10 * 60 * 1000 + 1,
      holdActive: true,
      skewThreshold: 10 * 60 * 1000,
    }

    const decision = arbitrate(input)
    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('cloud newer')
  })

  it('uses last accepted when both offline', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const online = arbitrate({ ...baseInput(), companionTs: 1500 })
    expect(online.acceptSource).toBe('cloud')

    const offline = arbitrate({
      ...baseInput(),
      isCompanionLive: false,
      cloudOnline: false,
      cloudTs: null,
      companionTs: null,
    })
    expect(offline.acceptSource).toBe('cloud')
    expect(offline.reason).toBe('no data')
  })

  it('returns source with data when other side is empty', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: 500,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })

  it('uses tie breaker for equal timestamps', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1000,
      controllerTieBreaker: 'companion' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('within window - tie breaker')
  })

  it('uses authority within confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 1200,
      authoritySource: 'companion' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('within window - authority')
  })

  it('newer timestamp wins outside confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('companion newer')
  })

  it('uses last accepted when both online with no data', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const initial = arbitrate({
      ...baseInput(),
      cloudTs: 2000,
      companionTs: 1000,
    })
    expect(initial.acceptSource).toBe('cloud')

    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: null,
      isCompanionLive: true,
      cloudOnline: true,
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('no data')
  })

  it('ignores hold when delta exceeds confidence window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const decision = arbitrate({
      ...baseInput(),
      cloudTs: 0,
      companionTs: 5000,
      confidenceWindowMs: 1000,
      holdActive: true,
      authoritySource: 'cloud' as const,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('companion newer')
  })

  it('skew guard boundary uses threshold strictly', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')
    const atThreshold = arbitrate({
      ...baseInput(),
      cloudTs: 0,
      companionTs: 10 * 60 * 1000,
      skewThreshold: 10 * 60 * 1000,
    })

    expect(atThreshold.acceptSource).toBe('companion')
    expect(atThreshold.reason).toBe('companion newer')

    const overThreshold = arbitrate({
      ...baseInput(),
      cloudTs: 0,
      companionTs: 10 * 60 * 1000 + 1,
      skewThreshold: 10 * 60 * 1000,
    })

    expect(overThreshold.acceptSource).toBe('cloud')
    expect(overThreshold.reason).toBe('cloud newer')
  })
})
