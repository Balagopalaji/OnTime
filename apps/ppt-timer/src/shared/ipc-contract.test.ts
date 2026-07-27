import { describe, expect, it } from 'vitest'
import {
  isAllowedUpsellUrl,
  isValidHttpsUrl,
  parseRendererAction,
  resolveUpsellUrl,
} from './ipc-contract'

describe('isValidHttpsUrl (S-033 exact HTTPS)', () => {
  it('accepts credential-free https URLs with a hostname and rejects everything else', () => {
    expect(isValidHttpsUrl('https://ontime.app')).toBe(true)
    expect(isValidHttpsUrl('https://ontime.app/get')).toBe(true)
    expect(isValidHttpsUrl('http://ontime.app')).toBe(false)
    expect(isValidHttpsUrl('ftp://ontime.app')).toBe(false)
    expect(isValidHttpsUrl('https://user:pass@ontime.app')).toBe(false)
    expect(isValidHttpsUrl('')).toBe(false)
    expect(isValidHttpsUrl('not a url')).toBe(false)
    expect(isValidHttpsUrl('https://')).toBe(false)
  })
})

describe('resolveUpsellUrl (S-033 hidden when unset/invalid)', () => {
  it('makes the CTA available for any syntactically valid https constant', () => {
    // resolveUpsellUrl validates SYNTAX only; the build constant is trusted to
    // be the canonical URL. Per-destination enforcement is isAllowedUpsellUrl's
    // exact-match job (tested below).
    expect(resolveUpsellUrl('https://ontime.app')).toEqual({ url: 'https://ontime.app', ctaAvailable: true })
    expect(resolveUpsellUrl('https://example.com/path')).toEqual({ url: 'https://example.com/path', ctaAvailable: true })
  })

  it('hides the CTA when the constant is missing, empty, or not valid https', () => {
    expect(resolveUpsellUrl(undefined)).toEqual({ url: null, ctaAvailable: false })
    expect(resolveUpsellUrl('')).toEqual({ url: null, ctaAvailable: false })
    expect(resolveUpsellUrl('http://insecure.example')).toEqual({ url: null, ctaAvailable: false })
    expect(resolveUpsellUrl('not a url')).toEqual({ url: null, ctaAvailable: false })
    expect(resolveUpsellUrl('https://user:pass@host.example')).toEqual({ url: null, ctaAvailable: false })
  })
})

describe('isAllowedUpsellUrl (S-033 exact match, no wildcard)', () => {
  const allowed = 'https://ontime.app'
  it('allows only the exact configured URL', () => {
    expect(isAllowedUpsellUrl('https://ontime.app', allowed)).toBe(true)
    expect(isAllowedUpsellUrl('https://ontime.app.evil.com', allowed)).toBe(false)
    expect(isAllowedUpsellUrl('https://ontime.app/interstitial', allowed)).toBe(false)
    expect(isAllowedUpsellUrl('https://evil.example', allowed)).toBe(false)
    expect(isAllowedUpsellUrl('https://ontime.app', null)).toBe(false)
  })
})

describe('parseRendererAction (S-014/S-033 closed union)', () => {
  it('accepts each valid action', () => {
    expect(parseRendererAction({ type: 'setTimingMode', mode: 'elapsed' })).toEqual({ ok: true, action: { type: 'setTimingMode', mode: 'elapsed' } })
    expect(parseRendererAction({ type: 'setAlwaysOnTop', enabled: false })).toEqual({ ok: true, action: { type: 'setAlwaysOnTop', enabled: false } })
    expect(parseRendererAction({ type: 'applyPreset', preset: 'large' })).toEqual({ ok: true, action: { type: 'applyPreset', preset: 'large' } })
    expect(parseRendererAction({ type: 'moveToDisplay', displayId: '2' })).toEqual({ ok: true, action: { type: 'moveToDisplay', displayId: '2' } })
    expect(parseRendererAction({ type: 'copyDiagnostics' })).toEqual({ ok: true, action: { type: 'copyDiagnostics' } })
  })

  it('rejects unknown action types and non-objects', () => {
    expect(parseRendererAction({ type: 'doSomethingEvil' }).ok).toBe(false)
    expect(parseRendererAction(null).ok).toBe(false)
    expect(parseRendererAction('setTimingMode').ok).toBe(false)
    expect(parseRendererAction(undefined).ok).toBe(false)
    expect(parseRendererAction({}).ok).toBe(false)
  })

  it('rejects malformed payloads', () => {
    expect(parseRendererAction({ type: 'setTimingMode', mode: 'sideways' }).ok).toBe(false)
    expect(parseRendererAction({ type: 'setAlwaysOnTop', enabled: 'yes' }).ok).toBe(false)
    expect(parseRendererAction({ type: 'applyPreset', preset: 'custom' }).ok).toBe(false)
    expect(parseRendererAction({ type: 'applyPreset', preset: 'enormous' }).ok).toBe(false)
    expect(parseRendererAction({ type: 'moveToDisplay', displayId: '' }).ok).toBe(false)
    expect(parseRendererAction({ type: 'moveToDisplay', displayId: 2 }).ok).toBe(false)
  })

  it('openUpsell never carries a renderer-supplied URL into the action', () => {
    const result = parseRendererAction({ type: 'openUpsell', url: 'https://evil.example' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action).toEqual({ type: 'openUpsell' })
      expect((result.action as { url?: string }).url).toBeUndefined()
    }
  })
})
