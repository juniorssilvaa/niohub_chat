import React, { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Utilizador autenticado como superadmin no painel provedor:
 * redireciona para a app Superadmin (outra origem) com token no hash (não vai para logs HTTP).
 */
export default function SuperadminHandoffRedirect() {
  const { logout } = useAuth()
  const base = import.meta.env.VITE_SUPERADMIN_APP_URL?.replace(/\/$/, '')

  useEffect(() => {
    if (!base) return
    const token = localStorage.getItem('auth_token')
    if (token) {
      window.location.replace(`${base}/#niochat_auth_handoff=${encodeURIComponent(token)}`)
    }
  }, [base])

  if (!base) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center max-w-lg mx-auto">
        <p className="text-lg">
          Conta de superadmin: defina <code className="rounded bg-muted px-1 text-sm">VITE_SUPERADMIN_APP_URL</code> no
          ambiente do build do painel provedor (URL base da app Superadmin) e volte a fazer deploy.
        </p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => logout().then(() => { window.location.href = '/login' })}
        >
          Sair
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-lg text-muted-foreground">A abrir o painel Superadmin…</p>
    </div>
  )
}
