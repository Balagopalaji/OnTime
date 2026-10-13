/**
 * Sidecar Firebase access over the public REST protocols — custom-token
 * sign-in (Identity Toolkit), refresh-token exchange (Secure Token), and the
 * HTTPS callable protocol — so the hidden process needs no Firebase SDK and the
 * only persisted session state is one refresh token (sealed via main).
 */

export type CloudConfig = { apiKey: string; projectId: string; region: string; emulatorHost: string | null }
export type CloudError = { code: string; details: Record<string, unknown> }
export type CallResult<T> = { ok: true; data: T } | { ok: false; error: CloudError }
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{
  status: number
  json(): Promise<unknown>
}>

/** Main passes the non-secret cloud target to the utility process as `--cloud-config=<json>`. */
export const CLOUD_CONFIG_ARG = '--cloud-config='
/** A hung socket settles as `unavailable` (then transient backoff) instead of stalling publication. */
export const CLOUD_REQUEST_TIMEOUT_MS = 15_000
const ID_TOKEN_MARGIN_MS = 5 * 60_000
/** Secure Token errors that mean the refresh token itself is dead; anything else (portal, proxy, 5xx) is transient. */
const DEAD_REFRESH = new Set(['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_GRANT_TYPE', 'MISSING_REFRESH_TOKEN'])
const IDENT = /^[a-z0-9-]{1,63}$/
const API_KEY = /^[A-Za-z0-9_-]{1,128}$/
const EMULATOR_HOST = /^(127\.0\.0\.1|localhost)$/

/** Strict config parser: the sidecar receives this from main as non-secret startup data. */
export function parseCloudConfig(value: unknown): CloudConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'apiKey,emulatorHost,projectId,region') return null
  const { apiKey, projectId, region, emulatorHost } = record
  if (typeof apiKey !== 'string' || !API_KEY.test(apiKey)) return null
  if (typeof projectId !== 'string' || !IDENT.test(projectId) || typeof region !== 'string' || !IDENT.test(region)) return null
  if (emulatorHost !== null && (typeof emulatorHost !== 'string' || !EMULATOR_HOST.test(emulatorHost))) return null
  return { apiKey, projectId, region, emulatorHost }
}

export function cloudUrls(config: CloudConfig) {
  const key = `?key=${encodeURIComponent(config.apiKey)}`
  const auth = config.emulatorHost ? `http://${config.emulatorHost}:9099/` : 'https://'
  const functions = config.emulatorHost
    ? `http://${config.emulatorHost}:5002/${config.projectId}/${config.region}`
    : `https://${config.region}-${config.projectId}.cloudfunctions.net`
  return {
    signIn: `${auth}identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken${key}`,
    refresh: `${auth}securetoken.googleapis.com/v1/token${key}`,
    callable: (name: string) => `${functions}/${name}`,
  }
}

const unavailable: CloudError = { code: 'unavailable', details: {} }
const unauthenticated: CloudError = { code: 'unauthenticated', details: {} }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Callable error body `{error:{status:'FAILED_PRECONDITION', details}}` → `{code:'failed-precondition', details}`. */
function callableError(body: unknown): CloudError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  const status = error && typeof error.status === 'string' ? error.status : 'INTERNAL'
  return { code: status.toLowerCase().replace(/_/g, '-'), details: error && isRecord(error.details) ? error.details : {} }
}

export function createCloudClient(options: {
  config: CloudConfig
  fetch: FetchLike
  now?: () => number
  /** Called when sign-in or refresh yields a new refresh token, so it can be sealed. */
  onRefreshTokenChanged?: (refreshToken: string) => void
}) {
  const now = options.now ?? Date.now
  const urls = cloudUrls(options.config)
  let refreshToken: string | null = null
  let idToken: { value: string; expiresAtMs: number } | null = null

  const post = async (url: string, headers: Record<string, string>, body: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), CLOUD_REQUEST_TIMEOUT_MS)))
    const request = (async () => {
      try {
        const response = await options.fetch(url, { method: 'POST', headers, body })
        return { status: response.status, body: await response.json().catch(() => null) }
      } catch {
        return null
      }
    })()
    try {
      return await Promise.race([request, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
  const accept = (body: unknown, idKey: string, refreshKey: string, expiresKey: string): boolean => {
    if (!isRecord(body)) return false
    const [id, refresh, expires] = [body[idKey], body[refreshKey], Number(body[expiresKey])]
    if (typeof id !== 'string' || typeof refresh !== 'string' || !id || !refresh || !Number.isFinite(expires)) return false
    idToken = { value: id, expiresAtMs: now() + expires * 1_000 - ID_TOKEN_MARGIN_MS }
    if (refresh !== refreshToken) {
      refreshToken = refresh
      options.onRefreshTokenChanged?.(refresh)
    }
    return true
  }

  /** Current ID token, refreshing when near expiry; `unauthenticated` means the device is signed out for good. */
  async function token(force = false): Promise<{ ok: true; value: string } | { ok: false; error: CloudError }> {
    if (!force && idToken && now() < idToken.expiresAtMs) return { ok: true, value: idToken.value }
    if (!refreshToken) return { ok: false, error: unauthenticated }
    const form = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    const response = await post(urls.refresh, { 'Content-Type': 'application/x-www-form-urlencoded' }, form)
    if (response?.status === 200 && accept(response.body, 'id_token', 'refresh_token', 'expires_in')) {
      return { ok: true, value: (idToken as { value: string }).value }
    }
    idToken = null
    const body = response?.body
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : ''
    const dead = response !== null && [400, 401, 403].includes(response.status) && DEAD_REFRESH.has(message.split(' ')[0])
    return { ok: false, error: dead ? unauthenticated : unavailable }
  }

  return {
    async signInWithCustomToken(customToken: string): Promise<CallResult<null>> {
      const response = await post(urls.signIn, { 'Content-Type': 'application/json' }, JSON.stringify({ token: customToken, returnSecureToken: true }))
      if (response === null || response.status >= 500) return { ok: false, error: unavailable }
      return response.status === 200 && accept(response.body, 'idToken', 'refreshToken', 'expiresIn')
        ? { ok: true, data: null }
        : { ok: false, error: unauthenticated }
    },
    /** Restore a persisted session; the ID token is minted on first use. */
    restore(persistedRefreshToken: string) {
      refreshToken = persistedRefreshToken
      idToken = null
    },
    /** The refresh token to persist (sealed); rotates on refresh. */
    refreshToken: () => refreshToken,
    signOut() {
      refreshToken = null
      idToken = null
    },
    /** HTTPS callable; one forced token refresh on `unauthenticated`. Unauthenticated callers (begin/complete) pass `auth: false`. */
    async call<T>(name: string, data: unknown, auth = true): Promise<CallResult<T>> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (auth) {
          const bearer = await token(attempt > 0)
          if (!bearer.ok) return bearer
          headers.Authorization = `Bearer ${bearer.value}`
        }
        const response = await post(urls.callable(name), headers, JSON.stringify({ data }))
        if (response === null) return { ok: false, error: unavailable }
        if (response.status === 200 && isRecord(response.body) && 'result' in response.body) return { ok: true, data: response.body.result as T }
        const error = callableError(response.body)
        if (!(auth && attempt === 0 && error.code === 'unauthenticated')) return { ok: false, error }
      }
      return { ok: false, error: unauthenticated }
    },
  }
}

export type CloudClient = ReturnType<typeof createCloudClient>
