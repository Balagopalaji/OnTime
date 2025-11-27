import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { LandingPage } from './LandingPage'
import { DashboardPage } from './DashboardPage'
import { ControllerPage } from './ControllerPage'
import { ViewerPage } from './ViewerPage'
import { ProtectedRoute } from './ProtectedRoute'
import { useEffect } from 'react'

const RouteRestorer = () => {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname === '/') {
      const last = window.localStorage.getItem('stagetime.lastPath')
      if (last) {
        navigate(last, { replace: true })
      }
    }
  }, [location.pathname, navigate])

  return null
}

export const AppRouter = () => {
  return (
    <BrowserRouter>
      <RouteRestorer />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/room/:roomId/control"
            element={
              <ProtectedRoute requireOwner>
                <ControllerPage />
              </ProtectedRoute>
            }
          />
          <Route path="/room/:roomId/view" element={<ViewerPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
