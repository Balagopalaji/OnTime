export type ViewerConfig = { webOrigin: string }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The hosted web origin whose `/session/:id/view` route this shell wraps.
 * Same variable the PowerPoint timer uses for its share links. HTTPS only,
 * except loopback HTTP for local development; anything else (including an
 * unset value) leaves the viewer unconfigured rather than guessing a default.
 */
export function readViewerConfig(env: Record<string, string | undefined>): ViewerConfig | null {
  const raw = env.ONTIME_WEB_ORIGIN
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username !== '' || url.password !== '') return null
  const secure = url.protocol === 'https:'
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  return secure || loopbackHttp ? { webOrigin: url.origin } : null
}
