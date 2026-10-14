import { describe, expect, it } from 'vitest'
import { isViewerPageUrl, parseViewerLink } from './viewer-link.js'

const ORIGIN = 'https://ontime.app'
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v'
const GOOD = `https://ontime.app/session/sess_abc-123/view#token=${TOKEN}`

describe('parseViewerLink', () => {
  it('accepts the exact viewer link and returns it unchanged with the session id', () => {
    expect(parseViewerLink(GOOD, ORIGIN)).toEqual({ ok: true, url: GOOD, sessionId: 'sess_abc-123' })
  })

  it('trims surrounding whitespace and accepts a trailing slash on the path', () => {
    const result = parseViewerLink(`  \n${GOOD.replace('/view#', '/view/#')}\n `, ORIGIN)
    expect(result).toMatchObject({ ok: true, sessionId: 'sess_abc-123' })
  })

  it('accepts an http loopback origin only when that is the configured origin', () => {
    const dev = `http://localhost:5173/session/dev1/view#token=${TOKEN}`
    expect(parseViewerLink(dev, 'http://localhost:5173')).toMatchObject({ ok: true })
    expect(parseViewerLink(dev, ORIGIN)).toEqual({ ok: false, reason: 'wrong-origin' })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['not a url', 'malformed'],
    ['ontime.app/session/x/view', 'malformed'],
    [GOOD.replace('https:', 'http:'), 'wrong-origin'],
    [GOOD.replace('ontime.app', 'evil.example'), 'wrong-origin'],
    [GOOD.replace('ontime.app', 'ontime.app.evil.example'), 'wrong-origin'],
    [GOOD.replace('ontime.app', 'ontime.app:8443'), 'wrong-origin'],
    [GOOD.replace('https://', 'https://user:pw@'), 'credentials'],
    ['javascript:alert(1)', 'wrong-origin'],
    ['file:///etc/passwd', 'wrong-origin'],
    [`https://ontime.app/dashboard#token=${TOKEN}`, 'bad-path'],
    [`https://ontime.app/session//view#token=${TOKEN}`, 'bad-path'],
    [`https://ontime.app/session/a/b/view#token=${TOKEN}`, 'bad-path'],
    [`https://ontime.app/session/a%2fb/view#token=${TOKEN}`, 'bad-path'],
    [`https://ontime.app/session/x/view?next=/c#token=${TOKEN}`, 'query'],
    ['https://ontime.app/session/x/view', 'missing-token'],
    ['https://ontime.app/session/x/view#', 'missing-token'],
    ['https://ontime.app/session/x/view#token=short', 'bad-token'],
    [`https://ontime.app/session/x/view#token=${TOKEN}&x=1`, 'bad-token'],
    [`https://ontime.app/session/x/view#${TOKEN}`, 'bad-token'],
    [`https://ontime.app/session/x/view#token=${'a'.repeat(129)}`, 'bad-token'],
  ])('rejects %j with %s', (input, reason) => {
    expect(parseViewerLink(input, ORIGIN)).toEqual({ ok: false, reason })
  })

  it('rejects file URLs even against the opaque "null" origin of a bad config', () => {
    expect(parseViewerLink(`file:///session/x/view#token=${TOKEN}`, 'null')).toEqual({ ok: false, reason: 'wrong-origin' })
  })

  it('never puts the token or the input into a rejection', () => {
    const rejected = parseViewerLink(`https://evil.example/session/x/view#token=${TOKEN}`, ORIGIN)
    expect(JSON.stringify(rejected)).not.toContain(TOKEN)
  })
})

describe('isViewerPageUrl', () => {
  it('allows viewer pages on the configured origin, with or without a fragment', () => {
    expect(isViewerPageUrl(GOOD, ORIGIN)).toBe(true)
    expect(isViewerPageUrl('https://ontime.app/session/x/view', ORIGIN)).toBe(true)
  })

  it.each([
    'https://ontime.app/',
    'https://ontime.app/dashboard',
    'https://ontime.app/session/x/view/extra',
    'https://evil.example/session/x/view',
    'http://ontime.app/session/x/view',
    'https://user@ontime.app/session/x/view',
    'file:///tmp/index.html',
    'about:blank',
    'javascript:void 0',
    'not a url',
  ])('denies %s', (url) => {
    expect(isViewerPageUrl(url, ORIGIN)).toBe(false)
  })
})
