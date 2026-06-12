import { describe, expect, it, vi } from 'vitest'
import type { ArbitrationDecision, ArbitrationLastAcceptedCache } from './index'

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

const createLastAcceptedSourceCache = (): ArbitrationLastAcceptedCache => {
  const cache = new Map<string, ArbitrationDecision['acceptSource']>()

  return {
    get: (key) => cache.get(key),
    set: (key, source) => {
      cache.set(key, source)
    },
  }
}

describe('arbitrate', () => {
  it('preserves the current rollout flags', async () => {
    vi.resetModules()
    const { ARBITRATION_FLAGS } = await import('./index')

    expect(ARBITRATION_FLAGS).toEqual({
      room: true,
      lock: true,
      pin: false,
      timer: false,
      cue: false,
      liveCue: false,
    })
  })

  it('calls the optional decision hook without owning environment logging', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
    const onDecision = vi.fn()
    const input = { ...baseInput(), companionTs: 1500 }

    const decision = arbitrate(input, { onDecision })

    expect(decision.acceptSource).toBe('cloud')
    expect(onDecision).toHaveBeenCalledWith(input, decision)
  })

  it('prefers hold source within window', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
    const options = { lastAcceptedSourceCache: createLastAcceptedSourceCache() }
    const online = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    }, options)
    expect(online.acceptSource).toBe('companion')

    const offline = arbitrate({
      ...baseInput(),
      isCompanionLive: false,
      cloudOnline: false,
      cloudTs: null,
      companionTs: null,
    }, options)
    expect(offline.acceptSource).toBe('companion')
    expect(offline.reason).toBe('no data')
  })

  it('returns source with data when other side is empty', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
    const options = { lastAcceptedSourceCache: createLastAcceptedSourceCache() }
    const initial = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    }, options)
    expect(initial.acceptSource).toBe('companion')

    const decision = arbitrate({
      ...baseInput(),
      cloudTs: null,
      companionTs: null,
      isCompanionLive: true,
      cloudOnline: true,
    }, options)

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('no data')
  })

  it('does not retain last accepted source without an injected cache', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const initial = arbitrate({
      ...baseInput(),
      cloudTs: 1000,
      companionTs: 10_000,
      confidenceWindowMs: 10,
    })
    expect(initial.acceptSource).toBe('companion')

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
    const { arbitrate } = await import('./index')
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
    const { arbitrate } = await import('./index')
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

describe('arbitrate mode bias', () => {
  const modeBiasInput = () => ({
    roomId: 'mode-bias-room',
    domain: 'room' as const,
    cloudTs: 1_000,
    companionTs: 1_000,
    mode: 'auto' as const,
    effectiveMode: 'cloud' as const,
    isCompanionLive: true,
    cloudOnline: true,
    confidenceWindowMs: 2_000,
  })

  it('selects local source in ambiguous near-equal cases when mode is local', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-local',
      mode: 'local',
      effectiveMode: 'local',
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('mode bias')
  })

  it('selects cloud source in ambiguous near-equal cases when mode is cloud', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-cloud',
      mode: 'cloud',
      effectiveMode: 'cloud',
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('mode bias')
  })

  it('uses companion preference in auto mode when companion is connected', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./index')

    const decision = arbitrate({
      ...modeBiasInput(),
      roomId: 'mode-bias-auto-connected',
      mode: 'auto',
      effectiveMode: 'local',
      isCompanionLive: true,
      cloudOnline: true,
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('mode bias')
  })
})
