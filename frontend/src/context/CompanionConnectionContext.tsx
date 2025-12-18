/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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
    return io('http://localhost:4000', {
      transports: ['websocket'],
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
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
    try {
      const res = await fetch('http://localhost:4001/api/token', {
        method: 'GET',
        headers: { Origin: origin },
      })
      if (!res.ok) return null
      const data = (await res.json()) as { token?: string }
      if (!data.token) return null
      setToken(data.token)
      try {
        window.localStorage.setItem(TOKEN_KEY, data.token)
        sessionStorage.setItem(TOKEN_KEY, data.token)
      } catch {
        // ignore
      }
      return data.token
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!socket) return
    const handleConnect = () => {
      if (debugCompanion) console.info('[companion] connect')
      setIsConnected(true)
      setHandshakeStatus('pending')
    }
    const handleDisconnect = () => {
      if (debugCompanion) console.info('[companion] disconnect')
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
  }, [debugCompanion, socket])

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      handshakeStatus,
      companionMode,
      capabilities,
      systemInfo,
      token,
      fetchToken,
      clearToken,
    }),
    [
      capabilities,
      clearToken,
      companionMode,
      fetchToken,
      handshakeStatus,
      isConnected,
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
