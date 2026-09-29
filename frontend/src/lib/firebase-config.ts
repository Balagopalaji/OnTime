// rebuild-target: app-internal (frontend Firebase configuration)
/**
 * Side-effect-free Firebase configuration shared by the default app
 * (`lib/firebase.ts`) and isolated apps such as the ISSUE-002 presentation
 * viewer. Importing this module initializes nothing.
 */

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

/** Only initialize Firebase if config is present (allows local/companion-only mode). */
export const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)

export const parseEmulatorPort = (value: string | undefined, fallback: number) => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

export const emulatorSettings = {
  enabled: import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true',
  authPort: 9099,
  firestorePort: parseEmulatorPort(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT, 8081),
  functionsPort: parseEmulatorPort(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT, 5002),
}
