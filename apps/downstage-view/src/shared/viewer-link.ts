/**
 * Viewer-link validation shared by the main process (authoritative) and tests.
 *
 * A Downstage View link is exactly the cloud browser viewer URL:
 * `https://<origin>/session/<sessionId>/view#token=<token>`. The credential
 * lives only in the fragment (never sent to a server, never logged). The
 * grammar mirrors `frontend/src/routes/session-viewer/session-link.ts`, which
 * remains the authority for what the hosted page accepts; this module only
 * decides whether the desktop shell may point its window at a URL.
 */

export type ViewerLinkRejection =
  | 'empty'
  | 'malformed'
  | 'wrong-origin'
  | 'credentials'
  | 'bad-path'
  | 'query'
  | 'missing-token'
  | 'bad-token'

export type ParsedViewerLink =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: ViewerLinkRejection }

const SESSION_PATH = /^\/session\/([A-Za-z0-9_-]{1,128})\/view\/?$/
const TOKEN_FRAGMENT = /^#token=[A-Za-z0-9_-]{32,128}$/

function parseUrl(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

export function parseViewerLink(input: string, webOrigin: string): ParsedViewerLink {
  const text = input.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  const url = parseUrl(text)
  if (url === null) return { ok: false, reason: 'malformed' }
  if (url.origin !== webOrigin || (url.protocol !== 'https:' && url.protocol !== 'http:')) return { ok: false, reason: 'wrong-origin' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' }
  const match = SESSION_PATH.exec(url.pathname)
  if (match === null) return { ok: false, reason: 'bad-path' }
  if (url.search !== '') return { ok: false, reason: 'query' }
  if (url.hash === '' || url.hash === '#') return { ok: false, reason: 'missing-token' }
  if (!TOKEN_FRAGMENT.test(url.hash)) return { ok: false, reason: 'bad-token' }
  return { ok: true, url: url.href, sessionId: match[1] as string }
}

/**
 * True for a viewer page on the configured origin (any fragment). This is the
 * only destination the window may ever navigate to after the first load.
 */
export function isViewerPageUrl(input: string, webOrigin: string): boolean {
  const url = parseUrl(input)
  if (url === null || url.origin !== webOrigin) return false
  // A `file:`/`data:` URL has the opaque origin "null"; never let a bad config match it.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username !== '' || url.password !== '') return false
  return SESSION_PATH.test(url.pathname)
}
