import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { delay } from '../lib/utils'

export type AuthUser = {
  uid: string
  displayName: string
}

type AuthContextValue = {
  user: AuthUser | null
  status: 'loading' | 'ready'
  login: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const DEMO_USER: AuthUser = {
  uid: 'demo-owner',
  displayName: 'StageTime Operator',
}

const STORAGE_KEY = 'stagetime.auth.v1'

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(STORAGE_KEY) ? DEMO_USER : null
  })
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    const timer = setTimeout(() => setStatus('ready'), 200)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user) {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [user])

  const login = useCallback(async () => {
    setStatus('loading')
    await delay(350)
    setUser(DEMO_USER)
    setStatus('ready')
  }, [])

  const logout = useCallback(async () => {
    setStatus('loading')
    await delay(200)
    setUser(null)
    setStatus('ready')
  }, [])

  const value = useMemo(() => ({ user, status, login, logout }), [
    user,
    status,
    login,
    logout,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
