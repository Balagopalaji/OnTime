import { describe, expect, it } from 'vitest'
import { isSessionViewerPath, readViewerToken, scrubViewerToken } from './session-link'

describe('viewer link fragment', () => {
  it.each([
    ['#token=' + 'A'.repeat(43), 'A'.repeat(43)],
    ['#token=abc', null],
    ['#token=' + 'A'.repeat(43) + '&x=1', null],
    ['#other=' + 'A'.repeat(43), null],
    ['', null],
  ])('reads %j as %j', (hash, expected) => {
    // Defect: a malformed or smuggled fragment is sent to resolution.
    expect(readViewerToken(hash)).toBe(expected)
  })

  it('removes the token from the address bar and history without navigating', () => {
    // Defect: the credential lingers in history, bookmarks, or referrers.
    window.history.replaceState(null, '', '/session/sess_1/view?kiosk=1#token=' + 'A'.repeat(43))
    const before = window.history.length
    scrubViewerToken()
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/session/sess_1/view?kiosk=1')
    expect(window.history.length).toBe(before)
  })

  it.each([
    ['/session/sess_1/view', '/', true],
    ['/session/sess_1/view/', '/', true],
    ['/app/session/sess_1/view', '/app', true],
    ['/room/r1/view', '/', false],
    ['/session/../view', '/', false],
    ['/session/a/b/view', '/', false],
  ])('recognizes %s under base %s as the isolated viewer entry: %s', (pathname, base, expected) => {
    expect(isSessionViewerPath(pathname, base)).toBe(expected)
  })
})
