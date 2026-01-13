import { BrowserRouter, HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { LandingPage } from './LandingPage'
import { DashboardPage } from './DashboardPage'
import { ControllerPage } from './ControllerPage'
import { ViewerPage } from './ViewerPage'
import { ProtectedRoute } from './ProtectedRoute'
import { CompanionTestPage } from './CompanionTestPage'
import { LocalModePage } from './LocalModePage'
import { CompanionTrustHelper } from './CompanionTrustHelper'
import { useEffect, useRef } from 'react'
import { isElectron, onNavigate, updateSessionState } from '../lib/electron'

// Use HashRouter in Electron (file:// protocol), BrowserRouter otherwise.
// NOTE: This check runs at module load time. It works because Electron's preload
// script runs before the page loads, so window.controllerAPI is already defined.
// Do NOT lazy-load this module or the check may fail.
const Router = isElectron() ? HashRouter : BrowserRouter

const RouteRestorer = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const hasRestoredRef = useRef(false)

  // Restore route on reload
  useEffect(() => {
    if (hasRestoredRef.current) return
    const navEntry =
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined) ??
      (performance as Performance & { navigation?: PerformanceNavigation }).navigation
    const isReload =
      (navEntry && 'type' in navEntry && (navEntry as PerformanceNavigationTiming).type === 'reload') ||
      (navEntry && 'type' in navEntry && (navEntry as PerformanceNavigation).type === 1)

    if (location.pathname === '/' && isReload) {
      const last = window.localStorage.getItem('stagetime.lastPath')
      if (last) {
        navigate(last, { replace: true })
      }
    }
    hasRestoredRef.current = true
  }, [location.pathname, navigate])

  // Handle deep link navigation from Electron main process
  useEffect(() => {
    return onNavigate((route) => {
      navigate(route, { replace: true })
    })
  }, [navigate])

  // Update session state for crash recovery (Electron only)
  useEffect(() => {
    if (location.pathname !== '/') {
      // Extract roomId from path if present
      const match = location.pathname.match(/^\/room\/([^/]+)\/(control|view)$/)
      const roomId = match?.[1] ?? undefined
      void updateSessionState({ lastPath: location.pathname, lastRoomId: roomId })
    }
  }, [location.pathname])

  return null
}

export const AppRouter = () => {
  return (
    <Router>
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
          <Route path="/companion-test" element={<CompanionTestPage />} />
          <Route path="/local" element={<LocalModePage />} />
          <Route path="/companion/trust" element={<CompanionTrustHelper />} />
        </Route>
      </Routes>
    </Router>
  )
}
