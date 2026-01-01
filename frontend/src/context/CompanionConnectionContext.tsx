/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'

type HandshakeStatus = 'idle' | 'pending' | 'ack' | 'error'

/**
 * Reconnection state for UI visibility.
 * - connecting: initial connection attempt
 * - connected: socket connected
 * - reconnecting: backoff retry in progress
 * - failed: max attempts exceeded (show Retry CTA)
 * - disconnected: intentionally disconnected
 */
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected'

type CompanionConnectionContextValue = {
  socket: Socket | null
  isConnected: boolean
  handshakeStatus: HandshakeStatus
  connectionState: ConnectionState
  reconnectAttempt: number
  maxReconnectAttempts: number
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
  /** Manual retry after max attempts exceeded */
  retryConnection: () => void
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
const MAX_RECONNECT_ATTEMPTS = 20

/**
 * Calculate backoff delay based on attempt number.
 * Schedule: attempt 1 immediate, attempts 2-5 at 2s, 6+ at 10s, cap at 60s
 */
function getBackoffDelay(attempt: number): number {
  if (attempt <= 1) return 0 // immediate
  if (attempt <= 5) return 2000 // 2s for attempts 2-5
  // For 6+ start at 10s, double each time, cap at 60s
  const base = 10000
  const exponentialAttempt = attempt - 5 // starts at 1 for attempt 6
  return Math.min(base * Math.pow(2, exponentialAttempt - 1), 60000)
}

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
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const heartbeatRef = useRef<number | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

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
    setReconnectAttempt(0)
    setConnectionState('connecting')
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

  /** Manual retry after max attempts exceeded */
  const retryConnection = useCallback(() => {
    setReconnectAttempt(0)
    setConnectionState('connecting')
    // Clear any existing timeout
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    // Trigger immediate reconnection
    void discoverCompanion()
  }, [discoverCompanion])

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

  // Reconnection state machine with exponential backoff
  useEffect(() => {
    const shouldProbe = !token || !isConnected || handshakeStatus !== 'ack'
    if (!shouldProbe) {
      // Connected successfully - clear reconnection state
      if (heartbeatRef.current) {
        window.clearTimeout(heartbeatRef.current)
        heartbeatRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      setConnectionState('connected')
      return
    }

    // Check if we've exceeded max attempts
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionState('failed')
      return
    }

    let cancelled = false
    const tick = async () => {
      const nextAttempt = reconnectAttempt + 1
      setReconnectAttempt(nextAttempt)
      setConnectionState('reconnecting')

      if (debugCompanion) {
        console.info(`[companion] Reconnect attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS}`)
      }

      const ok = await discoverCompanion()
      if (ok) {
        setReconnectAttempt(0)
        setConnectionState('connecting')
      } else if (!cancelled) {
        // Check if we've exceeded max attempts
        if (nextAttempt >= MAX_RECONNECT_ATTEMPTS) {
          setConnectionState('failed')
          return
        }
        // Schedule next attempt with backoff
        const delay = getBackoffDelay(nextAttempt + 1)
        if (debugCompanion) {
          console.info(`[companion] Next reconnect in ${delay}ms`)
        }
        reconnectTimeoutRef.current = window.setTimeout(tick, delay)
      }
    }

    // Start with initial delay based on current attempt
    const initialDelay = getBackoffDelay(reconnectAttempt + 1)
    reconnectTimeoutRef.current = window.setTimeout(tick, initialDelay)

    return () => {
      cancelled = true
      if (heartbeatRef.current) window.clearTimeout(heartbeatRef.current)
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current)
    }
  }, [debugCompanion, discoverCompanion, handshakeStatus, isConnected, reconnectAttempt, token])

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
      connectionState,
      reconnectAttempt,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      companionMode,
      capabilities,
      systemInfo,
      token,
      hasAttemptedDiscovery,
      discoverCompanion,
      lastSeenAt: lastSeenAt ?? undefined,
      fetchToken,
      clearToken,
      retryConnection,
    }),
    [
      capabilities,
      clearToken,
      companionMode,
      connectionState,
      discoverCompanion,
      fetchToken,
      hasAttemptedDiscovery,
      handshakeStatus,
      isConnected,
      lastSeenAt,
      reconnectAttempt,
      retryConnection,
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

export type { ConnectionState }
