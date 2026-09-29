// rebuild-target: app-internal (cloud-web session viewer)
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getFirestore, onSnapshot } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { emulatorSettings, firebaseConfig, hasConfig } from '../../lib/firebase-config'
import type { PresentationTransport, ResolveResult, ViewerStateDoc } from './presentation-session-controller'

/**
 * Viewer transport on its own named Firebase app with in-memory auth, so the
 * read-only viewer principal never replaces an owner's session in this
 * browser, is never persisted, and disappears with `close()`.
 */
export function createFirebasePresentationTransport(): PresentationTransport {
  if (!hasConfig) throw new Error('Cloud viewer requires Firebase configuration')
  const app = initializeApp(firebaseConfig, `presentation-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  const db = getFirestore(app)
  const fns = getFunctions(app)
  if (emulatorSettings.enabled) {
    connectAuthEmulator(auth, `http://localhost:${emulatorSettings.authPort}`, { disableWarnings: true })
    connectFirestoreEmulator(db, 'localhost', emulatorSettings.firestorePort)
    connectFunctionsEmulator(fns, 'localhost', emulatorSettings.functionsPort)
  }

  return {
    resolve: async (sessionId, token) => {
      const result = await httpsCallable<{ sessionId: string; token: string }, ResolveResult>(fns, 'resolvePresentationViewerLink')({ sessionId, token })
      return result.data
    },
    signIn: async (customToken) => {
      await signInWithCustomToken(auth, customToken)
    },
    onViewerState: (sessionId, next, error) =>
      onSnapshot(
        doc(db, 'presentationSessionViewerStates', sessionId),
        (snap) => next(snap.exists() ? (snap.data() as ViewerStateDoc) : null),
        (err) => error(err.code),
      ),
    onSnapshot: (sessionId, next, error) =>
      onSnapshot(
        doc(db, 'presentationSessionSnapshots', sessionId),
        (snap) => next(snap.exists() ? snap.data() : null),
        (err) => error(err.code),
      ),
    close: async () => {
      await signOut(auth).catch(() => {})
      await deleteApp(app)
    },
  }
}
