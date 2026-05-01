;(function consumeAuthHandoffHash() {
  try {
    const raw = window.location.hash || ''
    const prefix = '#niochat_auth_handoff='
    if (!raw.startsWith(prefix)) return
    const token = decodeURIComponent(raw.slice(prefix.length))
    if (token) localStorage.setItem('auth_token', token)
  } catch {
    /* ignore */
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
})()

import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from '@niochat/components/ErrorBoundary.jsx'
import { BrowserRouter as Router } from 'react-router-dom'
import { LanguageProvider } from '@niochat/contexts/LanguageContext'
import { AuthProvider } from '@niochat/contexts/AuthContext'
import { NotificationProvider } from '@niochat/contexts/NotificationContext'
import ReminderAlert from '@niochat/components/ReminderAlert'
import { Toaster } from 'sonner'

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Router>
      <AuthProvider>
        <LanguageProvider>
          <NotificationProvider>
            <App />
            <ReminderAlert />
            <Toaster position="top-right" richColors closeButton />
          </NotificationProvider>
        </LanguageProvider>
      </AuthProvider>
    </Router>
  </ErrorBoundary>
)
