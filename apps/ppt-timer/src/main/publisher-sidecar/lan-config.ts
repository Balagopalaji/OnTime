/**
 * Non-secret LAN publishing target (ISSUE-002 S9c). Main passes it to the
 * utility process as `--lan-config=<json>`; absent or malformed → LAN off.
 * The sidecar only ever talks to the Companion on the same machine, so the
 * host must be loopback (the hub also re-checks the socket address).
 */
export type LanConfig = { companionUrl: string; roomId: string }

export const LAN_CONFIG_ARG = '--lan-config='
const MAX_ROOM_ID_LENGTH = 128
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function parseLanConfig(value: unknown): LanConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'companionUrl,roomId') return null
  const { companionUrl, roomId } = record
  if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > MAX_ROOM_ID_LENGTH || roomId !== roomId.trim()) return null
  if (typeof companionUrl !== 'string') return null
  let url: URL
  try {
    url = new URL(companionUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.port === '') return null
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
  return { companionUrl: url.origin, roomId }
}
