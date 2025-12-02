/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { FirebaseDataProvider } from './FirebaseDataContext'
import { MockDataProvider } from './MockDataContext'
import { useDataContext } from './DataContext'

const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)

// Default to mock unless explicitly disabled and Firebase is configured
const shouldUseMock =
  import.meta.env.VITE_USE_MOCK !== 'false' || !hasFirebaseConfig
const shouldFallbackToMock =
  import.meta.env.VITE_FIREBASE_FALLBACK_TO_MOCK === 'true' || !hasFirebaseConfig

export const DataProvider = ({ children }: { children: ReactNode }) => {
  if (shouldUseMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return (
    <FirebaseDataProvider fallbackToMock={shouldFallbackToMock}>
      {children}
    </FirebaseDataProvider>
  )
}

export { useDataContext }
