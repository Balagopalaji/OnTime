import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { LandingPage } from './LandingPage'
import { DashboardPage } from './DashboardPage'
import { ControllerPage } from './ControllerPage'
import { ViewerPage } from './ViewerPage'
import { ProtectedRoute } from './ProtectedRoute'

export const AppRouter = () => {
  return (
    <BrowserRouter>
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
