// rebuild-target: packages/local-sync-arbitration
import type { ControllerClient } from '@ontime/shared-types'

// Controller-client presence-roster merge carved byte-faithful from
// frontend/src/context/UnifiedDataContext.tsx (Stage 1b U5).

const ROOM_CLIENT_MAX_AGE_MS = {
  cloud: 900_000,
  companion: 900_000,
}

const getRoomClientMaxAgeMs = (source?: ControllerClient['source']) => {
  if (source === 'cloud') return ROOM_CLIENT_MAX_AGE_MS.cloud
  if (source === 'companion') return ROOM_CLIENT_MAX_AGE_MS.companion
  return ROOM_CLIENT_MAX_AGE_MS.companion
}

export const mergeControllerClients = (
  existing: ControllerClient[],
  incoming: ControllerClient[],
): ControllerClient[] => {
  const now = Date.now()
  const byId = new Map<string, ControllerClient>()
  const keyFor = (client: ControllerClient) => `${client.clientId}:${client.source ?? 'unknown'}`
  const unknownKeyFor = (client: ControllerClient) => `${client.clientId}:unknown`
  existing.forEach((client) => {
    byId.set(keyFor(client), client)
  })
  incoming.forEach((client) => {
    const normalized = client
    const key = keyFor(normalized)
    const fallbackKey = normalized.source ? unknownKeyFor(normalized) : key
    const previous = byId.get(key) ?? (key !== fallbackKey ? byId.get(fallbackKey) : undefined)
    if (!previous) {
      byId.set(key, normalized)
      return
    }
    if (key !== fallbackKey && byId.has(fallbackKey)) {
      byId.delete(fallbackKey)
    }
    const prevTs = previous.lastHeartbeat ?? 0
    const nextTs = normalized.lastHeartbeat ?? 0
    if (nextTs >= prevTs) {
      byId.set(key, {
        ...previous,
        ...normalized,
        source: normalized.source ?? previous.source,
      })
    } else if (normalized.source && !previous.source) {
      byId.set(key, { ...previous, source: normalized.source })
    }
  })
  return [...byId.values()].filter((client) => {
    if (typeof client.lastHeartbeat !== 'number') return true
    const maxAgeMs = getRoomClientMaxAgeMs(client.source)
    return now - client.lastHeartbeat <= maxAgeMs
  })
}
