import { describe, expect, it, vi } from 'vitest'
import { BROWSER_SECURITY, safeOpenUpsell, shouldDenyNavigation, shouldDenyNewWindow } from './security'

describe('browser security policy (S-024/S-033)', () => {
  it('locks down the renderer: context isolation + sandbox, no node integration', () => {
    expect(BROWSER_SECURITY.contextIsolation).toBe(true)
    expect(BROWSER_SECURITY.sandbox).toBe(true)
    expect(BROWSER_SECURITY.nodeIntegration).toBe(false)
    expect(BROWSER_SECURITY.webSecurity).toBe(true)
    expect(BROWSER_SECURITY.allowRunningInsecureContent).toBe(false)
  })

  it('denies all in-app navigation and all new windows', () => {
    expect(shouldDenyNavigation()).toBe(true)
    expect(shouldDenyNewWindow()).toBe(true)
  })
})

describe('safeOpenUpsell (S-033)', () => {
  it('opens the exact configured URL in the default browser when available', async () => {
    const openExternal = vi.fn(async () => undefined)
    const opened = await safeOpenUpsell({ url: 'https://ontime.app', ctaAvailable: true }, openExternal)
    expect(opened).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://ontime.app')
  })

  it('never opens anything when the CTA is unavailable (no URL configured)', async () => {
    const openExternal = vi.fn(async () => undefined)
    const opened = await safeOpenUpsell({ url: null, ctaAvailable: false }, openExternal)
    expect(opened).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
