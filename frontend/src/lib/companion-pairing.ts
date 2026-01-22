export type LanPairingInfo = {
  roomId: string
  code: string
  expiresAt: number
  urls: string[]
  maxDevices: number
}

export type LanViewerToken = {
  roomId: string
  role: string
  token: string
  expiresAt: number
}

export type LanPairingStatus = {
  roomId: string
  pairing: { code: string; expiresAt: number } | null
  tokens: Array<{
    tokenId: string
    role: string
    deviceName?: string
    lastSeen?: number
    expiresAt: number
    revokedAt?: number
  }>
}

const getCompanionOrigin = () => {
  if (typeof window === 'undefined') return 'https://localhost:4440'
  if (window.location.port === '4440' || window.location.port === '4000') {
    return window.location.origin
  }
  const securePage = window.location.protocol === 'https:'
  return securePage ? 'https://localhost:4440' : 'http://localhost:4000'
}

const parseError = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { error?: string; message?: string }
    return data.message ?? data.error ?? 'Request failed'
  } catch {
    return 'Request failed'
  }
}

const buildHeaders = (token?: string): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export const createLanPairing = async (
  roomId: string,
  token?: string,
  options?: { reuse?: boolean },
): Promise<LanPairingInfo> => {
  const res = await fetch(`${getCompanionOrigin()}/api/pairing/create`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ roomId, reuse: options?.reuse }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return (await res.json()) as LanPairingInfo
}

export const fetchLanPairingStatus = async (roomId: string, token?: string): Promise<LanPairingStatus> => {
  const res = await fetch(`${getCompanionOrigin()}/api/pairing/status?roomId=${encodeURIComponent(roomId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return (await res.json()) as LanPairingStatus
}

export const revokeLanViewer = async (roomId: string, tokenId: string, token?: string): Promise<void> => {
  const res = await fetch(`${getCompanionOrigin()}/api/pairing/revoke`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ roomId, tokenId }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
}

export const resetLanViewers = async (roomId: string, token?: string): Promise<void> => {
  const res = await fetch(`${getCompanionOrigin()}/api/pairing/reset`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ roomId }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
}

export const claimLanPairing = async (payload: {
  roomId: string
  code: string
  role: string
  deviceName?: string
}): Promise<LanViewerToken> => {
  const res = await fetch(`${getCompanionOrigin()}/api/pairing/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return (await res.json()) as LanViewerToken
}
