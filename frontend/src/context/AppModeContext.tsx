/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCompanionConnection } from './CompanionConnectionContext'

export type AppMode = 'auto' | 'cloud' | 'local'
export type EffectiveAppMode = Exclude<AppMode, 'auto'>

const STORAGE_KEY = 'ontime:appMode'
const MODE_CHANNEL_NAME = 'ontime:appMode:channel'

type AppModeContextValue = {
  mode: AppMode
  effectiveMode: EffectiveAppMode
  setMode: (mode: AppMode) => void
  /** Called when Companion drops; if online, falls back to Cloud and sets degraded flag */
  triggerCompanionFallback: () => void
  /** True if we auto-fell back to Cloud due to Companion drop */
  isDegraded: boolean
  /** Clear the degraded flag (e.g., when user manually reconnects Companion) */
  clearDegraded: () => void
}

const AppModeContext = createContext<AppModeContextValue | undefined>(undefined)

const readInitialMode = (): AppMode => {
  if (typeof window === 'undefined') return 'auto'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'hybrid') return 'local'
  if (raw === 'auto' || raw === 'local' || raw === 'cloud') return raw
  // Default to 'auto' to allow companion auto-discovery on first load
  return 'auto'
}

export const AppModeProvider = ({ children }: { children: ReactNode }) => {
  const { isConnected, socket, handshakeStatus } = useCompanionConnection()
  const [mode, setModeState] = useState<AppMode>(() => readInitialMode())
  const [isDegraded, setIsDegraded] = useState(false)

  const effectiveMode = useMemo<EffectiveAppMode>(() => {
    if (isDegraded) return 'cloud'
    if (mode !== 'auto') return mode
    return isConnected ? 'local' : 'cloud'
  }, [isConnected, isDegraded, mode])

  const setMode = useCallback((next: AppMode) => {
    setModeState(next)
    // Clear degraded when user explicitly changes mode
    setIsDegraded(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
      try {
        const channel = new BroadcastChannel(MODE_CHANNEL_NAME)
        channel.postMessage(next)
        channel.close()
      } catch {
        // ignore
      }
    }
  }, [])

  const triggerCompanionFallback = useCallback(() => {
    // Only fallback if we're currently using Companion (local/auto resolving to local)
    const usingCompanion = mode === 'local' || (mode === 'auto' && effectiveMode === 'local')
    if (!usingCompanion) return

    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    if (isOnline) {
      console.warn('[AppMode] Companion dropped, falling back to Cloud (degraded)')
      setIsDegraded(true)
    } else {
      // Offline entirely - can't fallback to Cloud, stay in current mode (frozen view)
      console.warn('[AppMode] Companion dropped but offline, staying in current mode')
    }
  }, [effectiveMode, mode])

  useEffect(() => {
    if (!socket) return
    const handleDisconnect = () => {
      triggerCompanionFallback()
    }
    const handleHandshakeAck = () => {
      setIsDegraded(false)
    }
    socket.on('disconnect', handleDisconnect)
    socket.on('HANDSHAKE_ACK', handleHandshakeAck)
    return () => {
      socket.off('disconnect', handleDisconnect)
      socket.off('HANDSHAKE_ACK', handleHandshakeAck)
    }
  }, [socket, triggerCompanionFallback])

  useEffect(() => {
    if (!isConnected) return
    if (handshakeStatus === 'error') return
    window.setTimeout(() => {
      setIsDegraded(false)
    }, 0)
  }, [handshakeStatus, isConnected])

  const clearDegraded = useCallback(() => {
    setIsDegraded(false)
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      const next = (event.newValue === 'hybrid' ? 'local' : event.newValue) as AppMode
      if (next === mode) return
      setModeState(next)
      setIsDegraded(false)
    }

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(MODE_CHANNEL_NAME)
      channel.onmessage = (event: MessageEvent) => {
        const next = (event.data === 'hybrid' ? 'local' : event.data) as AppMode
        if (!next || next === mode) return
        setModeState(next)
        setIsDegraded(false)
      }
    } catch {
      channel = null
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
      if (channel) {
        channel.onmessage = null
        channel.close()
      }
    }
  }, [mode])

  const value = useMemo(
    () => ({ mode, effectiveMode, setMode, triggerCompanionFallback, isDegraded, clearDegraded }),
    [clearDegraded, effectiveMode, isDegraded, mode, setMode, triggerCompanionFallback],
  )
  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>
}

export const useAppMode = () => {
  const ctx = useContext(AppModeContext)
  if (!ctx) throw new Error('useAppMode must be used within AppModeProvider')
  return ctx
}
