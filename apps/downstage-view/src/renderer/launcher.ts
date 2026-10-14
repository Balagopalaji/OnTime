import type { OpenLinkFailure, PreloadApi } from '../shared/ipc-contract.js'

const OPEN_UNCONFIGURED = 'Not configured: no Downstage server address is set.'

const MESSAGES: Record<OpenLinkFailure, string> = {
  empty: 'Paste the viewer link first.',
  malformed: 'That does not look like a link.',
  'wrong-origin': 'That link is not for this Downstage server.',
  credentials: 'That link is not a Downstage viewer link.',
  'bad-path': 'That is not a Downstage viewer link.',
  query: 'That is not a Downstage viewer link.',
  'missing-token': 'That link is incomplete. Copy the full viewer link again.',
  'bad-token': 'That link is incomplete or damaged. Copy the full viewer link again.',
  'not-configured': 'Downstage View is not configured with a server address.',
  'load-failed': 'Could not open the viewer. Check your connection and try again.',
  'untrusted-sender': 'This window cannot open links.',
}

/**
 * Mounts the link launcher: one field, one button, one status line. It never
 * displays or retains the pasted link, and has no timer or control surface;
 * the viewer itself is the hosted viewer page.
 */
export async function mountLauncher(root: HTMLElement, api: PreloadApi): Promise<void> {
  const doc = root.ownerDocument
  const heading = doc.createElement('h1')
  heading.textContent = 'Downstage View'
  const hint = doc.createElement('p')
  hint.className = 'hint'

  const form = doc.createElement('form')
  const label = doc.createElement('label')
  label.htmlFor = 'link'
  label.textContent = 'Viewer link'
  const input = doc.createElement('input')
  input.id = 'link'
  input.type = 'text'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.placeholder = 'Paste the viewer link'
  const button = doc.createElement('button')
  button.type = 'submit'
  button.textContent = 'Open'
  form.append(label, input, button)

  const status = doc.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.className = 'status'

  root.replaceChildren(heading, hint, form, status)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      const text = input.value
      if (text.trim() === '') {
        status.textContent = 'Paste the viewer link first.'
        return
      }
      input.value = ''
      status.textContent = 'Opening…'
      const result = await api.openLink(text)
      if (result.ok) return
      status.textContent = MESSAGES[result.code]
    })()
  })

  const info = await api.getLauncherInfo()
  if (info.webOrigin === null) {
    hint.textContent = 'Read-only viewer for a shared Downstage timer.'
    status.textContent = OPEN_UNCONFIGURED
  } else {
    hint.textContent = `Read-only viewer for links from ${new URL(info.webOrigin).host}.`
  }
}
