/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { FirebaseDataProvider } from './FirebaseDataContext'
import { MockDataProvider } from './MockDataContext'
import { useDataContext } from './DataContext'
import { CompanionDataProvider } from './CompanionDataContext'
import { useAppMode } from './AppModeContext'

const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)

// Only use mocks when explicitly opted in.
const shouldUseMock = import.meta.env.VITE_USE_MOCK === 'true'
const shouldFallbackToMock = import.meta.env.VITE_FIREBASE_FALLBACK_TO_MOCK === 'true'

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { effectiveMode, triggerCompanionFallback } = useAppMode()
  // Always use effectiveMode for provider selection - this respects fallback state
  // (e.g., when mode is "local" but Companion dropped and we fell back to "cloud")

  if (shouldUseMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  // Both Local and Hybrid use Companion as primary, with Firestore write-through when online.
  // This ensures seamless fallback to Cloud if Companion drops - Firestore always has the latest state.
  // The only difference is the label; functionally they behave the same when online.
  if (effectiveMode === 'local' || effectiveMode === 'hybrid') {
    return (
      <CompanionDataProvider firestoreWriteThrough onDisconnect={triggerCompanionFallback}>
        {children}
      </CompanionDataProvider>
    )
  }

  if (!hasFirebaseConfig && !shouldFallbackToMock) {
    console.error('Firebase configuration is missing and mock mode is disabled.')
    return (
      <div className="p-6 text-center text-sm text-red-300">
        Missing Firebase configuration. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, and
        VITE_FIREBASE_APP_ID, or enable VITE_FIREBASE_FALLBACK_TO_MOCK=true during setup.
      </div>
    )
  }

  return (
    <FirebaseDataProvider fallbackToMock={shouldFallbackToMock}>
      {children}
    </FirebaseDataProvider>
  )
}

export { useDataContext }
