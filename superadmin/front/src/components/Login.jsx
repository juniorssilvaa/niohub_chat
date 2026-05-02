import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import axios from 'axios'
import { APP_VERSION } from '../config/version'
import { buildApiPath } from '../utils/apiBaseUrl'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [version, setVersion] = useState(APP_VERSION)

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await axios.get(buildApiPath('/api/changelog/'))
        if (response.data?.current_version) setVersion(response.data.current_version)
      } catch {
        // fallback
      }
    }
    fetchVersion()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const userData = await login(username, password)
      if (userData.user_type !== 'superadmin') {
        setError('Este painel é exclusivo para superadmin.')
        return
      }
      navigate('/admin', { replace: true })
    } catch (err) {
      if (err.response?.status === 401) setError('Usuário ou senha inválidos')
      else setError(err.response?.data?.error || 'Erro ao conectar com o servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4 text-white">
      <div className="relative w-full max-w-4xl">
        <div className="bg-zinc-800 rounded-2xl shadow-2xl overflow-hidden border border-zinc-700">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-1/2 bg-zinc-800 p-8 md:p-12 flex flex-col items-center justify-center relative">
              <div className="absolute inset-0 opacity-[0.03] bg-zinc-200" />
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-48 h-48 md:w-56 md:h-56 mb-6 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                  <img src="https://i.imgur.com/MLwyaEt.png" alt="NIO HUB Logo" className="w-40 h-40 object-contain" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-wide text-zinc-100">NIO HUB</h1>
                <p className="text-zinc-300 mt-3 text-sm text-center">Sua plataforma inteligente de atendimento</p>
              </div>
            </div>

            <div className="md:w-1/2 p-8 md:p-12 bg-zinc-800">
              <h2 className="text-2xl font-bold text-zinc-100 mb-2 tracking-tight">Bem-vindo de volta</h2>
              <p className="text-zinc-200 mb-8">Faça login para continuar</p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-zinc-200 text-sm">Usuário</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-12 h-12 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-400 rounded-md"
                      placeholder="Seu usuário"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-zinc-200 text-sm">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-12 pr-12 h-12 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-400 rounded-md"
                      placeholder="Sua senha"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all rounded-md"
                >
                  {loading ? 'Entrando...' : 'Acessar'}
                </button>
              </form>
            </div>
          </div>
        </div>
        <div className="text-center mt-6 text-sm text-zinc-400 space-y-1">
          <p>© 2026 NIO HUB</p>
          <p>Versão {version}</p>
        </div>
      </div>
    </div>
  )
}
