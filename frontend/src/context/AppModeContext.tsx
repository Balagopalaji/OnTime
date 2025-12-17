/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCompanionConnection } from './CompanionConnectionContext'

export type AppMode = 'auto' | 'cloud' | 'local' | 'hybrid'
export type EffectiveAppMode = Exclude<AppMode, 'auto'>

const STORAGE_KEY = 'ontime:appMode'

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
  if (typeof window === 'undefined') return 'cloud'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'auto' || raw === 'local' || raw === 'hybrid' || raw === 'cloud') return raw
  return 'cloud'
}

export const AppModeProvider = ({ children }: { children: ReactNode }) => {
  const { isConnected } = useCompanionConnection()
  const [mode, setModeState] = useState<AppMode>(() => readInitialMode())
  const [effectiveMode, setEffectiveMode] = useState<EffectiveAppMode>(() =>
    mode === 'auto' ? 'cloud' : mode,
  )
  const [isDegraded, setIsDegraded] = useState(false)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  const setMode = useCallback((next: AppMode) => {
    setModeState(next)
    // Clear degraded when user explicitly changes mode
    setIsDegraded(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  const triggerCompanionFallback = useCallback(() => {
    // Only fallback if we're currently using Companion (local/hybrid/auto resolving to those)
    const usingCompanion = mode === 'local' || mode === 'hybrid' || (mode === 'auto' && (effectiveMode === 'local' || effectiveMode === 'hybrid'))
    if (!usingCompanion) return

    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    if (isOnline) {
      console.warn('[AppMode] Companion dropped, falling back to Cloud (degraded)')
      setEffectiveMode('cloud')
      setIsDegraded(true)
    } else {
      // Offline entirely - can't fallback to Cloud, stay in current mode (frozen view)
      console.warn('[AppMode] Companion dropped but offline, staying in current mode')
    }
  }, [effectiveMode, mode])

  const clearDegraded = useCallback(() => {
    setIsDegraded(false)
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    // If we're in degraded state, don't override effectiveMode - keep Cloud fallback active
    if (isDegraded) {
      return
    }

    if (mode !== 'auto') {
      setEffectiveMode(mode)
      return
    }

    const next: EffectiveAppMode = isConnected ? (isOnline ? 'hybrid' : 'local') : 'cloud'
    setEffectiveMode(next)
  }, [isConnected, isDegraded, isOnline, mode])

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

