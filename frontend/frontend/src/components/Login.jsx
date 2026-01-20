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
    <div className="min-h-screen bg-[#1a1f2e] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative w-full max-w-4xl"
      >
        <div className="bg-[#242b3d] rounded-2xl shadow-2xl overflow-hidden border border-[#2d3548]">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-1/2 bg-[#1e2433] p-8 md:p-12 flex flex-col items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[#4a90d9]/5 to-transparent" />
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-48 h-48 md:w-56 md:h-56 mb-6">
                  <img src={logoImage} alt="NioChat Logo" className="w-full h-full object-contain" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-wide text-[#4a90d9]">
                  NioChat
                </h1>
                <p className="text-[#6b7280] mt-3 text-sm text-center">
                  Sua plataforma inteligente de atendimento
                </p>
              </div>
            </div>

            <div className="md:w-1/2 p-8 md:p-12">
              <h2 className="text-2xl font-semibold text-white mb-2">
                Bem-vindo de volta
              </h2>
              <p className="text-[#6b7280] mb-8">
                Faça login para continuar
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-[#9ca3af]">Usuário</Label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6b7280]" />
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-12 h-12"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[#9ca3af]">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6b7280]" />
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

        <div className="text-center mt-6 text-sm text-[#6b7280] space-y-1">
          <p>© 2026 NIOCHAT</p>
          <p>Versão {version}</p>
        </div>
      </motion.div>
    </div>
  );
}
