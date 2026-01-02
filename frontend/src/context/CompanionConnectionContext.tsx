/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'

type HandshakeStatus = 'idle' | 'pending' | 'ack' | 'error'
type ReconnectState = 'idle' | 'reconnecting' | 'stopped'
type ProtocolCompatibility = 'ok' | 'warn' | 'incompatible' | 'unknown'

export type CompanionConnectionContextValue = {
  socket: Socket | null
  isConnected: boolean
  handshakeStatus: HandshakeStatus
  reconnectState: ReconnectState
  reconnectAttempts: number
  nextRetryAt?: number
  reconnectStartedAt?: number
  lastErrorCode?: string
  protocolStatus: {
    clientVersion: string
    serverVersion: string | null
    compatibility: ProtocolCompatibility
  }
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
  markHandshakePending: () => void
  retryConnection: () => void
}

type HandshakeAck = {
  type: 'HANDSHAKE_ACK'
  success: boolean
  companionMode: string
  companionVersion: string
  interfaceVersion?: string
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

type HandshakeError = {
  type: 'HANDSHAKE_ERROR'
  code?: string
  message?: string
}

const TOKEN_KEY = 'ontime:companionToken'
export const INTERFACE_VERSION = '1.2.0'
const MAX_RECONNECT_ATTEMPTS = 20
const BACKOFF_FAST_MS = 2000
const BACKOFF_SLOW_MS = 10_000
const BACKOFF_CAP_MS = 60_000

export const getReconnectDelayMs = (attempt: number) => {
  if (attempt <= 1) return 0
  if (attempt <= 5) return BACKOFF_FAST_MS
  return Math.min(BACKOFF_SLOW_MS, BACKOFF_CAP_MS)
}

const parseMajorVersion = (version: string | null | undefined) => {
  if (!version) return null
  const [majorRaw] = version.split('.')
  const major = Number(majorRaw)
  return Number.isFinite(major) ? major : null
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
      reconnection: false,
    })
  }, [])
  const [isConnected, setIsConnected] = useState(false)
  const [handshakeStatus, setHandshakeStatus] = useState<HandshakeStatus>('idle')
  const [reconnectState, setReconnectState] = useState<ReconnectState>('idle')
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null)
  const [reconnectStartedAt, setReconnectStartedAt] = useState<number | null>(null)
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null)
  const [protocolStatus, setProtocolStatus] = useState<CompanionConnectionContextValue['protocolStatus']>({
    clientVersion: INTERFACE_VERSION,
    serverVersion: null,
    compatibility: 'unknown',
  })
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
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectStateRef = useRef<ReconnectState>('idle')

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

  const setReconnectStateSafe = useCallback((next: ReconnectState) => {
    reconnectStateRef.current = next
    setReconnectState(next)
  }, [])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
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
    if (socket && !socket.connected) {
      socket.connect()
    }
    try {
      window.localStorage.setItem(TOKEN_KEY, token)
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      // ignore
    }
    return token
  }, [socket])

  const discoverCompanion = useCallback(async () => {
    setHasAttemptedDiscovery(true)
    const next = await fetchToken()
    return next
  }, [fetchToken])

  const scheduleReconnect = useCallback(
    function scheduleReconnect(reason?: string) {
      if (!socket) return
      if (reconnectStateRef.current === 'stopped') return
      if (reconnectTimerRef.current) return

      const nextAttempt = reconnectAttemptsRef.current + 1
      if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
        setReconnectStateSafe('stopped')
        setNextRetryAt(null)
        return
      }

      reconnectAttemptsRef.current = nextAttempt
      setReconnectAttempts(nextAttempt)
      if (nextAttempt === 1) {
        setReconnectStartedAt(Date.now())
      }
      setReconnectStateSafe('reconnecting')

      const delay = getReconnectDelayMs(nextAttempt)
      setNextRetryAt(Date.now() + delay)

      reconnectTimerRef.current = window.setTimeout(async () => {
        reconnectTimerRef.current = null
        if (reconnectStateRef.current === 'stopped') return
        const refreshedToken = await fetchToken()
        const nextToken = refreshedToken ?? token
        if (!nextToken) {
          setLastErrorCode('TOKEN_MISSING')
          scheduleReconnect('token_missing')
          return
        }
        if (!socket.connected) {
          if (debugCompanion) {
            console.info('[companion] reconnect attempt', { attempt: nextAttempt, reason })
          }
          socket.connect()
        }
      }, delay)
    },
    [debugCompanion, fetchToken, setReconnectStateSafe, socket, token],
  )

  const retryConnection = useCallback(() => {
    reconnectAttemptsRef.current = 0
    setReconnectAttempts(0)
    setLastErrorCode(null)
    setNextRetryAt(null)
    setReconnectStartedAt(null)
    setReconnectStateSafe('idle')
    clearReconnectTimer()
    scheduleReconnect('manual')
  }, [clearReconnectTimer, scheduleReconnect, setReconnectStateSafe])

  const markHandshakePending = useCallback(() => {
    setHandshakeStatus((prev) => (prev === 'pending' ? prev : 'pending'))
  }, [])

  useEffect(() => {
    if (!socket) return
    const shouldReconnect = !isConnected || handshakeStatus === 'error'
    if (!shouldReconnect) {
      clearReconnectTimer()
      setNextRetryAt(null)
      return
    }
    scheduleReconnect('auto')
  }, [clearReconnectTimer, handshakeStatus, isConnected, scheduleReconnect, socket])

  useEffect(() => {
    if (!socket) return
    if (!token) return
    if (!socket.connected) {
      socket.connect()
    }
  }, [socket, token])

  useEffect(() => {
    if (!socket) return
    if (isConnected) return
    let cancelled = false
    const interval = window.setInterval(async () => {
      if (cancelled) return
      const next = await fetchToken()
      if (next && !socket.connected) {
        socket.connect()
      }
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [fetchToken, isConnected, socket])

  useEffect(() => {
    if (!socket) return
    const handleConnect = () => {
      if (debugCompanion) console.info('[companion] connect')
      setIsConnected(true)
      // Stay idle until a room join drives a handshake ACK/ERROR.
      setHandshakeStatus('idle')
      if (reconnectStateRef.current !== 'idle') {
        reconnectAttemptsRef.current = 0
        setReconnectAttempts(0)
        setReconnectStartedAt(null)
        setReconnectStateSafe('idle')
        setNextRetryAt(null)
        setLastErrorCode(null)
        clearReconnectTimer()
      }
    }
    const handleDisconnect = (reason?: string) => {
      if (debugCompanion) console.info('[companion] disconnect', reason)
      if (reason === 'io server disconnect' || reason === 'server namespace disconnect') {
        clearToken()
        setHandshakeStatus('error')
      }
      setIsConnected(false)
      if (reason !== 'io server disconnect') {
        setHandshakeStatus('idle')
      }
      if (reason) {
        setLastErrorCode(reason)
      }
      scheduleReconnect('disconnect')
    }
    const handleConnectError = () => {
      if (debugCompanion) console.warn('[companion] connect_error')
      setIsConnected(false)
      setHandshakeStatus('error')
      setLastErrorCode('CONNECT_ERROR')
      scheduleReconnect('connect_error')
    }
    const handleHandshakeAck = (data: HandshakeAck) => {
      if (debugCompanion) console.info('[companion] HANDSHAKE_ACK', data)
      setCompanionMode(data.companionMode)
      setCapabilities(data.capabilities)
      setSystemInfo(data.systemInfo)
      setHandshakeStatus('ack')
      setLastErrorCode(null)
      reconnectAttemptsRef.current = 0
      setReconnectAttempts(0)
      setReconnectStartedAt(null)
      setReconnectStateSafe('idle')
      setNextRetryAt(null)
      clearReconnectTimer()
      setProtocolStatus((prev) => {
        const serverVersion = data.interfaceVersion ?? null
        const clientMajor = parseMajorVersion(prev.clientVersion)
        const serverMajor = parseMajorVersion(serverVersion)
        let compatibility: ProtocolCompatibility = 'unknown'
        if (clientMajor !== null && serverMajor !== null) {
          compatibility = clientMajor === serverMajor ? 'ok' : 'incompatible'
        } else if (serverVersion) {
          compatibility = 'warn'
        }
        return {
          ...prev,
          serverVersion,
          compatibility,
        }
      })
    }
    const handleHandshakeError = (error: HandshakeError) => {
      const code = error?.code ?? 'HANDSHAKE_ERROR'
      if (debugCompanion) console.warn('[companion] HANDSHAKE_ERROR', code)
      setLastErrorCode(code)
      if (code === 'INVALID_TOKEN') {
        clearToken()
      }
      setHandshakeStatus('error')
      if (code === 'CONTROLLER_TAKEN') {
        setReconnectStateSafe('stopped')
        setNextRetryAt(null)
        clearReconnectTimer()
        return
      }
      scheduleReconnect('handshake_error')
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
      clearReconnectTimer()
      socket.disconnect()
    }
  }, [clearReconnectTimer, clearToken, debugCompanion, scheduleReconnect, setReconnectStateSafe, socket])

  useEffect(() => {
    if (!lastErrorCode) return
    console.warn('[companion] last error code', lastErrorCode)
  }, [lastErrorCode])

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      handshakeStatus,
      reconnectState,
      reconnectAttempts,
      nextRetryAt: nextRetryAt ?? undefined,
      reconnectStartedAt: reconnectStartedAt ?? undefined,
      lastErrorCode: lastErrorCode ?? undefined,
      protocolStatus,
      companionMode,
      capabilities,
      systemInfo,
      token,
      hasAttemptedDiscovery,
      discoverCompanion,
      lastSeenAt: lastSeenAt ?? undefined,
      fetchToken,
      clearToken,
      markHandshakePending,
      retryConnection,
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
      lastErrorCode,
      markHandshakePending,
      nextRetryAt,
      reconnectStartedAt,
      protocolStatus,
      reconnectAttempts,
      reconnectState,
      retryConnection,
      socket,
      systemInfo,
      token,
    ],
  )

  return <CompanionConnectionContext.Provider value={value}>{children}</CompanionConnectionContext.Provider>
}

export const useCompanionConnection = (): CompanionConnectionContextValue => {
  const ctx = useContext(CompanionConnectionContext)
  if (!ctx) {
    throw new Error('useCompanionConnection must be used within CompanionConnectionProvider')
  }
  return ctx
}
