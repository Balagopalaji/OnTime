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
  signInAnonymously,
  signInWithPopup,
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
const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)
const useMockAuth = import.meta.env.VITE_USE_MOCK !== 'false' || !hasFirebaseConfig
const fallbackToMockAuth =
  import.meta.env.VITE_FIREBASE_FALLBACK_TO_MOCK === 'true' || !hasFirebaseConfig

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

    const handleFallback = () => {
      if (fallbackToMockAuth) {
        setUser(DEMO_USER)
      }
      setStatus('ready')
    }

    let unsub = () => { }
    try {
      unsub = onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
        if (fbUser) {
          setUser({
            uid: fbUser.uid,
            displayName: fbUser.displayName ?? 'StageTime Operator',
          })
        } else if (fallbackToMockAuth) {
          setUser(DEMO_USER)
        } else {
          setUser(null)
          // Attempt anonymous sign-in if no user is found
          signInAnonymously(auth).catch((error) => {
            console.warn('Anonymous sign-in failed', error)
            setTimeout(handleFallback, 0)
          })
        }
        setStatus('ready')
      })
    } catch (error) {
      console.warn('Auth listener failed', error)
      setTimeout(handleFallback, 0)
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
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (error) {
      console.warn('Google sign-in failed, falling back to anonymous', error)
      await signInAnonymously(auth)
    }
    setStatus('ready')
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
    await signOut(auth)
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
