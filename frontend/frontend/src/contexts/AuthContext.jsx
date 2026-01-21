import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiBaseUrl';

const AuthContext = createContext(null);

// Configurar baseURL do axios UMA ÚNICA VEZ
axios.defaults.baseURL = getApiBaseUrl();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const booted = useRef(false);
  const refreshing = useRef(false);
  const refreshQueue = useRef([]);

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout/');
    } catch {}
    
    // ÚNICO lugar onde token é removido
    localStorage.removeItem('auth_token');
    localStorage.removeItem('token'); // Limpar fallback se existir
    localStorage.removeItem('user');
    booted.current = false; // Resetar flag de bootstrap
    setUser(null);
  }, []);

  const refreshToken = useCallback(async () => {
    // Se já está fazendo refresh, aguardar na fila
    if (refreshing.current) {
      return new Promise((resolve, reject) => {
        refreshQueue.current.push({ resolve, reject });
      });
    }

    refreshing.current = true;

    try {
      const { data } = await axios.post('/api/auth/refresh/');
      if (!data?.token) throw new Error('Token de refresh ausente');
      
      // ÚNICO lugar onde token é atualizado
      localStorage.setItem('auth_token', data.token);
      
      // Resolver todas as promessas na fila
      refreshQueue.current.forEach(p => p.resolve(data.token));
      refreshQueue.current = [];
      
      return data.token;
    } catch (err) {
      // Refresh falhou - limpar sessão
      refreshQueue.current.forEach(p => p.reject(err));
      refreshQueue.current = [];
      // Limpar sessão diretamente (não chamar logout para evitar dependência circular)
      localStorage.removeItem('auth_token');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      throw err;
    } finally {
      refreshing.current = false;
    }
  }, []);

  // Request interceptor (PASSIVO - apenas adiciona token se existir, SEM warnings/logs)
  useEffect(() => {
    const req = axios.interceptors.request.use(config => {
      const token = localStorage.getItem('auth_token');
      
      // Se há token, adicionar ao header. Se não há, deixar passar sem token (passivo)
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Token ${token}`;
      }
      // Se não há token, não fazer nada - deixar a request seguir sem Authorization
      // O backend responderá 401 se necessário, e isso é comportamento esperado
      
      return config;
    });
    return () => axios.interceptors.request.eject(req);
  }, []);

  // Response interceptor (PASSIVO - só tenta refresh se houver token e for 401)
  useEffect(() => {
    const res = axios.interceptors.response.use(
      r => r,
      async error => {
        const original = error.config;
        const status = error.response?.status;
        
        // PRIMEIRO: Verificar se há token antes de tentar qualquer ação
        const token = localStorage.getItem('auth_token');
        
        // Se não há token, não fazer nada - deixar o erro propagar naturalmente
        // Isso evita tentativas de refresh quando não há sessão válida
        if (!token) {
          return Promise.reject(error);
        }
        
        // Ignorar refresh se:
        // - Não é 401
        // - Já tentou refresh antes
        // - É a requisição de refresh em si
        // - É login/logout (não deve fazer refresh)
        const isAuthEndpoint = original.url?.includes('/api/auth/login/') || 
                              original.url?.includes('/api/auth/logout/') ||
                              original.url?.includes('/api/auth/refresh/');
        
        if (status !== 401 || original._retry || isAuthEndpoint) {
          return Promise.reject(error);
        }

        // Só chega aqui se: há token, é 401, não é endpoint de auth, e não tentou refresh ainda
        original._retry = true;
        
        try {
          const newToken = await refreshToken();
          original.headers.Authorization = `Token ${newToken}`;
          return axios(original);
        } catch (refreshError) {
          // Refresh falhou - deixar o erro propagar naturalmente
          // O AuthContext já cuida do logout se necessário
          return Promise.reject(refreshError);
        }
      }
    );
    return () => axios.interceptors.response.eject(res);
  }, [refreshToken]);

  const bootstrap = useCallback(async () => {
    if (booted.current) {
      console.debug('[AUTH] Bootstrap já executado, ignorando');
      return;
    }
    booted.current = true;
    console.debug('[AUTH] Bootstrap iniciado');

    // PRIMEIRO: Verificar se há token ANTES de fazer qualquer chamada
    const token = localStorage.getItem('auth_token');
    if (!token) {
      console.debug('[AUTH] Bootstrap: Nenhum token encontrado no localStorage - app não autenticado');
      setLoading(false);
      return;
    }
    
    // Validar que o token não está vazio ou apenas espaços
    if (!token.trim()) {
      console.debug('[AUTH] Bootstrap: Token vazio encontrado - limpando');
      localStorage.removeItem('auth_token');
      setLoading(false);
      return;
    }

    console.debug('[AUTH] Bootstrap: Token encontrado', { 
      tokenPrefix: token.substring(0, 10),
      tokenLength: token.length 
    });

    // Tentar validar o token com retry para lidar com race conditions
    let retries = 0;
    const maxRetries = 2;
    
    while (retries <= maxRetries) {
      try {
        console.debug(`[AUTH] Bootstrap: Validando token via /api/auth/me/ (tentativa ${retries + 1})`);
        const { data } = await axios.get('/api/auth/me/');
        console.debug('[AUTH] Bootstrap: Token válido, usuário restaurado', {
          userId: data.id,
          username: data.username
        });
        setUser(data);
        localStorage.setItem('user', JSON.stringify(data));
        setLoading(false);
        return; // Sucesso, sair do loop
      } catch (err) {
        const status = err.response?.status;
        console.warn(`[AUTH] Bootstrap: Falha na tentativa ${retries + 1}`, {
          status,
          statusText: err.response?.statusText,
          error: err.response?.data
        });
        
        // Se for 401, tentar refresh token antes de desistir
        if (status === 401 && retries < maxRetries) {
          console.debug('[AUTH] Bootstrap: 401 recebido, tentando refresh token');
          try {
            // Tentar refresh token
            await refreshToken();
            // Aguardar um pouco antes de retentar (para evitar race conditions)
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
            continue; // Retentar /api/auth/me/ com o novo token
          } catch (refreshErr) {
            console.error('[AUTH] Bootstrap: Refresh token falhou', {
              status: refreshErr.response?.status,
              error: refreshErr.response?.data
            });
            // Refresh falhou, limpar sessão
            await logout();
            setLoading(false);
            return;
          }
        } else {
          // Não é 401 ou excedeu retries, limpar sessão
          console.error('[AUTH] Bootstrap: Token inválido após todas as tentativas', {
            status,
            retries
          });
          await logout();
          setLoading(false);
          return;
        }
      }
    }
  }, [logout, refreshToken]);

  const login = useCallback(async (username, password) => {
    console.debug('[AUTH] Login iniciado', { username });
    
    const { data } = await axios.post('/api/auth/login/', { username, password });
    if (!data?.token) {
      console.error('[AUTH] Login falhou: Token ausente na resposta');
      throw new Error('Token ausente');
    }
    
    console.debug('[AUTH] Token recebido do servidor', { 
      tokenPrefix: data.token.substring(0, 10),
      tokenLength: data.token.length 
    });
    
    // ÚNICO lugar onde token é salvo
    localStorage.setItem('auth_token', data.token);
    const savedToken = localStorage.getItem('auth_token');
    console.debug('[AUTH] Token salvo no localStorage', { 
      saved: savedToken === data.token,
      savedPrefix: savedToken?.substring(0, 10),
      originalPrefix: data.token.substring(0, 10)
    });
    
    // Buscar dados do usuário
    try {
      console.debug('[AUTH] Buscando dados do usuário via /api/auth/me/');
      const tokenBeforeRequest = localStorage.getItem('auth_token');
      console.debug('[AUTH] Token antes da requisição /me:', { 
        exists: !!tokenBeforeRequest,
        prefix: tokenBeforeRequest?.substring(0, 10)
      });
      
      const { data: userData } = await axios.get('/api/auth/me/');
      console.debug('[AUTH] Dados do usuário recebidos', { 
        userId: userData.id,
        username: userData.username,
        userType: userData.user_type 
      });
      
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      return userData;
    } catch (err) {
      console.error('[AUTH] Erro ao buscar /me após login', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        error: err.response?.data,
        tokenExists: !!localStorage.getItem('auth_token')
      });
      // Se falhar ao buscar /me, limpar token e relançar erro
      localStorage.removeItem('auth_token');
      throw err;
    }
  }, []);

  // Bootstrap executa UMA ÚNICA VEZ
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
};
