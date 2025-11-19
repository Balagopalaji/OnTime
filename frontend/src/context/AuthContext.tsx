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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    const timer = setTimeout(() => setStatus('ready'), 400)
    return () => clearTimeout(timer)
  }, [])

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
