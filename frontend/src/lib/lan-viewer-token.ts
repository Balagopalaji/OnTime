// rebuild-target: app-internal (LAN viewer pairing token storage)
/**
 * Browser-side storage of the LAN viewer pairing token (one per room). Shared
 * by the room viewer and the LAN presentation viewer so a device pairs once.
 * Storage may be unavailable (private windows, blocked site data): every
 * access is guarded and the UI simply asks to pair again.
 */
export type ViewerTokenState = {
  token: string
  expiresAt: number
  role: string
}

const getViewerTokenKey = (roomId: string) => `ontime:viewerToken:${roomId}`

export const readViewerToken = (roomId?: string | null): ViewerTokenState | null => {
  if (!roomId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getViewerTokenKey(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ViewerTokenState
    if (!parsed?.token || typeof parsed.expiresAt !== 'number') return null
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(getViewerTokenKey(roomId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const writeViewerToken = (roomId: string, payload: ViewerTokenState) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getViewerTokenKey(roomId), JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export const clearViewerToken = (roomId: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getViewerTokenKey(roomId))
  } catch {
    // ignore
  }
}
