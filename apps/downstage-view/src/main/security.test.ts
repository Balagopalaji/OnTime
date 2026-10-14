import { describe, expect, it, vi } from 'vitest'
import { BROWSER_SECURITY, createNavigationPolicy, denyAllPermissions, isTrustedLauncherSender } from './security.js'

const ORIGIN = 'https://ontime.app'
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v'

describe('BROWSER_SECURITY', () => {
  it('keeps the renderer isolated, sandboxed, and node-free', () => {
    expect(BROWSER_SECURITY).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
    })
  })
})

describe('navigation policy', () => {
  const policy = createNavigationPolicy({ webOrigin: ORIGIN })

  it('allows navigation only to viewer pages on the configured origin', () => {
    expect(policy.allowNavigation(`${ORIGIN}/session/abc/view#token=${TOKEN}`)).toBe(true)
    expect(policy.allowNavigation(`${ORIGIN}/session/abc/view`)).toBe(true)
  })

  it.each([
    `${ORIGIN}/`,
    `${ORIGIN}/dashboard`,
    `${ORIGIN}/controller/room1`,
    'https://evil.example/session/abc/view',
    'http://ontime.app/session/abc/view',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
  ])('denies navigation to %s', (url) => {
    expect(policy.allowNavigation(url)).toBe(false)
  })

  it('denies everything, including file URLs, when no usable origin is configured', () => {
    const unconfigured = createNavigationPolicy({ webOrigin: 'null' })
    expect(unconfigured.allowNavigation('file:///app/session/abc/view')).toBe(false)
    expect(unconfigured.allowNavigation(`${ORIGIN}/session/abc/view`)).toBe(false)
  })

  it('denies every window.open and external navigation request', () => {
    expect(policy.windowOpenHandler({ url: `${ORIGIN}/session/abc/view` })).toEqual({ action: 'deny' })
    expect(policy.windowOpenHandler({ url: 'https://evil.example' })).toEqual({ action: 'deny' })
  })

  it('attach() blocks disallowed will-navigate/will-redirect, permits allowed ones, denies windows and webviews', () => {
    const handlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
    const contents = {
      on: vi.fn((name: string, handler: (event: { preventDefault(): void }, url: string) => void) => void handlers.set(name, handler)),
      setWindowOpenHandler: vi.fn(),
    }
    policy.attach(contents)

    const run = (name: string, url: string) => {
      const event = { preventDefault: vi.fn() }
      handlers.get(name)?.(event, url)
      return event.preventDefault.mock.calls.length
    }
    expect(run('will-navigate', 'https://evil.example/')).toBe(1)
    expect(run('will-redirect', 'https://evil.example/')).toBe(1)
    expect(run('will-navigate', `${ORIGIN}/session/abc/view#token=${TOKEN}`)).toBe(0)
    expect(run('will-redirect', `${ORIGIN}/session/abc/view`)).toBe(0)
    expect(run('will-attach-webview', 'anything')).toBe(1)
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce()
    const opener = contents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string }
    expect(opener({ url: ORIGIN })).toEqual({ action: 'deny' })
  })
})

describe('permissions', () => {
  it('denies every permission request and check', () => {
    const callback = vi.fn()
    const session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    denyAllPermissions(session)
    const request = session.setPermissionRequestHandler.mock.calls[0]?.[0] as (...args: unknown[]) => void
    request({}, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    const check = session.setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean
    expect(check()).toBe(false)
  })
})

describe('isTrustedLauncherSender', () => {
  const launcher = 'file:///app/dist/renderer/index.html'

  it('trusts only the local launcher document', () => {
    expect(isTrustedLauncherSender(launcher, launcher)).toBe(true)
    expect(isTrustedLauncherSender(`${launcher}#x`, launcher)).toBe(true)
  })

  it.each([undefined, '', `${ORIGIN}/session/abc/view`, 'file:///app/dist/renderer/other.html', 'https://evil.example/', `${launcher}/../x`])(
    'does not trust %j',
    (url) => {
      expect(isTrustedLauncherSender(url, launcher)).toBe(false)
    },
  )
})
