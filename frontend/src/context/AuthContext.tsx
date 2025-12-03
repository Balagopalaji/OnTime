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
import { auth } from '../lib/firebase'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth'

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
// Only use mocks when explicitly opted in.
const useMockAuth = import.meta.env.VITE_USE_MOCK === 'true'
// Default to popup unless explicitly told to redirect.
const preferRedirect = import.meta.env.VITE_AUTH_METHOD === 'redirect'

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(STORAGE_KEY) && useMockAuth ? DEMO_USER : null
  })
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    if (useMockAuth) {
      const timer = setTimeout(() => setStatus('ready'), 200)
      return () => clearTimeout(timer)
    }

    let unsub = () => {}
    try {
      unsub = onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
        if (fbUser) {
          setUser({
            uid: fbUser.uid,
            displayName: fbUser.displayName ?? 'StageTime Operator',
          })
        } else {
          setUser(null)
        }
        setStatus('ready')
      })
    } catch (error) {
      console.warn('Auth listener failed', error)
      setStatus('ready')
      return
    }

    return () => unsub()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user && useMockAuth) {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [user])

  const login = useCallback(async () => {
    if (useMockAuth) {
      setStatus('loading')
      await delay(350)
      setUser(DEMO_USER)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const shouldRedirectFirst =
        preferRedirect && (typeof window === 'undefined' || window.crossOriginIsolated)
      if (shouldRedirectFirst) {
        await signInWithRedirect(auth, provider)
      } else {
        try {
          await signInWithPopup(auth, provider)
        } catch (error) {
          console.warn('Popup sign-in failed, falling back to redirect', error)
          await signInWithRedirect(auth, provider)
        }
      }
    } catch (error) {
      console.error('Google sign-in failed', error)
    } finally {
      setStatus('ready')
    }
  }, [])

  const logout = useCallback(async () => {
    if (useMockAuth) {
      setStatus('loading')
      await delay(200)
      setUser(null)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      await signOut(auth)
    } finally {
      setStatus('ready')
    }
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
