/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'

type HandshakeStatus = 'idle' | 'pending' | 'ack' | 'error'

type CompanionConnectionContextValue = {
  socket: Socket | null
  isConnected: boolean
  handshakeStatus: HandshakeStatus
  companionMode: string
  capabilities: {
    powerpoint: boolean
    externalVideo: boolean
    fileOperations: boolean
  }
  systemInfo: {
    platform: string
    hostname: string
  } | null
  token: string | null
  hasAttemptedDiscovery?: boolean
  discoverCompanion?: () => Promise<string | null>
  lastSeenAt?: number
  fetchToken: () => Promise<string | null>
  clearToken: () => void
}

type HandshakeAck = {
  type: 'HANDSHAKE_ACK'
  success: boolean
  companionMode: string
  companionVersion: string
  capabilities: {
    powerpoint: boolean
    externalVideo: boolean
    fileOperations: boolean
  }
  systemInfo: {
    platform: string
    hostname: string
  }
}

const TOKEN_KEY = 'ontime:companionToken'

const CompanionConnectionContext = createContext<CompanionConnectionContextValue | undefined>(undefined)

const readStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const CompanionConnectionProvider = ({ children }: { children: ReactNode }) => {
  const debugCompanion = import.meta.env.VITE_DEBUG_COMPANION === 'true'
  const socket = useMemo<Socket | null>(() => {
    if (typeof window === 'undefined') return null
    const securePage = window.location.protocol === 'https:'
    const socketUrl = securePage ? 'https://localhost:4440' : 'http://localhost:4000'
    // Browsers block ws:// upgrades from an https page; keep polling-only when served over HTTPS.
    const transports = securePage ? ['polling'] : ['websocket', 'polling']
    return io(socketUrl, {
      transports,
      upgrade: !securePage,
      autoConnect: false,
    })
  }, [])
  const [isConnected, setIsConnected] = useState(false)
  const [handshakeStatus, setHandshakeStatus] = useState<HandshakeStatus>('idle')
  const [companionMode, setCompanionMode] = useState('minimal')
  const [capabilities, setCapabilities] = useState<CompanionConnectionContextValue['capabilities']>({
    powerpoint: false,
    externalVideo: false,
    fileOperations: true,
  })
  const [systemInfo, setSystemInfo] = useState<CompanionConnectionContextValue['systemInfo']>(null)
  const [token, setToken] = useState<string | null>(() => readStoredToken())
  const [hasAttemptedDiscovery, setHasAttemptedDiscovery] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null)
  const backoffRef = useRef(10_000)
  const heartbeatRef = useRef<number | null>(null)

  const clearToken = useCallback(() => {
    setToken(null)
    try {
      window.localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
  }, [])

  const fetchToken = useCallback(async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'

    const tryFetch = async (url: string) => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
          credentials: 'omit',
          headers: { Origin: origin },
        })
        if (!res.ok) return null
        const data = (await res.json()) as { token?: string }
        return data.token ?? null
      } catch {
        return null
      }
    }

    const securePage = typeof window !== 'undefined' ? window.location.protocol === 'https:' : false
    const endpoints = securePage
      ? [
          'https://localhost:4441/api/token',
          'https://127.0.0.1:4441/api/token',
          'https://[::1]:4441/api/token',
          // Fallback to http if user has explicitly allowed insecure loopback
          'http://localhost:4001/api/token',
          'http://127.0.0.1:4001/api/token',
          'http://[::1]:4001/api/token',
        ]
      : [
          'http://localhost:4001/api/token',
          'http://127.0.0.1:4001/api/token',
          'http://[::1]:4001/api/token',
          'https://localhost:4441/api/token',
          'https://127.0.0.1:4441/api/token',
          'https://[::1]:4441/api/token',
        ]

    let token: string | null = null
    for (const endpoint of endpoints) {
      token = await tryFetch(endpoint)
      if (token) break
    }

    if (!token) return null

    setToken(token)
    setLastSeenAt(Date.now())
    backoffRef.current = 10_000
    try {
      window.localStorage.setItem(TOKEN_KEY, token)
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      // ignore
    }
    return token
  }, [])

  const discoverCompanion = useCallback(async () => {
    setHasAttemptedDiscovery(true)
    const next = await fetchToken()
    return next
  }, [fetchToken])

  // If handshake errors while online, assume token may be stale (e.g., Companion restarted with new secret)
  // and force a refresh once.
  const attemptedRecoveryRef = useRef(false)
  useEffect(() => {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    // Only attempt recovery when we are actually connected to the socket and online.
    if (handshakeStatus !== 'error' || !isConnected || !isOnline) {
      attemptedRecoveryRef.current = false
      return
    }
    if (attemptedRecoveryRef.current) return
    attemptedRecoveryRef.current = true
    void (async () => {
      clearToken()
      const next = await fetchToken()
      if (next && socket && !socket.connected && !socket.active) {
        socket.connect()
      }
    })()
  }, [clearToken, fetchToken, handshakeStatus, isConnected, socket])

  useEffect(() => {
    // Auto-discover on mount if no token
    if (token) return
    window.setTimeout(() => {
      void discoverCompanion()
    }, 0)
  }, [discoverCompanion, token])

  // Fetch initial token on mount
  useEffect(() => {
    void fetchToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  useEffect(() => {
    if (!socket) return
    // If we have a token but the socket isn't connected/active (e.g., Companion restarted), kick a connect.
    if (token && !socket.connected && !socket.active) {
      socket.connect()
    }
  }, [socket, token])

  useEffect(() => {
    const shouldProbe = !token || !isConnected || handshakeStatus !== 'ack'
    if (!shouldProbe) {
      if (heartbeatRef.current) {
        window.clearTimeout(heartbeatRef.current)
        heartbeatRef.current = null
      }
      return
    }
    let cancelled = false
    const tick = async () => {
      const ok = await discoverCompanion()
      if (ok) {
        backoffRef.current = 10_000
      } else {
        backoffRef.current = Math.min(backoffRef.current * 2, 60_000)
      }
      if (!cancelled) {
        heartbeatRef.current = window.setTimeout(tick, backoffRef.current)
      }
    }
    heartbeatRef.current = window.setTimeout(tick, backoffRef.current)
    return () => {
      cancelled = true
      if (heartbeatRef.current) window.clearTimeout(heartbeatRef.current)
    }
  }, [discoverCompanion, handshakeStatus, isConnected, token])

  useEffect(() => {
    if (!socket) return
    const handleConnect = () => {
      if (debugCompanion) console.info('[companion] connect')
      setIsConnected(true)
      // Stay idle until a room join drives a handshake ACK/ERROR.
      setHandshakeStatus('idle')
    }
    const handleDisconnect = (reason?: string) => {
      if (debugCompanion) console.info('[companion] disconnect', reason)
      if (reason === 'io server disconnect') {
        clearToken()
        setHandshakeStatus('error')
      }
      setIsConnected(false)
      setHandshakeStatus('idle')
    }
    const handleConnectError = () => {
      if (debugCompanion) console.warn('[companion] connect_error')
      setIsConnected(false)
      setHandshakeStatus('error')
    }
    const handleHandshakeAck = (data: HandshakeAck) => {
      if (debugCompanion) console.info('[companion] HANDSHAKE_ACK', data)
      setCompanionMode(data.companionMode)
      setCapabilities(data.capabilities)
      setSystemInfo(data.systemInfo)
      setHandshakeStatus('ack')
    }
    const handleHandshakeError = () => {
      if (debugCompanion) console.warn('[companion] HANDSHAKE_ERROR')
      clearToken()
      setHandshakeStatus('error')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.io.on('error', handleConnectError)
    socket.on('HANDSHAKE_ACK', handleHandshakeAck)
    socket.on('HANDSHAKE_ERROR', handleHandshakeError)

    socket.connect()

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.io.off('error', handleConnectError)
      socket.off('HANDSHAKE_ACK', handleHandshakeAck)
      socket.off('HANDSHAKE_ERROR', handleHandshakeError)
      socket.disconnect()
    }
  }, [clearToken, debugCompanion, socket])

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      handshakeStatus,
      companionMode,
      capabilities,
      systemInfo,
      token,
      hasAttemptedDiscovery,
      discoverCompanion,
      lastSeenAt: lastSeenAt ?? undefined,
      fetchToken,
      clearToken,
    }),
    [
      capabilities,
      clearToken,
      companionMode,
      discoverCompanion,
      fetchToken,
      hasAttemptedDiscovery,
      handshakeStatus,
      isConnected,
      lastSeenAt,
      socket,
      systemInfo,
      token,
    ],
  )

  return <CompanionConnectionContext.Provider value={value}>{children}</CompanionConnectionContext.Provider>
}

export const useCompanionConnection = () => {
  const ctx = useContext(CompanionConnectionContext)
  if (!ctx) {
    throw new Error('useCompanionConnection must be used within CompanionConnectionProvider')
  }
  return ctx
}
