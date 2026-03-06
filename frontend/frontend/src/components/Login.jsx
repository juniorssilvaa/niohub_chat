import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { APP_VERSION } from '../config/version';
import logoImage from '../assets/logo.png';
import { buildApiPath } from '@/utils/apiBaseUrl';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [version, setVersion] = useState(APP_VERSION);

  // Buscar versão da API do changelog
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const changelogUrl = buildApiPath('/api/changelog/');
        const response = await axios.get(changelogUrl);
        if (response.data?.current_version) {
          setVersion(response.data.current_version);
        }
      } catch (err) {
        console.warn('Não foi possível carregar versão do changelog, usando fallback:', APP_VERSION);
        // Mantém a versão estática como fallback
      }
    };

    fetchVersion();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // #region agent log
    console.log('[AUTH-DEBUG] Login.jsx:42: handleSubmit chamado', { username, loading });
    try {
      fetch('http://127.0.0.1:7242/ingest/985f778c-eea1-40fb-8675-4607dc61316b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Login.jsx:42', message: 'handleSubmit chamado', data: { username, loading }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
    } catch (e) { }
    // #endregion
    if (loading) {
      // #region agent log
      console.log('[AUTH-DEBUG] Login.jsx:42: handleSubmit bloqueado - já em loading', { username });
      try {
        fetch('http://127.0.0.1:7242/ingest/985f778c-eea1-40fb-8675-4607dc61316b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Login.jsx:42', message: 'handleSubmit bloqueado - já em loading', data: { username }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
      } catch (e) { }
      // #endregion
      return;
    }
    setLoading(true);
    setError('');

    try {
      // ✅ ÚNICO lugar onde login é chamado - AuthContext cuida de tudo
      const userData = await login(username, password);

      // Redirecionar baseado no tipo de usuário
      if (userData.user_type === 'superadmin') {
        navigate('/superadmin', { replace: true });
      } else if (userData.provedor_id) {
        if (userData.user_type === 'agent') {
          navigate(`/app/accounts/${userData.provedor_id}/conversations`, { replace: true });
        } else {
          navigate(`/app/accounts/${userData.provedor_id}/dashboard`, { replace: true });
        }
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Usuário ou senha inválidos');
      } else {
        setError('Erro ao conectar com o servidor');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4 dark">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-4xl"
      >
        <div className="bg-card rounded-2xl shadow-2xl overflow-hidden border border-border">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-1/2 bg-[#242424] p-8 md:p-12 flex flex-col items-center justify-center relative">
              <div className="absolute inset-0 bg-[#ffffff]/0.02" />
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-48 h-48 md:w-56 md:h-56 mb-6">
                  <img src={logoImage} alt="NioChat Logo" className="w-full h-full object-contain" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-wide text-foreground">
                  NioChat
                </h1>
                <p className="text-muted-foreground mt-3 text-sm text-center">
                  Sua plataforma inteligente de atendimento
                </p>
              </div>
            </div>

            <div className="md:w-1/2 p-8 md:p-12">
              <h2 className="text-2xl font-semibold text-white mb-2">
                Bem-vindo de volta
              </h2>
              <p className="text-muted-foreground mb-8">
                Faça login para continuar
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Usuário</Label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-12 h-12"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-12 pr-12 h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg p-3">
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={loading} className="w-full h-12">
                  {loading ? 'Entrando...' : 'Acessar'}
                </Button>
              </form>
            </div>
          </div>
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground space-y-1">
          <p>© 2026 NIOCHAT</p>
          <p>Versão {version}</p>
        </div>
      </motion.div>
    </div>
  );
}
