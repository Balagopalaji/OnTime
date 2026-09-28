import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import firebaseConfigJson from '../../../firebase.json?raw'

const emulatorConfig = JSON.parse(firebaseConfigJson) as {
  emulators: {
    firestore: { port: number }
    functions: { port: number }
  }
}
const defaultFirestorePort = emulatorConfig.emulators.firestore.port
const defaultFunctionsPort = emulatorConfig.emulators.functions.port

const firebaseSdk = vi.hoisted(() => {
  const app = { kind: 'app' }
  const auth = { kind: 'auth' }
  const db = { kind: 'firestore' }
  const functions = { kind: 'functions' }

  return {
    app,
    auth,
    db,
    functions,
    connectAuthEmulator: vi.fn(),
    connectFirestoreEmulator: vi.fn(),
    connectFunctionsEmulator: vi.fn(),
    getApps: vi.fn(() => []),
    initializeApp: vi.fn(() => app),
    getApp: vi.fn(() => app),
    getAuth: vi.fn(() => auth),
    getFirestore: vi.fn(() => db),
    getFunctions: vi.fn(() => functions),
    setPersistence: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('firebase/app', () => ({
  getApps: firebaseSdk.getApps,
  initializeApp: firebaseSdk.initializeApp,
  getApp: firebaseSdk.getApp,
}))

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: { kind: 'browser-local-persistence' },
  connectAuthEmulator: firebaseSdk.connectAuthEmulator,
  getAuth: firebaseSdk.getAuth,
  setPersistence: firebaseSdk.setPersistence,
}))

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: firebaseSdk.connectFirestoreEmulator,
  getFirestore: firebaseSdk.getFirestore,
}))

vi.mock('firebase/functions', () => ({
  connectFunctionsEmulator: firebaseSdk.connectFunctionsEmulator,
  getFunctions: firebaseSdk.getFunctions,
}))

const enableConfiguredFirebase = () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app')
  vi.stubEnv('VITE_USE_FIREBASE_EMULATOR', 'true')
  vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', '')
  vi.stubEnv('VITE_FUNCTIONS_EMULATOR_PORT', '')
}

describe('Firebase emulator configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    enableConfiguredFirebase()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults Firestore and Functions to the checked-in firebase.json ports', async () => {
    await import('./firebase')

    expect.soft(firebaseSdk.connectFirestoreEmulator).toHaveBeenCalledWith(
      firebaseSdk.db,
      'localhost',
      defaultFirestorePort,
    )
    expect.soft(firebaseSdk.connectFunctionsEmulator).toHaveBeenCalledWith(
      firebaseSdk.functions,
      'localhost',
      defaultFunctionsPort,
    )
  })

  it('uses Vite port overrides when emulator ports are configured', async () => {
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', '18081')
    vi.stubEnv('VITE_FUNCTIONS_EMULATOR_PORT', '15002')

    await import('./firebase')

    expect.soft(firebaseSdk.connectFirestoreEmulator).toHaveBeenCalledWith(
      firebaseSdk.db,
      'localhost',
      18081,
    )
    expect.soft(firebaseSdk.connectFunctionsEmulator).toHaveBeenCalledWith(
      firebaseSdk.functions,
      'localhost',
      15002,
    )
  })

  it.each([
    ['non-number', 'not-a-number'],
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '8081.5'],
    ['above the maximum TCP port', '65536'],
    ['non-finite', 'Infinity'],
  ])('falls back to checked-in defaults for %s emulator port overrides', async (_case, value) => {
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', value)
    vi.stubEnv('VITE_FUNCTIONS_EMULATOR_PORT', value)

    await import('./firebase')

    expect.soft(firebaseSdk.connectFirestoreEmulator).toHaveBeenCalledWith(
      firebaseSdk.db,
      'localhost',
      defaultFirestorePort,
    )
    expect.soft(firebaseSdk.connectFunctionsEmulator).toHaveBeenCalledWith(
      firebaseSdk.functions,
      'localhost',
      defaultFunctionsPort,
    )
  })
})
