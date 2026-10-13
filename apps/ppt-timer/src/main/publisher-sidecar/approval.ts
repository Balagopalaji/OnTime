/**
 * Main-process checks for the device-approval round trip: only the configured
 * web origin's approval page is ever opened, and the app's registered callback
 * URI is accepted only as `<scheme>://publisher-auth?challenge=…&code=…`.
 */
import { isApprovalUrl } from './protocol'

const CHALLENGE_ID = /^[A-Za-z0-9_-]{22,64}$/
const AUTH_CODE = /^[A-Za-z0-9_-]{43}$/

export function isAllowedApprovalUrl(url: string, allowedOrigin: string): boolean {
  return isApprovalUrl(url) && new URL(url).origin === allowedOrigin
}

export function parseAuthCallbackUrl(url: string, scheme: string): { challengeId: string; code: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${scheme}:` || parsed.hostname !== 'publisher-auth' || !['', '/'].includes(parsed.pathname)) return null
  const keys = [...parsed.searchParams.keys()].sort()
  if (keys.length !== 2 || keys[0] !== 'challenge' || keys[1] !== 'code') return null
  const challengeId = parsed.searchParams.get('challenge') ?? ''
  const code = parsed.searchParams.get('code') ?? ''
  return CHALLENGE_ID.test(challengeId) && AUTH_CODE.test(code) ? { challengeId, code } : null
}
