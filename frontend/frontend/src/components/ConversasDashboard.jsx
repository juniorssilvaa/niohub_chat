import React, { useEffect, useState, useRef } from 'react';
import { Users, AlertTriangle, Flame, HelpCircle, Clock, MoreVertical, Bot, MessageCircle, User, X, Volume2, BrainCircuit, Timer } from 'lucide-react';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from './ui/dialog';
import { buildWebSocketUrl } from '../utils/websocketUrl';
import { useTheme } from '../hooks/useTheme';
import chatBgPattern from '../assets/chat-bg-pattern.svg';
import chatBgPatternLight from '../assets/chat-bg-pattern-light.svg';
// Remover: import { toast } from './ui/sonner';

const statusMap = [
  {
    key: 'snoozed',
    titulo: 'Na Automação',
    cor: 'bg-[#2d5eff]',
    textoCor: 'text-white',
  },
  {
    key: 'pending',
    titulo: 'Em Espera',
    cor: 'bg-[#ffd600]',
    textoCor: 'text-black',
  },
  {
    key: 'open',
    titulo: 'Em Atendimento',
    cor: 'bg-[#1bc47d]',
    textoCor: 'text-white',
  },
];

const fases = [
  {
    titulo: 'Navegando',
    cor: 'border',
    info: { flame: 0, alert: 0, help: 0, users: 0 },
  },
  {
    titulo: 'Em Espera',
    cor: 'border',
    info: { flame: 0, alert: 0, help: 0, users: 0 },
  },
  {
    titulo: 'Em Atendimento',
    cor: 'border',
    info: { flame: 0, alert: 0, help: 0, users: 0 },
  },
];

const blocos = [
  {
    key: 'ia',
    titulo: 'Com a IA',
    cor: 'bg-gradient-to-r from-purple-500 to-indigo-500',
    textoCor: 'text-white',
    icone: <HelpCircle className="w-7 h-7 text-white" />,
    status: 'snoozed', // Exemplo: status para IA
  },
  {
    key: 'fila',
    titulo: 'Fila de Atendentes',
    cor: 'bg-gradient-to-r from-orange-400 to-yellow-400',
    textoCor: 'text-white',
    icone: <AlertTriangle className="w-7 h-7 text-white" />,
    status: 'pending', // Exemplo: status para fila
  },
  {
    key: 'atendimento',
    titulo: 'Em Atendimento',
    cor: 'bg-gradient-to-r from-green-400 to-emerald-600',
    textoCor: 'text-white',
    icone: <Users className="w-7 h-7 text-white" />,
    status: 'open', // Exemplo: status para atendimento humano
  },
];

export default function ConversasDashboard() {
  const isDarkTheme = useTheme();
  const [counts, setCounts] = useState({ ia: 0, fila: 0, atendimento: 0 });
  const [loading, setLoading] = useState(true);

  // Função para processar conteúdo da mensagem (parsear JSON se necessário)
  const processMessageContent = (content, isFromCustomer = false) => {
    if (!content || typeof content !== 'string') {
      return content;
    }

    // Se parece ser JSON, tentar parsear
    if (content.trim().startsWith('{')) {
      try {
        // Primeiro, tentar parsear como está
        const parsed = JSON.parse(content);
        if (parsed.text) {
          return parsed.text;
        }
      } catch (e) {
        // Se falhou, tentar converter aspas simples para duplas
        try {
          const contentWithDoubleQuotes = content.replace(/'/g, '"');
          const parsed = JSON.parse(contentWithDoubleQuotes);
          if (parsed.text) {
            return parsed.text;
          }
        } catch (e2) {
          // Se ambos falharem, retornar o conteúdo original
        }
      }
    }

    return content;
  };

  // Função para obter nome limpo do canal
  const getChannelDisplayName = (inbox) => {
    if (!inbox) return 'Canal';

    const channelTypes = {
      'whatsapp': 'WhatsApp',
      'email': 'Email',
      'telegram': 'Telegram',
      'webchat': 'Chat Web',
      'facebook': 'Facebook',
      'instagram': 'Instagram'
    };

    return channelTypes[inbox.channel_type] || inbox.channel_type || 'Canal';
  };
  const [conversas, setConversas] = useState([]);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuBtnRefs = useRef({});
  const [modalConversa, setModalConversa] = useState(null); // conversa aberta no modal
  const [modalMensagens, setModalMensagens] = useState([]); // mensagens da conversa
  const [modalLoading, setModalLoading] = useState(false);
  const mensagensEndRef = useRef(null);
  const wsRef = useRef(null);
  const [modalTransferir, setModalTransferir] = useState(null); // conversa a transferir
  const [usuariosTransferir, setUsuariosTransferir] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [modalTransferirEquipe, setModalTransferirEquipe] = useState(null); // conversa a transferir para equipe
  const [equipesTransferir, setEquipesTransferir] = useState([]);
  const [loadingEquipes, setLoadingEquipes] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Funções auxiliares para filtrar conversas (sem sobreposição)
  const isComIA = (conv) => {
    // Conversas NÃO atribuídas a um agente (automatização/IA)
    // EXCLUIR conversas fechadas
    if (conv.status === 'closed' || conv.status === 'encerrada' || conv.status === 'resolved' || conv.status === 'finalizada') {
      return false;
    }
    // Com IA se status for snoozed E não tiver atendente humano
    return conv.status === 'snoozed' && !conv.assignee;
  };

  const isEmEspera = (conv) => {
    // Conversas aguardando atendimento humano
    // EXCLUIR conversas fechadas
    if (conv.status === 'closed' || conv.status === 'encerrada' || conv.status === 'resolved' || conv.status === 'finalizada') {
      return false;
    }
    // Em espera se status for pending OU se tiver equipe mas sem atendente individual
    return conv.status === 'pending' || (!conv.assignee && !!conv.additional_attributes?.assigned_team);
  };

  const isEmAtendimento = (conv) => {
    // Conversas que têm atendente individual atribuído
    // EXCLUIR conversas fechadas
    if (conv.status === 'closed' || conv.status === 'encerrada' || conv.status === 'resolved' || conv.status === 'finalizada') {
      return false;
    }
    // Se tem assignee humano, está em atendimento (independente de equipe ou status open/in_progress)
    return !!conv.assignee;
  };

  // Função para verificar autenticação (mesma lógica do ConversationList)
  const checkAuth = async () => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (token) {
        const userRes = await axios.get('/api/auth/me/', {
          headers: { Authorization: `Token ${token}` }
        });
        setUser(userRes.data);
        setAuthReady(true);
        return true;
      }
    } catch (error) {
      console.log('Credenciais inválidas, removendo...');
      // #region agent log
      const authTokenBefore = localStorage.getItem('auth_token');
      const tokenBefore = localStorage.getItem('token');
      console.log('[AUTH-DEBUG] ConversasDashboard.jsx:189: removendo token', { authTokenExists: !!authTokenBefore, tokenExists: !!tokenBefore, error: error.message });
      try {
        fetch('http://127.0.0.1:7242/ingest/985f778c-eea1-40fb-8675-4607dc61316b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ConversasDashboard.jsx:189', message: 'ConversasDashboard removendo token', data: { authTokenExists: !!authTokenBefore, tokenExists: !!tokenBefore, error: error.message }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
      } catch (e) { }
      // #endregion
      localStorage.removeItem('token');
      // #region agent log
      const authTokenAfter = localStorage.getItem('auth_token');
      console.log('[AUTH-DEBUG] ConversasDashboard.jsx:189: removeu token', { authTokenStillExists: !!authTokenAfter });
      try {
        fetch('http://127.0.0.1:7242/ingest/985f778c-eea1-40fb-8675-4607dc61316b', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ConversasDashboard.jsx:189', message: 'ConversasDashboard removeu token', data: { authTokenStillExists: !!authTokenAfter }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
      } catch (e) { }
      // #endregion
    }

    // Tentar sessão ativa
    try {
      const userRes = await axios.get('/api/auth/me/', {
        withCredentials: true
      });
      setUser(userRes.data);
      setAuthReady(true);
      return true;
    } catch (error) {
      // Nenhuma sessão ativa encontrada
      return false;
    }
  };

  // Inicializar autenticação
  useEffect(() => {
    const initializeAuth = async () => {
      const success = await checkAuth();
      if (!success) {
        setAuthReady(false);
        setHasInitialized(true);
      } else {
        setHasInitialized(true);
      }
    };

    initializeAuth();
  }, []);

  // Buscar mensagens ao abrir o modal
  useEffect(() => {
    if (modalConversa && modalConversa.id) {
      setModalLoading(true);
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      // Carregando mensagens da conversa
      axios.get(`/api/messages/?conversation=${modalConversa.id}&page_size=1000`, {
        headers: { Authorization: `Token ${token}` }
      })
        .then(res => {
          const mensagens = res.data.results || res.data;

          // Processar mensagens carregadas via API da mesma forma que as mensagens via WebSocket
          const processedMessages = mensagens.map(msg => {
            let processedContent = processMessageContent(msg.content, msg.is_from_customer);

            // Remover assinatura do agente se presente
            if (processedContent && processedContent.match(/\*.*disse:\*\n/) && !msg.is_from_customer) {
              processedContent = processedContent.replace(/\*.*disse:\*\n/, '');
            }

            // Identificar mensagens da IA de forma mais robusta
            const isFromAI = msg.from_ai === true ||
              msg.additional_attributes?.from_ai === true ||
              msg.sender?.sender_type === 'ai';

            return {
              ...msg,
              content: processedContent,
              sender: msg.sender || (isFromAI ? { sender_type: 'ai' } : { sender_type: 'agent' }),
              from_ai: isFromAI
            };
          });

          setModalMensagens(processedMessages);
        })
        .catch(error => {
          console.error(' Erro ao carregar mensagens:', error);
          setModalMensagens([]);
        })
        .finally(() => setModalLoading(false));
    } else {
      setModalMensagens([]);
    }
  }, [modalConversa]);

  // WebSocket para mensagens em tempo real no modal
  useEffect(() => {
    if (modalConversa && modalConversa.id) {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;

      // Fechar conexão anterior se existir
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
      }

      const wsUrl = buildWebSocketUrl(`/ws/conversations/${modalConversa.id}/`, { token });
      const ws = new window.WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // WebSocket modal recebeu dados

          // CORREÇÃO: Adicionar message_received que é o tipo usado para mensagens do cliente
          // O frontend deve verificar todos os tipos que o backend pode enviar
          if (data.type === 'message' ||
            data.type === 'new_message' ||
            data.type === 'chat_message' ||
            data.type === 'message_created' ||
            data.type === 'message_received') {
            // Nova mensagem recebida via WebSocket - adicionar diretamente ao estado
            if (data.message) {
              setModalMensagens(currentMessages => {
                // Verificar se a mensagem já existe para evitar duplicatas
                const messageExists = currentMessages.some(m => m.id === data.message.id);

                if (!messageExists) {
                  // Processar conteúdo da mensagem (parsear JSON se necessário)
                  let processedContent = processMessageContent(data.message.content, data.message.is_from_customer);

                  // Remover assinatura do agente se presente (WebSocket)
                  if (processedContent && processedContent.match(/\*.*disse:\*\n/) && !data.message.is_from_customer) {
                    processedContent = processedContent.replace(/\*.*disse:\*\n/, '');
                  }

                  // Identificar mensagens da IA de forma mais robusta
                  const isFromAI = data.message.from_ai === true ||
                    data.message.additional_attributes?.from_ai === true ||
                    data.message.sender?.sender_type === 'ai' ||
                    data.sender === 'ai';

                  // Criar mensagem processada
                  const processedMessage = {
                    ...data.message,
                    content: processedContent,
                    // Garantir que mensagens da IA sejam identificadas corretamente
                    sender: data.message.sender || (isFromAI ? { sender_type: 'ai' } : { sender_type: 'agent' }),
                    from_ai: isFromAI
                  };

                  // Adicionar nova mensagem e ordenar por data
                  const newMessages = [...currentMessages, processedMessage].sort((a, b) => {
                    const dateA = new Date(a.created_at || a.timestamp || 0);
                    const dateB = new Date(b.created_at || b.timestamp || 0);
                    return dateA - dateB;
                  });

                  // Log para debug (apenas em desenvolvimento)
                  if (process.env.NODE_ENV === 'development') {
                    console.log('[ConversasDashboard] Nova mensagem via WebSocket no modal:', {
                      type: data.type,
                      message_id: data.message.id,
                      conversation_id: modalConversa.id,
                      is_from_customer: data.message.is_from_customer,
                      from_ai: isFromAI
                    });
                  }

                  return newMessages;
                }
                return currentMessages;
              });

              // CORREÇÃO: NÃO atualizar o modalConversa aqui
              // Apenas adicionar a mensagem ao estado sem recarregar o modal
              // O modal deve permanecer estável e apenas receber novas mensagens
            }
          }
        } catch (e) {
          console.error('[ConversasDashboard] Erro ao processar WebSocket modal:', e);
        }
      };

      ws.onopen = () => {
        // Log para debug (apenas em desenvolvimento)
        if (process.env.NODE_ENV === 'development') {
          console.log('[ConversasDashboard] WebSocket do modal conectado para conversa:', modalConversa.id);
        }
      };

      ws.onclose = (event) => {
        // Log para debug
        if (process.env.NODE_ENV === 'development') {
          console.log('[ConversasDashboard] WebSocket do modal fechado:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            conversation_id: modalConversa?.id
          });
        }

        wsRef.current = null;

        // Tentar reconectar se não foi fechado intencionalmente e a conversa ainda está aberta
        // Não reconectar se foi fechado normalmente (code 1000) ou erro permanente (4001, 4003)
        if (event.code !== 1000 && modalConversa && modalConversa.id) {
          const permanentErrorCodes = [4001, 4003]; // Unauthorized, Forbidden

          if (!permanentErrorCodes.includes(event.code)) {
            // Reconectar após 2 segundos
            setTimeout(() => {
              if (modalConversa && modalConversa.id && !wsRef.current) {
                const reconnectToken = localStorage.getItem('auth_token') || localStorage.getItem('token');
                if (reconnectToken) {
                  const wsUrl = buildWebSocketUrl(`/ws/conversations/${modalConversa.id}/`, { token: reconnectToken });
                  const newWs = new window.WebSocket(wsUrl);
                  wsRef.current = newWs;

                  // Replicar handlers para manter comportamento consistente
                  newWs.onmessage = ws.onmessage;
                  newWs.onopen = ws.onopen;
                  newWs.onclose = ws.onclose;
                  newWs.onerror = ws.onerror;

                  if (process.env.NODE_ENV === 'development') {
                    console.log('[ConversasDashboard] Tentando reconectar WebSocket do modal...');
                  }
                }
              }
            }, 2000);
          }
        }
      };

      ws.onerror = (error) => {
        console.error('[ConversasDashboard] Erro no WebSocket do modal:', error);
      };

      return () => {
        // Cleanup: fechar conexão quando o modal fechar ou a conversa mudar
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          wsRef.current.close(1000); // Fechar normalmente (code 1000)
        }
        wsRef.current = null;
      };
    } else {
      // Se modalConversa for null, fechar conexão se existir
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    }
  }, [modalConversa]);

  // Scroll automático para última mensagem
  useEffect(() => {
    if (mensagensEndRef.current) {
      mensagensEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [modalMensagens, modalLoading]);

  // Fechar menu quando clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuOpenId && !event.target.closest('.menu-contextual') && !event.target.closest('button[data-menu-trigger]')) {
        setMenuOpenId(null);
      }
    }

    if (menuOpenId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [menuOpenId]);

  // Handlers do menu contextual
  function handleMenuOpen(conversaId, e) {
    e.stopPropagation();
    const btn = menuBtnRefs.current[conversaId];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const menuWidth = 160;
      const menuHeight = 140; // altura aproximada do menu com 4 itens
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      // Posição vertical - preferir mostrar embaixo, mas se não couber, mostrar em cima
      let top = rect.bottom + 4;
      if (top + menuHeight > windowHeight - 20) {
        top = rect.top - menuHeight - 4;
        // Se ainda não couber em cima, centralizar próximo ao botão
        if (top < 20) {
          top = rect.top + (rect.height / 2) - (menuHeight / 2);
        }
      }

      // Posição horizontal - preferir à esquerda do botão (alinhado pela direita)
      let left = rect.right - menuWidth;
      if (left < 20) {
        left = rect.left; // se não couber, alinhar pela esquerda do botão
        if (left + menuWidth > windowWidth - 20) {
          left = windowWidth - menuWidth - 20; // último recurso: colar na direita da tela
        }
      }

      setMenuPosition({
        top: Math.max(20, Math.min(top, windowHeight - menuHeight - 20)),
        left: Math.max(20, Math.min(left, windowWidth - menuWidth - 20))
      });
    }
    setMenuOpenId(conversaId);
  }
  function handleMenuClose() {
    setMenuOpenId(null);
  }
  function handleAbrir(conversa) {
    setModalConversa(conversa);
    setMenuOpenId(null);
  }
  function handleTransferir(conversa) {
    setModalTransferir(conversa);
    setMenuOpenId(null);
  }
  async function handleTransferirGrupo(conversa) {
    setModalTransferirEquipe(conversa);
    setMenuOpenId(null);

    // Buscar equipes disponíveis
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) {
      console.warn('Token não encontrado. Usuário não autenticado.');
      setEquipesTransferir([]);
      setLoadingEquipes(false);
      return;
    }

    setLoadingEquipes(true);

    try {
      // O interceptor do axios já adiciona o token automaticamente
      const response = await axios.get('/api/teams/');

      const equipes = response.data.results || response.data;
      // Equipes encontradas
      setEquipesTransferir(equipes || []);
    } catch (error) {
      // Silenciar erro para não exibir na tela - apenas logar no console
      // O erro será tratado silenciosamente sem propagar para a UI
      if (error.response?.status === 401) {
        // Token inválido ou expirado - o interceptor global do axios já trata isso
        console.debug('Não autenticado para acessar equipes.');
      } else if (error.response?.status === 404) {
        console.debug('Endpoint /api/teams/ não encontrado. A funcionalidade de equipes pode não estar disponível.');
      } else if (error.response?.status === 403) {
        console.debug('Sem permissão para acessar equipes.');
      } else {
        console.debug('Erro ao buscar equipes:', error.message);
      }

      // Sempre definir array vazio em caso de erro para não quebrar a UI
      setEquipesTransferir([]);
    } finally {
      setLoadingEquipes(false);
    }
  }
  async function handleEncerrar(conversa) {
    setMenuOpenId(null);
    if (!conversa?.id) return;
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    // Perguntar tipo de resolução
    const resolutionType = prompt('Tipo de resolução (ex: resolvido, transferido, cancelado):') || 'resolvido';
    const resolutionNotes = prompt('Observações sobre a resolução (opcional):') || '';

    if (!window.confirm('Tem certeza que deseja encerrar este atendimento?')) return;

    try {
      // Usar a API de encerramento por agente
      const response = await axios.post(`/api/conversations/${conversa.id}/close_conversation_agent/`, {
        resolution_type: resolutionType,
        resolution_notes: resolutionNotes
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // Encerramento realizado

      // Atualizar a conversa na lista (mudar status para 'closed')
      setConversas(prev => prev.map(c =>
        c.id === conversa.id
          ? { ...c, status: 'closed' }
          : c
      ));

      alert('Atendimento encerrado com sucesso!');
    } catch (e) {
      console.error('Erro ao encerrar atendimento:', e);
      console.error('Status:', e.response?.status);
      console.error('Data:', e.response?.data);
      alert(`Erro ao encerrar atendimento: ${e.response?.status || e.message}`);
    }
  }
  // Fechar menu ao clicar fora
  useEffect(() => {
    function handleClick(e) {
      if (menuOpenId) setMenuOpenId(null);
    }
    if (menuOpenId) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [menuOpenId]);

  const fetchTimeoutRef = useRef(null);

  async function fetchCounts() {
    if (!authReady) return;

    // Se já houver um agendamento, cancelar para evitar múltiplas chamadas
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce de 300ms para evitar tempestade de requisições
    fetchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        const headers = token ? { Authorization: `Token ${token}` } : {};
        // Adicionar timestamp para evitar cache e garantir ordenação correta
        const timestamp = new Date().getTime();
        const res = await axios.get(`/api/conversations/?page_size=500&ordering=-last_message_at&_t=${timestamp}`, { headers });
        const conversasData = res.data.results || res.data;
        setConversas(conversasData);

        const userPermissions = user?.permissions || [];
        let filteredConversas = conversasData;

        if (!userPermissions.includes('view_ai_conversations')) {
          filteredConversas = filteredConversas.filter(conv => !isComIA(conv));
        }

        if (!userPermissions.includes('view_team_unassigned')) {
          filteredConversas = filteredConversas.filter(conv => !isEmEspera(conv));
        }

        const ia = filteredConversas.filter(isComIA).length;
        const fila = filteredConversas.filter(isEmEspera).length;
        const atendimento = filteredConversas.filter(isEmAtendimento).length;

        setCounts({ ia, fila, atendimento });
      } catch (e) {
        if (e.response?.status === 401) {
          setAuthReady(false);
          await checkAuth();
        } else {
          setCounts({ ia: 0, fila: 0, atendimento: 0 });
          setConversas([]);
        }
      } finally {
        setLoading(false);
        fetchTimeoutRef.current = null;
      }
    }, 300);
  }

  useEffect(() => {
    if (authReady && hasInitialized) {
      fetchCounts();
    }
  }, [authReady, hasInitialized]);

  // WebSocket para atualizações em tempo real
  useEffect(() => {
    if (!authReady) return;

    let ws;
    function setupWebSocket() {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;

      const wsUrl = buildWebSocketUrl('/ws/conversas_dashboard/', { token });
      ws = new window.WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // WebSocket ConversasDashboard recebeu dados

          // Processar qualquer evento relacionado a conversas
          if (data.action === 'update_conversation' ||
            data.action === 'new_message' ||
            data.type === 'dashboard_event' ||
            data.type === 'conversation_event' ||
            data.event_type === 'new_message' ||
            data.event_type === 'message_received') {

            // Se o evento trouxe o objeto da conversa completo, atualizar localmente para ser instantâneo
            const convAtualizada = data.conversation || (data.data && data.data.conversation);

            if (convAtualizada && convAtualizada.id) {
              setConversas(prev => {
                // Filtrar a conversa antiga se existir
                const listaSemAntiga = prev.filter(c => c.id !== convAtualizada.id);
                // Adicionar a nova no topo (Ordenação em Tempo Real)
                const novaLista = [convAtualizada, ...listaSemAntiga];

                // Recalcular contagens
                let ia = 0, fila = 0, atendimento = 0;
                novaLista.forEach(conv => {
                  if (isComIA(conv)) ia++;
                  else if (isEmEspera(conv)) fila++;
                  else if (isEmAtendimento(conv)) atendimento++;
                });
                setCounts({ ia, fila, atendimento });

                return novaLista;
              });
            } else {
              // Caso não tenha os dados completos, recarregar via API debounced
              fetchCounts();
            }
          }

          // Remover lógica duplicada para update_conversation pois já está tratada acima
          if (data.action === 'update_conversation' && data.conversation && !data.type) {
            // ... mantido apenas por segurança caso venha sem type
          }
        } catch (e) {
          // Erro WebSocket (silenciado)
        }
      };
      ws.onclose = () => {
        setTimeout(setupWebSocket, 2000);
      };
    }
    setupWebSocket();

    return () => {
      if (ws) ws.close();
    };
  }, [authReady]);

  // CORREÇÃO: Listener para atualização de permissões do usuário atual
  useEffect(() => {
    const handlePermissionsUpdate = (event) => {
      // Permissões do usuário atualizadas

      // Atualizar o usuário local com as novas permissões
      setUser(prevUser => ({
        ...prevUser,
        permissions: event.detail.permissions
      }));

      // Recarregar contagens para aplicar as novas permissões
      setTimeout(() => {
        if (authReady && hasInitialized) {
          fetchCounts();
        }
      }, 500);
    };

    window.addEventListener('userPermissionsUpdated', handlePermissionsUpdate);

    return () => {
      window.removeEventListener('userPermissionsUpdated', handlePermissionsUpdate);
    };
  }, [authReady, hasInitialized]);

  // Buscar usuários do provedor ao abrir modal de transferência
  useEffect(() => {
    if (modalTransferir) {
      setLoadingUsuarios(true);
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      axios.get('/api/users/?provedor=me', { headers: { Authorization: `Token ${token}` } })
        .then(res => {
          const users = res.data.results || res.data;
          setUsuariosTransferir(users);

          // Conectar ao WebSocket para atualizações de status em tempo real
          // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
          const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
          if (!token) return;
          const wsUrl = buildWebSocketUrl('/ws/user_status/', { token });
          const statusWs = new WebSocket(wsUrl);

          statusWs.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'user_status_update' && data.users) {
                // Atualizar status dos usuários na lista
                setUsuariosTransferir(prev =>
                  prev.map(user => {
                    const updatedUser = data.users.find(u => u.id === user.id);
                    return updatedUser ? { ...user, is_online: updatedUser.is_online } : user;
                  })
                );
              }
            } catch (e) { /* ignore */ }
          };

          // Limpar WebSocket ao fechar modal
          return () => {
            if (statusWs.readyState === WebSocket.OPEN) {
              statusWs.close();
            }
          };
        })
        .catch(() => setUsuariosTransferir([]))
        .finally(() => setLoadingUsuarios(false));
    } else {
      setUsuariosTransferir([]);
    }
  }, [modalTransferir]);

  async function transferirParaUsuario(usuario) {
    if (!modalTransferir) return;
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      await axios.post(`/api/conversations/${modalTransferir.id}/transfer/`, { user_id: usuario.id }, {
        headers: { Authorization: `Token ${token}` }
      });
      alert('Transferido com sucesso!');
      setModalTransferir(null);
    } catch (e) {
      alert('Erro ao transferir atendimento.');
    }
  }

  async function transferirParaEquipe(equipe) {
    if (!modalTransferirEquipe?.id) return;

    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      // Usar endpoint de transferência padrão que aceita team_id
      const response = await axios.post(`/api/conversations/${modalTransferirEquipe.id}/transfer/`, {
        team_id: equipe.id,
        team_name: equipe.name
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // Transferência para equipe realizada
      setModalTransferirEquipe(null);
      setEquipesTransferir([]);

      alert(`Transferido para equipe "${equipe.name}" com sucesso! Agora está visível para todos os membros da equipe.`);
      // O WebSocket já vai atualizar a lista automaticamente através do Dashboard
    } catch (error) {
      console.error('Erro ao transferir para equipe:', error);
      alert('Erro ao transferir conversa para equipe. Tente novamente.');
    }
  }

  // Função utilitária para pegar avatar
  function getAvatar(contact) {
    if (contact && contact.avatar) return contact.avatar;
    // Se não tiver avatar, usar inicial do nome
    const name = contact?.name || 'Contato';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
  }

  // Função para pegar nome do atendente
  function getAtendente(conversa) {
    // Se tem atendente individual, mostrar nome
    if (conversa.assignee) {
      return conversa.assignee.first_name || conversa.assignee.username || 'Atendente';
    }

    // Se transferido para equipe (sem atendente individual), NÃO mostrar no campo atendente
    if (conversa.additional_attributes?.assigned_team) {
      return ''; // Campo atendente vazio quando transferido para equipe
    }

    // Se não tem atendente mas está "Com IA", mostrar "IA"
    if (conversa.status === 'snoozed') {
      return 'IA';
    }

    // Se não tem atendente e está em espera: deixar vazio
    return '';
  }

  // Função para pegar equipe
  function getEquipe(conversa) {
    // Primeiro, verificar se há equipe atribuída diretamente à conversa (ex: equipe IA)
    if (conversa.team?.name) {
      return conversa.team.name;
    }

    // Segundo, verificar se há informação da equipe específica da transferência
    if (conversa.additional_attributes?.assigned_team?.name) {
      return conversa.additional_attributes.assigned_team.name;
    }

    // Se tem assignee, tentar obter da equipe do usuário
    if (conversa.assignee?.team?.name) {
      // Retornando equipe do assignee
      return conversa.assignee.team.name;
    }

    // Nenhuma equipe encontrada, retornando string vazia
    return ''; // Não usar mais fallback fixo
  }

  // Função para formatar número do contato
  function formatPhone(phone) {
    if (!phone) return '-';
    // Remove sufixo @s.whatsapp.net ou @lid
    let num = phone.replace(/(@.*$)/, '');
    // Formata para +55 99999-9999
    if (num.length >= 13) {
      return `+${num.slice(0, 2)} ${num.slice(2, 7)}-${num.slice(7, 11)}`;
    } else if (num.length >= 11) {
      return `+${num.slice(0, 2)} ${num.slice(2, 7)}-${num.slice(7)}`;
    }
    return num;
  }

  // Função para formatar timestamp
  function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 60) {
      return `${diffMins}min`;
    } else if (diffHours < 24) {
      return `${diffHours}h`;
    } else {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Função para pegar status traduzido
  function getStatusText(status, conv = null) {
    // Se temos a conversa, usar lógica baseada na atribuição
    if (conv) {
      if (conv.assignee) {
        return 'Em Atendimento';
      } else if (status === 'snoozed') {
        return 'Com IA';
      } else if (status === 'pending') {
        return 'Em Espera';
      }
    }

    // Fallback para status padrão
    switch (status) {
      case 'snoozed': return 'Em Espera';
      case 'open': return 'Em Atendimento';
      case 'pending': return 'Pendente';
      case 'resolved': return 'Resolvido';
      default: return status;
    }
  }



  // Função para pegar cor do status
  function getStatusColor(status) {
    switch (status) {
      case 'snoozed': return 'bg-yellow-500';
      case 'open': return 'bg-green-500';
      case 'pending': return 'bg-orange-500';
      case 'resolved': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  }

  // Função para renderizar mensagem com links clicáveis
  const renderMessageWithLinks = (text) => {
    if (!text || typeof text !== 'string') return text;

    // Regex para detectar URLs completas
    const urlRegex = /(https?:\/\/[^\s\n<>"']+|www\.[^\s\n<>"']+)/gi;

    // Dividir o texto em partes (texto e URLs)
    const parts = [];
    let lastIndex = 0;
    let match;

    urlRegex.lastIndex = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      // Adicionar texto antes da URL
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }

      // Adicionar a URL (remover caracteres inválidos no final se houver)
      let urlContent = match[0];
      urlContent = urlContent.replace(/[.,;:!?]+$/, '');

      parts.push({ type: 'url', content: urlContent });

      lastIndex = match.index + match[0].length;
    }

    // Adicionar texto restante
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }

    // Se não encontrou URLs, retornar texto original
    if (parts.length === 0) {
      return text;
    }

    // Renderizar partes como elementos React
    return parts.map((part, index) => {
      if (part.type === 'url') {
        // Adicionar protocolo se não tiver
        let url = part.content.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }

        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition-colors break-all"
            onClick={(e) => e.stopPropagation()}
            style={{
              wordBreak: 'break-all',
              color: '#7DD3FC',
              textDecoration: 'underline',
              textDecorationColor: '#7DD3FC'
            }}
            onMouseEnter={(e) => {
              e.target.style.color = '#5BC0EB';
              e.target.style.textDecorationColor = '#5BC0EB';
            }}
            onMouseLeave={(e) => {
              e.target.style.color = '#7DD3FC';
              e.target.style.textDecorationColor = '#7DD3FC';
            }}
          >
            {part.content}
          </a>
        );
      }
      return <span key={index}>{part.content}</span>;
    });
  };

  // Ícone de status dos tickets (igual ao ChatArea)
  const ModalMessageStatusIcon = ({ message }) => {
    const status = message.additional_attributes?.last_status;
    const readAt = message.additional_attributes?.read_at;
    const deliveredAt = message.additional_attributes?.delivered_at;
    const sentAt = message.additional_attributes?.sent_at;

    let currentStatus = status;
    if (readAt || status === 'read') {
      currentStatus = 'read';
    } else if (deliveredAt || status === 'delivered') {
      currentStatus = 'delivered';
    } else if (sentAt || status === 'sent') {
      currentStatus = 'sent';
    }

    // Se não há status mas a mensagem foi enviada com external_id, assumir "sent"
    if (!currentStatus && !message.isTemporary && (message.external_id || message.additional_attributes?.external_id)) {
      currentStatus = 'sent';
    }

    // 3️⃣ Mensagem lida - 2 tickets azuis fortes
    if (currentStatus === 'read') {
      return (
        <span className="inline-flex items-center ml-1" title="Lida">
          <svg width="16" height="12" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.5 5.5L3 8L7 4" stroke="#0066FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M8.5 5.5L11 8L15.5 3" stroke="#0066FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </span>
      );
    }

    // 2️⃣ Mensagem entregue - 2 tickets cinza neutros
    if (currentStatus === 'delivered') {
      return (
        <span className="inline-flex items-center ml-1" title="Entregue">
          <svg width="16" height="12" viewBox="0 0 16 11" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.5 5.5L3 8L7 4" stroke="#D1D5DB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M8.5 5.5L11 8L15.5 3" stroke="#9CA3AF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </span>
      );
    }

    // 1️⃣ Mensagem enviada - 1 ticket cinza
    return (
      <span className="inline-flex items-center ml-1" title={currentStatus === 'sent' ? 'Enviada' : 'Enviando...'}>
        <svg width="12" height="10" viewBox="0 0 12 9" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 4.5L4.5 8L11 1.5" stroke="#9CA3AF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </span>
    );
  };

  // Renderização dos balões de mensagem
  function renderMensagem(msg) {
    //  CORRIGIDO: Melhor detecção de tipo de mensagem
    const isCliente = msg.is_from_customer === true;
    const isAtendente = msg.is_from_customer === false && !msg.sender_type?.includes('bot');
    const isBot = msg.is_from_customer === false && (msg.sender_type?.includes('bot') || msg.message_type === 'outgoing');

    const align = isCliente ? 'justify-start' : 'justify-end';

    // Cores correspondentes ao ChatArea: cliente = cinza-azulado escuro, sistema/agente = azul
    const bg = (isBot || isAtendente) ? 'bg-[#2196F3] text-white' : 'bg-[#4A5568] text-white';

    return (
      <div key={msg.id} className={`flex ${align} mb-4`}>
        {isCliente && (
          <div className="w-10 h-10 rounded-full flex items-center justify-center mr-3 flex-shrink-0 overflow-hidden bg-gray-300">
            {/*  CORRIGIDO: Foto de perfil do cliente */}
            {modalConversa?.contact?.avatar ? (
              <img
                src={modalConversa.contact.avatar}
                alt={modalConversa.contact.name || 'Cliente'}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className={`w-full h-full flex items-center justify-center text-white font-medium text-sm bg-gradient-to-br from-blue-500 to-purple-600 ${modalConversa?.contact?.avatar ? 'hidden' : 'flex'}`}
            >
              {(modalConversa?.contact?.name || modalConversa?.contact?.phone || 'U').charAt(0).toUpperCase()}
            </div>
          </div>
        )}
        <div className={`max-w-[70%] ${(isAtendente || isBot) ? 'order-2' : 'order-1'}`}>
          <div className={`px-4 py-3 rounded-2xl shadow-sm ${bg}`}>
            {msg.content_type === 'audio' && msg.audio_url ? (
              <audio controls src={msg.audio_url} className="w-full">
                Seu navegador não suporta áudio.
              </audio>
            ) : (
              <p className="text-sm whitespace-pre-line leading-relaxed">
                {renderMessageWithLinks(msg.content)}
              </p>
            )}
          </div>
          <div
            className={`flex items-center mt-2 space-x-1 text-xs text-muted-foreground ${(isAtendente || isBot) ? 'justify-end' : 'justify-start'
              }`}
          >
            <span className="bg-background/80 px-2 py-1 rounded-full">
              {(msg.created_at || msg.timestamp)
                ? new Date(msg.created_at || msg.timestamp).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                : ''}
            </span>
            {(isAtendente || isBot) &&
              (modalConversa?.inbox?.channel_type === 'whatsapp' || modalConversa?.channel === 'whatsapp') &&
              !msg.isTemporary && (
                <ModalMessageStatusIcon message={msg} />
              )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Conversas</h1>

      {/* Verificação de autenticação */}
      {!hasInitialized ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Verificando autenticação...</p>
          </div>
        </div>
      ) : !authReady ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h3 className="text-lg font-medium mb-2">Acesso Restrito</h3>
            <p className="text-muted-foreground mb-4">Você precisa estar logado para acessar as conversas.</p>
            <button
              onClick={() => window.location.href = '/admin/login/'}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            >
              Fazer Login
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando conversas...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Dashboard de Métricas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-[#242424] border border-[#333333] rounded-[2rem] p-6 shadow-2xl relative group transition-all hover:bg-[#2d2d2d] active:scale-[0.98]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Inteligência Artificial</p>
                  <p className="text-4xl font-black text-white tracking-tighter">{conversas.filter(isComIA).length}</p>
                </div>
                <BrainCircuit className="w-9 h-9 text-purple-400" strokeWidth={1.2} />
              </div>
            </div>

            <div className="bg-[#242424] border border-[#333333] rounded-[2rem] p-6 shadow-2xl relative group transition-all hover:bg-[#2d2d2d] active:scale-[0.98]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Fila de Espera</p>
                  <p className="text-4xl font-black text-white tracking-tighter">{conversas.filter(isEmEspera).length}</p>
                </div>
                <Timer className="w-9 h-9 text-amber-500" strokeWidth={1.2} />
              </div>
            </div>

            <div className="bg-[#242424] border border-[#333333] rounded-[2rem] p-6 shadow-2xl relative group transition-all hover:bg-[#2d2d2d] active:scale-[0.98]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Em Atendimento</p>
                  <p className="text-4xl font-black text-white tracking-tighter">{conversas.filter(isEmAtendimento).length}</p>
                </div>
                <Users className="w-9 h-9 text-emerald-400" strokeWidth={1.2} />
              </div>
            </div>
          </div>

          {/* Blocos de fases */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Bloco 1: Com IA */}
            <div className="bg-card rounded-lg shadow-md p-4 flex flex-col h-96">
              <h3 className="text-lg font-semibold text-card-foreground mb-4">Com IA</h3>
              <div className="flex-1 overflow-y-auto pr-2">
                <div className="space-y-3">
                  {conversas.filter(isComIA).map((conv) => (
                    <div key={conv.id} className="bg-background rounded-lg p-3 relative">
                      <div className="flex items-start gap-3">
                        <img
                          src={getAvatar(conv.contact)}
                          alt="avatar"
                          className="w-10 h-10 rounded-full object-cover border-2 border-border"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-card-foreground truncate">
                              {conv.contact?.name || 'Contato'}
                            </h4>
                            <span className="bg-green-500 text-white px-2 py-1 rounded-full text-xs font-medium">
                              {formatTimestamp(conv.updated_at || conv.created_at)}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground mt-2">
                            <div><strong>Contato:</strong> {formatPhone(conv.contact?.phone)}</div>
                            <div><strong>Atendente:</strong> {getAtendente(conv)}</div>
                            <div><strong>Grupo:</strong> {getEquipe(conv) || '-'}</div>
                            <div><strong>Status:</strong> {getStatusText(conv.status, conv)}</div>
                            <div><strong>Canal:</strong> {getChannelDisplayName(conv.inbox)}</div>
                          </div>
                        </div>
                      </div>
                      <button
                        ref={el => (menuBtnRefs.current[conv.id] = el)}
                        className="absolute bottom-2 right-2 p-1 text-muted-foreground hover:text-card-foreground"
                        onClick={e => handleMenuOpen(conv.id, e)}
                        data-menu-trigger
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                      {/* Menu contextual */}
                      {menuOpenId === conv.id && (
                        <div
                          className="menu-contextual bg-card border border-border rounded shadow-lg z-[9999] min-w-[160px] flex flex-col w-max fixed"
                          style={{ top: menuPosition.top, left: menuPosition.left }}
                        >
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleAbrir(conv); }}>
                            <MessageCircle className="w-4 h-4" /> <span>Abrir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferir(conv); }}>
                            <User className="w-4 h-4 text-blue-500" /> <span>Transferir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferirGrupo(conv); }}>
                            <Users className="w-4 h-4 text-blue-500" /> <span>Transferir Grupo</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted text-red-600" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleEncerrar(conv); }}>
                            <X className="w-4 h-4" /> <span>Encerrar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bloco 2: Em Espera */}
            <div className="bg-card rounded-lg shadow-md p-4 flex flex-col h-96">
              <h3 className="text-lg font-semibold text-card-foreground mb-4">Em Espera</h3>
              <div className="flex-1 overflow-y-auto pr-2">
                <div className="space-y-3">
                  {conversas.filter(isEmEspera).map((conv) => (
                    <div key={conv.id} className="bg-background rounded-lg p-3 relative">
                      <div className="flex items-start gap-3">
                        <img
                          src={getAvatar(conv.contact)}
                          alt="avatar"
                          className="w-10 h-10 rounded-full object-cover border-2 border-border"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-card-foreground truncate">
                              {conv.contact?.name || 'Contato'}
                            </h4>
                            <span className="bg-green-500 text-white px-2 py-1 rounded-full text-xs font-medium">
                              {formatTimestamp(conv.updated_at || conv.created_at)}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground mt-2">
                            <div><strong>Contato:</strong> {formatPhone(conv.contact?.phone)}</div>
                            <div><strong>Atendente:</strong> {getAtendente(conv)}</div>
                            <div><strong>Grupo:</strong> {getEquipe(conv) || '-'}</div>
                            <div><strong>Status:</strong> {getStatusText(conv.status, conv)}</div>
                            <div><strong>Canal:</strong> {getChannelDisplayName(conv.inbox)}</div>
                          </div>
                        </div>
                      </div>
                      <button
                        ref={el => (menuBtnRefs.current[conv.id] = el)}
                        className="absolute bottom-2 right-2 p-1 text-muted-foreground hover:text-card-foreground"
                        onClick={e => handleMenuOpen(conv.id, e)}
                        data-menu-trigger
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                      {/* Menu contextual */}
                      {menuOpenId === conv.id && (
                        <div
                          className="menu-contextual bg-card border border-border rounded shadow-lg z-[9999] min-w-[160px] flex flex-col w-max fixed"
                          style={{ top: menuPosition.top, left: menuPosition.left }}
                        >
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleAbrir(conv); }}>
                            <MessageCircle className="w-4 h-4" /> <span>Abrir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferir(conv); }}>
                            <User className="w-4 h-4 text-blue-500" /> <span>Transferir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferirGrupo(conv); }}>
                            <Users className="w-4 h-4 text-blue-500" /> <span>Transferir Grupo</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted text-red-600" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleEncerrar(conv); }}>
                            <X className="w-4 h-4" /> <span>Encerrar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bloco 3: Em Atendimento */}
            <div className="bg-card rounded-lg shadow-md p-4 flex flex-col h-96">
              <h3 className="text-lg font-semibold text-card-foreground mb-4">Em Atendimento</h3>
              <div className="flex-1 overflow-y-auto pr-2">
                <div className="space-y-3">
                  {conversas.filter(isEmAtendimento).map((conv) => (
                    <div key={conv.id} className="bg-background rounded-lg p-3 relative">
                      <div className="flex items-start gap-3">
                        <img
                          src={getAvatar(conv.contact)}
                          alt="avatar"
                          className="w-10 h-10 rounded-full object-cover border-2 border-border"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-card-foreground truncate">
                              {conv.contact?.name || 'Contato'}
                            </h4>
                            <span className="bg-green-500 text-white px-2 py-1 rounded-full text-xs font-medium">
                              {formatTimestamp(conv.updated_at || conv.created_at)}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground mt-2">
                            <div><strong>Contato:</strong> {formatPhone(conv.contact?.phone)}</div>
                            <div><strong>Atendente:</strong> {getAtendente(conv)}</div>
                            <div><strong>Grupo:</strong> {getEquipe(conv) || '-'}</div>
                            <div><strong>Status:</strong> {getStatusText(conv.status, conv)}</div>
                            <div><strong>Canal:</strong> {getChannelDisplayName(conv.inbox)}</div>
                          </div>
                        </div>
                      </div>
                      <button
                        ref={el => (menuBtnRefs.current[conv.id] = el)}
                        className="absolute bottom-2 right-2 p-1 text-muted-foreground hover:text-card-foreground"
                        onClick={e => handleMenuOpen(conv.id, e)}
                        data-menu-trigger
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                      {/* Menu contextual */}
                      {menuOpenId === conv.id && (
                        <div
                          className="menu-contextual bg-card border border-border rounded shadow-lg z-[9999] min-w-[160px] flex flex-col w-max fixed"
                          style={{ top: menuPosition.top, left: menuPosition.left }}
                        >
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleAbrir(conv); }}>
                            <MessageCircle className="w-4 h-4" /> <span>Abrir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferir(conv); }}>
                            <User className="w-4 h-4 text-blue-500" /> <span>Transferir</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleTransferirGrupo(conv); }}>
                            <Users className="w-4 h-4 text-blue-500" /> <span>Transferir Grupo</span>
                          </button>
                          <button className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-muted text-red-600" onClick={(e) => { e.stopPropagation(); handleMenuClose(); handleEncerrar(conv); }}>
                            <X className="w-4 h-4" /> <span>Encerrar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Modal de conversa detalhada */}
          <Dialog open={!!modalConversa} onOpenChange={v => !v && setModalConversa(null)}>
            <DialogContent className="max-w-none w-screen h-screen bg-background/95 border-none p-4 flex items-center justify-center">
              {/* Modal secundário com o conteúdo */}
              <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-3xl h-[75vh] flex flex-col">
                <style>{`
                  .messages-container::-webkit-scrollbar {
                    width: 14px;
                    background: transparent;
                  }
                  .messages-container::-webkit-scrollbar-track {
                    background: #e5e7eb;
                    border-radius: 8px;
                    margin: 4px;
                  }
                  .messages-container::-webkit-scrollbar-thumb {
                    background: #9ca3af;
                    border-radius: 8px;
                    border: 2px solid #e5e7eb;
                  }
                  .messages-container::-webkit-scrollbar-thumb:hover {
                    background: #6b7280;
                  }
                  .messages-container {
                    scrollbar-width: auto;
                    scrollbar-color: #9ca3af #e5e7eb;
                  }
                `}</style>

                {/* Header do modal secundário */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-card rounded-t-lg">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      {modalConversa?.contact?.avatar ? (
                        <img
                          src={modalConversa.contact.avatar}
                          alt={modalConversa.contact.name || 'Cliente'}
                          className="w-10 h-10 rounded-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div
                        className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm ${modalConversa?.contact?.avatar ? 'hidden' : 'flex'}`}
                      >
                        {(modalConversa?.contact?.name || modalConversa?.contact?.phone || 'U').charAt(0).toUpperCase()}
                      </div>
                    </div>

                    <div className="flex-1">
                      <div className="text-lg font-semibold text-foreground">{modalConversa?.contact?.name || 'Contato'}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatPhone(modalConversa?.contact?.phone)} • {getChannelDisplayName(modalConversa?.inbox)} • {getStatusText(modalConversa?.status, modalConversa)}
                      </div>
                      {/*  Tempo de atendimento em aberto */}
                      <div className="text-xs text-white bg-gray-600 px-2 py-1 rounded-full mt-1 inline-block">
                        Atendimento há: {modalConversa?.created_at ? (() => {
                          const agora = new Date();
                          const inicio = new Date(modalConversa.created_at);
                          const diffMs = agora - inicio;
                          const diffMinutos = Math.floor(diffMs / (1000 * 60));
                          const diffHoras = Math.floor(diffMinutos / 60);
                          const diffDias = Math.floor(diffHoras / 24);

                          if (diffDias > 0) {
                            return `${diffDias} dia${diffDias > 1 ? 's' : ''}`;
                          } else if (diffHoras > 0) {
                            return `${diffHoras}h ${diffMinutos % 60}min`;
                          } else {
                            return `${diffMinutos} min`;
                          }
                        })() : 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Área de mensagens com scroll */}
                <div
                  className="messages-container flex-1 overflow-y-auto flex flex-col gap-3 p-4 dark:bg-background bg-[#efeae2] rounded-b-lg"
                  style={{
                    backgroundImage: `url(${isDarkTheme ? chatBgPattern : chatBgPatternLight})`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: '200px 200px',
                    backgroundPosition: 'center',
                    opacity: 1
                  }}
                >
                  {modalLoading ? (
                    <div className="text-muted-foreground text-center py-8">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      Carregando mensagens...
                    </div>
                  ) : modalMensagens.length === 0 ? (
                    <div className="text-muted-foreground text-center py-8">
                      <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      Nenhuma mensagem nesta conversa.
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground text-center py-2 border-b border-border mb-2">
                        {modalMensagens.length} mensagem{modalMensagens.length !== 1 ? 's' : ''} • Atualizações em tempo real ativas
                      </div>
                      {modalMensagens.map(renderMensagem)}
                      <div ref={mensagensEndRef} />
                    </>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {/* Modal de transferência de atendimento */}
          <Dialog open={!!modalTransferir} onOpenChange={v => !v && setModalTransferir(null)}>
            <DialogContent className="max-w-md w-full">
              <DialogHeader>
                <DialogTitle>
                  Transferir Atendimento <span className="font-bold">{modalTransferir?.contact?.name}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="divide-y">
                {loadingUsuarios ? (
                  <div className="text-muted-foreground text-center py-8">Carregando usuários...</div>
                ) : usuariosTransferir.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">Nenhum usuário encontrado.</div>
                ) : (
                  usuariosTransferir.map(usuario => (
                    <button
                      key={usuario.id}
                      className="flex items-center w-full gap-4 py-3 px-2 hover:bg-muted transition"
                      onClick={() => transferirParaUsuario(usuario)}
                    >
                      <img
                        src={usuario.avatar || '/avatar-em-branco.png'}
                        alt={usuario.first_name}
                        className="w-12 h-12 rounded-full object-cover bg-muted"
                      />
                      <div className="flex-1 text-left">
                        <div className="font-medium text-card-foreground">{usuario.first_name} {usuario.last_name}</div>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 ${usuario.is_online ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{usuario.is_online ? 'Online' : 'Offline'}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
          {/* Modal de transferência para equipe */}
          <Dialog open={!!modalTransferirEquipe} onOpenChange={v => !v && setModalTransferirEquipe(null)}>
            <DialogContent className="max-w-md w-full">
              <DialogHeader>
                <DialogTitle>
                  Transferir para Equipe <span className="font-bold">{modalTransferirEquipe?.contact?.name}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="divide-y">
                {loadingEquipes ? (
                  <div className="text-muted-foreground text-center py-8">Carregando equipes...</div>
                ) : equipesTransferir.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">Nenhuma equipe encontrada.</div>
                ) : (
                  equipesTransferir.map(equipe => (
                    <button
                      key={equipe.id}
                      className="flex items-center w-full gap-4 py-3 px-2 hover:bg-muted transition"
                      onClick={() => transferirParaEquipe(equipe)}
                    >
                      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                        <Users className="w-6 h-6 text-blue-600" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-card-foreground">{equipe.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {equipe.members?.length || 0} membro(s)
                        </div>
                        {equipe.members && equipe.members.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {equipe.members.map(member => {
                              if (member.user) {
                                const firstName = member.user.first_name || '';
                                const lastName = member.user.last_name || '';
                                const username = member.user.username || '';
                                return `${firstName} ${lastName}`.trim() || username;
                              }
                              return 'Usuário não encontrado';
                            }).join(', ')}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>

        </>
      )}
    </div>
  );
} 