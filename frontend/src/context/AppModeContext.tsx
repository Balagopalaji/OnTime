/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type AppMode = 'auto' | 'cloud' | 'local' | 'hybrid'
export type EffectiveAppMode = Exclude<AppMode, 'auto'>

const STORAGE_KEY = 'ontime:appMode'

type AppModeContextValue = {
  mode: AppMode
  effectiveMode: EffectiveAppMode
  setMode: (mode: AppMode) => void
}

const AppModeContext = createContext<AppModeContextValue | undefined>(undefined)

const readInitialMode = (): AppMode => {
  if (typeof window === 'undefined') return 'cloud'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'auto' || raw === 'local' || raw === 'hybrid' || raw === 'cloud') return raw
  return 'cloud'
}

const probeCompanion = async (timeoutMs = 600): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('http://localhost:4001/api/token', {
      method: 'GET',
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

export const AppModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<AppMode>(() => readInitialMode())
  const [effectiveMode, setEffectiveMode] = useState<EffectiveAppMode>(() =>
    mode === 'auto' ? 'cloud' : mode,
  )
  const resolvingRef = useRef(false)

  const setMode = useCallback((next: AppMode) => {
    setModeState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      setEffectiveMode(mode)
      return
    }

    let cancelled = false

    const resolve = async () => {
      if (resolvingRef.current) return
      resolvingRef.current = true
      try {
        const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
        const companionReachable = await probeCompanion()
        const next: EffectiveAppMode = companionReachable ? (isOnline ? 'hybrid' : 'local') : 'cloud'
        if (!cancelled) setEffectiveMode(next)
      } finally {
        resolvingRef.current = false
      }
    }

    void resolve()
    const interval = window.setInterval(resolve, 3000)
    const handleOnline = () => void resolve()
    const handleOffline = () => void resolve()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [mode])

  const value = useMemo(() => ({ mode, effectiveMode, setMode }), [effectiveMode, mode, setMode])
  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>
}

export const useAppMode = () => {
  const ctx = useContext(AppModeContext)
  if (!ctx) throw new Error('useAppMode must be used within AppModeProvider')
  return ctx
}


