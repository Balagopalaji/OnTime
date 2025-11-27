/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { FirebaseDataProvider } from './FirebaseDataContext'
import { MockDataProvider } from './MockDataContext'
import { useDataContext } from './DataContext'

// Default to Firebase unless explicitly set to "true"
const shouldUseMock = import.meta.env.VITE_USE_MOCK === 'true'
const shouldFallbackToMock =
  import.meta.env.VITE_FIREBASE_FALLBACK_TO_MOCK === 'true'

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
