import { describe, expect, it, vi } from 'vitest'

const baseInput = () => ({
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

describe('arbitrate mode bias', () => {
  it('selects local source in ambiguous near-equal cases when mode is local', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')

    const decision = arbitrate({
      ...baseInput(),
      roomId: 'mode-bias-local',
      mode: 'local',
      effectiveMode: 'local',
    })

    expect(decision.acceptSource).toBe('companion')
    expect(decision.reason).toBe('mode bias')
  })

  it('selects cloud source in ambiguous near-equal cases when mode is cloud', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')

    const decision = arbitrate({
      ...baseInput(),
      roomId: 'mode-bias-cloud',
      mode: 'cloud',
      effectiveMode: 'cloud',
    })

    expect(decision.acceptSource).toBe('cloud')
    expect(decision.reason).toBe('mode bias')
  })

  it('uses companion preference in auto mode when companion is connected', async () => {
    vi.resetModules()
    const { arbitrate } = await import('./arbitration')

    const decision = arbitrate({
      ...baseInput(),
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
