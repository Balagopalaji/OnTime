import { getApps, initializeApp, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'

// Only initialize Firebase if config is present (allows local/companion-only mode)
const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)

let app: ReturnType<typeof initializeApp> | null = null
let auth: ReturnType<typeof getAuth> | null = null
let db: ReturnType<typeof getFirestore> | null = null
let functions: ReturnType<typeof getFunctions> | null = null

if (hasConfig) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  auth = getAuth(app)
  void setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn('Failed to set auth persistence', error)
  })
  db = getFirestore(app)
  functions = getFunctions(app)
} else {
  console.warn('[Firebase] No configuration found - running in local/companion mode only')
}

if (useEmulator && auth && db) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099')
    connectFirestoreEmulator(db, 'localhost', 8080)
  } catch (error) {
    console.warn('Failed to connect Firebase emulators', error)
  }
}

if (useEmulator && functions) {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001)
  } catch (error) {
    console.warn('Failed to connect Firebase Functions emulator', error)
  }
}

// For debugging and console tests
if (typeof window !== 'undefined') {
  (window as any).firebase = { app, auth, db, functions };
}

export { app, auth, db, functions }
