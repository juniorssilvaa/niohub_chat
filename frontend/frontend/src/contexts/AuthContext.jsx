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

  // Request interceptor (somente adicionar token - SEM DECISÕES)
  useEffect(() => {
    const req = axios.interceptors.request.use(config => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Token ${token}`;
      }
      return config;
    });
    return () => axios.interceptors.request.eject(req);
  }, []);

  // Response interceptor (refresh token - SEM LIMPAR SESSÃO)
  useEffect(() => {
    const res = axios.interceptors.response.use(
      r => r,
      async error => {
        const original = error.config;
        
        // Ignorar refresh se:
        // - Não é 401
        // - Já tentou refresh antes
        // - É a requisição de refresh em si
        // - É login/logout (não deve fazer refresh)
        const isAuthEndpoint = original.url?.includes('/api/auth/login/') || 
                              original.url?.includes('/api/auth/logout/') ||
                              original.url?.includes('/api/auth/refresh/');
        
        if (error.response?.status !== 401 || original._retry || isAuthEndpoint) {
          return Promise.reject(error);
        }

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
    if (booted.current) return;
    booted.current = true;

    const token = localStorage.getItem('auth_token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await axios.get('/api/auth/me/');
      setUser(data);
      localStorage.setItem('user', JSON.stringify(data));
    } catch {
      // Token inválido, limpar sessão
      await logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login/', { username, password });
    if (!data?.token) throw new Error('Token ausente');
    
    // ÚNICO lugar onde token é salvo
    localStorage.setItem('auth_token', data.token);
    
    // Buscar dados do usuário
    try {
      const { data: userData } = await axios.get('/api/auth/me/');
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      return userData;
    } catch (err) {
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
