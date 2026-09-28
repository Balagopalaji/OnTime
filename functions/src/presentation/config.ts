/**
 * ISSUE-002 presentation-session constants
 * (docs/spec/downstage-remote-powerpoint-viewer.endpoints.md).
 */

export const COLLECTIONS = {
  sessions: 'presentationSessions',
  snapshots: 'presentationSessionSnapshots',
  viewerStates: 'presentationSessionViewerStates',
  links: 'presentationViewerLinks',
  requestResults: 'presentationRequestResults',
  challenges: 'presentationPublisherAuthChallenges',
  devices: 'presentationPublisherDevices',
  rateLimits: 'presentationRateLimits',
} as const

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export const CHALLENGE_TTL_MS = 5 * MINUTE_MS
export const ACTIVE_WINDOW_MS = DAY_MS
export const INACTIVE_CLEANUP_MS = 7 * DAY_MS
export const REQUEST_RESULT_TTL_MS = DAY_MS
export const REVOKED_DEVICE_AUDIT_MS = 30 * DAY_MS
export const MAX_ACTIVE_SESSIONS_PER_OWNER = 3

export const PUBLISHER_ROLE = 'presentation-publisher'
export const VIEWER_ROLE = 'presentation-viewer'

const EMULATOR_SECRET = 'emulator-only-presentation-secret'

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true'
}

/** Registered custom URI scheme of the PPT Timer app's approval callback. */
export function publisherCallbackScheme(): string {
  return process.env.PRESENTATION_CALLBACK_SCHEME ?? 'downstage-ppt-timer'
}

/** Origin of the web app that hosts approval and viewer routes. */
export function webOrigin(): string {
  const origin = process.env.PRESENTATION_WEB_ORIGIN
  if (origin) return origin.replace(/\/+$/, '')
  if (isEmulator()) return 'http://localhost:5173'
  throw new Error('PRESENTATION_WEB_ORIGIN is not configured')
}

/**
 * Server secret for deriving viewer-link tokens and HMAC scopes. Fails closed
 * outside the emulator so production never uses a guessable default.
 */
export function serverSecret(): string {
  const secret = process.env.PRESENTATION_SERVER_SECRET
  if (secret && secret.length >= 32) return secret
  if (isEmulator()) return EMULATOR_SECRET
  throw new Error('PRESENTATION_SERVER_SECRET is not configured')
}

export function approvalUrl(challengeId: string): string {
  return `${webOrigin()}/publisher/device/approve?challenge=${encodeURIComponent(challengeId)}`
}

/** The token lives only in the fragment, so it never reaches HTTP path, query, or referrer. */
export function viewerUrl(sessionId: string, token: string): string {
  return `${webOrigin()}/session/${encodeURIComponent(sessionId)}/view#token=${token}`
}
