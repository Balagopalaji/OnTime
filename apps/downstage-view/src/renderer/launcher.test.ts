// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { OpenLinkResult, PreloadApi } from '../shared/ipc-contract.js'
import { mountLauncher } from './launcher.js'

function setup(result: OpenLinkResult = { ok: true }, webOrigin: string | null = 'https://ontime.app') {
  document.body.innerHTML = '<main id="app"></main>'
  const root = document.getElementById('app') as HTMLElement
  const api: PreloadApi = {
    openLink: vi.fn(async () => result),
    getLauncherInfo: vi.fn(async () => ({ webOrigin })),
  }
  const ready = mountLauncher(root, api)
  const input = root.querySelector('input') as HTMLInputElement
  const form = root.querySelector('form') as HTMLFormElement
  const status = root.querySelector('[role="status"]') as HTMLElement
  const submit = () => {
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { api, input, status, submit, ready, root }
}

describe('launcher', () => {
  it('has a single labelled link field and no control or timer surface', async () => {
    const { root, input, ready } = setup()
    await ready
    expect(input.getAttribute('aria-label') ?? root.querySelector('label')?.textContent).toBeTruthy()
    expect(root.querySelectorAll('input')).toHaveLength(1)
    expect(root.querySelector('[data-state]')).toBeNull()
  })

  it('submits the pasted link to the bridge and clears the field on success', async () => {
    const { api, input, submit } = setup()
    input.value = ' https://ontime.app/session/a/view#token=x '
    await submit()
    expect(api.openLink).toHaveBeenCalledExactlyOnceWith(' https://ontime.app/session/a/view#token=x ')
    expect(input.value).toBe('')
  })

  it.each([
    ['wrong-origin', /Downstage/i],
    ['bad-token', /link/i],
    ['not-configured', /configured/i],
    ['load-failed', /could not/i],
    ['untrusted-sender', /.+/],
  ] as const)('shows a plain message for %s and never echoes the link', async (code, pattern) => {
    const { input, status, submit } = setup({ ok: false, code })
    input.value = 'https://ontime.app/session/a/view#token=SECRETSECRETSECRETSECRETSECRETSECRET'
    await submit()
    expect(status.textContent).toMatch(pattern)
    expect(status.textContent).not.toContain('SECRET')
    expect(input.value).toBe('')
  })

  it('does not call the bridge for an empty field', async () => {
    const { api, status, submit } = setup()
    await submit()
    expect(api.openLink).not.toHaveBeenCalled()
    expect(status.textContent).toMatch(/paste/i)
  })

  it('names the configured origin, or says the viewer is unconfigured', async () => {
    const configured = setup()
    await configured.ready
    expect(configured.root.textContent).toContain('ontime.app')
    const unconfigured = setup({ ok: true }, null)
    await unconfigured.ready
    expect(unconfigured.status.textContent).toMatch(/not configured/i)
  })
})
