// rebuild-target: app-internal (cloud-web session viewer)
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SessionViewerPage } from './SessionViewerPage'

/**
 * Stand-alone root for `/session/:sessionId/view`, mounted without the
 * Auth/Data/room providers so no room listener, Companion socket, or owner
 * session is touched by a read-only presentation viewer.
 */
export function SessionViewerApp({ basename }: { basename?: string }) {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/session/:sessionId/view" element={<SessionViewerPage />} />
      </Routes>
    </BrowserRouter>
  )
}
