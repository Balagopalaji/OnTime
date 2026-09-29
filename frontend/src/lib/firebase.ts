import { getApps, initializeApp, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, type Auth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions'

import { emulatorSettings, firebaseConfig, hasConfig } from './firebase-config'

let app: ReturnType<typeof initializeApp> | null = null
let auth: ReturnType<typeof getAuth> | null = null
let db: ReturnType<typeof getFirestore> | null = null
let functions: ReturnType<typeof getFunctions> | null = null

declare global {
  interface Window {
    firebase?: {
      app: FirebaseApp | null
      auth: Auth | null
      db: Firestore | null
      functions: Functions | null
    }
  }
}

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

if (emulatorSettings.enabled && auth && db) {
  try {
    connectAuthEmulator(auth, `http://localhost:${emulatorSettings.authPort}`)
    connectFirestoreEmulator(db, 'localhost', emulatorSettings.firestorePort)
  } catch (error) {
    console.warn('Failed to connect Firebase emulators', error)
  }
}

if (emulatorSettings.enabled && functions) {
  try {
    connectFunctionsEmulator(functions, 'localhost', emulatorSettings.functionsPort)
  } catch (error) {
    console.warn('Failed to connect Firebase Functions emulator', error)
  }
}

// For debugging and console tests
if (typeof window !== 'undefined') {
  window.firebase = { app, auth, db, functions }
}

export { app, auth, db, functions }
