import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AuthProvider } from './context/AuthContext'
import { CompanionConnectionProvider } from './context/CompanionConnectionContext'
import { DataProvider } from './context/DataProvider'
import { AppModeProvider } from './context/AppModeContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CompanionConnectionProvider>
      <AppModeProvider>
        <AuthProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </AuthProvider>
      </AppModeProvider>
    </CompanionConnectionProvider>
  </React.StrictMode>,
)
