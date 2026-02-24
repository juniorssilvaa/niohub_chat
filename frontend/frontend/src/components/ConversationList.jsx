import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Search, Filter, MoreHorizontal, User, Clock, Tag, MoreVertical, UserPlus } from 'lucide-react';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { buildWebSocketUrl } from '../utils/websocketUrl';
import { useNotifications } from '../contexts/NotificationContext';

const ConversationList = memo(({ onConversationSelect, selectedConversation, provedorId, onConversationUpdate, user }) => {
  const { painelWsConnected } = useNotifications();

  const [searchTerm, setSearchTerm] = useState(() => {
    return localStorage.getItem('conversationSearchTerm') || '';
  });

  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('conversationListActiveTab') || 'mine';
  });

  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const userPermissions = useMemo(() => user?.permissions || [], [user]);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [newMessageNotification, setNewMessageNotification] = useState(false);
  const faviconTimerRef = useRef(null);
  const isFaviconBlinkingRef = useRef(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const authReady = useMemo(() => !!user, [user]);
  const audioRef = useRef(null);
  const prevConversationsRef = useRef({}); // { [id]: lastMessageIdOrTime }
  const hasSoundInitRef = useRef(false);

  //  Estados para novo atendimento
  const [showMenuAtendimento, setShowMenuAtendimento] = useState(false);
  const [modalNovoContato, setModalNovoContato] = useState(false);
  const [modalContatoExistente, setModalContatoExistente] = useState(false);

  const [novoContato, setNovoContato] = useState({
    nome: '',
    telefone: '',
    canal: 'whatsapp',
    mensagem: '',
    usarTemplate: false,
    templateSelecionado: null,
    canalId: null
  });

  const [templates, setTemplates] = useState([]);
  const [carregandoTemplates, setCarregandoTemplates] = useState(false);

  const [contatoExistente, setContatoExistente] = useState({
    busca: '',
    contato: null,
    mensagem: ''
  });

  const [enviandoAtendimento, setEnviandoAtendimento] = useState(false);
  const [buscandoContato, setBuscandoContato] = useState(false);
  const [contatosEncontrados, setContatosEncontrados] = useState([]);

  //  Função para buscar contatos existentes
  const buscarContatos = async (termo) => {
    if (!termo.trim()) {
      setContatosEncontrados([]);
      return;
    }

    setBuscandoContato(true);
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    try {
      const response = await axios.get(`/api/contacts/?search=${termo}`, {
        headers: { Authorization: `Token ${token}` }
      });

      setContatosEncontrados(response.data.results || []);
    } catch (error) {
      // Erro ao buscar contatos
      setContatosEncontrados([]);
    } finally {
      setBuscandoContato(false);
    }
  };

  // Removido prompt de desbloqueio (UX simplificada)
  useEffect(() => { }, [authReady, user?.sound_notifications_enabled]);

  // Buscar templates quando modal abrir e canal for WhatsApp
  useEffect(() => {
    if (modalNovoContato && novoContato.canal === 'whatsapp') {
      buscarCanalWhatsApp();
    } else if (!modalNovoContato) {
      // Limpar templates quando fechar modal
      setTemplates([]);
      setNovoContato(prev => ({ ...prev, usarTemplate: false, templateSelecionado: null, canalId: null }));
    }
  }, [modalNovoContato, novoContato.canal]);

  // Função para buscar templates do canal WhatsApp
  const buscarTemplates = async (canalId) => {
    if (!canalId) return;

    setCarregandoTemplates(true);
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    try {
      const response = await axios.get(`/api/canais/${canalId}/message-templates/`, {
        headers: { Authorization: `Token ${token}` }
      });

      // O endpoint retorna { success: true, templates: [...] }
      const templatesList = response.data?.templates || response.data || [];

      console.log('Total de templates retornados:', templatesList.length);
      console.log('Templates (primeiros 3):', templatesList.slice(0, 3));

      // Filtrar apenas templates aprovados (case-insensitive para segurança)
      const templatesAprovados = templatesList.filter(t =>
        t.status && t.status.toUpperCase() === 'APPROVED'
      );

      setTemplates(templatesAprovados);

      console.log('Templates aprovados encontrados:', templatesAprovados.length, 'de', templatesList.length);

      if (templatesAprovados.length === 0 && templatesList.length > 0) {
        console.warn('Há templates mas nenhum está aprovado. Status dos templates:',
          templatesList.map(t => ({ name: t.name, status: t.status }))
        );
      }
    } catch (error) {
      console.error('Erro ao buscar templates:', error);
      console.error('Detalhes do erro:', error.response?.data);
      setTemplates([]);
    } finally {
      setCarregandoTemplates(false);
    }
  };

  // Função para buscar canal WhatsApp ativo
  const buscarCanalWhatsApp = async () => {
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      // Construir parâmetros da query
      const params = {};
      if (provedorId) {
        params.provedor_id = provedorId;
      }

      const response = await axios.get('/api/canais/', {
        headers: { Authorization: `Token ${token}` },
        params: params
      });

      // A resposta pode ter results (paginado) ou ser um array direto
      const canais = response.data.results || response.data || [];

      console.log('Canais encontrados:', canais.length);
      console.log('Canais disponíveis:', canais.map(c => ({ id: c.id, tipo: c.tipo, ativo: c.ativo, nome: c.name || c.nome })));

      // Filtrar apenas canais WhatsApp Oficial ativos
      const canalWhatsApp = canais.find(
        canal => canal.tipo === 'whatsapp_oficial' && canal.ativo === true
      );

      console.log('Canal WhatsApp encontrado:', canalWhatsApp ? `ID: ${canalWhatsApp.id}, Nome: ${canalWhatsApp.name || canalWhatsApp.nome}` : 'Nenhum');

      if (canalWhatsApp) {
        setNovoContato(prev => ({ ...prev, canalId: canalWhatsApp.id }));
        buscarTemplates(canalWhatsApp.id);
      } else {
        console.warn('Nenhum canal WhatsApp Oficial ativo encontrado para o provedor');
        setTemplates([]);
      }
    } catch (error) {
      console.error('Erro ao buscar canal WhatsApp:', error);
      console.error('Detalhes do erro:', error.response?.data);
      setTemplates([]);
    }
  };

  //  Função para criar atendimento com novo contato
  const handleNovoContato = async () => {
    if (!novoContato.nome || !novoContato.telefone) {
      alert('Por favor, preencha nome e telefone');
      return;
    }

    // Se usar template, não precisa de mensagem
    if (!novoContato.usarTemplate && !novoContato.mensagem) {
      alert('Por favor, digite uma mensagem ou selecione um template');
      return;
    }

    // Se usar template, deve ter template selecionado
    if (novoContato.usarTemplate && !novoContato.templateSelecionado) {
      alert('Por favor, selecione um template');
      return;
    }

    const telefoneFormatado = novoContato.telefone.replace(/\D/g, '');
    if (!telefoneFormatado.startsWith('55') || telefoneFormatado.length < 12) {
      alert('Telefone deve começar com 55 e ter pelo menos 12 dígitos');
      return;
    }

    setEnviandoAtendimento(true);
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    try {
      // Se usar template e canal for WhatsApp, usar endpoint de template
      if (novoContato.usarTemplate && novoContato.canal === 'whatsapp' && novoContato.canalId) {
        const template = templates.find(t => t.name === novoContato.templateSelecionado);

        if (!template) {
          alert('Template não encontrado');
          setEnviandoAtendimento(false);
          return;
        }

        const response = await axios.post('/api/conversations/start-with-template/', {
          phone: telefoneFormatado,
          template_name: template.name,
          template_language: template.language || 'pt_BR',
          template_components: [], // TODO: Adicionar suporte a parâmetros
          canal_id: novoContato.canalId,
          contact_name: novoContato.nome
        }, {
          headers: { Authorization: `Token ${token}` }
        });

        if (response.data.success) {
          alert('Template enviado com sucesso! A conversa aparecerá no painel em instantes.');
          setNovoContato({ nome: '', telefone: '', canal: 'whatsapp', mensagem: '', usarTemplate: false, templateSelecionado: null, canalId: null });
          setModalNovoContato(false);
          setTimeout(() => fetchConversations(true), 1000);
        } else {
          throw new Error(response.data.error || 'Erro ao enviar template');
        }

        setEnviandoAtendimento(false);
        return;
      }

      // Fluxo original para mensagem normal
      const userResponse = await axios.get('/api/auth/me/', {
        headers: { Authorization: `Token ${token}` }
      });

      // 1. Criar ou buscar contato
      let contactResponse;
      try {
        contactResponse = await axios.post('/api/contacts/', {
          name: novoContato.nome,
          phone: telefoneFormatado,
          provedor: 2
        }, {
          headers: { Authorization: `Token ${token}` }
        });
      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.non_field_errors?.[0]?.includes('único')) {
          // Contato já existe, buscar o existente
          const contactsResponse = await axios.get(`/api/contacts/?phone=${telefoneFormatado}`, {
            headers: { Authorization: `Token ${token}` }
          });
          contactResponse = { data: contactsResponse.data.results[0] };
        } else {
          throw error;
        }
      }

      // 2. Buscar inbox padrão para o canal
      const inboxesResponse = await axios.get('/api/inboxes/', {
        headers: { Authorization: `Token ${token}` }
      });

      const inbox = inboxesResponse.data.results.find(
        inbox => inbox.channel_type === novoContato.canal
      ) || inboxesResponse.data.results[0];

      if (!inbox) {
        throw new Error('Nenhum inbox encontrado');
      }

      // 3. Criar conversa
      const conversationResponse = await axios.post('/api/conversations/', {
        contact_id: contactResponse.data.id,
        inbox_id: inbox.id,
        assignee_id: userResponse.data.id,
        status: 'open'
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // 4. Enviar mensagem inicial
      const messageResponse = await axios.post('/api/messages/send_text/', {
        content: novoContato.mensagem,
        conversation_id: conversationResponse.data.id
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      alert('Atendimento criado com sucesso! Aparecerá no painel em instantes.');
      setNovoContato({ nome: '', telefone: '', canal: 'whatsapp', mensagem: '', usarTemplate: false, templateSelecionado: null, canalId: null });
      setModalNovoContato(false);

      // Recarregar conversas
      setTimeout(() => fetchConversations(true), 1000);

    } catch (error) {
      // Tratar erro traduzido do backend
      const errorMessage = error.response?.data?.error || error.response?.data?.detail || error.message;
      alert('Erro ao enviar mensagem: ' + errorMessage);
    } finally {
      setEnviandoAtendimento(false);
    }
  };

  //  Função para criar atendimento com contato existente
  const handleContatoExistente = async () => {
    if (!contatoExistente.contato || !contatoExistente.mensagem) {
      alert('Por favor, selecione um contato e digite a mensagem');
      return;
    }

    setEnviandoAtendimento(true);
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    try {
      //  USAR ENDPOINT COMPLETO para contato existente
      const userResponse = await axios.get('/api/auth/me/', {
        headers: { Authorization: `Token ${token}` }
      });

      // 1. Buscar inbox padrão
      const inboxesResponse = await axios.get('/api/inboxes/', {
        headers: { Authorization: `Token ${token}` }
      });

      const inbox = inboxesResponse.data.results.find(
        inbox => inbox.channel_type === 'whatsapp'
      ) || inboxesResponse.data.results[0];

      if (!inbox) {
        throw new Error('Nenhum inbox encontrado');
      }

      // 2. Criar conversa
      const conversationResponse = await axios.post('/api/conversations/', {
        contact_id: contatoExistente.contato.id,
        inbox_id: inbox.id,
        assignee_id: userResponse.data.id,
        status: 'open'
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // 3. Enviar mensagem inicial
      const messageResponse = await axios.post('/api/messages/send_text/', {
        content: contatoExistente.mensagem,
        conversation_id: conversationResponse.data.id
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      alert('Atendimento criado com contato existente! Aparecerá no painel em instantes.');
      setContatoExistente({ busca: '', contato: null, mensagem: '' });
      setModalContatoExistente(false);
      setContatosEncontrados([]);

      // Recarregar conversas
      setTimeout(() => fetchConversations(true), 1000);

    } catch (error) {
      // Erro ao enviar para contato existente
      alert('Erro ao enviar mensagem: ' + (error.response?.data?.detail || error.message));
    } finally {
      setEnviandoAtendimento(false);
    }
  };

  // Ref para verificar se o componente está montado
  const isMounted = useRef(true);
  const wsRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  // Cleanup quando o componente desmontar
  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Salvar termo de busca no localStorage
  useEffect(() => {
    localStorage.setItem('conversationSearchTerm', searchTerm);
  }, [searchTerm]);

  // Salvar aba ativa no localStorage
  useEffect(() => {
    localStorage.setItem('conversationListActiveTab', activeTab);
  }, [activeTab]);

  // Preferências de som
  const isSoundEnabled = () => {
    if (typeof user?.sound_notifications_enabled === 'boolean') return user.sound_notifications_enabled;
    return localStorage.getItem('sound_notifications_enabled') === 'true';
  };
  const getNewMessageSound = () => {
    return user?.new_message_sound || localStorage.getItem('sound_new_message') || 'mixkit-bell-notification-933.wav';
  };
  const getNewConversationSound = () => {
    return user?.new_conversation_sound || localStorage.getItem('sound_new_conversation') || 'mixkit-digital-quick-tone-2866.wav';
  };
  const playSound = (fileName) => {
    if (!isSoundEnabled()) return;
    try {
      const src = `/sounds/${fileName}`;
      if (!audioRef.current) {
        audioRef.current = new Audio(src);
      } else {
        audioRef.current.pause();
        audioRef.current.src = src;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error) => {
        // Autoplay bloqueado: silenciar erro
        // Log removido('Autoplay bloqueado pelo navegador:', error);
      });
    } catch (e) {
      // Silenciar erros de autoplay
      // Log removido('Erro ao reproduzir som:', e);
    }
  };

  const setFavicon = (hrefBase) => {
    try {
      const href = `${hrefBase}?v=${Date.now()}`; // cache-busting
      const links = Array.from(document.querySelectorAll("link[rel~='icon']"));
      if (links.length > 0) {
        links.forEach(l => { l.href = href; });
      } else {
        // Criar tanto 'icon' quanto 'shortcut icon' para compatibilidade
        const link1 = document.createElement('link');
        link1.rel = 'icon';
        link1.type = 'image/x-icon';
        link1.href = href;
        document.head.appendChild(link1);
        const link2 = document.createElement('link');
        link2.rel = 'shortcut icon';
        link2.type = 'image/x-icon';
        link2.href = href;
        document.head.appendChild(link2);
      }
    } catch (_) { }
  };

  const startBlinkingFavicon = () => {
    if (isFaviconBlinkingRef.current) return;
    isFaviconBlinkingRef.current = true;
    const defaultIcon = '/favicon.ico';
    const notifyIcon = '/faviconnotifica.ico';
    let toggle = false;
    faviconTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // parar quando a aba estiver ativa
        stopBlinkingFavicon();
        return;
      }
      toggle = !toggle;
      setFavicon(toggle ? notifyIcon : defaultIcon);
    }, 800);
  };

  const stopBlinkingFavicon = () => {
    if (faviconTimerRef.current) {
      clearInterval(faviconTimerRef.current);
      faviconTimerRef.current = null;
    }
    isFaviconBlinkingRef.current = false;
    setFavicon('/favicon.ico');
  };

  const unlockAudio = () => {
    try {
      const src = `/sounds/${getNewMessageSound()}`;
      if (!audioRef.current) {
        audioRef.current = new Audio(src);
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => setShowSoundPrompt(false))
        .catch(() => setShowSoundPrompt(true));
    } catch (_) { }
  };

  const fetchTimeoutRef = useRef(null);

  // Função para buscar conversas com debounce
  const fetchConversations = async (forceRefresh = false) => {
    if (!isMounted.current || !authReady) {
      return;
    }

    // Se já houver um agendamento, cancelar para evitar múltiplas chamadas
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce de 300ms para evitar tempestade de requisições
    fetchTimeoutRef.current = setTimeout(async () => {
      if (forceRefresh) {
        setLoading(true);
      }

      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        if (!token) {
          setLoading(false);
          return;
        }

        const params = new URLSearchParams({
          page_size: '500', // Aumentado para garantir que novos atendimentos apareçam
          ordering: '-last_message_at',
          _t: new Date().getTime().toString() // Cache bust
        });

        if (provedorId) {
          params.append('provedor_id', provedorId);
        }

        const res = await axios.get(`/api/conversations/?${params.toString()}`, {
          headers: { Authorization: `Token ${token}` }
        });

        if (!isMounted.current) return;

        const conversationsData = res.data.results || res.data || [];

        const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
        const activeConversations = conversationsData.filter(conv => {
          const status = conv.status || conv.additional_attributes?.status;
          const isClosed = closedStatuses.includes(status);

          if (isClosed && selectedConversation?.id === conv.id) {
            if (onConversationUpdate) {
              onConversationUpdate(null);
            }
            localStorage.removeItem('selectedConversation');
          }

          return !isClosed;
        });

        if (selectedConversation) {
          const selectedStillExists = activeConversations.some(c => c.id === selectedConversation.id);
          const selectedStatus = selectedConversation.status || selectedConversation.additional_attributes?.status;

          if (!selectedStillExists || closedStatuses.includes(selectedStatus)) {
            if (onConversationUpdate) {
              onConversationUpdate(null);
            }
            localStorage.removeItem('selectedConversation');
          }
        }

        try {
          const prevMap = prevConversationsRef.current || {};
          const nextMap = {};

          activeConversations.forEach(conv => {
            const convId = conv.id;
            const lastMsgKey = conv.last_message?.id || conv.last_message?.created_at || conv.updated_at || conv.created_at || 'none';
            nextMap[convId] = lastMsgKey;

            if (hasSoundInitRef.current) {
              if (!(convId in prevMap)) {
                playSound(getNewConversationSound());
              } else if (prevMap[convId] !== lastMsgKey) {
                playSound(getNewMessageSound());
              }
            }
          });

          prevConversationsRef.current = nextMap;
          if (!hasSoundInitRef.current) {
            hasSoundInitRef.current = true;
          }
        } catch (_) { }

        setConversations(activeConversations);
        setHasInitialized(true);
        setLastUpdateTime(new Date());

      } catch (err) {
        if (isMounted.current) {
          if (err.response?.status === 401) {
            setConversations([]);
          } else if (err.response?.status === 403) {
            setConversations([]);
          } else {
            setConversations([]);
          }
          setHasInitialized(true);
        }
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
        fetchTimeoutRef.current = null;
      }
    }, 300);
  };

  // Inicialização: Marcar como inicializado quando o usuário estiver disponível
  useEffect(() => {
    if (user) {
      setHasInitialized(true);
    }
  }, [user]);

  // Buscar conversas quando auth estiver pronto
  useEffect(() => {
    if (authReady && isMounted.current && provedorId) {
      // Auth pronto, buscando conversas
      fetchConversations(true);
    }
  }, [authReady, provedorId]);

  // Expor função de recarregamento
  useEffect(() => {
    if (onConversationUpdate && authReady) {
      onConversationUpdate(() => fetchConversations(true));
    }
  }, [onConversationUpdate, authReady]);

  const selectedConversationRef = useRef(selectedConversation);
  const onConversationUpdateRef = useRef(onConversationUpdate);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    onConversationUpdateRef.current = onConversationUpdate;
  }, [onConversationUpdate]);

  // WebSocket para atualização em tempo real
  useEffect(() => {
    if (!provedorId || !authReady || !isMounted.current) {
      return;
    }

    // O WebSocket agora é gerenciado pelo NotificationContext (painelWsConnected)
    // Este componente apenas ouve as atualizações de estado e reage aos eventos se necessário
    // No entanto, ainda precisamos dos handlers de onmessage para atualizar a lista local.
    // Para manter a estabilidade, vamos mover a conexão para o Context e usar os eventos de lá.
    // Por enquanto, vamos apenas garantir que a conexão aqui não caia ao trocar conversas.

    const connectWebSocket = () => {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;

      const wsUrl = buildWebSocketUrl(`/ws/painel/${provedorId}/`, { token });
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const wsTimeout = setTimeout(() => {
        // Log removido('Timeout do WebSocket');
        setWsConnected(false);
      }, 5000);

      ws.onopen = () => {
        clearTimeout(wsTimeout);
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // CORREÇÃO: Tratar evento de conversa fechada ANTES de outros eventos
          if (data.type === 'conversation_event' &&
            (data.event_type === 'conversation_closed' || data.event_type === 'conversation_ended')) {
            const closedConversationId = data.conversation_id;

            // Remover conversa fechada do estado imediatamente
            setConversations(prevConversations => {
              const filtered = prevConversations.filter(conv => {
                const status = conv.status || conv.additional_attributes?.status;
                const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
                // Remover se for a conversa específica ou se tiver status fechado
                return conv.id !== closedConversationId && !closedStatuses.includes(status);
              });
              return filtered;
            });

            // Se a conversa fechada estava selecionada, limpar seleção IMEDIATAMENTE
            if (selectedConversationRef.current?.id === closedConversationId) {
              if (onConversationUpdateRef.current) {
                // Passar null para limpar a seleção
                onConversationUpdateRef.current(null);
              }
              // Limpar localStorage também
              localStorage.removeItem('selectedConversation');
            }

            // Recarregar lista para garantir sincronização
            setTimeout(() => fetchConversations(true), 300);
            return;
          }

          // Processar todos os tipos de eventos relacionados a conversas
          const isConversationEvent = data.type === 'conversation_created' ||
            data.type === 'conversation_updated' ||
            data.type === 'conversation_event';
          const isMessageEvent = data.type === 'new_message' ||
            data.type === 'message_created' ||
            data.type === 'message' ||
            data.type === 'chat_message' ||
            data.type === 'messages' ||
            data.event_type === 'new_message' ||
            data.event_type === 'message_received' ||
            data.event_type === 'message' ||
            data.event_type === 'chat_message' ||
            data.event_type === 'messages';

          if (isConversationEvent || isMessageEvent) {
            // Tocar som e piscar favicon conforme o tipo de evento
            try {
              const evt = data.type || data.event_type;
              if (isMessageEvent) {
                playSound(getNewMessageSound());
                startBlinkingFavicon();
              } else if (isConversationEvent) {
                const conv = data.conversation || data.payload || data.data;
                const status = conv?.status || conv?.additional_attributes?.status;
                const assignedToMe = conv?.assignee && user && (
                  (conv.assignee.id && conv.assignee.id === user.id) ||
                  (conv.assignee.username && conv.assignee.username === user.username)
                );
                const isUnassignedPending = !conv?.assignee && status === 'pending';
                if (!conv || assignedToMe || isUnassignedPending) {
                  playSound(getNewConversationSound());
                  startBlinkingFavicon();
                }
              }
            } catch (_) { }

            setNewMessageNotification(true);
            setTimeout(() => setNewMessageNotification(false), 3000);

            // SEMPRE recarregar a lista de conversas quando houver evento de nova conversa ou nova mensagem
            // Isso garante que a lista seja atualizada mesmo se o payload não contiver a conversa completa
            if (isMounted.current) {
              // Tentar atualização instantânea se tivermos a conversa no evento
              const convAtualizada = data.conversation || (data.data && data.data.conversation) || data.payload || data.conversation_data;
              if (convAtualizada && convAtualizada.id) {
                setConversations(prev => {
                  const listaSemAntiga = prev.filter(c => c.id !== convAtualizada.id);
                  // Adicionar no início da lista e ordenar por última mensagem
                  const novaLista = [convAtualizada, ...listaSemAntiga];
                  return novaLista.sort((a, b) => {
                    const timeA = a.last_message?.created_at || a.updated_at || a.created_at || 0;
                    const timeB = b.last_message?.created_at || b.updated_at || b.created_at || 0;
                    return new Date(timeB) - new Date(timeA);
                  });
                });
              }

              // SEMPRE recarregar para garantir que a lista esteja atualizada
              // Limpar timeout anterior se existir para evitar múltiplas chamadas
              if (fetchTimeoutRef.current) {
                clearTimeout(fetchTimeoutRef.current);
                fetchTimeoutRef.current = null;
              }

              // Usar um pequeno delay para evitar múltiplas chamadas simultâneas
              // Mas garantir que sempre execute
              fetchTimeoutRef.current = setTimeout(() => {
                if (isMounted.current) {
                  fetchConversations(true);
                  fetchTimeoutRef.current = null;
                }
              }, 200);
            }
          }
        } catch (error) {
          // CORREÇÃO DE SEGURANÇA: Não expor detalhes do erro
          // Silenciar erro para não expor informações sensíveis
        }
      };

      ws.onclose = (event) => {
        clearTimeout(wsTimeout);
        setWsConnected(false);

        // Códigos que indicam erro permanente (não tentar reconectar)
        // 4001 = Unauthorized, 4003 = Forbidden
        const permanentErrorCodes = [4001, 4003];

        if (permanentErrorCodes.includes(event.code)) {
          // Erro de permissão ou autenticação - não tentar reconectar
          return;
        }

        // Tentar reconectar em 3 segundos apenas se não foi erro permanente
        if (isMounted.current && authReady) {
          setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = (error) => {
        // CORREÇÃO DE SEGURANÇA: Não expor token em logs
        // O erro pode conter a URL com token, mas não vamos logá-la
        clearTimeout(wsTimeout);
        setWsConnected(false);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [provedorId, authReady]);

  // Parar piscar quando a aba ficar visível
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        stopBlinkingFavicon();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopBlinkingFavicon();
    };
  }, []);

  // Conversas são atualizadas via WebSocket do painel (tempo real)
  // Não é necessário polling - o WebSocket já envia conversation_event quando há mudanças

  // Definir abas baseado nas permissões
  const getAvailableTabs = () => {
    const activeConversations = conversations.filter(c => {
      const status = c.status || c.additional_attributes?.status;
      const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
      return !closedStatuses.includes(status);
    });

    const tabs = [];

    // Abas padrão - Minhas sempre primeiro
    tabs.push({
      id: 'mine',
      label: 'Minhas',
      count: activeConversations.filter(c => {
        const a = c.assignee;
        if (!a || !user) return false;
        return (a.id && a.id === user.id) || (a.username && a.username === user.username);
      }).length,
    });

    // Aba Não atribuídas - conversas em espera (pending) OU com IA (snoozed) OU transferidas
    tabs.push({
      id: 'unassigned',
      label: 'Não atribuídas',
      count: activeConversations.filter(c => {
        const status = c.status || c.additional_attributes?.status;
        const assignedUser = c.additional_attributes?.assigned_user;
        const assignedTeam = c.additional_attributes?.assigned_team;

        if (!c.assignee) {
          // Conversas com IA ou em espera geral
          if (status === 'pending' || status === 'snoozed') {
            return true;
          }

          // Conversas transferidas para este usuário específico
          if (assignedUser && user && (assignedUser.id === user.id || assignedUser.id === user.id.toString())) {
            return true;
          }

          // Conversas transferidas para equipe do usuário
          if (assignedTeam && user && user.team && assignedTeam.id === user.team.id) {
            return true;
          }
        }

        return false;
      }).length,
    });

    // Aba Com IA se o usuário tiver a permissão específica - depois de Não atribuídas
    if (userPermissions.includes('view_ai_conversations')) {
      tabs.push({
        id: 'ai',
        label: 'Com IA',
        count: activeConversations.filter(c => {
          const status = c.status || c.additional_attributes?.status;
          return status === 'snoozed' && !c.assignee;
        }).length,
      });
    }

    return tabs;
  };

  const tabs = getAvailableTabs();

  // Filtrar conversas baseado na aba ativa e termo de busca
  const filteredConversations = useMemo(() => {
    let filtered = conversations.filter(c => {
      const status = c.status || c.additional_attributes?.status;
      const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
      return !closedStatuses.includes(status);
    });

    // Filtrar por aba
    if (activeTab === 'ai') {
      // Mostrar conversas com IA: status 'snoozed' e não atribuídas
      filtered = filtered.filter(c => {
        const status = c.status || c.additional_attributes?.status;
        return status === 'snoozed' && !c.assignee;
      });
    } else if (activeTab === 'mine') {
      // Mostrar conversas atribuídas ao usuário atual (qualquer status)
      filtered = filtered.filter(c => {
        const a = c.assignee;
        if (!a || !user) return false;
        return (a.id && a.id === user.id) || (a.username && a.username === user.username);
      });
    } else if (activeTab === 'unassigned') {
      // Mostrar conversas não atribuídas em espera (pending) OU com IA (snoozed)
      // OU transferidas para o usuário atual (assigned_user)
      filtered = filtered.filter(c => {
        const status = c.status || c.additional_attributes?.status;
        const assignedUser = c.additional_attributes?.assigned_user;
        const assignedTeam = c.additional_attributes?.assigned_team;

        // Debug removido

        // Conversas sem assignee OU transferidas para este usuário/equipe
        if (!c.assignee || (assignedUser && user && (assignedUser.id === user.id || assignedUser.id === user.id.toString()))) {
          // Conversas com IA ou em espera geral
          if (status === 'pending' || status === 'snoozed') {
            return true;
          }

          // Conversas transferidas para este usuário específico
          if (assignedUser && user && (assignedUser.id === user.id || assignedUser.id === user.id.toString())) {
            return true;
          }

          // Conversas transferidas para equipe do usuário (se ele pertence à equipe)
          if (assignedTeam && user && user.team && assignedTeam.id === user.team.id) {
            return true;
          }
        }

        return false;
      });
    }

    // Filtrar por termo de busca
    if (searchTerm && searchTerm.trim().length >= 2) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(c => {
        const contactName = c.contact?.name || '';
        const lastMessage = c.last_message?.content || '';
        const phone = c.contact?.phone || '';

        return contactName.toLowerCase().includes(searchLower) ||
          lastMessage.toLowerCase().includes(searchLower) ||
          phone.includes(searchTerm);
      });
    }

    return filtered;
  }, [conversations, activeTab, searchTerm, user?.id, userPermissions]);

  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-background flex flex-col h-full">
      <style>{`
        .conversation-list::-webkit-scrollbar {
          width: 6px;
          background: transparent;
        }
        .conversation-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .conversation-list::-webkit-scrollbar-thumb {
          background: #4a5568;
          border-radius: 3px;
          border: none;
        }
        .conversation-list::-webkit-scrollbar-thumb:hover {
          background: #2d3748;
        }
        .conversation-list {
          scrollbar-width: thin;
          scrollbar-color: #4a5568 transparent;
        }
      `}</style>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Conversas</h2>
          <div className="flex items-center space-x-2">
            {/* Botão de ativar sons removido */}

            {/* Notificação de nova mensagem */}
            {newMessageNotification && (
              <div className="flex items-center space-x-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs animate-pulse">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Nova mensagem!</span>
              </div>
            )}

            <button
              onClick={() => fetchConversations(true)}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Atualizar conversas"
            >
            </button>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Log removido(' Clicou nos 3 pontinhos da página Atendimento');
                  setShowMenuAtendimento(!showMenuAtendimento);
                }}
                className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                title="Novo atendimento"
              >
                <UserPlus size={20} />
              </button>

              {/* Menu de opções */}
              {showMenuAtendimento && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenuAtendimento(false);
                      setModalNovoContato(true);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center space-x-2"
                  >
                    <User className="w-4 h-4" />
                    <span>Novo Contato</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenuAtendimento(false);
                      setModalContatoExistente(true);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center space-x-2"
                  >
                    <Search className="w-4 h-4" />
                    <span>Contato Existente</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Pesquisar mensagens em conversas"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="niochat-input pl-8 w-full text-sm"
          />
          {searchTerm && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSearchTerm('')}
            >
              Limpar
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-muted rounded-lg p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1 bg-primary text-primary-foreground text-xs px-1 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div
        className={`flex-1 conversation-list ${filteredConversations.length > 3 ? 'overflow-y-auto' : 'overflow-hidden'
          }`}
        style={filteredConversations.length > 3 ? {
          maxHeight: '450px' // Altura para mostrar aproximadamente 3 conversas (~150px cada com padding e bordas)
        } : {}}
      >
        {!authReady ? (
          <div className="p-3 text-center text-muted-foreground">
            {!hasInitialized ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span>Verificando autenticação...</span>
              </div>
            ) : (
              <div>
                <div className="mb-3">
                  <svg className="w-12 h-12 mx-auto text-muted-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h3 className="text-lg font-medium mb-2">Acesso Restrito</h3>
                  <p className="text-sm mb-4">Você precisa estar logado para acessar as conversas.</p>
                </div>
                <button
                  onClick={() => window.location.href = '/admin/login/'}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  Fazer Login
                </button>
                <p className="text-xs mt-2 text-muted-foreground">
                  Ou acesse o painel administrativo para autenticação
                </p>
              </div>
            )}
          </div>
        ) : !hasInitialized ? (
          <div className="p-3 text-center text-muted-foreground">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span>Carregando...</span>
            </div>
            <p className="text-xs mt-2">Buscando conversas...</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-6 text-center">
            {conversations.length === 0 ? (
              <div className="py-8 flex flex-col items-center">
                {/* Texto principal */}
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Nenhuma conversa ativa
                </h3>

                {/* Texto explicativo */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Suas conversas aparecerão aqui assim que novos clientes entrarem em contato
                </p>
              </div>
            ) : (
              <div className="py-4">
                <p className="text-sm text-muted-foreground">
                  Nenhuma conversa na aba "{tabs.find(t => t.id === activeTab)?.label}"
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Total: {conversations.length}
                </p>
              </div>
            )}
          </div>
        ) : (
          filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              onClick={() => onConversationSelect(conversation)}
              className={`p-3 border-b border-border cursor-pointer transition-colors hover:bg-muted/50 ${selectedConversation?.id === conversation.id ? 'bg-muted' : ''
                }`}
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    {conversation.contact?.avatar ? (
                      <img
                        src={conversation.contact.avatar}
                        alt={conversation.contact.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <User size={20} className="text-primary" />
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground truncate">
                      {conversation.contact?.name || 'Contato sem nome'}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {conversation.last_message?.created_at ?
                        new Date(conversation.last_message.created_at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : ''
                      }
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground truncate mt-1">
                    {(() => {
                      const msg = conversation.last_message;
                      if (!msg) return 'Nenhuma mensagem';

                      // Se o conteúdo for vazio ou apenas pontos, verificar se é mensagem interativa
                      if (!msg.content || msg.content === '...') {
                        const attrs = msg.additional_attributes;
                        if (attrs?.interactive_rows?.length > 0) return '📋 Menu de Opções';
                        if (attrs?.interactive_buttons?.length > 0) return '🔘 Botões Interativos';
                      }

                      return msg.content || 'Nenhuma mensagem';
                    })()}
                  </p>

                  {/*  Tempo de atendimento em aberto */}
                  <div className="mt-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-600 text-white">
                      <Clock size={12} className="mr-1" />
                      Há {(() => {
                        const agora = new Date();
                        const inicio = new Date(conversation.created_at);
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
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/*  Modal de novo contato */}
      <Dialog open={modalNovoContato} onOpenChange={setModalNovoContato}>
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle>Novo Contato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Nome do Contato</label>
              <input
                type="text"
                value={novoContato.nome}
                onChange={(e) => setNovoContato(prev => ({ ...prev, nome: e.target.value }))}
                placeholder="Digite o nome do contato"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Telefone (com 55)</label>
              <input
                type="text"
                value={novoContato.telefone}
                onChange={(e) => setNovoContato(prev => ({ ...prev, telefone: e.target.value }))}
                placeholder="5511999999999"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Canal</label>
              <select
                value={novoContato.canal}
                onChange={(e) => setNovoContato(prev => ({
                  ...prev,
                  canal: e.target.value,
                  usarTemplate: e.target.value === 'whatsapp' ? prev.usarTemplate : false,
                  templateSelecionado: e.target.value === 'whatsapp' ? prev.templateSelecionado : null
                }))}
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
                <option value="email">Email</option>
              </select>
            </div>

            {novoContato.canal === 'whatsapp' && (
              <div>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={novoContato.usarTemplate}
                    onChange={(e) => setNovoContato(prev => ({
                      ...prev,
                      usarTemplate: e.target.checked,
                      templateSelecionado: e.target.checked ? prev.templateSelecionado : null,
                      mensagem: e.target.checked ? '' : prev.mensagem
                    }))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium">Usar template de mensagem (para iniciar conversa após 24h)</span>
                </label>
              </div>
            )}

            {novoContato.usarTemplate && novoContato.canal === 'whatsapp' ? (
              <div>
                <label className="block text-sm font-medium mb-2">Template</label>
                {carregandoTemplates ? (
                  <div className="text-sm text-muted-foreground">Carregando templates...</div>
                ) : templates.length > 0 ? (
                  <select
                    value={novoContato.templateSelecionado || ''}
                    onChange={(e) => setNovoContato(prev => ({ ...prev, templateSelecionado: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Selecione um template</option>
                    {templates.map((template, index) => (
                      <option key={template.id || template.name || `template-${index}`} value={template.name}>
                        {template.name} ({template.language || 'pt_BR'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Nenhum template aprovado encontrado. Crie templates em Configurações → Integrações → WhatsApp Oficial
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-2">Mensagem</label>
                <textarea
                  value={novoContato.mensagem}
                  onChange={(e) => setNovoContato(prev => ({ ...prev, mensagem: e.target.value }))}
                  placeholder="Digite a mensagem a ser enviada"
                  rows={3}
                  className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-4">
              <button
                onClick={() => setModalNovoContato(false)}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                disabled={enviandoAtendimento}
              >
                Cancelar
              </button>
              <button
                onClick={handleNovoContato}
                disabled={enviandoAtendimento}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {enviandoAtendimento
                  ? 'Enviando...'
                  : novoContato.usarTemplate
                    ? 'Enviar Template'
                    : 'Enviar Mensagem'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/*  Modal de contato existente */}
      <Dialog open={modalContatoExistente} onOpenChange={setModalContatoExistente}>
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle>Contato Existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Buscar Contato</label>
              <input
                type="text"
                value={contatoExistente.busca}
                onChange={(e) => {
                  setContatoExistente(prev => ({ ...prev, busca: e.target.value }));
                  buscarContatos(e.target.value);
                }}
                placeholder="Digite nome ou telefone"
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Lista de contatos encontrados */}
            {contatosEncontrados.length > 0 && (
              <div className="max-h-40 overflow-y-auto border border-border rounded-lg">
                {contatosEncontrados.map(contato => (
                  <button
                    key={contato.id}
                    onClick={() => setContatoExistente(prev => ({ ...prev, contato }))}
                    className={`w-full text-left p-3 hover:bg-accent transition-colors border-b last:border-b-0 ${contatoExistente.contato?.id === contato.id ? 'bg-accent' : ''
                      }`}
                  >
                    <div className="font-medium">{contato.name}</div>
                    <div className="text-sm text-muted-foreground">{contato.phone}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Contato selecionado */}
            {contatoExistente.contato && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="font-medium">Contato Selecionado:</div>
                <div className="text-sm">{contatoExistente.contato.name} - {contatoExistente.contato.phone}</div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Mensagem</label>
              <textarea
                value={contatoExistente.mensagem}
                onChange={(e) => setContatoExistente(prev => ({ ...prev, mensagem: e.target.value }))}
                placeholder="Digite a mensagem a ser enviada"
                rows={3}
                className="w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4">
              <button
                onClick={() => {
                  setModalContatoExistente(false);
                  setContatoExistente({ busca: '', contato: null, mensagem: '' });
                  setContatosEncontrados([]);
                }}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                disabled={enviandoAtendimento}
              >
                Cancelar
              </button>
              <button
                onClick={handleContatoExistente}
                disabled={enviandoAtendimento || !contatoExistente.contato}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {enviandoAtendimento ? 'Enviando...' : 'Enviar Mensagem'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}, (prevProps, nextProps) => {
  // OTIMIZAÇÃO: Só re-renderizar se props essenciais mudarem
  // Não re-renderizar se apenas a conversa selecionada mudar, a menos que mude qual ID está selecionado
  return (
    prevProps.provedorId === nextProps.provedorId &&
    prevProps.user?.id === nextProps.user?.id &&
    prevProps.selectedConversation?.id === nextProps.selectedConversation?.id &&
    prevProps.onConversationUpdate === nextProps.onConversationUpdate
  );
});

export default ConversationList;
