// rebuild-target: app-internal (cloud-web session viewer)
/**
 * The viewer credential travels only in the URL fragment
 * (`/session/:sessionId/view#token=…`), which never reaches the server,
 * referrers, or logs; it is read once and scrubbed from history.
 */

const TOKEN_FRAGMENT = /^#token=([A-Za-z0-9_-]{32,128})$/
const SESSION_PATH = /^\/session\/[A-Za-z0-9_-]{1,128}\/view\/?$/

export function readViewerToken(hash: string): string | null {
  return TOKEN_FRAGMENT.exec(hash)?.[1] ?? null
}

const storageKey = (sessionId: string) => `ontime.presentationViewerToken.${sessionId}`

/**
 * The link token for this session: from the fragment when present (then kept
 * in tab-scoped session storage so a reload keeps working), else the one this
 * tab already holds. Session storage is cleared when the tab closes.
 */
export function takeViewerToken(sessionId: string, hash: string): string | null {
  const fromHash = readViewerToken(hash)
  try {
    if (fromHash !== null) window.sessionStorage.setItem(storageKey(sessionId), fromHash)
    return fromHash ?? readViewerToken(`#token=${window.sessionStorage.getItem(storageKey(sessionId)) ?? ''}`)
  } catch {
    return fromHash
  }
}

/** Replace the current history entry without the fragment (no navigation, no new entry). */
export function scrubViewerToken(): void {
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}`)
}

/** True for the isolated presentation viewer entry under the app base path. */
export function isSessionViewerPath(pathname: string, base: string): boolean {
  const prefix = base === '/' ? '' : base.replace(/\/+$/, '')
  if (prefix && !pathname.startsWith(`${prefix}/`)) return false
  return SESSION_PATH.test(pathname.slice(prefix.length))
}
