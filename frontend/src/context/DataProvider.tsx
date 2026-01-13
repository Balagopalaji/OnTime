/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { AppModeProvider } from './AppModeContext'
import { CompanionConnectionProvider } from './CompanionConnectionContext'
import { MockDataProvider } from './MockDataContext'
import { UnifiedDataProvider, useUnifiedDataContext } from './UnifiedDataContext'

const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)

// Only use mocks when explicitly opted in.
const shouldUseMock = import.meta.env.VITE_USE_MOCK === 'true'
const shouldFallbackToMock = import.meta.env.VITE_FIREBASE_FALLBACK_TO_MOCK === 'true'

export const DataProvider = ({ children }: { children: ReactNode }) => {
  let content: ReactNode

  if (shouldUseMock) {
    content = <MockDataProvider>{children}</MockDataProvider>
  } else if (!hasFirebaseConfig && !shouldFallbackToMock) {
    console.error('Firebase configuration is missing and mock mode is disabled.')
    content = (
      <div className="p-6 text-center text-sm text-red-300">
        Missing Firebase configuration. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, and
        VITE_FIREBASE_APP_ID, or enable VITE_FIREBASE_FALLBACK_TO_MOCK=true during setup.
      </div>
    )
  } else {
    content = (
      <UnifiedDataProvider fallbackToMock={shouldFallbackToMock}>
        {children}
      </UnifiedDataProvider>
    )
  }

  return (
    <CompanionConnectionProvider>
      <AppModeProvider>{content}</AppModeProvider>
    </CompanionConnectionProvider>
  )
}

export { useUnifiedDataContext as useDataContext }
