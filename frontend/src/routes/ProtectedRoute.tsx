import { Navigate, useLocation, useParams } from 'react-router-dom'
import { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMockData } from '../context/MockDataContext'

export const ProtectedRoute = ({
  children,
  requireOwner = false,
}: {
  children: ReactNode
  requireOwner?: boolean
}) => {
  const { user, status } = useAuth()
  const { getRoom } = useMockData()
  const params = useParams()
  const location = useLocation()

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
    if (!room || room.ownerId !== user.uid) {
      return <Navigate to="/dashboard" replace />
    }
  }

  return <>{children}</>
}
