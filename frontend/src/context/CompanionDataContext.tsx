import { useEffect, useRef, type ReactNode } from 'react'
import { useCompanionConnection } from './CompanionConnectionContext'
import { UnifiedDataProvider } from './UnifiedDataContext'

export const CompanionDataProvider = ({
  children,
  onDisconnect,
}: {
  children: ReactNode
  firestoreWriteThrough?: boolean
  /** Called when the Companion WebSocket disconnects unexpectedly */
  onDisconnect?: () => void
}) => {
  const { isConnected } = useCompanionConnection()
  const wasConnectedRef = useRef(false)

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true
      return
    }

    if (wasConnectedRef.current) {
      onDisconnect?.()
      wasConnectedRef.current = false
    }
  }, [isConnected, onDisconnect])

  return <UnifiedDataProvider>{children}</UnifiedDataProvider>
}
