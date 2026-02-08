import { describe, expect, it } from 'vitest'
import {
  canHandOverForAuthoritySource,
  VIEWER_ONLY_PREFERENCE_SCOPE,
  canForceTakeover,
  canPerformHandoverAction,
  canPerformLockRecoveryAction,
  canPerformWriteAction,
  canRequestControl,
} from './controller-permissions'

describe('controller permission guards', () => {
  it('readOnly + not viewerOnly allows lock recovery but blocks write actions', () => {
    expect(canPerformLockRecoveryAction({ viewerOnly: false, isCloudOffline: false })).toBe(true)
    expect(canPerformWriteAction({ viewerOnly: false, isReadOnly: true })).toBe(false)
  })

  it('viewerOnly blocks lock recovery and write actions', () => {
    expect(canPerformLockRecoveryAction({ viewerOnly: true, isCloudOffline: false })).toBe(false)
    expect(canPerformWriteAction({ viewerOnly: true, isReadOnly: false })).toBe(false)
  })

  it('authoritative + canHandOver true enables handover', () => {
    expect(
      canPerformHandoverAction({
        viewerOnly: false,
        canHandOver: true,
        lockState: 'authoritative',
      }),
    ).toBe(true)
  })

  it('allows handover source gate during pending authority reconnect windows', () => {
    expect(
      canHandOverForAuthoritySource({
        authoritySource: 'pending',
        isCloudOffline: false,
      }),
    ).toBe(true)
  })

  it('keeps handover source gate blocked when authority source is unknown', () => {
    expect(
      canHandOverForAuthoritySource({
        authoritySource: undefined,
        isCloudOffline: false,
      }),
    ).toBe(false)
  })

  it('cloud offline disables lock recovery even when not viewerOnly', () => {
    expect(canPerformLockRecoveryAction({ viewerOnly: false, isCloudOffline: true })).toBe(false)
  })

  it('invalid force/request conditions remain blockable via existing non-permission constraints', () => {
    expect(canPerformLockRecoveryAction({ viewerOnly: false, isCloudOffline: false })).toBe(true)
    expect(
      canRequestControl({
        lockRecoveryAllowed: true,
        lockState: 'requesting',
      }),
    ).toBe(false)
    expect(
      canForceTakeover({
        lockRecoveryAllowed: true,
        forceTakeoverInFlight: false,
        forceTakeoverReady: false,
        canForceNow: false,
      }),
    ).toBe(false)
  })

  it('viewerOnly preference is explicit tab-local ephemeral contract', () => {
    expect(VIEWER_ONLY_PREFERENCE_SCOPE).toBe('ephemeral')
  })
})
