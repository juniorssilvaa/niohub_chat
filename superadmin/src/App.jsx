import React, { useState, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import axios from 'axios'
import LoadingBar from '@niochat/components/ui/LoadingBar'
import Login from '@niochat/components/Login'
import Topbar from '@niochat/components/Topbar'
import { useAuth } from '@niochat/contexts/AuthContext'
import useSessionTimeout from '@niochat/hooks/useSessionTimeout.jsx'
import { APP_VERSION } from '@niochat/config/version'
import Changelog from '@niochat/components/Changelog'
import UserStatusManager from '@niochat/components/UserStatusManager'

import './App.css'

const SuperadminSidebar = lazy(() => import('./SuperadminSidebar'))
const SuperadminDashboard = lazy(() => import('./SuperadminDashboard'))
const MetaFinalizingSuperadmin = lazy(() => import('./MetaFinalizingSuperadmin'))

export default function App() {
  const { user, loading: authLoading, logout } = useAuth()
  const [showChangelog, setShowChangelog] = useState(false)
  const [pendingChangelogVersion, setPendingChangelogVersion] = useState(APP_VERSION)
  const { startTimeout } = useSessionTimeout(user)

  const userRole = user?.user_type || user?.role || null
  const changelogStorageKey = user?.id ? `last_seen_changelog_version:${user.id}` : 'last_seen_changelog_version'

  useEffect(() => {
    if (user?.id) {
      startTimeout()
      const checkChangelogVersion = async () => {
        try {
          const response = await axios.get('/api/changelog/')
          const currentVersion = response.data?.current_version || APP_VERSION
          const lastSeenVersion = localStorage.getItem(changelogStorageKey)
          setPendingChangelogVersion(currentVersion)
          if (lastSeenVersion !== currentVersion) {
            setShowChangelog(true)
          }
        } catch {
          const lastSeenVersion = localStorage.getItem(changelogStorageKey)
          setPendingChangelogVersion(APP_VERSION)
          if (lastSeenVersion !== APP_VERSION) {
            setShowChangelog(true)
          }
        }
      }
      checkChangelogVersion()
    }
  }, [user?.id, startTimeout, changelogStorageKey])

  useEffect(() => {
    if (!user?.id) return
    const ping = async () => {
      try {
        await axios.post('/api/users/ping/')
      } catch {
        /* ignore */
      }
    }
    const initialTimer = setTimeout(() => {
      ping()
      const timer = setInterval(ping, 30000)
      return () => clearInterval(timer)
    }, 1000)
    return () => clearTimeout(initialTimer)
  }, [user?.id])

  const handleLogout = async () => {
    await logout()
    window.location.href = '/login'
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-xl">Carregando...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/*" element={<Login />} />
      </Routes>
    )
  }

  if (userRole !== 'superadmin') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg">Este painel é exclusivo para superadministradores.</p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-primary-foreground"
          onClick={() => logout().then(() => { window.location.href = '/login' })}
        >
          Sair
        </button>
      </div>
    )
  }

  return (
    <Suspense fallback={<LoadingBar />}>
      <Routes>
        <Route path="/app/meta/finalizando-superadmin" element={<MetaFinalizingSuperadmin />} />
        <Route
          path="/admin/*"
          element={
            <div className="flex h-screen">
              <SuperadminSidebar onLogout={handleLogout} />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Topbar onLogout={handleLogout} onChangelog={() => setShowChangelog(true)} />
                <SuperadminDashboard />
              </div>
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <Changelog
        isOpen={showChangelog}
        onClose={() => {
          setShowChangelog(false)
          localStorage.setItem(changelogStorageKey, pendingChangelogVersion || APP_VERSION)
        }}
      />
      <UserStatusManager user={user} />
    </Suspense>
  )
}
