import { Navigate, useLocation, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useDataContext } from '../context/DataProvider'
import { useAppMode } from '../context/AppModeContext'

export const ProtectedRoute = ({
  children,
  requireOwner = false,
}: {
  children: ReactNode
  requireOwner?: boolean
}) => {
  const { mode } = useAppMode()
  const { user, status } = useAuth()
  const { getRoom } = useDataContext()
  const params = useParams()
  const location = useLocation()

  if (mode === 'local' || mode === 'hybrid') {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Checking credentials...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace state={{ from: location }} />
  }

  if (requireOwner && params.roomId) {
    const room = getRoom(params.roomId)
    if (!room) {
      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          Loading room...
        </div>
      )
    }
    if (room.ownerId !== user.uid) {
      return <Navigate to="/dashboard" replace />
    }
  }

  return <>{children}</>
}
