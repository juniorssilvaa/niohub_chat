import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ConversationList from './components/ConversationList';
import ChatArea from './components/ChatArea';
import ConversationsPage from './components/ConversationsPage';
import Dashboard from './components/Dashboard';
import DashboardPrincipal from './components/DashboardPrincipal';
import Settings from './components/Settings';
import UserManagement from './components/UserManagement';
import CompanyManagement from './components/CompanyManagement';
import ConversasDashboard from './components/ConversasDashboard';
import Contacts from './components/Contacts2';
import SuperadminDashboard from './components/SuperadminDashboard';
import Login from './components/Login';
import Topbar from './components/Topbar';
import UserStatusManager from './components/UserStatusManager';
import './App.css';
import {
  Routes,
  Route,
  Navigate,
  useParams,
  useLocation,
  useNavigate
} from 'react-router-dom';
import ConversationAudit from './components/ConversationAudit';
import SuperadminSidebar from './components/SuperadminSidebar';
import ProviderAdminSidebar from './components/ProviderAdminSidebar';
import ProviderDataForm from './components/ProviderDataForm';
import ProviderScheduleForm from './components/ProviderScheduleForm';
import Integrations from './components/Integrations';
import ProfilePage from './components/ProfilePage';
import AppearancePage from './components/AppearancePage';
import TeamsPage from './components/TeamsPage';
import ConversationRecovery from './components/ConversationRecovery';
import CSATDashboard from './components/CSATDashboard';
import Changelog from './components/Changelog';
import OAuthCallback from './components/OAuthCallback';
import MetaFinalizing from './components/MetaFinalizing';
import { io } from 'socket.io-client';
import axios from 'axios';
import { AlertTriangle } from 'lucide-react';
import { NotificationProvider } from './contexts/NotificationContext';
import useSessionTimeout from './hooks/useSessionTimeout';

// Configurar axios para usar URLs relativas (será resolvido pelo proxy do Vite)
// axios.defaults.baseURL = 'http://192.168.100.55:8010'; // REMOVIDO - usar URLs relativas

// BaseURL dinâmica: usa API direta em app.niochat.com.br (produção), relativa em desenvolvimento
// Para front.niochat.com.br, usar URL relativa para permitir proxy do Vite apontar para backend local
// PRIORIDADE: Variável de ambiente > Modo DEV > Hostname
// Usar função centralizada para obter URL da API
import { getApiBaseUrl } from './utils/apiBaseUrl';
const forceLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === 'true';
axios.defaults.baseURL = forceLocalBackend ? '' : getApiBaseUrl();

// Interceptor global do Axios para adicionar o token do usuário logado
axios.interceptors.request.use(config => {
  // Sempre obter o token mais recente do localStorage
  const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
  
  if (token) {
    if (!config.headers) config.headers = {};
    
    // Sempre aplicar o token do localStorage para garantir consistência, 
    // exceto se o request já tiver um header de Authorization específico e diferente
    // (o que é raro no nosso app)
    const currentHeader = typeof config.headers.get === 'function' 
      ? config.headers.get('Authorization') 
      : (config.headers['Authorization'] || config.headers['authorization']);

    if (!currentHeader || !currentHeader.includes(token)) {
      if (typeof config.headers.set === 'function') {
        config.headers.set('Authorization', `Token ${token}`);
      } else {
        config.headers['Authorization'] = `Token ${token}`;
      }
    }
  }
  
  return config;
}, error => {
  return Promise.reject(error);
});

// Interceptor para lidar com respostas não autorizadas
axios.interceptors.response.use(
  response => response,
  error => {
    // Se o request marcou para ignorar logout por 401, apenas rejeitar
    if (error.config?.__skip401Logout) {
      return Promise.reject(error);
    }

    if (error.response && error.response.status === 401) {
      const currentPath = window.location.pathname;
      
      // Não redirecionar se já estiver na página de login
      if (currentPath === '/login' || currentPath.includes('/login')) {
        return Promise.reject(error);
      }
      
      // CRÍTICO: Não redirecionar durante processo de login ativo
      const loginInProgress = typeof window !== 'undefined' && window.__loginInProgress === true;
      if (loginInProgress) {
        return Promise.reject(error);
      }
      
      // Verificar se o token ainda existe no localStorage
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      
      // Se não há token, definitivamente não está autenticado - limpar e redirecionar
      if (!token) {
        const keysToClear = ['auth_token', 'token', 'user', 'selectedConversation', 'unread_messages_by_user', 'internal_chat_unread_count'];
        keysToClear.forEach(key => localStorage.removeItem(key));
        delete axios.defaults.headers.common['Authorization'];
        window.location.href = '/login';
        return Promise.reject(error);
      }
      
      // Se o token EXISTE, o 401 pode ser um erro temporário ou permissão
      // SÓ deslogar se for um endpoint de autenticação E o erro for explicitamente de token inválido
      const authEndpoints = ['/api/auth/me/', '/api/auth/login/'];
      const isAuthEndpoint = authEndpoints.some(endpoint => 
        error.config?.url?.includes(endpoint)
      );
      
      if (isAuthEndpoint) {
        const errorDetail = error.response?.data?.detail || error.response?.data?.error || '';
        const isTokenError = errorDetail.includes('Token inválido') || 
                            errorDetail.includes('Invalid token') ||
                            errorDetail.includes('não autenticado');
                            
        if (isTokenError) {
          console.warn('Logout forçado: Servidor rejeitou o token como inválido.');
          const keysToClear = ['auth_token', 'token', 'user', 'selectedConversation', 'unread_messages_by_user', 'internal_chat_unread_count'];
          keysToClear.forEach(key => localStorage.removeItem(key));
          delete axios.defaults.headers.common['Authorization'];
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }
      
      // Se o token existe e não é um erro confirmado de validade do token, 
      // NÃO limpa o localStorage. Deixa o usuário na página atual.
      // Isso resolve o problema de deslogar no Refresh se o servidor demorar a responder.
      console.log('401 detectado, mas token mantido no localStorage para resiliência.');
    }
    return Promise.reject(error);
  }
);

// Função para verificar se login está em progresso (usada pelo interceptor)
// A flag é controlada diretamente no Login.jsx
window.__isLoginInProgress = () => isLoginInProgress;

const isMetaFinalizingPath = (pathname) =>
  pathname === '/app/meta/finalizando' ||
  pathname.startsWith('/app/meta/finalizando');

function ProvedorAppWrapper({ userRole, user, handleLogout, handleChangelog, handleNotifications, selectedConversation, setSelectedConversation, providerMenu, setProviderMenu, whatsappDisconnected, setWhatsappDisconnected }) {
  const { provedorId } = useParams();
  const location = useLocation();
  
  // Proteção de rotas baseada no papel do usuário
  const isAdminRoute = (path) => {
    const adminRoutes = ['users', 'equipes', 'audit', 'companies', 'integracoes', 'dados-provedor', 'horario-provedor'];
    return adminRoutes.some(route => path.includes(route));
  };
  
  // Se é atendente e está tentando acessar rota administrativa, redirecionar
  if (userRole === 'agent' && isAdminRoute(location.pathname)) {
    return <Navigate to={`/app/accounts/${provedorId}/conversations`} replace />;
  }
  
  // Estado para abrir/fechar o sidebar no mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });

  // Fechar sidebar ao navegar (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  
  // CRÍTICO: Verificar se estamos em fluxo de integração para não redirecionar
  const isIntegrationFlow = location.pathname.includes('/integracoes');
  
  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden w-full">
      <Sidebar 
        userRole={userRole} 
        userPermissions={user?.permissions || []} 
        provedorId={provedorId} 
        mobileOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        onCollapseChange={setSidebarCollapsed}
      />
      <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300 min-w-0 w-full">
        <Topbar onLogout={handleLogout} onChangelog={handleChangelog} onNotifications={handleNotifications} onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto w-full overflow-x-hidden">
          <div className="w-full h-full">
            <Routes>
                          <Route path="dashboard" element={<DashboardPrincipal provedorId={provedorId} />} />
          <Route path="conversas" element={<ConversasDashboard provedorId={provedorId} />} />
          <Route path="conversas-dashboard" element={<ConversasDashboard provedorId={provedorId} />} />
          <Route path="contacts" element={<Contacts provedorId={provedorId} />} />
          <Route path="conversations" element={
            <ConversationsPage 
              selectedConversation={selectedConversation}
              setSelectedConversation={setSelectedConversation}
              provedorId={provedorId}
              user={user}
            />
          } />
          <Route path="reports" element={<DashboardPrincipal provedorId={provedorId} />} />
          <Route path="settings" element={<Settings provedorId={provedorId} />} />
          <Route path="users" element={<UserManagement provedorId={provedorId} />} />
          <Route path="equipes" element={<TeamsPage />} />
          <Route path="audit" element={<ConversationAudit provedorId={provedorId} />} />
          <Route path="recovery" element={<ConversationRecovery provedorId={provedorId} />} />
          <Route path="companies" element={<CompanyManagement provedorId={provedorId} />} />
          <Route path="csat" element={<CSATDashboard provedorId={provedorId} />} />
          <Route path="integracoes" element={<Integrations provedorId={provedorId} />} />
          <Route path="perfil" element={<ProfilePage provedorId={provedorId} />} />
          <Route path="aparencia" element={<AppearancePage provedorId={provedorId} />} />
          <Route path="dados-provedor" element={<ProviderDataForm provedorId={provedorId} />} />
          <Route path="horario-provedor" element={<ProviderScheduleForm provedorId={provedorId} />} />
          <Route path="atendimento-provedor" element={<div>Em breve: Atendimento Provedor</div>} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

function OAuthCallbackHandler() {
  const location = useLocation();
  const [status, setStatus] = useState('Processando autenticação...');
  
  useEffect(() => {
    // Se a URL já contém /app/accounts/, significa que o backend já redirecionou corretamente
    // Não processar aqui - deixar o componente Integrations processar
    if (location.pathname.includes('/app/accounts/')) {
      // Extrair provider_id da URL e redirecionar para integracoes se necessário
      const pathParts = location.pathname.split('/');
      const providerIdIndex = pathParts.indexOf('accounts');
      if (providerIdIndex !== -1 && pathParts[providerIdIndex + 1]) {
        const providerId = pathParts[providerIdIndex + 1];
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        const state = params.get('state');
        
        // Se já estamos em /integracoes, não fazer nada
        if (location.pathname.includes('/integracoes')) {
          return;
        }
        
        // Se não estamos em /integracoes, redirecionar para lá mantendo code e state
        if (code && state) {
          window.location.replace(`/app/accounts/${providerId}/integracoes?code=${code}&state=${state}`);
          return;
        }
      }
      return;
    }
    
    // Extrair parâmetros da URL
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    
    if (error) {
      setStatus('Erro na autenticação. Redirecionando...');
      const providerId = state ? state.replace('provider_', '') : '1';
      setTimeout(() => {
        window.location.replace(`/app/accounts/${providerId}/integracoes?oauth_error=${error}`);
      }, 1000);
      return;
    }
    
    if (!code || !state) {
      setStatus('Parâmetros inválidos. Redirecionando...');
      setTimeout(() => {
        window.location.replace('/app/accounts/1/integracoes?oauth_error=invalid_params');
      }, 1000);
      return;
    }
    
    // Extrair provider_id do state
    const providerId = state.replace('provider_', '');
    
    // Fazer requisição ao backend para processar o callback
    // Usar função centralizada para obter URL da API
    const apiBaseUrl = getApiBaseUrl();
    const backendUrl = apiBaseUrl || window.location.origin.replace(':8012', ':8010'); // Fallback para localhost se apiBaseUrl estiver vazio
    const callbackUrl = `${backendUrl}/app/oauth/callback/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    
    setStatus('Conectando ao servidor...');
    
    // Fazer fetch para o backend processar o callback
    fetch(callbackUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/html',
      }
    })
    .then(response => {
      if (response.ok) {
        // Tentar parsear como JSON primeiro
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return response.json().then(data => {
            setStatus('Autenticação concluída. Redirecionando...');
            setTimeout(() => {
              window.location.replace(data.redirect_url || `/app/accounts/${providerId}/integracoes?oauth_success=1`);
            }, 500);
          });
        } else {
          // Se não for JSON, apenas redirecionar
          setStatus('Autenticação concluída. Redirecionando...');
          setTimeout(() => {
            window.location.replace(`/app/accounts/${providerId}/integracoes?oauth_success=1`);
          }, 500);
        }
      } else {
        return response.text().then(text => {
          throw new Error(`Erro ${response.status}: ${text.substring(0, 100)}`);
        });
      }
    })
    .catch(error => {
      setStatus('Erro ao processar. Redirecionando...');
      // Mesmo com erro, redirecionar para integrações
      setTimeout(() => {
        window.location.replace(`/app/accounts/${providerId}/integracoes?oauth_error=processing_failed`);
      }, 1000);
    });
  }, [location]);
  
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      gap: '20px'
    }}>
      <div style={{ fontSize: '18px', color: '#666' }}>{status}</div>
      <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #667eea', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function SafeRedirect({ user }) {
  const location = useLocation();

  // 🚨 BLOQUEIO ABSOLUTO DA META
  if (isMetaFinalizingPath(location.pathname)) {
    return null;
  }

  // Se há code e state na URL, significa que é retorno do OAuth
  // NÃO redirecionar para dashboard - deixar o componente Integrations processar
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  const oauthError = params.get('oauth_error');
  const oauthSuccess = params.get('oauth_success');
  
  // CRÍTICO: Se há parâmetros OAuth ou estamos em integrações, NUNCA redirecionar
  if ((code && state) || oauthError || oauthSuccess || location.pathname.includes('/integracoes')) {
    return null;
  }
  
  if (user && user.user_type === 'superadmin') {
    return <Navigate to="/superadmin" replace />;
  }
  
  // Redirecionamento inteligente baseado no tipo de usuário
  if (user && user.provedor_id) {
    if (user.user_type === 'agent') {
      return <Navigate to={`/app/accounts/${user.provedor_id}/conversations`} replace />;
    } else {
      return <Navigate to={`/app/accounts/${user.provedor_id}/dashboard`} replace />;
    }
  }
  
  return <Navigate to={user && user.provedor_id ? `/app/accounts/${user.provedor_id}/dashboard` : '/'} replace />;
}

function App() {
  const [selectedConversation, setSelectedConversation] = useState(() => {
    // CORREÇÃO: Recuperar conversa selecionada do localStorage e verificar se não está fechada
    const savedConversation = localStorage.getItem('selectedConversation');
    if (savedConversation) {
      try {
        const parsed = JSON.parse(savedConversation);
        const status = parsed.status || parsed.additional_attributes?.status;
        const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
        
        // Só restaurar se a conversa não estiver fechada
        if (!closedStatuses.includes(status)) {
          return parsed;
        } else {
          // Limpar localStorage se a conversa estiver fechada
          localStorage.removeItem('selectedConversation');
          return null;
        }
      } catch (e) {
        // Se houver erro ao parsear, limpar e retornar null
        localStorage.removeItem('selectedConversation');
        return null;
      }
    }
    return null;
  });

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [providerMenu, setProviderMenu] = useState('dados');
  const [whatsappDisconnected, setWhatsappDisconnected] = useState(false);
  const [provedorId, setProvedorId] = useState(null);
  const lastStatusRef = useRef(null);
  const navigate = useNavigate();
  
  // Hook para timeout da sessão
  let startTimeout = () => {};
  try {
    const sessionTimeout = useSessionTimeout();
    startTimeout = sessionTimeout.startTimeout || (() => {});
  } catch (error) {
    // Erro ao inicializar useSessionTimeout
  }

  // Debug: Log do estado do usuário
  useEffect(() => {
    // Removidos logs de debug para evitar sobrecarga
  }, [user, userRole, authLoading, provedorId]);

  // Debug: Monitorar mudanças no provedorId
  useEffect(() => {
    // Removidos logs de debug para evitar sobrecarga
  }, [provedorId]);

  // Salvar conversa selecionada no localStorage quando mudar
  useEffect(() => {
    if (selectedConversation) {
      localStorage.setItem('selectedConversation', JSON.stringify(selectedConversation));
    } else {
      localStorage.removeItem('selectedConversation');
    }
  }, [selectedConversation]);

  // Buscar provedorId do usuário logado
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const userObj = JSON.parse(userStr);
        if (userObj.provedor_id) setProvedorId(userObj.provedor_id);
      } catch {}
    }
  }, []);

  useEffect(() => {
    // Se já temos o usuário no estado ou se o login está em progresso, não buscar novamente
    if (user || window.__loginInProgress) {
      if (authLoading) setAuthLoading(false);
      return;
    }

    // Priorizar auth_token que é o padrão salvo no Login
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    
    if (token) {
      // Fazer requisição com tratamento de erro silencioso
      // O interceptor já vai adicionar o token do localStorage
      axios.get('/api/auth/me/', {
        // Garantir que não tentamos deslogar se este request específico falhar (race condition)
        __skip401Logout: true 
      })
        .then(res => {
          const userData = res.data;
          const userWithToken = { ...userData, token };
          setUser(userWithToken);
          localStorage.setItem('user', JSON.stringify(userWithToken));
          
          const tipo = userData.role || userData.user_type;
          setUserRole(tipo);
          
          if (userData.provedor_id) {
            setProvedorId(userData.provedor_id);
          }
          
          setAuthLoading(false);
          startTimeout();
        })
        .catch((error) => {
          // Só deslogar se for erro 401 real de token inválido
          if (error.response && error.response.status === 401) {
            const errorDetail = error.response.data?.detail || error.response.data?.error || '';
            const isInvalidToken = errorDetail.includes('Token inválido') || 
                                  errorDetail.includes('Invalid token') || 
                                  errorDetail.includes('não autenticado');
            
            if (isInvalidToken) {
              console.warn('Sessão expirada ou token inválido na inicialização');
              localStorage.removeItem('auth_token');
              localStorage.removeItem('token');
              localStorage.removeItem('user');
              setUser(null);
              setUserRole(null);
            }
          }
          setAuthLoading(false);
        });
    } else {
      setAuthLoading(false);
    }
  }, [user, authLoading]); // Adicionado authLoading para garantir que finaliza se necessário

  useEffect(() => {
    // Integração WebSocket Evolution
    const evoInstance = localStorage.getItem('evoInstance');
    if (!evoInstance) return;
    const socket = io(`wss://evo.niochat.com.br/${evoInstance}`, {
      transports: ['websocket'],
    });
    socket.on('connect', () => {
      // Log removido('Conectado ao Evolution WebSocket');
    });
    socket.onAny((event, data) => {
      // Log removido('Evento Evolution:', event, data);
    });
    socket.on('disconnect', () => {
      // Log removido('Desconectado do Evolution WebSocket');
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  // Fallback de presença: ping periódico para manter usuário online mesmo sem WS
  useEffect(() => {
    if (!user || !user.id) return;
    
    let intervalId;
    const sendPing = async () => {
      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        if (!token) return;
        
        // Usar uma instância limpa ou garantir headers para este request
        await axios.post('/api/users/ping/', {}, {
          headers: {
            'Authorization': `Token ${token}`
          },
          // Custom flag para o interceptor não deslogar em caso de 401 neste endpoint
          __skip401Logout: true 
        });
      } catch (err) {
        // Silenciar erros de ping para não afetar a experiência do usuário
        // Se der 401 aqui, o interceptor global NÃO vai deslogar por causa do __skip401Logout
      }
    };
    
    // Pequeno delay inicial para garantir que o token está estável
    const initialTimer = setTimeout(() => {
      sendPing();
      intervalId = setInterval(sendPing, 30000);
    }, 2000);
    
    return () => {
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [user?.id]);

  // Listener para atualização de conversas
  useEffect(() => {
    const handleConversationUpdate = (event) => {
      const { conversationId, conversation } = event.detail;
      if (selectedConversation && selectedConversation.id === conversationId) {
        setSelectedConversation(conversation);
      }
    };

    window.addEventListener('conversationUpdated', handleConversationUpdate);
    return () => {
      window.removeEventListener('conversationUpdated', handleConversationUpdate);
    };
  }, [selectedConversation]);

  const handleLogin = (userData) => {
    // Log removido('Login realizado com sucesso');
    setUser(userData);
    const tipo = userData.role || userData.user_type;
    setUserRole(tipo);
    
    // Salvar dados do usuário no localStorage para persistência e outros componentes
    localStorage.setItem('user', JSON.stringify(userData));
    if (userData.provedor_id) setProvedorId(userData.provedor_id);
    
    // Iniciar timeout da sessão
    startTimeout();
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (token) {
        // Chamar API de logout para registrar no log de auditoria
        await fetch('/api/auth/logout/', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error) {
      // Erro ao fazer logout
    } finally {
      // Sempre limpar dados locais mesmo se a API falhar
      // Limpar todos os dados de sessão para evitar crosstalk entre usuários
      const keysToClear = ['auth_token', 'token', 'user', 'selectedConversation', 'unread_messages_by_user', 'internal_chat_unread_count'];
      keysToClear.forEach(key => localStorage.removeItem(key));
      
      setUser(null);
      setUserRole(null);
      setProvedorId(null);
      window.location.href = '/login';
    }
  };

  const [showChangelog, setShowChangelog] = useState(false);

  const handleChangelog = () => {
    setShowChangelog(true);
  };

  const handleNotifications = () => {
    alert('Notificações em breve!');
  };

  // LISTENER GLOBAL PARA EVENTOS DA META
  // Isso garante que capturamos o evento mesmo se a página mudar de Integracoes para MetaFinalizing
  useEffect(() => {
    const handleMetaMessage = (event) => {
      // Validar se é um evento da Meta
      if (event.data?.type === 'WA_EMBEDDED_SIGNUP' && event.data?.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        // Salvar no localStorage como um "sinalizador" para os componentes interessados
        localStorage.setItem('meta_signup_result', JSON.stringify({
          timestamp: Date.now(),
          data: event.data
        }));

        // Disparar um evento customizado para notificar componentes montados
        window.dispatchEvent(new CustomEvent('metaSignupFinished', { detail: event.data }));
      }
    };

    window.addEventListener('message', handleMetaMessage);
    return () => window.removeEventListener('message', handleMetaMessage);
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-xl animate-pulse">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/*" element={<Login onLogin={handleLogin} />} />
      </Routes>
    );
  }

  const SuperadminRoute = ({ children }) => {
    if (userRole !== 'superadmin') {
      return <Navigate to="/" replace />;
    }
    return children;
  };

  // Debug: Renderização com fallback
  try {
    return (
      <NotificationProvider>
        {/* Modal de alerta WhatsApp desconectado */}
        {whatsappDisconnected && (
          <div className="fixed inset-0 bg-white/95 flex items-center justify-center z-50">
            <div className="w-full max-w-md text-center relative flex flex-col items-center p-10 rounded-xl">
              <button onClick={() => setWhatsappDisconnected(false)} className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition text-2xl text-gray-400" title="Fechar">
                ×
              </button>
              <div className="flex flex-col items-center mb-4">
                <div className="bg-red-100 rounded-full p-4 mb-2">
                  <AlertTriangle className="w-12 h-12 text-red-600" />
                </div>
                <h3 className="text-2xl font-bold text-black mb-2">WhatsApp desconectado</h3>
                <p className="text-gray-700 mb-6">Conecte-se novamente para que os resultados não sejam afetados.</p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg text-lg font-semibold shadow transition w-full"
              >
                RECONECTAR-SE
              </button>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/superadmin/*" element={
            <SuperadminRoute>
              <div className="h-screen bg-background text-foreground flex overflow-hidden">
                <SuperadminSidebar onLogout={handleLogout} />
                <div className="flex-1 flex flex-col overflow-hidden">
                  <Topbar onLogout={handleLogout} onChangelog={handleChangelog} onNotifications={handleNotifications} />
                  <SuperadminDashboard onLogout={handleLogout} />
                </div>
              </div>
            </SuperadminRoute>
          } />
          {/* Tela intermediária para pós-"Concluir" da Meta - DEVE estar antes das rotas protegidas */}
          <Route path="/app/meta/finalizando" element={<MetaFinalizing />} />
          {/* OAuth callback - página intermediária para processar callback do Meta */}
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          {/* OAuth callback - processar e redirecionar (legado) */}
          <Route path="/app/oauth/callback/*" element={<OAuthCallbackHandler />} />
          {/* Rotas multi-tenant para provedores */}
          <Route path="/app/accounts/:provedorId/*" element={
            <ProvedorAppWrapper
              userRole={userRole}
              user={user}
              handleLogout={handleLogout}
              handleChangelog={handleChangelog}
              handleNotifications={handleNotifications}
              selectedConversation={selectedConversation}
              setSelectedConversation={setSelectedConversation}
              providerMenu={providerMenu}
              setProviderMenu={setProviderMenu}
              whatsappDisconnected={whatsappDisconnected}
              setWhatsappDisconnected={setWhatsappDisconnected}
            />
          } />
          {/* Redirecionamento padrão para login ou dashboard */}
          <Route path="*" element={<SafeRedirect user={user} />} />
        </Routes>
        {/* Changelog Modal */}
        <Changelog 
          isOpen={showChangelog} 
          onClose={() => setShowChangelog(false)} 
        />
        
        {/* Gerenciador de Status Online do Usuário */}
        <UserStatusManager user={user} />
      </NotificationProvider>
    );
  } catch (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Erro na Aplicação</h1>
          <p className="text-red-500 mb-4">{error.message}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Recarregar Página
          </button>
        </div>
      </div>
    );
  }
}

export default App;
