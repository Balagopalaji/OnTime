import React from 'react'
import ReactDOM from 'react-dom/client'
import { isSessionViewerPath } from './routes/session-viewer/session-link'

const appBase = import.meta.env.VITE_APP_BASE ?? '/'
const root = ReactDOM.createRoot(document.getElementById('root')!)

// ISSUE-002: the read-only presentation viewer is a separate entry. Neither
// branch statically imports the other, so a viewer never loads the operator
// app (default Firebase app, persisted owner session, room providers).
if (isSessionViewerPath(window.location.pathname, appBase)) {
  void import('./routes/session-viewer/SessionViewerApp').then(({ SessionViewerApp }) => {
    root.render(
      <React.StrictMode>
        <SessionViewerApp basename={appBase === '/' ? undefined : appBase.replace(/\/+$/, '')} />
      </React.StrictMode>,
    )
  })
} else {
  void Promise.all([
    import('./App'),
    import('./context/AuthContext'),
    import('./context/DataProvider'),
    import('./index.css'),
  ]).then(([{ default: App }, { AuthProvider }, { DataProvider }]) => {
    root.render(
      <React.StrictMode>
        <AuthProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </AuthProvider>
      </React.StrictMode>,
    )
  })
}
