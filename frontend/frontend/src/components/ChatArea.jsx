import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  Paperclip,
  Smile,
  User,
  MessageCircle,
  Globe,
  ChevronDown,
  UserCheck,
  CheckCircle2,
  ArrowRightLeft,
  Mic,
  MicOff,
  Square,
  FileText,
  Zap
} from 'lucide-react';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogPortal, DialogOverlay } from './ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import whatsappIcon from '../assets/whatsapp.png';
import telegramIcon from '../assets/telegram.png';
import gmailIcon from '../assets/gmail.png';
import instagramIcon from '../assets/instagram.png';
import logoImage from '../assets/logo.png';
import chatBgPattern from '../assets/chat-bg-pattern.svg';
import chatBgPatternLight from '../assets/chat-bg-pattern-light.svg';
import CustomAudioPlayer from './ui/CustomAudioPlayer';
import FilePreview from './FilePreview';
import { buildMediaUrl } from '../config/environment';
import { buildWebSocketUrl } from '../utils/websocketUrl';
import { useTheme } from '../hooks/useTheme';

const ChatArea = ({ conversation, onConversationClose, onConversationUpdate, user }) => {
  const navigate = useNavigate();
  const isDarkTheme = useTheme();

  // Verificação de segurança para evitar erros
  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-4">
          {/* Logo do NioChat */}
          <div className="mb-6">
            <img
              src={logoImage}
              alt="NioChat Logo"
              className="w-32 h-32 mx-auto object-contain"
            />
          </div>

          {/* Texto principal */}
          <p className="text-base text-foreground mb-2">
            Selecione uma conversa para iniciar o atendimento
          </p>

          {/* Texto explicativo */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            Os atendimentos em andamento aparecerão aqui.
          </p>
        </div>
      </div>
    );
  }

  if (!conversation.contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <h3 className="text-lg font-medium mb-2">Conversa inválida</h3>
          <p>Esta conversa não possui informações de contato válidas</p>
        </div>
      </div>
    );
  }

  // Proteção: Carregando dados do usuário logado
  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando dados do usuário...</p>
        </div>
      </div>
    );
  }

  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Estado para verificar se a janela de 24 horas está aberta
  // Inicializar com o valor da prop se disponível, senão null
  const channelType = conversation?.inbox?.channel_type;
  const initialIs24hWindowOpen = (channelType === 'whatsapp' || channelType === 'whatsapp_oficial')
    ? (conversation?.is_24h_window_open ?? null)
    : true; // Para outros canais, sempre aberta
  const [is24hWindowOpen, setIs24hWindowOpen] = useState(initialIs24hWindowOpen);
  // Estado local para o nome do contato (pode ser atualizado via WebSocket)
  const [contactName, setContactName] = useState(conversation.contact?.name);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const wsRef = useRef(null);
  const [loadingProfilePic, setLoadingProfilePic] = useState(false);
  const [showResolverDropdown, setShowResolverDropdown] = useState(false);
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const [agents, setAgents] = useState([]);
  const [agentsStatus, setAgentsStatus] = useState({});
  const [profilePicture, setProfilePicture] = useState(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const dropdownRef = useRef(null);

  // Estados para visualização de mídia
  const [selectedImage, setSelectedImage] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);

  // Estados para reações e exclusão
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [replyingToMessage, setReplyingToMessage] = useState(null);

  // Estados para gravação de áudio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const recordingIntervalRef = useRef(null);

  // Estados para templates
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);

  // Estados para reprodução de áudio
  const [playingAudio, setPlayingAudio] = useState(null);
  const [audioProgress, setAudioProgress] = useState({});
  const audioRefs = useRef({});

  //  ESTADO PARA CONTROLE DE MENSAGENS PENDENTES
  const [pendingMessages, setPendingMessages] = useState(new Set());

  // Respostas Rápidas
  const [quickReplies, setQuickReplies] = useState([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyFilter, setQuickReplyFilter] = useState('');
  const [quickReplyIndex, setQuickReplyIndex] = useState(0);

  useEffect(() => {
    const fetchQuickReplies = async () => {
      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        const provedorId = user?.provedor_id || user?.provedores_admin?.[0]?.id;
        if (!token || !provedorId) return;
        const res = await axios.get(`/api/respostas-rapidas/?provedor=${provedorId}`, {
          headers: { Authorization: `Token ${token}` }
        });
        setQuickReplies(res.data?.results || res.data || []);
      } catch (err) {
        console.error('Erro ao buscar respostas rápidas:', err);
      }
    };
    if (user) fetchQuickReplies();
  }, [user]);

  const filteredQuickReplies = quickReplies.filter(r =>
    r.titulo.toLowerCase().includes(quickReplyFilter.toLowerCase()) ||
    r.conteudo.toLowerCase().includes(quickReplyFilter.toLowerCase())
  );

  const selectQuickReply = (qr) => {
    setMessage(qr.conteudo);
    setShowQuickReplies(false);
    setTimeout(() => document.getElementById('message-input')?.focus(), 10);
  };

  const handleMessageChange = (e) => {
    const val = e.target.value;
    setMessage(val);

    if (val === '/') {
      setShowQuickReplies(true);
      setQuickReplyFilter('');
      setQuickReplyIndex(0);
    } else if (val.startsWith('/')) {
      setShowQuickReplies(true);
      setQuickReplyFilter(val.substring(1));
      setQuickReplyIndex(0);
    } else {
      setShowQuickReplies(false);
    }
  };

  // Ref para rastrear mensagens já marcadas como lidas nesta sessão
  const markedAsReadRef = useRef(new Set());

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

  //  FUNÇÃO PARA LIMPAR MENSAGENS DUPLICADAS
  const cleanDuplicateMessages = (messages) => {
    const uniqueMessages = [];
    const seenIds = new Set();

    messages.forEach(msg => {
      //  CORRIGIDO: Permitir TODAS as mensagens com ID válido
      if (msg.id && !seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        uniqueMessages.push(msg);
      }
      //  CORRIGIDO: Permitir mensagens temporárias SEM ID apenas
      else if (!msg.id && (msg.isTemporary || msg.is_sending)) {
        // Verificar duplicatas por conteúdo e timestamp apenas para temporárias
        const isDuplicate = uniqueMessages.some(existingMsg => {
          if (!existingMsg.isTemporary && !existingMsg.is_sending) return false;
          const timeDiff = Math.abs(new Date(existingMsg.created_at) - new Date(msg.created_at));
          return existingMsg.content === msg.content &&
            existingMsg.is_from_customer === msg.is_from_customer &&
            timeDiff < 1000; // 1 segundo de tolerância
        });

        if (!isDuplicate) {
          uniqueMessages.push(msg);
        }
      }
      //  NOVO: Fallback para mensagens sem ID que não são temporárias (casos raros)
      else if (!msg.id && !msg.isTemporary && !msg.is_sending) {
        // Verificar se já existe uma mensagem igual por conteúdo e timestamp
        const isDuplicate = uniqueMessages.some(existingMsg => {
          const timeDiff = Math.abs(new Date(existingMsg.created_at) - new Date(msg.created_at));
          return existingMsg.content === msg.content &&
            existingMsg.is_from_customer === msg.is_from_customer &&
            timeDiff < 2000; // 2 segundos de tolerância para mensagens sem ID
        });

        if (!isDuplicate) {
          uniqueMessages.push(msg);
        }
      }
    });

    return uniqueMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  };

  // Componente para exibir ícone de status de leitura (estilo WhatsApp)
  const MessageStatusIcon = ({ message }) => {
    const status = message.additional_attributes?.last_status;
    const readAt = message.additional_attributes?.read_at;
    const deliveredAt = message.additional_attributes?.delivered_at;
    const sentAt = message.additional_attributes?.sent_at;

    // Determinar o status atual (prioridade: read > delivered > sent)
    let currentStatus = status;
    if (readAt || status === 'read') {
      currentStatus = 'read';
    } else if (deliveredAt || status === 'delivered') {
      currentStatus = 'delivered';
    } else if (sentAt || status === 'sent') {
      currentStatus = 'sent';
    }

    // Se não há status definido mas a mensagem não é temporária e tem external_id, assumir "sent"
    // (mensagem foi enviada com sucesso)
    if (!currentStatus && !message.isTemporary && (message.external_id || message.additional_attributes?.external_id)) {
      currentStatus = 'sent';
    }

    // 3️⃣ Mensagem lida pelo usuário - 2 tickets azuis bem fortes
    if (currentStatus === 'read') {
      return (
        <span className="inline-flex items-center ml-1 transition-all duration-300 ease-in-out" title="Lida">
          <svg
            width="16"
            height="12"
            viewBox="0 0 16 11"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="transition-all duration-300 ease-in-out"
          >
            {/* Primeiro checkmark (atrás) - azul bem forte */}
            <path
              d="M0.5 5.5L3 8L7 4"
              stroke="#0066FF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Segundo checkmark (frente, deslocado) - azul bem forte */}
            <path
              d="M8.5 5.5L11 8L15.5 3"
              stroke="#0066FF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
      );
    }

    // 2️⃣ Mensagem entregue no celular - 2 tickets cinza bem neutros (sem tom roxo)
    if (currentStatus === 'delivered') {
      return (
        <span className="inline-flex items-center ml-1 transition-all duration-300 ease-in-out" title="Entregue">
          <svg
            width="16"
            height="12"
            viewBox="0 0 16 11"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="transition-all duration-300 ease-in-out"
          >
            {/* Primeiro checkmark (atrás) - cinza claro neutro */}
            <path
              d="M0.5 5.5L3 8L7 4"
              stroke="#D1D5DB"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Segundo checkmark (frente, deslocado) - cinza médio neutro */}
            <path
              d="M8.5 5.5L11 8L15.5 3"
              stroke="#9CA3AF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
      );
    }

    // 1️⃣ Mensagem enviada - 1 ticket cinza neutro (sem tom roxo)
    return (
      <span
        className="inline-flex items-center ml-1 transition-all duration-300 ease-in-out"
        title={currentStatus === 'sent' ? 'Enviada' : 'Enviando...'}
      >
        <svg
          width="12"
          height="10"
          viewBox="0 0 12 9"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="transition-all duration-300 ease-in-out"
        >
          {/* Checkmark único cinza neutro (sem tom roxo) */}
          <path
            d="M1 4.5L4.5 8L11 1.5"
            stroke="#9CA3AF"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
    );
  };

  // Função para renderizar ícone do canal
  const getChannelIcon = (channelType) => {
    switch (channelType) {
      case 'whatsapp':
        return <img src={whatsappIcon} alt="WhatsApp" className="w-3 h-3" />;
      case 'telegram':
        return <img src={telegramIcon} alt="Telegram" className="w-3 h-3" />;
      case 'email':
        return <img src={gmailIcon} alt="Gmail" className="w-3 h-3" />;
      case 'instagram':
        return <img src={instagramIcon} alt="Instagram" className="w-3 h-3" />;
      case 'webchat':
        return <Globe className="w-3 h-3 text-cyan-500" />;
      default:
        return <MessageCircle className="w-3 h-3 text-muted-foreground" />;
    }
  };

  // Função para buscar mensagens
  const fetchMessages = async () => {
    if (!conversation) return;
    setLoading(true);
    setError('');
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      // Buscar TODAS as mensagens da conversa com paginação automática
      let allMessages = [];
      let page = 1;
      let hasMore = true;
      const maxPages = 20; // Proteção contra loops infinitos (máx 200k mensagens)

      while (hasMore && page <= maxPages) {
        const res = await axios.get(`/api/messages/?conversation=${conversation.id}&page_size=10000&ordering=created_at&page=${page}`, {
          headers: { Authorization: `Token ${token}` }
        });

        const pageMessages = res.data.results || (Array.isArray(res.data) ? res.data : []);
        allMessages = [...allMessages, ...pageMessages];

        // Verificar se há mais páginas
        hasMore = res.data.next !== null && pageMessages.length > 0;
        page++;

        // Parar se não há mais mensagens
        if (pageMessages.length === 0) {
          hasMore = false;
        }
      }

      // Processar todas as mensagens sem filtros desnecessários
      const processedMessages = allMessages.map(msg => {
        let processedContent = processMessageContent(msg.content, msg.is_from_customer);

        //  Remover assinatura do agente se presente
        if (processedContent && processedContent.match(/\*.*disse:\*\n/) && !msg.is_from_customer) {
          processedContent = processedContent.replace(/\*.*disse:\*\n/, '');
        }

        // CORREÇÃO: Identificar mensagens da IA de forma mais robusta
        // Verificar from_ai do serializer, additional_attributes.from_ai, ou sender.sender_type
        const isFromAI = msg.from_ai === true ||
          msg.additional_attributes?.from_ai === true ||
          msg.sender?.sender_type === 'ai';

        return {
          ...msg,
          content: processedContent,
          // Garantir que campos do serializer estejam presentes
          sender: msg.sender || (!msg.is_from_customer && isFromAI ? { sender_type: 'ai' } : { sender_type: 'agent' }),
          from_ai: isFromAI  // CORREÇÃO: Usar verificação robusta
        };
      });

      setMessages(processedMessages);
    } catch (err) {
      setError('Erro ao carregar mensagens.');
      console.error('Erro ao buscar mensagens:', err);
    } finally {
      setLoading(false);
    }
  };

  // Atualizar estado local do nome do contato quando a conversa mudar
  useEffect(() => {
    setContactName(conversation.contact?.name);

    // NÃO definir estado inicial baseado na prop conversation
    // Sempre buscar do backend para garantir dados atualizados
    // Isso evita usar dados antigos que podem estar na prop

    // Buscar conversa atualizada do backend para garantir dados corretos (especialmente status da janela de 24h)
    const fetchConversationStatus = async () => {
      if (!conversation?.id) return;

      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        if (!token) return;

        const response = await axios.get(`/api/conversations/${conversation.id}/`, {
          headers: { Authorization: `Token ${token}` }
        });

        if (response.data) {
          const updatedConversation = response.data;

          // Atualizar conversa no componente pai se callback disponível
          if (onConversationUpdate) {
            onConversationUpdate(updatedConversation);
          }

          // Atualizar status da janela de 24 horas
          // IMPORTANTE: Sempre usar o valor calculado pelo backend (is_24h_window_open)
          // que busca a mensagem mais recente do cliente e usa o created_at real
          const channelType = updatedConversation.inbox?.channel_type;
          if (channelType === 'whatsapp' || channelType === 'whatsapp_oficial') {
            // O backend sempre retorna is_24h_window_open calculado corretamente
            // usando o created_at da mensagem mais recente do cliente
            if (updatedConversation.is_24h_window_open !== undefined) {
              console.log(`[ChatArea] Status da janela atualizado do backend: ${updatedConversation.is_24h_window_open} para conversa ${conversation.id}`);
              setIs24hWindowOpen(updatedConversation.is_24h_window_open);
            } else {
              // Fallback: se não veio do backend, assumir fechada para segurança
              console.warn(`[ChatArea] is_24h_window_open não veio do backend para conversa ${conversation.id}, assumindo fechada`);
              setIs24hWindowOpen(false);
            }
          } else {
            setIs24hWindowOpen(true);
          }
        }
      } catch (error) {
        console.error('Erro ao buscar status da conversa:', error);
        // Em caso de erro, usar dados da conversa que já temos como último recurso
        // Mas sempre priorizar o valor calculado pelo backend
        if (conversation) {
          const channelType = conversation.inbox?.channel_type;
          if (channelType === 'whatsapp' || channelType === 'whatsapp_oficial') {
            // Usar o valor do backend se disponível, senão assumir fechada
            if (conversation.is_24h_window_open !== undefined) {
              console.log(`[ChatArea] Usando valor da prop conversation como fallback: ${conversation.is_24h_window_open}`);
              setIs24hWindowOpen(conversation.is_24h_window_open);
            } else {
              console.warn(`[ChatArea] Nenhum valor disponível, assumindo janela fechada`);
              setIs24hWindowOpen(false);
            }
          } else {
            setIs24hWindowOpen(true);
          }
        }
      }
    };

    // Buscar conversa atualizada quando a conversa mudar
    // IMPORTANTE: Sempre buscar do backend, não usar valores da prop que podem estar desatualizados
    if (conversation?.id) {
      fetchConversationStatus();
    }
  }, [conversation?.id]);

  // Buscar mensagens ao abrir conversa
  useEffect(() => {
    fetchMessages();
  }, [conversation?.id]);

  // Verificar periodicamente o status da janela de 24 horas para WhatsApp
  // NOTA: Esta verificação periódica foi removida porque agora buscamos a conversa atualizada
  // do backend quando a conversa muda, garantindo dados sempre atualizados.
  // O status é atualizado em tempo real via WebSocket quando mensagens chegam.

  // Função para marcar mensagem como lida no WhatsApp
  const markMessageAsRead = async (messageId) => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;

      await axios.post('/api/messages/mark_as_read/', {
        message_id: messageId
      }, {
        headers: { Authorization: `Token ${token}` }
      });
    } catch (error) {
      // Silenciar erros - não é crítico se falhar
      console.error('Erro ao marcar mensagem como lida:', error);
    }
  };

  // Marcar mensagens do cliente como lidas quando a conversa estiver aberta (apenas WhatsApp)
  useEffect(() => {
    // Só marcar como lida se:
    // 1. A conversa estiver aberta e carregada
    // 2. For uma conversa do WhatsApp
    // 3. Tiver mensagens carregadas
    // 4. O usuário for o atendente atribuído (assignee)
    if (!conversation || !conversation.id || messages.length === 0) return;

    // SEGURANÇA: Apenas o atendente atribuído marca como lida para evitar tempestade de requisições
    const currentUserId = user?.id;
    const assigneeId = conversation.assignee?.id || conversation.assignee_id;

    if (user?.user_type !== 'superadmin' && assigneeId && assigneeId !== currentUserId) {
      return;
    }

    const channelType = conversation.inbox?.channel_type;
    if (channelType !== 'whatsapp') return;

    // Limpar o ref quando mudar de conversa
    if (!markedAsReadRef.current.has(`conversation_${conversation.id}`)) {
      markedAsReadRef.current.clear();
      markedAsReadRef.current.add(`conversation_${conversation.id}`);
    }

    // Usar um timeout para aguardar o carregamento completo das mensagens
    const timeoutId = setTimeout(() => {
      // Filtrar mensagens do cliente que ainda não foram marcadas como lidas
      const unreadMessages = messages.filter((msg) => {
        const alreadyMarkedInSession = markedAsReadRef.current.has(msg.id);
        const alreadyMarkedPreviously = msg.additional_attributes?.marked_as_read_at;

        return (
          msg.is_from_customer &&
          msg.id &&
          msg.external_id &&
          !alreadyMarkedInSession &&
          !alreadyMarkedPreviously
        );
      });

      if (unreadMessages.length > 0) {
        // OTIMIZAÇÃO: Marcar apenas a ÚLTIMA mensagem como lida.
        // A API da Meta marcará automaticamente todas as anteriores.
        // Isso reduz N requisições para apenas 1 por lote de mensagens.
        const lastUnreadMsg = unreadMessages[unreadMessages.length - 1];

        // Registrar todas no ref para evitar novas tentativas neste ciclo
        unreadMessages.forEach(msg => markedAsReadRef.current.add(msg.id));

        // Chamar o backend apenas para a última
        markMessageAsRead(lastUnreadMsg.id);
      }
    }, 1500); // Aguardar 1.5s após o carregamento das mensagens

    return () => {
      clearTimeout(timeoutId);
    };
  }, [conversation?.id, messages.length, user?.id]);

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowResolverDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Monitorar status dos usuários via WebSocket (tempo real)
  useEffect(() => {
    if (!showTransferDropdown || !agents.length) return;

    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) return;

    const wsUrl = buildWebSocketUrl('/ws/user_status/', { token });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Buscar status inicial via API apenas uma vez
      axios.get('/api/users/status/', {
        headers: { Authorization: `Token ${token}` }
      }).then(response => {
        if (response.data && response.data.users) {
          const statusUpdates = {};
          response.data.users.forEach(user => {
            statusUpdates[user.id] = user.is_online;
          });
          setAgentsStatus(prev => ({ ...prev, ...statusUpdates }));
        }
      }).catch(() => { });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'user_status_update' && data.user_id) {
          setAgentsStatus(prev => ({
            ...prev,
            [data.user_id]: data.is_online
          }));
        }
      } catch (_) { }
    };

    ws.onerror = () => { };
    ws.onclose = () => {
      // Reconectar após 5 segundos se ainda precisar
      if (showTransferDropdown) {
        setTimeout(() => {
          if (showTransferDropdown) {
            ws.close();
          }
        }, 5000);
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [showTransferDropdown, agents]);

  //  WebSocket CORRIGIDO - Melhor controle de duplicatas
  useEffect(() => {
    if (!conversation || !conversation.id) return;

    // Validar se a conversa existe antes de conectar
    const validateConversation = async () => {
      try {
        // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        if (!token) return true; // Permitir tentar mesmo sem token (será bloqueado pelo WebSocket)

        const response = await axios.get(`/api/conversations/${conversation.id}/`, {
          headers: { Authorization: `Token ${token}` }
        });

        return response.status === 200;
      } catch (error) {
        // Se for 404 ou 403, a conversa pode não existir ou sem permissão
        // Mas não fechar imediatamente - deixar o WebSocket tentar conectar primeiro
        // Se o WebSocket também falhar, aí sim fechar
        if (error.response?.status === 404 || error.response?.status === 403) {
          // Retornar false mas NÃO fechar ainda - deixar o WebSocket tentar
          return false;
        }
        // Para outros erros (rede, timeout, etc), permitir tentar conectar
        return true;
      }
    };

    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    let shouldReconnect = true;
    let reconnectTimeout = null;

    const connectWebSocket = async () => {
      // OTIMIZAÇÃO: Não fazer GET de validação antes de conectar
      // O WebSocket vai falhar naturalmente se a conversa não existir
      // Isso evita chamadas HTTP desnecessárias

      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;

      // Fechar conexão anterior se existir
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
      }

      const wsUrl = buildWebSocketUrl(`/ws/conversations/${conversation.id}/`, { token });
      const ws = new window.WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // WebSocket conectado - resetar tentativas
        reconnectAttempts = 0;
        shouldReconnect = true;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // WebSocket recebeu dados

          if (data.type === 'message' || data.type === 'chat_message' || data.type === 'message_created' || data.type === 'message_received') {
            if (data.message) {
              // Atualizar nome do contato se vier no payload da mensagem
              if (data.message.contact_name && data.message.contact_name.trim()) {
                setContactName(data.message.contact_name.trim());
                // Notificar componente pai sobre atualização (se necessário)
                if (onConversationUpdate && conversation.contact) {
                  const updatedConversation = {
                    ...conversation,
                    contact: {
                      ...conversation.contact,
                      name: data.message.contact_name.trim()
                    }
                  };
                  onConversationUpdate(updatedConversation);
                }
              }

              setMessages(currentMessages => {
                //  Verificação mais robusta de duplicatas
                const messageExists = currentMessages.some(m => m.id === data.message.id);

                if (!messageExists) {
                  let processedContent = processMessageContent(data.message.content, data.message.is_from_customer);

                  //  Remover assinatura do agente se presente (WebSocket)
                  if (processedContent && processedContent.match(/\*.*disse:\*\n/) && !data.message.is_from_customer) {
                    processedContent = processedContent.replace(/\*.*disse:\*\n/, '');
                  }

                  // CORREÇÃO: Identificar mensagens da IA de forma mais robusta
                  const isFromAI = data.message.from_ai === true ||
                    data.message.additional_attributes?.from_ai === true ||
                    data.message.sender?.sender_type === 'ai' ||
                    data.sender === 'ai';

                  const processedMessage = {
                    ...data.message,
                    content: processedContent,
                    // Garantir que mensagens da IA sejam identificadas corretamente
                    sender: data.message.sender || (isFromAI ? { sender_type: 'ai' } : { sender_type: 'agent' }),
                    from_ai: isFromAI  // CORREÇÃO: Usar verificação robusta
                  };

                  // Se a mensagem é do cliente e é WhatsApp, reabrir a janela de 24 horas
                  if (processedMessage.is_from_customer && (conversation?.inbox?.channel_type === 'whatsapp' || conversation?.inbox?.channel_type === 'whatsapp_oficial')) {
                    // Se a conversa atualizada foi enviada no evento, usar os dados dela
                    if (data.conversation) {
                      const updatedConversation = data.conversation;

                      // Atualizar a conversa no componente pai se callback disponível
                      if (onConversationUpdate) {
                        onConversationUpdate(updatedConversation);
                      }

                      // Atualizar status da janela de 24 horas
                      if (updatedConversation.is_24h_window_open !== undefined) {
                        setIs24hWindowOpen(updatedConversation.is_24h_window_open);
                      } else {
                        // Se não veio do backend, assumir fechada para segurança
                        // O backend sempre deve retornar is_24h_window_open calculado corretamente
                        setIs24hWindowOpen(false);
                      }
                    } else {
                      // Se não veio a conversa no evento, buscar do backend para garantir dados atualizados
                      const fetchUpdatedConversation = async () => {
                        try {
                          const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
                          const response = await axios.get(`/api/conversations/${conversation.id}/`, {
                            headers: { Authorization: `Token ${token}` }
                          });

                          if (response.data) {
                            const updatedConversation = response.data;
                            if (onConversationUpdate) {
                              onConversationUpdate(updatedConversation);
                            }

                            // Atualizar status da janela
                            // Sempre usar o valor calculado pelo backend
                            if (updatedConversation.is_24h_window_open !== undefined) {
                              setIs24hWindowOpen(updatedConversation.is_24h_window_open);
                            } else {
                              // Se não veio do backend, assumir fechada para segurança
                              setIs24hWindowOpen(false);
                            }
                          }
                        } catch (error) {
                          console.error('Erro ao buscar conversa atualizada:', error);
                          // Fallback: assumir que está aberta quando cliente envia mensagem
                          setIs24hWindowOpen(true);
                        }
                      };

                      // Buscar conversa atualizada do backend
                      fetchUpdatedConversation();
                    }
                    setError(''); // Limpar erro se houver
                  }

                  //  Remover das mensagens pendentes se existir
                  setPendingMessages(prev => {
                    const newSet = new Set(prev);
                    // Remover a mensagem original (sem assinatura) das pendentes
                    const originalContent = processedMessage.content.replace(/\*.*disse:\*\n/, '');
                    newSet.delete(originalContent);
                    return newSet;
                  });

                  //  Remover mensagens temporárias relacionadas
                  const filteredMessages = currentMessages.filter(m => {
                    // Remover mensagens temporárias com conteúdo similar
                    if (m.isTemporary || m.is_sending) {
                      const originalContent = processedMessage.content.replace(/\*.*disse:\*\n/, '');
                      return !(m.content === originalContent &&
                        m.is_from_customer === processedMessage.is_from_customer);
                    }
                    return true;
                  });

                  return [...filteredMessages, processedMessage].sort((a, b) =>
                    new Date(a.created_at) - new Date(b.created_at)
                  );
                }
                return currentMessages;
              });
            }
          }

          // Atualização de reação em tempo real (via webhook)
          if (data.type === 'message_updated' && data.action === 'reaction_updated') {
            // Quando a reação vem do cliente via webhook, atualizar apenas a mensagem específica
            // Evitar recarregar toda a lista para não causar polling desnecessário
            if (data.message_id && data.reaction) {
              setMessages(currentMessages =>
                currentMessages.map(msg =>
                  msg.id === data.message_id
                    ? { ...msg, reaction: data.reaction }
                    : msg
                )
              );
            }
          }

          // Handler para eventos de reação via WebSocket
          if (data.type === 'message_reaction' && data.message_id && data.reaction) {
            setMessages(currentMessages =>
              currentMessages.map(msg => {
                if (msg.id === data.message_id) {
                  // Atualizar o campo reactions (array) do backend
                  const existingReactions = msg.reactions || [];
                  const reactionExists = existingReactions.some(r =>
                    r.id === data.reaction.id ||
                    (r.emoji === data.reaction.emoji && r.is_from_customer === data.reaction.is_from_customer)
                  );

                  if (!reactionExists) {
                    // Adicionar nova reação ao array
                    return {
                      ...msg,
                      reactions: [...existingReactions, data.reaction]
                    };
                  } else {
                    // Atualizar reação existente
                    return {
                      ...msg,
                      reactions: existingReactions.map(r =>
                        (r.id === data.reaction.id ||
                          (r.emoji === data.reaction.emoji && r.is_from_customer === data.reaction.is_from_customer))
                          ? data.reaction
                          : r
                      )
                    };
                  }
                }
                return msg;
              })
            );
          }

          // Atualização de status de mensagem (sent, delivered, read)
          if (data.type === 'message_status_update' && data.message_id && data.status) {
            setMessages(currentMessages =>
              currentMessages.map(msg => {
                if (msg.id === data.message_id) {
                  // Atualizar additional_attributes com o novo status
                  const updatedAttrs = {
                    ...(msg.additional_attributes || {}),
                    last_status: data.status,
                    last_status_timestamp: data.timestamp
                  };

                  // Adicionar campos específicos por status
                  if (data.status === 'read') {
                    updatedAttrs.read_at = data.timestamp;
                    updatedAttrs.read_by = data.recipient_id;
                  } else if (data.status === 'delivered') {
                    updatedAttrs.delivered_at = data.timestamp;
                  } else if (data.status === 'sent') {
                    updatedAttrs.sent_at = data.timestamp;
                  }

                  // Atualizar histórico de status
                  const statusHistory = updatedAttrs.status_history || [];
                  statusHistory.push({
                    status: data.status,
                    timestamp: data.timestamp,
                    recipient_id: data.recipient_id
                  });
                  updatedAttrs.status_history = statusHistory;

                  return {
                    ...msg,
                    additional_attributes: updatedAttrs
                  };
                }
                return msg;
              })
            );
          }

          if (data.type === 'conversation_updated') {
            // Conversa atualizada via WebSocket
            const updatedConversation = data.conversation || conversation;

            // Atualizar status da janela de 24 horas se a conversa foi atualizada
            if (updatedConversation) {
              const channelType = updatedConversation.inbox?.channel_type;
              if (channelType === 'whatsapp' || channelType === 'whatsapp_oficial') {
                // Sempre usar o valor calculado pelo backend
                if (updatedConversation.is_24h_window_open !== undefined) {
                  setIs24hWindowOpen(updatedConversation.is_24h_window_open);
                } else {
                  // Se não veio do backend, assumir fechada para segurança
                  setIs24hWindowOpen(false);
                }
              } else {
                // Para outros canais, janela sempre aberta
                setIs24hWindowOpen(true);
              }
            }

            if (onConversationUpdate) {
              onConversationUpdate(updatedConversation);
            }
          }

          // Listener para eventos de encerramento de conversa
          if (data.type === 'conversation_event') {
            // Evento de conversa recebido

            if (data.event_type === 'conversation_closed' || data.event_type === 'conversation_ended') {
              // Verificar se a conversa atual realmente está fechada antes de fechar a interface
              // Só fechar se a conversa atual for a mesma que foi fechada E se ela realmente estiver fechada
              if (data.conversation_id === conversation.id) {
                // Verificar status atual da conversa antes de fechar
                // Se a conversa já estava fechada quando foi aberta, não fechar novamente
                const currentStatus = conversation.status;

                // Só fechar se a conversa estava aberta e agora foi fechada
                if (currentStatus && currentStatus !== 'closed' && currentStatus !== 'ended') {
                  // Conversa encerrada via WebSocket

                  // Atualizar estado da conversa
                  if (onConversationUpdate) {
                    onConversationUpdate({
                      ...conversation,
                      status: 'closed',
                      closed_at: data.timestamp
                    });
                  }

                  // Notificar usuário e fechar a interface
                  if (onConversationClose) {
                    onConversationClose();
                  }
                } else {
                  // Apenas atualizar o status sem fechar a interface
                  if (onConversationUpdate) {
                    onConversationUpdate({
                      ...conversation,
                      status: data.data?.status || 'closed',
                      closed_at: data.timestamp
                    });
                  }
                }
              }

              // Manter histórico de mensagens; apenas atualiza status
            }

            // Listener para atribuição de conversa
            if (data.event_type === 'conversation_assigned') {
              // Conversa atribuída via WebSocket

              if (onConversationUpdate) {
                onConversationUpdate({
                  ...conversation,
                  assignee_id: data.data.assignee_id
                });
              }
            }

            // Listener para mudanças de provedor (isolamento multi-tenant)
            if (data.event_type === 'provedor_changed') {
              // Mudança de provedor detectada via WebSocket

              // Verificar se a conversa atual pertence ao provedor correto
              if (data.data.provedor_id !== conversation?.contact?.provedor?.id) {
                // Conversa não pertence ao provedor atual, redirecionando

                // Redirecionar para lista de conversas
                if (onConversationClose) {
                  onConversationClose();
                }

                // Manter histórico de mensagens; apenas fecha a conversa
              }
            }
          }

        } catch (error) {
          // CORREÇÃO DE SEGURANÇA: Não expor detalhes do erro
          // Silenciar erro para não expor informações sensíveis
        }
      };

      ws.onerror = (error) => {
        // CORREÇÃO DE SEGURANÇA: Não expor token em logs
        // O erro pode conter a URL com token, mas não vamos logá-la
      };

      ws.onclose = async (event) => {
        // Códigos de erro que indicam que a conversa não existe ou sem permissão
        // 4001 = Unauthorized, 4003 = Forbidden, 4000 = Internal error (quando conversa não existe)
        const conversationNotFoundCodes = [4001, 4003, 4000];

        // Se o código indica que a conversa não existe ou sem permissão, validar antes de parar
        if (conversationNotFoundCodes.includes(event.code)) {
          // Validar se a conversa realmente não existe
          const isValid = await validateConversation();
          if (!isValid) {
            // Se a validação falhou E o WebSocket também falhou, aí sim limpar
            // Mas verificar mais uma vez para ter certeza
            try {
              // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
              const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
              if (token && conversation && conversation.id) {
                const response = await axios.get(`/api/conversations/${conversation.id}/`, {
                  headers: { Authorization: `Token ${token}` },
                  timeout: 5000 // Timeout curto
                });
                if (response.status === 200) {
                  // Conversa existe, continuar tentando reconectar
                  return;
                }
              }
            } catch {
              // Se até agora falhou, realmente não existe ou sem permissão
              // Limpar conversa inválida do localStorage
              localStorage.removeItem('selectedConversation');
              // Notificar componente pai para limpar seleção
              if (onConversationClose) {
                onConversationClose();
              }
              shouldReconnect = false;
              reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
              return;
            }
          }
          // Se a conversa existe mas deu erro de permissão no WebSocket, também parar
          if (event.code === 4001 || event.code === 4003) {
            shouldReconnect = false;
            reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
            return;
          }
        }

        // WebSocket desconectado - tentar reconectar apenas se:
        // 1. Ainda deve reconectar
        // 2. Não excedeu o limite de tentativas
        // 3. A conversa ainda está selecionada
        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && conversation && conversation.id) {
          reconnectAttempts++;
          reconnectTimeout = setTimeout(() => {
            if (shouldReconnect && conversation && conversation.id) {
              connectWebSocket();
            }
          }, 3000);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          // Excedeu tentativas - parar de tentar
          shouldReconnect = false;
        }
      };
    };

    connectWebSocket();

    return () => {
      // Parar tentativas de reconexão
      shouldReconnect = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      // Fechando WebSocket
      if (wsRef.current) {
        if (wsRef.current.heartbeatInterval) {
          clearInterval(wsRef.current.heartbeatInterval);
        }
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close(1000);
        }
        wsRef.current = null;
      }
    };
  }, [conversation, onConversationClose]);

  //  LIMPEZA AUTOMÁTICA DE MENSAGENS TEMPORÁRIAS
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      setMessages(currentMessages => {
        const now = Date.now();
        return currentMessages.filter(msg => {
          if (msg.isTemporary || msg.is_sending) {
            const messageAge = now - new Date(msg.created_at).getTime();
            return messageAge <= 15000; // Manter por no máximo 15 segundos
          }
          return true;
        });
      });
    }, 5000); // Executar a cada 5 segundos

    return () => {
      clearInterval(cleanupInterval);
    };
  }, [conversation]);

  // Status da conversa é monitorado via WebSocket do painel (tempo real)
  // Não é necessário polling - o WebSocket já envia conversation_event quando há mudanças

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScrollContainer = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80; // px de tolerância para considerar "no fundo"
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= threshold;
    setShouldAutoScroll(atBottom);
  };

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, shouldAutoScroll]);

  //  handleSendMessage CORRIGIDO - SEM mensagem temporária
  const handleCorrectText = async () => {
    if (!message.trim() || isCorrecting) return;

    try {
      setIsCorrecting(true);
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

      const res = await axios.post('/api/text/correct/', {
        text: message,
        language: 'pt-BR'
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      if (res.data?.success && res.data?.corrected_text) {
        setMessage(res.data.corrected_text);

        // Ajustar altura da textarea após a correção
        setTimeout(() => {
          const textarea = document.getElementById('message-input');
          if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
          }
        }, 50);
      }
    } catch (err) {
      console.error('Erro ao corrigir texto:', err);
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !conversation) return;

    // Verificar se a janela de 24 horas está aberta para WhatsApp
    // Se is24hWindowOpen for null, ainda não foi carregado do backend, então permitir
    if (is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp') {
      setError('⚠️ Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.');
      return;
    }

    setError('');
    // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    //  Marcar mensagem como pendente para evitar duplicatas
    const messageKey = message.trim();
    if (pendingMessages.has(messageKey)) {
      // Mensagem já está sendo enviada, ignorando
      return;
    }

    setPendingMessages(prev => new Set(prev).add(messageKey));

    try {
      // Buscar informações do usuário atual para adicionar assinatura
      const userResponse = await axios.get('/api/auth/me/', {
        headers: { Authorization: `Token ${token}` }
      });

      const currentUser = userResponse.data;
      const userName = currentUser.first_name || currentUser.username || 'Usuário';

      // Formatar mensagem com nome do usuário para enviar ao WhatsApp
      const formattedMessage = `*${userName} disse:*\n${message}`;

      //  NÃO adicionar mensagem temporária - deixar o WebSocket fazer isso

      // Preparar payload para envio
      const payload = {
        conversation_id: conversation.id,
        content: formattedMessage
      };

      // Adicionar informações de resposta se estiver respondendo a uma mensagem
      if (replyingToMessage) {
        const replyId = replyingToMessage.external_id || replyingToMessage.additional_attributes?.external_id || replyingToMessage.id;
        payload.reply_to_message_id = replyId;
        payload.reply_to_content = replyingToMessage.content;
        // Debug removido
      }

      // Enviar mensagem formatada para o WhatsApp
      const response = await axios.post('/api/messages/send_text/', payload, {
        headers: { Authorization: `Token ${token}` }
      });

      //  Se o WebSocket não funcionar, adicionar mensagem do response
      setTimeout(() => {
        if (pendingMessages.has(messageKey)) {
          // WebSocket não recebeu mensagem, adicionando do response
          if (response.data && response.data.id) {
            const processedMessage = {
              ...response.data,
              content: processMessageContent(response.data.content, response.data.is_from_customer)
            };

            setMessages(currentMessages => {
              const messageExists = currentMessages.some(m => m.id === response.data.id);
              if (!messageExists) {
                return [...currentMessages, processedMessage].sort((a, b) =>
                  new Date(a.created_at) - new Date(b.created_at)
                );
              }
              return currentMessages;
            });
          }

          // Remover das pendentes
          setPendingMessages(prev => {
            const newSet = new Set(prev);
            newSet.delete(messageKey);
            return newSet;
          });
        }
      }, 2000); // Aguardar 2 segundos pelo WebSocket

      setMessage('');
      setReplyingToMessage(null);

    } catch (e) {
      console.error(' Erro ao enviar mensagem:', e);

      // Verificar se é erro de janela de 24 horas fechada
      let errorMessage = 'Erro ao enviar mensagem.';

      if (e.response?.data?.error_message) {
        // Mensagem específica do backend (ex: janela de 24 horas)
        errorMessage = e.response.data.error_message;
      } else if (e.response?.data?.error) {
        // Mensagem de erro genérica do backend
        errorMessage = e.response.data.error;
      } else if (e.response?.data?.detail) {
        // Mensagem de erro detalhada
        errorMessage = e.response.data.detail;
      } else if (e.message) {
        // Mensagem de erro do axios
        errorMessage = e.message;
      }

      // Verificar se é erro de janela de 24 horas (código 131047)
      if (e.response?.data?.error_code === 131047 ||
        errorMessage.includes('24 horas') ||
        errorMessage.includes('janela de atendimento')) {
        errorMessage = '⚠️ ' + errorMessage;
      }

      setError(errorMessage);

      //  Remover das pendentes em caso de erro
      setPendingMessages(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageKey);
        return newSet;
      });
    }
  };

  const handleKeyPress = (e) => {
    if (showQuickReplies) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setQuickReplyIndex(prev => Math.min(prev + 1, filteredQuickReplies.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setQuickReplyIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredQuickReplies.length > 0) {
          selectQuickReply(filteredQuickReplies[quickReplyIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowQuickReplies(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Funções para gravação de áudio
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia não é suportado neste navegador');
      }

      const isSecure = window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.includes('ngrok');

      if (!isSecure) {
        throw new Error('Gravação de áudio requer HTTPS. Use HTTPS ou localhost para gravar áudio.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));

        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Erro ao iniciar gravação:', error);

      if (error.name === 'NotAllowedError') {
        setError('Permissão de microfone negada. Clique no ícone do microfone na barra de endereços para permitir.');
      } else if (error.name === 'NotFoundError') {
        setError('Nenhum microfone encontrado. Verifique se há um microfone conectado.');
      } else if (error.message.includes('getUserMedia não é suportado')) {
        setError('Gravação de áudio não é suportada neste navegador. Tente usar HTTPS ou um navegador mais recente.');
      } else if (error.message.includes('requer HTTPS')) {
        setError('Gravação de áudio requer HTTPS. Use HTTPS ou localhost para gravar áudio.');
      } else if (error.name === 'NotSupportedError') {
        setError('Este navegador não suporta gravação de áudio. Tente usar Chrome, Firefox ou Edge.');
      } else {
        setError('Erro ao acessar microfone. Verifique as permissões ou tente usar HTTPS.');
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioBlob(null);
      setAudioUrl(null);
      setRecordingTime(0);

      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }

      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    }
  };

  const sendAudioMessage = async () => {
    if (!audioBlob || !conversation) return;

    // Verificar se a janela de 24 horas está aberta para WhatsApp
    // Se is24hWindowOpen for null, ainda não foi carregado do backend, então permitir
    if (is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp') {
      setError('⚠️ Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.');
      return;
    }

    if (sendingMedia) {
      // Já está enviando áudio, ignorando
      return;
    }

    try {
      // Iniciando envio de áudio PTT

      const audioFile = new File([audioBlob], `audio_${Date.now()}.webm`, {
        type: 'audio/webm'
      });

      // Dados do áudio

      const maxSize = 16 * 1024 * 1024;
      if (audioFile.size > maxSize) {
        setError('Áudio muito grande. Tamanho máximo: 16MB');
        return;
      }

      if (audioBlob.size === 0) {
        setError('Áudio inválido. Tente gravar novamente.');
        return;
      }

      // Validações passaram, enviando áudio

      const finalMediaType = 'ptt';
      // Usando media_type

      if (finalMediaType !== 'ptt') {
        console.error(' ERRO: media_type não é PTT!');
        setError('Erro interno: tipo de mídia inválido');
        return;
      }

      await handleSendMedia(audioFile, finalMediaType, null);

      // Log removido(' Áudio enviado com sucesso!');

      setAudioBlob(null);
      setAudioUrl(null);
      setRecordingTime(0);

    } catch (error) {
      console.error(' Erro ao enviar áudio:', error);
      setError('Erro ao enviar áudio: ' + error.message);
    }
  };

  const formatRecordingTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const playAudio = (messageId, audioUrl) => {
    // Log removido('🎵 Reproduzindo áudio:', { messageId, audioUrl });

    if (playingAudio && playingAudio !== messageId) {
      const prevAudio = audioRefs.current[playingAudio];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    let audio = audioRefs.current[messageId];
    if (!audio) {
      audio = new Audio(audioUrl);
      audioRefs.current[messageId] = audio;

      audio.addEventListener('timeupdate', () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        setAudioProgress(prev => ({ ...prev, [messageId]: progress }));
      });

      audio.addEventListener('ended', () => {
        setPlayingAudio(null);
        setAudioProgress(prev => ({ ...prev, [messageId]: 0 }));
      });

      audio.addEventListener('error', (e) => {
        console.error('Erro ao reproduzir áudio:', e);
        setPlayingAudio(null);
      });
    }

    audio.play().then(() => {
      setPlayingAudio(messageId);
    }).catch(e => {
      console.error('Erro ao reproduzir áudio:', e);
    });
  };

  const pauseAudio = (messageId) => {
    const audio = audioRefs.current[messageId];
    if (audio) {
      audio.pause();
      setPlayingAudio(null);
    }
  };

  // Cleanup ao desmontar componente
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      Object.values(audioRefs.current).forEach(audio => {
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
      audioRefs.current = {};
    };
  }, [audioUrl]);

  //  handleSendMedia CORRIGIDO - SEM mensagem temporária
  const handleSendMedia = async (file, mediaType, caption = '') => {
    if (!conversation) return;

    // Verificar se a janela de 24 horas está aberta para WhatsApp
    // Se is24hWindowOpen for null, ainda não foi carregado do backend, então permitir
    if (is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp') {
      setError('⚠️ Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.');
      return;
    }

    if (sendingMedia) {
      // Log removido('🚫 Já está enviando mídia, ignorando...');
      return;
    }

    setError('');
    setSendingMedia(true);
    const token = localStorage.getItem('token');

    // Iniciando envio de mídia

    const maxSize = 16 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Arquivo muito grande. Tamanho máximo: 16MB');
      setSendingMedia(false);
      return;
    }

    // Validar tipo de arquivo
    const allowedTypes = {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'],
      audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/webm'],
      ptt: ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
      myaudio: ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
      document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    };

    if (!allowedTypes[mediaType]?.includes(file.type)) {
      console.warn('Tipo de arquivo não reconhecido:', file.type);
    }

    try {
      //  NÃO adicionar mensagem de "enviando..." - deixar o WebSocket fazer isso

      // Buscar informações do usuário atual se houver caption (exceto para PTT)
      let formattedCaption = caption;
      if (caption && mediaType !== 'ptt') {
        const userResponse = await axios.get('/api/auth/me/', {
          headers: { Authorization: `Token ${token}` }
        });

        const currentUser = userResponse.data;
        const userName = currentUser.first_name || currentUser.username || 'Usuário';
        formattedCaption = `*${userName} disse:*\n${caption}`;
      }

      const formData = new FormData();
      formData.append('conversation_id', conversation.id);
      formData.append('media_type', mediaType);
      formData.append('file', file);
      // Para PTT (mensagens de voz), não enviar caption
      if (formattedCaption && mediaType !== 'ptt') {
        formData.append('caption', formattedCaption);
      }

      // Adicionar informações de resposta se estiver respondendo a uma mensagem
      if (replyingToMessage) {
        const replyId = replyingToMessage.external_id || replyingToMessage.additional_attributes?.external_id || replyingToMessage.id;
        formData.append('reply_to_message_id', replyId);
        // Enviando mídia como resposta para mensagem
      }

      // Enviando mídia para o backend

      // Enviar mídia com caption formatado para o WhatsApp
      const response = await axios.post('/api/messages/send_media/', formData, {
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      // Log removido(' Mídia enviada com sucesso:', response.data);

      //  Se o WebSocket não funcionar, adicionar mensagem do response
      setTimeout(() => {
        if (response.data && response.data.id) {
          setMessages(currentMessages => {
            const messageExists = currentMessages.some(m => m.id === response.data.id);
            if (!messageExists) {
              // Log removido('WebSocket não recebeu mídia, adicionando do response');
              return [...currentMessages, response.data].sort((a, b) =>
                new Date(a.created_at) - new Date(b.created_at)
              );
            }
            return currentMessages;
          });
        }
      }, 2000); // Aguardar 2 segundos pelo WebSocket

    } catch (e) {
      console.error(' Erro ao enviar mídia:', e);
      console.error(' Detalhes do erro:', e.response?.data);

      // Verificar se é erro de janela de 24 horas fechada
      let errorMessage = 'Erro ao enviar mídia.';

      if (e.response?.data?.error_message) {
        // Mensagem específica do backend (ex: janela de 24 horas)
        errorMessage = e.response.data.error_message;
      } else if (e.response?.data?.error) {
        // Mensagem de erro genérica do backend
        errorMessage = e.response.data.error;
      } else if (e.response?.data?.detail) {
        // Mensagem de erro detalhada
        errorMessage = e.response.data.detail;
      } else if (e.message) {
        // Mensagem de erro do axios
        errorMessage = e.message;
      }

      // Verificar se é erro de janela de 24 horas (código 131047)
      if (e.response?.data?.error_code === 131047 ||
        errorMessage.includes('24 horas') ||
        errorMessage.includes('janela de atendimento')) {
        errorMessage = '⚠️ ' + errorMessage;
      } else {
        errorMessage = 'Erro ao enviar mídia: ' + errorMessage;
      }

      setError(errorMessage);
    } finally {
      setSendingMedia(false);
    }
  };

  // Função para atribuir conversa para o usuário atual
  const handleAssignToMe = async () => {
    if (!conversation) return;

    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      // Usar o novo endpoint específico para atribuição
      const response = await axios.post(`/api/conversations/${conversation.id}/assign/`, {}, {
        headers: { Authorization: `Token ${token}` }
      });

      // Log removido('Conversa atribuída com sucesso:', response.data);
      setShowResolverDropdown(false);

      // O WebSocket ou o callback onConversationUpdate cuidará da atualização da UI
      if (onConversationUpdate && response.data.conversation) {
        onConversationUpdate(response.data.conversation);
      }
    } catch (error) {
      console.error('Erro ao atribuir conversa:', error);
      console.error('Detalhes do erro:', error.response?.data);
      alert('Erro ao atribuir conversa. Tente novamente.');
    }
  };

  // Função para encerrar conversa
  const handleCloseConversation = async () => {
    if (!conversation) return;

    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    try {
      const response = await axios.patch(`/api/conversations/${conversation.id}/`, {
        status: 'closed'
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // Log removido('Conversa encerrada com sucesso:', response.data);
      setShowResolverDropdown(false);

      // CORREÇÃO: Limpar conversa selecionada do localStorage imediatamente
      localStorage.removeItem('selectedConversation');

      // CORREÇÃO: Notificar atualização com null para limpar seleção
      if (onConversationUpdate) {
        onConversationUpdate(null);
      }

      // Chamar callback para fechar a conversa
      if (onConversationClose) {
        onConversationClose();
      }

      // Fallback: navegar de volta para a lista de conversas
      if (!onConversationClose) {
        const provedorId = conversation.inbox?.provedor?.id || '';
        navigate(`/app/accounts/${provedorId}/conversations`);
      }
    } catch (error) {
      console.error('Erro ao encerrar conversa:', error);
      console.error('Detalhes do erro:', error.response?.data);
      alert('Erro ao encerrar conversa. Tente novamente.');
    }
  };

  // Função para buscar atendentes do provedor
  const fetchAgents = async () => {
    if (!conversation) return;

    const token = localStorage.getItem('token');
    setLoadingAgents(true);

    try {
      // Usar o novo endpoint específico para usuários do provedor
      const response = await axios.get('/api/users/my_provider_users/', {
        headers: { Authorization: `Token ${token}` }
      });

      const agents = response.data.users || [];
      // Log removido('Agentes encontrados:', agents);
      setAgents(agents);

      // Buscar status atual dos usuários
      await fetchUsersStatus(agents, token);

      setShowTransferDropdown(true);
    } catch (error) {
      console.error('Erro ao buscar atendentes:', error);
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  };

  // Função para buscar status atual dos usuários
  const fetchUsersStatus = async (users, token) => {
    try {
      // Buscar status atual dos usuários
      // Log removido('Buscando status dos usuários...');
      const statusResponse = await axios.get('/api/users/status/', {
        headers: { Authorization: `Token ${token}` }
      });

      // Log removido('Resposta do status:', statusResponse.data);

      if (statusResponse.data && statusResponse.data.users) {
        const statusUpdates = {};
        statusResponse.data.users.forEach(user => {
          statusUpdates[user.id] = user.is_online;
        });
        setAgentsStatus(prev => ({ ...prev, ...statusUpdates }));
        // Log removido('Status dos usuários atualizado:', statusUpdates);
      }
    } catch (error) {
      console.error('Erro ao buscar status dos usuários:', error);
      // Se não conseguir buscar status, usar o status do backend
      const statusUpdates = {};
      users.forEach(user => {
        statusUpdates[user.id] = user.is_online;
      });
      setAgentsStatus(prev => ({ ...prev, ...statusUpdates }));
    }
  };

  // Função para atualizar status dos agentes em tempo real
  const updateAgentStatus = (agentId, isOnline) => {
    setAgentsStatus(prev => ({
      ...prev,
      [agentId]: isOnline
    }));
  };

  // Função para transferir conversa
  const handleTransferConversation = async () => {
    setShowResolverDropdown(false);
    await fetchAgents();
  };

  // Função para transferir para um agente específico
  const handleTransferToAgent = async (agentId) => {
    if (!conversation) return;

    const token = localStorage.getItem('token');
    const url = `/api/conversations/${conversation.id}/transfer/`;

    // Log removido(' DEBUG: URL de transferência:', url);
    // Log removido(' DEBUG: Axios baseURL:', axios.defaults.baseURL);
    // Log removido(' DEBUG: URL completa:', axios.defaults.baseURL + url);

    try {
      // Usar o mesmo endpoint do ConversasDashboard
      const response = await axios.post(url, {
        user_id: agentId
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // Log removido('Conversa transferida com sucesso!');
      alert('Transferido com sucesso!');
      setShowTransferDropdown(false);

      // Atualizar a interface em vez de recarregar a página
      if (response.data.success) {
        const updatedConversation = {
          ...conversation,
          status: 'pending',
          assignee: null
        };
        if (onConversationUpdate) {
          onConversationUpdate(updatedConversation);
        }
        setShowTransferDropdown(false);
      }

    } catch (_) {
      alert('Erro ao transferir atendimento.');
    }
  };

  const fetchProfilePicture = async (silent = false) => {
    if (!conversation || !conversation.contact) {
      return;
    }

    setLoadingProfilePic(true);
    const token = localStorage.getItem('token');

    try {
      // Determinar o tipo de integração baseado no canal
      // Para todas as conversas WhatsApp, usar Uazapi (que está funcionando)
      const integrationType = (conversation.inbox?.channel_type === 'whatsapp' ||
        // whatsapp_session é o valor do banco de dados para sessões Uazapi
        conversation.inbox?.channel_type === 'whatsapp_session') ? 'uazapi' : 'evolution';

      // Para Uazapi, usar a instância configurada no provedor
      // Para Evolution, usar a instância do canal
      let instanceName;
      if (integrationType === 'uazapi') {
        // Para Uazapi, usar uma instância padrão ou buscar do provedor
        instanceName = 'teste-niochat'; // Instância padrão da Uazapi
      } else {
        // Para Evolution, usar a instância do canal
        instanceName = conversation.inbox?.settings?.evolution_instance ||
          conversation.inbox?.settings?.instance ||
          conversation.inbox?.name?.replace('WhatsApp ', '');
      }

      // Log removido(` Buscando foto via ${integrationType}, instância: ${instanceName}`);
      // Log removido(` Channel type: ${conversation.inbox?.channel_type}`);

      const response = await axios.post('/api/whatsapp/profile-picture/', {
        phone: conversation.contact.phone,
        instance_name: instanceName,
        integration_type: integrationType
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      if (response.data.success) {
        if (!silent) {
          alert('Foto do perfil atualizada com sucesso! Recarregue a página para ver a mudança.');
        }
      } else {
        if (!silent) {
          alert('Não foi possível obter a foto do perfil: ' + response.data.error);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar foto do perfil:', error);
      if (!silent) {
        alert('Erro ao buscar foto do perfil. Verifique o console para mais detalhes.');
      }
    } finally {
      setLoadingProfilePic(false);
    }
  };

  // Função para enviar reação
  const sendReaction = async (messageId, emoji) => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

      // Chamar endpoint do backend para enviar reação
      const response = await axios.post('/api/messages/react/', {
        message_id: messageId,
        emoji: emoji
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      if (response.data.success) {
        // Log removido('Reação enviada com sucesso');
        setShowReactionPicker(false);
        setSelectedMessageForReaction(null);

        // Log removido(' Processando mensagem após reação...');

        // Atualizar a mensagem localmente com a resposta do backend
        // O backend retorna a reação, não a mensagem completa atualizada
        // Vamos atualizar o campo reactions da mensagem
        if (response.data.reaction) {
          // Atualizar a mensagem localmente adicionando a reação ao array reactions
          setMessages(prevMessages =>
            prevMessages.map(msg => {
              if (msg.id === messageId) {
                const existingReactions = msg.reactions || [];
                const reactionData = {
                  id: response.data.reaction.id,
                  emoji: response.data.reaction.emoji,
                  is_from_customer: false, // Agente está reagindo
                  created_at: new Date().toISOString()
                };

                // Verificar se já existe uma reação com o mesmo emoji do agente
                const existingReactionIndex = existingReactions.findIndex(r =>
                  r.emoji === reactionData.emoji && r.is_from_customer === false
                );

                if (existingReactionIndex >= 0) {
                  // Atualizar reação existente
                  const updatedReactions = [...existingReactions];
                  updatedReactions[existingReactionIndex] = reactionData;
                  return {
                    ...msg,
                    reactions: updatedReactions
                  };
                } else {
                  // Adicionar nova reação
                  return {
                    ...msg,
                    reactions: [...existingReactions, reactionData]
                  };
                }
              }
              return msg;
            })
          );
        }
      } else {
        alert('Erro ao enviar reação: ' + (response.data.error || 'Erro desconhecido'));
      }
    } catch (error) {
      console.error('Erro ao enviar reação:', error);

      let errorMessage = 'Erro ao enviar reação';
      if (error.response?.status === 401) {
        errorMessage = 'Erro de autenticação. Faça login novamente.';
      } else if (error.response?.status === 404) {
        errorMessage = 'Mensagem não encontrada.';
      } else if (error.response?.status === 400) {
        errorMessage = error.response.data?.error || 'Dados inválidos.';
      } else {
        errorMessage = error.response?.data?.error || error.message;
      }

      alert(errorMessage);
    }
  };

  // Função para apagar mensagem
  const deleteMessage = async (messageId) => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      // Log removido(' DEBUG: Tentando excluir mensagem:', messageId);
      // Log removido('DEBUG: Credenciais verificadas');

      // Chamar endpoint do backend para deletar mensagem
      const response = await axios.post('/api/messages/delete_message/', {
        message_id: messageId
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      // Log removido(' DEBUG: Resposta do servidor:', response.status, response.data);

      if (response.data.success) {
        // Log removido('Mensagem apagada com sucesso');
        setShowDeleteConfirm(false);
        setMessageToDelete(null);

        // Atualizar a mensagem localmente com a resposta do backend
        const updatedMessage = response.data.updated_message;

        // Processar o conteúdo da mensagem atualizada
        const processedMessage = {
          ...updatedMessage,
          content: processMessageContent(updatedMessage.content, updatedMessage.is_from_customer)
        };

        // Atualizar no estado local
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? processedMessage : msg
          )
        );
      } else {
        alert('Erro ao apagar mensagem: ' + (response.data.error || 'Erro desconhecido'));
      }
    } catch (error) {
      let errorMessage = 'Erro ao apagar mensagem';
      if (error.response?.status === 401) {
        errorMessage = 'Erro de autenticação. Faça login novamente.';
      } else if (error.response?.status === 404) {
        errorMessage = 'Mensagem não encontrada.';
      } else if (error.response?.status === 400) {
        errorMessage = error.response.data?.error || 'Dados inválidos.';
      } else {
        errorMessage = error.response?.data?.error || error.message;
      }

      alert(errorMessage);
    }
  };

  // Função para abrir seletor de reação
  const openReactionPicker = (message) => {
    setSelectedMessageForReaction(message);
    setShowReactionPicker(true);
  };

  // Função para responder a uma mensagem
  const handleReplyToMessage = (message) => {
    setReplyingToMessage(message);
    // Focar no input de mensagem
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      messageInput.focus();
    }
  };

  // Função para cancelar resposta
  const cancelReply = () => {
    setReplyingToMessage(null);
  };

  // Função para buscar templates do canal (mesma lógica do Integrations.jsx)
  const fetchTemplates = async () => {
    // Verificar se temos os dados necessários
    if (!conversation) {
      setError('Conversa não encontrada');
      return;
    }

    if (!conversation.inbox) {
      setError('Inbox não encontrado');
      return;
    }

    // Verificar se é WhatsApp Oficial
    if (conversation.inbox.channel_type !== 'whatsapp' && conversation.inbox.channel_type !== 'whatsapp_oficial') {
      setError('Templates só estão disponíveis para WhatsApp Oficial');
      return;
    }

    setLoadingTemplates(true);
    setError(''); // Limpar erro anterior
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

      if (!token) {
        setError('Token de autenticação não encontrado');
        setLoadingTemplates(false);
        return;
      }

      // Buscar o canal completo (mesma lógica do Integrations.jsx)
      // Primeiro, tentar usar channel_id se disponível
      let channelId = conversation.inbox.channel_id;

      // Se não tiver channel_id, buscar canais e encontrar o WhatsApp Oficial do provedor
      if (!channelId) {
        console.log('Channel ID não encontrado no inbox, buscando canais...');
        const channelsResponse = await axios.get('/api/canais/', {
          headers: { Authorization: `Token ${token}` }
        });

        const channelsList = Array.isArray(channelsResponse.data)
          ? channelsResponse.data
          : channelsResponse.data.results || [];

        // Buscar canal WhatsApp Oficial do mesmo provedor
        const provedorId = conversation.inbox?.provedor?.id;
        const whatsappOficial = channelsList.find(c =>
          c.tipo === 'whatsapp_oficial' &&
          (!provedorId || c.provedor === provedorId || c.provedor?.id === provedorId)
        );

        if (whatsappOficial) {
          channelId = whatsappOficial.id;
          console.log('Canal WhatsApp Oficial encontrado:', channelId);
        } else {
          setError('Canal WhatsApp Oficial não encontrado. Verifique se o canal está configurado corretamente.');
          setLoadingTemplates(false);
          return;
        }
      }

      console.log('Buscando templates para canal:', channelId);

      // Buscar templates (mesma lógica do Integrations.jsx loadTemplates)
      const response = await axios.get(`/api/canais/${channelId}/message-templates/`, {
        headers: { Authorization: `Token ${token}` }
      });

      console.log('Resposta da API de templates:', response.data);

      if (response.data && response.data.success) {
        if (response.data.templates && response.data.templates.length > 0) {
          setTemplates(response.data.templates);
          setError(''); // Limpar erro se houver sucesso
        } else {
          setTemplates([]);
          setError(''); // Não é erro, apenas não há templates
        }
      } else {
        setTemplates([]);
        setError(response.data?.error || 'Erro ao buscar templates');
      }
    } catch (error) {
      console.error('Erro ao buscar templates:', error);
      console.error('Detalhes do erro:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      let errorMessage = 'Erro ao carregar templates';
      if (error.response?.status === 404) {
        errorMessage = 'Canal não encontrado. Verifique se o canal está configurado corretamente.';
      } else if (error.response?.status === 401) {
        errorMessage = 'Erro de autenticação. Faça login novamente.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = error.message || 'Erro desconhecido';
      }

      setError(errorMessage);
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Função para abrir modal de templates
  const openTemplatesModal = () => {
    setShowTemplatesModal(true);
    fetchTemplates();
  };

  // Função para enviar template
  const sendTemplate = async (template) => {
    if (!conversation?.contact?.phone) {
      setError('Número de telefone do contato não encontrado');
      return;
    }

    setSendingTemplate(true);
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

      const response = await axios.post('/api/conversations/start-with-template/', {
        phone: conversation.contact.phone,
        template_name: template.name,
        template_language: template.language || 'pt_BR',
        template_components: [], // Pode ser expandido para suportar variáveis
        provedor_id: conversation.inbox?.provedor?.id,
        canal_id: conversation.inbox?.channel_id,
        conversation_id: conversation.id // Enviar ID da conversa atual para usar a mesma conversa
      }, {
        headers: { Authorization: `Token ${token}` }
      });

      if (response.data.success) {
        setShowTemplatesModal(false);
        setError('');

        // Se a resposta retornou uma conversa diferente, atualizar para ela
        if (response.data.conversation && response.data.conversation.id !== conversation.id) {
          // Nova conversa foi criada, atualizar para ela
          if (onConversationUpdate) {
            onConversationUpdate(response.data.conversation);
          }
        } else {
          // Mesma conversa, apenas atualizar status da janela e recarregar mensagens
          setIs24hWindowOpen(true);
          // Aguardar um pouco antes de recarregar para dar tempo do backend criar a mensagem
          setTimeout(() => {
            fetchMessages();
          }, 500);
        }
      } else {
        setError('Erro ao enviar template: ' + (response.data.error || 'Erro desconhecido'));
      }
    } catch (error) {
      console.error('Erro ao enviar template:', error);
      setError('Erro ao enviar template: ' + (error.response?.data?.error || error.message));
    } finally {
      setSendingTemplate(false);
    }
  };

  // Função para confirmar exclusão
  const confirmDelete = (message) => {
    setMessageToDelete(message);
    setShowDeleteConfirm(true);
  };

  // Função para determinar se uma mensagem é grande (estilo WhatsApp)
  const isLargeMessage = (content) => {
    if (!content) return false;

    // Considerar mensagem grande se:
    // 1. Tem mais de 100 caracteres
    // 2. Tem mais de 3 linhas
    // 3. Contém quebras de linha
    const charCount = content.length;
    const lineCount = content.split('\n').length;
    const hasLineBreaks = content.includes('\n');

    return charCount > 100 || lineCount > 3 || hasLineBreaks;
  };

  // Função para determinar o alinhamento da mensagem
  const getMessageAlignment = (msg, content) => {
    const isCustomer = msg.is_from_customer;

    // TODAS as mensagens do sistema (IA ou atendente) ficam do lado direito
    if (!isCustomer) {
      return 'justify-end';
    }

    // Mensagens do cliente ficam do lado esquerdo
    return 'justify-start';
  };

  // Função para determinar a ordem da mensagem
  const getMessageOrder = (msg, content) => {
    const isCustomer = msg.is_from_customer;

    // TODAS as mensagens do sistema (IA ou atendente) usam ordem 2 (direita)
    if (!isCustomer) {
      return 'order-2';
    }

    // Mensagens do cliente usam ordem 1 (esquerda)
    return 'order-1';
  };

  //  USAR LIMPEZA DE DUPLICATAS NO RENDER
  const uniqueMessages = cleanDuplicateMessages(messages);

  // Filtrar mensagens apenas para atendentes se o usuário atual for cliente
  // Se user não existe ou não é admin/agent, considerar como cliente
  const isViewingAsAgent = user && (user.user_type === 'superadmin' || user.user_type === 'admin' || user.user_type === 'agent');
  const filteredMessages = isViewingAsAgent
    ? uniqueMessages
    : uniqueMessages.filter(msg => !msg.additional_attributes?.apenas_atendentes);

  // Limpeza de duplicatas funcionando corretamente

  // Função para lidar com upload de arquivo
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Verificar se a janela de 24 horas está aberta para WhatsApp
    // Se is24hWindowOpen for null, ainda não foi carregado do backend, então permitir
    if (is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp') {
      setError('⚠️ Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.');
      event.target.value = ''; // Limpar input
      return;
    }

    // Determinar tipo de mídia baseado no tipo do arquivo
    let mediaType = 'document'; // Padrão

    if (file.type.startsWith('image/')) {
      mediaType = 'image';
    } else if (file.type.startsWith('video/')) {
      mediaType = 'video';
    } else if (file.type.startsWith('audio/')) {
      mediaType = 'audio';
    }

    // Enviar arquivo
    handleSendMedia(file, mediaType);

    // Limpar input
    event.target.value = '';
  };

  // Função para abrir modal de imagem
  const openImageModal = (imageUrl) => {
    setSelectedImage(imageUrl);
    setShowImageModal(true);
  };

  // Função para renderizar mensagem com links clicáveis
  const renderMessageWithLinks = (text) => {
    if (!text || typeof text !== 'string') return text;

    // Regex melhorada para detectar URLs completas
    // Detecta: https://, http://, www., e domínios com protocolo
    // Suporta URLs longas com query strings, fragmentos, etc.
    // Padrão: protocolo://domínio/caminho?query#fragmento
    // Captura qualquer caractere válido em URL até encontrar espaço, quebra de linha ou pontuação final
    const urlRegex = /(https?:\/\/[^\s\n<>"']+|www\.[^\s\n<>"']+)/gi;

    // Dividir o texto em partes (texto e URLs)
    const parts = [];
    let lastIndex = 0;
    let match;

    // Resetar regex para garantir que funciona corretamente
    urlRegex.lastIndex = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      // Adicionar texto antes da URL
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }

      // Adicionar a URL (remover caracteres inválidos no final se houver)
      let urlContent = match[0];
      // Remover pontuação final comum que não faz parte da URL
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

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0 min-h-0 overflow-hidden">
      {/* Header da conversa */}
      <div className="border-b border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative">
              {conversation.contact?.avatar ? (
                <img
                  src={(() => {
                    const avatar = conversation.contact.avatar;
                    // Se avatar for apenas um número ou não for uma URL válida, usar fallback
                    if (!avatar || /^\d+$/.test(avatar) || (!avatar.startsWith('http://') && !avatar.startsWith('https://') && !avatar.startsWith('data:') && !avatar.startsWith('/'))) {
                      return `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.contact.name || conversation.contact.phone || 'U')}&background=random`;
                    }
                    return avatar;
                  })()}
                  alt={conversation.contact.name || 'Avatar'}
                  className="w-10 h-10 rounded-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <div
                className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm ${conversation.contact?.avatar ? 'hidden' : 'flex'}`}
              >
                {(conversation.contact?.name || conversation.contact?.phone || 'U').charAt(0).toUpperCase()}
              </div>
            </div>

            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h3 className="font-medium text-foreground">
                  {(() => {
                    // SEMPRE priorizar nome do contato quando disponível
                    // Usar estado local (pode ser atualizado via WebSocket) ou nome da prop
                    const displayName = (contactName && contactName.trim()) || conversation.contact?.name?.trim();
                    const contactPhone = conversation.contact?.phone;

                    // Se tem nome válido (mesmo que seja igual ao telefone), usar o nome
                    if (displayName && displayName.length > 0) {
                      return displayName;
                    }

                    // Caso contrário, exibir telefone
                    return contactPhone || 'Contato sem nome';
                  })()}
                </h3>
                <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                  {getChannelIcon(conversation.inbox?.channel_type)}
                  <span className="capitalize">
                    {conversation.inbox?.channel_type === 'whatsapp' ? 'WhatsApp' :
                      conversation.inbox?.channel_type === 'telegram' ? 'Telegram' :
                        conversation.inbox?.channel_type === 'email' ? 'Email' :
                          conversation.inbox?.channel_type === 'instagram' ? 'Instagram' :
                            conversation.inbox?.channel_type === 'webchat' ? 'Web Chat' :
                              conversation.inbox?.channel_type || 'Chat'}
                  </span>
                </div>
              </div>
              {conversation.contact?.phone && (
                <p className="text-sm text-muted-foreground">
                  {(() => {
                    // Exibir telefone sempre que disponível
                    const contactName = conversation.contact?.name?.trim();
                    const contactPhone = conversation.contact?.phone;

                    // Exibir telefone sempre (é útil para identificar o contato)
                    return contactPhone;
                  })()}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Botão para buscar foto do perfil */}
            {conversation.inbox?.channel_type === 'whatsapp' && (
              <button
                onClick={() => fetchProfilePicture(false)}
                disabled={loadingProfilePic}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
                title="Atualizar foto do perfil"
              >
                {loadingProfilePic ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <User className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Dropdown de ações */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowResolverDropdown(!showResolverDropdown)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                title="Ações da conversa"
              >
                <ChevronDown className="w-4 h-4" />
              </button>

              {showResolverDropdown && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                  <button
                    onClick={handleAssignToMe}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center space-x-2"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>Atribuir para mim</span>
                  </button>
                  <button
                    onClick={handleTransferConversation}
                    disabled={loadingAgents}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center space-x-2 disabled:opacity-50"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    <span>{loadingAgents ? 'Carregando...' : 'Transferir'}</span>
                  </button>
                  <button
                    onClick={handleCloseConversation}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center space-x-2 text-red-600"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Encerrar conversa</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lista de mensagens */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScrollContainer}
        className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 dark:bg-background bg-[#efeae2]"
        style={{
          minHeight: '200px',
          // Tema de fundo estilo WhatsApp (imagem enviada)
          backgroundImage: `url(${isDarkTheme ? chatBgPattern : chatBgPatternLight})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          opacity: 1
        }}
      >
        {/* Conteúdo das mensagens */}
        <div className="relative space-y-4">
          {loading && (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          {error && (
            <div className={`text-center p-3 rounded-lg mb-2 ${error.includes('24 horas') || error.includes('janela de atendimento') || error.includes('⚠️')
              ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800'
              : 'text-red-500 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'
              }`}>
              <div className="font-medium">{error}</div>
            </div>
          )}

          {filteredMessages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Nenhuma mensagem encontrada</p>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const content = msg.content || '';
              const isCustomer = msg.is_from_customer;
              // CORREÇÃO: Identificar mensagens da IA corretamente - verificação mais robusta
              const isAI = !isCustomer && (
                msg.sender?.sender_type === 'ai' ||
                msg.from_ai === true ||
                msg.additional_attributes?.from_ai === true
              );

              const isBot = !isCustomer && !isAI && (msg.message_type === 'incoming' || msg.sender?.sender_type === 'bot');
              const isAgent = !isCustomer && !isBot && !isAI;
              const isSystemMessage = msg.additional_attributes?.system_message || msg.content?.includes('Conversa atribuída para');
              const isResumoSuporte = msg.additional_attributes?.tipo === 'resumo_suporte' || msg.additional_attributes?.apenas_atendentes;
              const isLarge = isLargeMessage(content);

              // Determinar se a mensagem tem mídia
              const hasImage = (msg.attachments && msg.attachments.some(att => att.file_type === 'image')) ||
                (msg.message_type === 'image' && msg.file_url);
              const hasVideo = (msg.attachments && msg.attachments.some(att => att.file_type === 'video')) ||
                (msg.message_type === 'video' && msg.file_url);
              const hasAudio = (msg.attachments && msg.attachments.some(att => att.file_type === 'audio')) ||
                ((msg.message_type === 'audio' || msg.message_type === 'ptt') && msg.file_url);
              const hasDocument = (msg.attachments && msg.attachments.some(att => att.file_type === 'file')) ||
                (msg.message_type === 'document' && msg.file_url);

              // Debug: logar dados da mensagem
              if (msg.message_type === 'image' || (msg.attachments && msg.attachments.some(att => att.file_type === 'image'))) {
                // Debug removido
              }

              return (
                <div key={msg.id} className={`flex ${getMessageAlignment(msg, content)} group mb-4 min-w-0`}>
                  <div className={`max-w-[70%] min-w-0 ${getMessageOrder(msg, content)}`}>
                    <div className={`
                  px-5 py-3 shadow-sm
                  ${isCustomer
                        ? 'bg-[#4A5568] text-white rounded-2xl'  // Mensagens recebidas (cliente)
                        : isResumoSuporte
                          ? 'bg-[#FFF9C4] text-[#856404] rounded-2xl border border-[#FFE69C]'  // Resumo suporte - amarelo fraco
                          : isAI || isBot || isSystemMessage
                            ? 'bg-[#2196F3] text-white rounded-2xl'  // IA / bot / sistema
                            : 'bg-[#2196F3] text-white rounded-2xl'  // Mensagens do agente (envio) - igual ao exemplo
                      }
                `}>
                      {/* Resposta a mensagem anterior */}
                      {msg.additional_attributes?.is_reply && (
                        <div className={`mb-2 p-2 rounded-lg text-xs ${isCustomer ? 'bg-white/30' : 'bg-black/10'} opacity-75`}>
                          <div className="font-medium">{isCustomer ? 'Resposta a:' : 'Respondendo a:'}</div>
                          <div className="truncate">
                            {msg.additional_attributes.reply_to_content || 'Mensagem anterior'}
                          </div>
                        </div>
                      )}

                      {/* Anexos de imagem */}
                      {hasImage && msg.attachments && msg.attachments.filter(att => att.file_type === 'image').map((attachment, index) => (
                        <div key={index} className="mb-2">
                          <img
                            src={attachment.data_url}
                            alt="Imagem"
                            className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => openImageModal(attachment.data_url)}
                            style={{ maxHeight: '300px' }}
                          />

                        </div>
                      ))}

                      {/* Imagens via file_url (WhatsApp/Telegram etc) - só se não tiver attachments */}
                      {hasImage && msg.message_type === 'image' && msg.file_url && !msg.attachments && (
                        <div className="mb-2">
                          <img
                            src={buildMediaUrl(msg.file_url)}
                            alt="Imagem"
                            className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => openImageModal(buildMediaUrl(msg.file_url))}
                            style={{ maxHeight: '300px' }}
                            onError={(e) => {
                              console.error('Erro ao carregar imagem:', msg.file_url);
                              e.target.style.display = 'none';
                            }}
                          />

                        </div>
                      )}

                      {/* Anexos de vídeo */}
                      {hasVideo && msg.attachments && msg.attachments.filter(att => att.file_type === 'video').map((attachment, index) => (
                        <div key={index} className="mb-2">
                          <video
                            controls
                            className="max-w-full h-auto rounded-lg"
                            style={{ maxHeight: '300px' }}
                          >
                            <source src={attachment.data_url} type="video/mp4" />
                            Seu navegador não suporta o elemento de vídeo.
                          </video>

                        </div>
                      ))}

                      {/* Vídeos via file_url - só se não tiver attachments */}
                      {hasVideo && msg.message_type === 'video' && msg.file_url && !msg.attachments && (
                        <div className="mb-2">
                          <video
                            controls
                            className="max-w-full h-auto rounded-lg"
                            style={{ maxHeight: '300px' }}
                            onError={(e) => {
                              console.error('Erro ao carregar vídeo:', msg.file_url);
                            }}
                          >
                            <source src={buildMediaUrl(msg.file_url)} type="video/mp4" />
                            Seu navegador não suporta o elemento de vídeo.
                          </video>

                        </div>
                      )}

                      {/* Anexos de áudio */}
                      {hasAudio && msg.attachments && msg.attachments.filter(att => att.file_type === 'audio').map((attachment, index) => (
                        <div key={index} className="mb-2">
                          <CustomAudioPlayer
                            src={attachment.data_url}
                            isCustomer={isCustomer}
                            conversationId={conversation?.id}
                          />

                        </div>
                      ))}

                      {/* Áudios via file_url (só se não tiver attachments) */}
                      {hasAudio && (msg.message_type === 'audio' || msg.message_type === 'ptt') && msg.file_url && !msg.attachments && (
                        <div className="mb-2">
                          <CustomAudioPlayer
                            src={buildMediaUrl(msg.file_url)}
                            isCustomer={isCustomer}
                            conversationId={conversation?.id}
                          />

                        </div>
                      )}

                      {/* Anexos de documento */}
                      {hasDocument && msg.attachments && msg.attachments.filter(att => att.file_type === 'file').map((attachment, index) => (
                        <div key={index} className="mb-2">
                          <a
                            href={attachment.data_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center space-x-2 p-2 bg-black/10 rounded-lg hover:bg-black/20 transition-colors"
                          >
                            <Paperclip className="w-4 h-4" />
                            <span className="text-sm">{attachment.file_name || 'Documento'}</span>
                          </a>

                        </div>
                      ))}

                      {/* Documentos via file_url - só se não tiver attachments */}
                      {hasDocument && msg.message_type === 'document' && msg.file_url && !msg.attachments && (
                        <div className="mb-2">
                          <FilePreview
                            file={{
                              url: msg.file_url,
                              name: msg.file_name || msg.content || 'Documento',
                              size: msg.file_size,
                              type: msg.additional_attributes?.file_type || 'application/pdf',
                              pages: msg.additional_attributes?.pages,
                              jpegThumbnail: msg.additional_attributes?.pdf_thumbnail,
                              uazapi_url: msg.additional_attributes?.file_url,
                              additional_attributes: msg.additional_attributes
                            }}
                            isCustomer={isCustomer}
                            content={msg.content}
                          />

                        </div>
                      )}

                      {/* QR Codes PIX */}
                      {msg.message_type === 'image' && msg.content && msg.content.includes('QR Code PIX') && (
                        <div className="mb-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                          <div className="text-sm font-medium text-green-900 dark:text-green-100 mb-2">
                            🎯 QR Code PIX
                          </div>
                          <div className="text-xs text-green-700 dark:text-green-300 mb-2">
                            Escaneie este QR code com o app do seu banco para pagar via PIX
                          </div>
                          {msg.file_url && (
                            <div className="bg-white p-2 rounded border">
                              <img
                                src={buildMediaUrl(msg.file_url)}
                                alt="QR Code PIX"
                                className="w-32 h-32 mx-auto"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'block';
                                }}
                              />
                              <div className="hidden text-center text-xs text-gray-500">
                                QR Code PIX (imagem não disponível)
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Links de boleto */}
                      {msg.content && msg.content.includes('🔗') && msg.content.includes('Link do Boleto:') && (
                        <div className="mb-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                          <div className="text-sm font-medium text-orange-900 dark:text-orange-100 mb-2">
                            📄 Boleto Bancário
                          </div>
                          <div className="text-xs text-orange-700 dark:text-orange-300 mb-2">
                            Clique no link abaixo para acessar o boleto completo
                          </div>
                          {msg.content.split('\n').map((line, index) => {
                            if (line.includes('https://')) {
                              return (
                                <a
                                  key={index}
                                  href={line.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block w-full px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm text-center"
                                >
                                  📥 Baixar Boleto PDF
                                </a>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}

                      {/* Botões interativos (como "Copiar Chave PIX") */}
                      {msg.additional_attributes?.has_buttons && msg.additional_attributes?.button_choices && (
                        <div className="mt-3 space-y-2">
                          {msg.additional_attributes.button_choices.map((choice, index) => {
                            const [nome, acao] = choice.split('|', 2);
                            if (acao && acao.startsWith('copy:')) {
                              const textoParaCopiar = acao.replace('copy:', '');
                              return (
                                <button
                                  key={index}
                                  onClick={() => {
                                    navigator.clipboard.writeText(textoParaCopiar);
                                    // Mostrar feedback visual
                                    const btn = event.target;
                                    const originalText = btn.textContent;
                                    btn.textContent = '✅ Copiado!';
                                    btn.className = 'w-full px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 text-sm font-medium';
                                    setTimeout(() => {
                                      btn.textContent = originalText;
                                      btn.className = 'w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-400 hover:from-blue-600 hover:to-blue-500 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 text-sm font-medium';
                                    }, 2000);
                                  }}
                                  className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-400 hover:from-blue-600 hover:to-blue-500 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 text-sm font-medium"
                                >
                                  {nome}
                                </button>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}

                      {/* Lista interativa do chatbot (menu/planos) */}
                      {msg.additional_attributes?.interactive_rows && msg.additional_attributes.interactive_rows.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                            Opções da lista do menu
                          </div>
                          {msg.additional_attributes.interactive_rows.map((row, index) => (
                            <div
                              key={row.id || index}
                              className="px-3 py-2 bg-white/10 dark:bg-slate-700/50 border border-slate-200/20 dark:border-slate-600/30 rounded-lg"
                            >
                              <div className="text-xs font-semibold text-blue-500 dark:text-blue-400">
                                {row.title}
                              </div>
                              {row.description && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  {row.description}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Botões interativos do chatbot */}
                      {msg.additional_attributes?.interactive_buttons && msg.additional_attributes.interactive_buttons.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {msg.additional_attributes.interactive_buttons.map((btn, index) => (
                            <div
                              key={btn.id || index}
                              className="px-3 py-2 bg-blue-500/10 dark:bg-blue-500/20 border border-blue-300/30 dark:border-blue-600/30 rounded-lg text-center"
                            >
                              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                {btn.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Mensagens especiais de fatura */}
                      {content && content.includes('💳') && content.includes('Fatura ID:') && (
                        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                          <div className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                            📋 Detalhes da Fatura
                          </div>
                          <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                            {content.split('\n').map((line, index) => {
                              if (line.includes('Fatura ID:') || line.includes('Vencimento:') || line.includes('Valor:')) {
                                return (
                                  <div key={index} className="flex justify-between">
                                    <span className="font-medium">{line.split(':')[0]}</span>
                                    <span>{line.split(':')[1]}</span>
                                  </div>
                                );
                              }
                              return null;
                            })}
                          </div>
                        </div>
                      )}

                      {/* Conteúdo da mensagem - NÃO mostrar se for mídia pura */}
                      {content && !hasImage && !hasVideo && !hasAudio && !hasDocument && (
                        <div className="whitespace-pre-wrap break-words break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                          {(() => {
                            const displayContent = !isCustomer && content.includes('*') && content.includes('disse:*')
                              ? content.split('\n').slice(1).join('\n').trim() || content
                              : content;
                            return renderMessageWithLinks(displayContent);
                          })()}
                        </div>
                      )}

                      {/* Mostrar apenas a última reação recebida ou enviada */}
                      {msg.reactions && msg.reactions.length > 0 && (() => {
                        // Ordenar reações por data (mais recente primeiro) e pegar apenas a última
                        const sortedReactions = [...msg.reactions].sort((a, b) => {
                          const dateA = new Date(a.created_at || 0);
                          const dateB = new Date(b.created_at || 0);
                          return dateB - dateA;
                        });
                        const lastReaction = sortedReactions[0];

                        return (
                          <div className="mt-2 flex items-center">
                            <div
                              className={`rounded-full px-2 py-1 text-xs flex items-center space-x-1 ${isCustomer
                                ? 'bg-blue-500/20'
                                : 'bg-white/20'
                                }`}
                            >
                              <span>{lastReaction.emoji}</span>
                              <span className="text-xs opacity-75">✓</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Fallback para reações antigas em additional_attributes (compatibilidade) */}
                      {(!msg.reactions || msg.reactions.length === 0) && (
                        ((msg.additional_attributes?.reaction) ||
                          (isCustomer && msg.additional_attributes?.agent_reaction) ||
                          (!isCustomer && msg.additional_attributes?.received_reactions?.[0]?.emoji) ||
                          (isCustomer && msg.additional_attributes?.received_reactions?.[0]?.emoji)) && (
                          <div className="mt-2 flex items-center space-x-1 flex-wrap">
                            {/* Reação existente */}
                            {msg.additional_attributes?.reaction && (
                              <div className="bg-white/20 rounded-full px-2 py-1 text-xs flex items-center space-x-1">
                                <span>{msg.additional_attributes.reaction.emoji}</span>
                                <span className="text-xs opacity-75">
                                  {msg.additional_attributes.reaction.status === 'sent' ? '✓' : '⏳'}
                                </span>
                              </div>
                            )}

                            {/* Reação do agente para mensagens do cliente */}
                            {isCustomer && msg.additional_attributes?.agent_reaction && (
                              <div className="bg-white/20 rounded-full px-2 py-1 text-xs flex items-center space-x-1">
                                <span>{msg.additional_attributes.agent_reaction.emoji}</span>
                                <span className="text-xs opacity-75">✓</span>
                              </div>
                            )}

                            {/* Reação do cliente para mensagens do agente */}
                            {!isCustomer && msg.additional_attributes?.received_reactions?.[0]?.emoji && (
                              <div className="bg-white/20 rounded-full px-2 py-1 text-xs flex items-center space-x-1">
                                <span>{msg.additional_attributes.received_reactions[0].emoji}</span>
                                <span className="text-xs opacity-75">✓</span>
                              </div>
                            )}

                            {/* Reação do cliente nas próprias mensagens */}
                            {isCustomer && msg.additional_attributes?.received_reactions?.[0]?.emoji && (
                              <div className="bg-white/20 rounded-full px-2 py-1 text-xs flex items-center space-x-1">
                                <span>{msg.additional_attributes.received_reactions[0].emoji}</span>
                                <span className="text-xs opacity-75">✓</span>
                              </div>
                            )}
                          </div>
                        )
                      )}

                      {/* Timestamp e ações */}
                      <div className={`flex items-center justify-end mt-1`}>
                        <div className={`flex items-center space-x-2 text-xs ${isCustomer ? 'text-muted-foreground' : 'text-white'}`}>
                          <span>
                            {new Date(msg.created_at || msg.timestamp).toLocaleString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit'
                            })}
                          </span>
                          {msg.isTemporary && (
                            <span className="opacity-60">Enviando...</span>
                          )}
                          {/* Status de leitura para mensagens enviadas pelo agente (apenas WhatsApp) */}
                          {!isCustomer && conversation.inbox?.channel_type === 'whatsapp' &&
                            !msg.isTemporary && (
                              <MessageStatusIcon
                                key={`status-${msg.id}-${msg.additional_attributes?.last_status || 'pending'}`}
                                message={msg}
                              />
                            )}
                        </div>

                        {/* Botões de ação para todas as mensagens (cliente e agente) */}
                        <div className="flex items-center space-x-1 mt-2">
                          <button
                            onClick={() => openReactionPicker(msg)}
                            className={`p-1 hover:bg-white/20 rounded-full text-xs ${isCustomer ? 'hover:bg-black/10' : ''}`}
                            title="Reagir à mensagem"
                          >
                            😊
                          </button>
                          <button
                            onClick={() => handleReplyToMessage(msg)}
                            className={`p-1 hover:bg-white/20 rounded-full text-xs ${isCustomer ? 'hover:bg-black/10' : ''}`}
                            title="Responder mensagem"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 17l-5-5 5-5M20 12H4" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Área de resposta */}
      {replyingToMessage && (
        <div className="border-t border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground mb-1">Respondendo a:</div>
              <div className="text-sm truncate">
                {replyingToMessage.content || 'Mensagem'}
              </div>
            </div>
            <button
              onClick={cancelReply}
              className="p-1 hover:bg-accent rounded"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Preview de áudio gravado */}
      {audioUrl && (
        <div className="border-t border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="text-sm font-medium">Áudio gravado</div>
              <audio controls src={audioUrl} className="h-8" />
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={sendAudioMessage}
                disabled={sendingMedia}
                className="px-3 py-1 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 text-sm"
              >
                {sendingMedia ? 'Enviando...' : 'Enviar'}
              </button>
              <button
                onClick={() => {
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setRecordingTime(0);
                }}
                className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input de mensagem */}
      <div className="border-t border-border p-4 bg-card">
        {/* Botão de templates quando janela fechada */}
        {is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp' && (
          <div className="mb-3">
            <button
              onClick={openTemplatesModal}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50"
              title="Ver templates disponíveis"
            >
              <FileText className="w-5 h-5" />
              <span className="font-medium">Usar Template para Reabrir Conversa</span>
            </button>
          </div>
        )}

        <div className="flex items-center space-x-2">
          {/* Upload de arquivo */}
          <input
            type="file"
            id="file-upload"
            className="hidden"
            onChange={handleFileUpload}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
          />
          <button
            onClick={() => document.getElementById('file-upload').click()}
            disabled={sendingMedia || (is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp')}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
            title={(is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp') ? "Janela de 24 horas fechada" : "Enviar arquivo"}
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Input de texto */}
          <div className="flex-1 relative">
            {is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp' ? (
              <div className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                ⚠️ Mais de 24 horas se passaram desde que o cliente respondeu pela última vez. Para enviar mensagens após este período, é necessário usar um modelo de mensagem (template). O cliente precisa entrar em contato primeiro para reabrir a janela de atendimento.
              </div>
            ) : (
              <div className="relative w-full">
                {showQuickReplies && filteredQuickReplies.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
                    <div className="p-2 border-b border-border bg-muted/50">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Zap className="w-3 h-3" /> Respostas Rápidas
                      </p>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                      {filteredQuickReplies.map((qr, idx) => (
                        <button
                          key={qr.id}
                          onClick={() => selectQuickReply(qr)}
                          className={`w-full text-left p-3 rounded-lg transition-colors flex items-start gap-3 ${idx === quickReplyIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}`}
                          onMouseEnter={() => setQuickReplyIndex(idx)}
                        >
                          <div className={`mt-0.5 flex items-center justify-center flex-shrink-0 ${idx === quickReplyIndex ? 'text-accent-foreground' : 'text-muted-foreground'}`}>
                            <Zap className="w-4 h-4" strokeWidth={2} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate">{qr.titulo}</p>
                            <p className="text-xs opacity-70 line-clamp-1">{qr.conteudo}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  id="message-input"
                  value={message}
                  onChange={handleMessageChange}
                  onKeyPress={handleKeyPress}
                  placeholder="Digite sua mensagem..."
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={1}
                  style={{
                    minHeight: '40px',
                    maxHeight: '120px',
                    height: 'auto'
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                />

                {message.trim().length > 2 && (
                  <button
                    onClick={handleCorrectText}
                    disabled={isCorrecting}
                    title="Corrigir texto com IA"
                    className="absolute right-2 bottom-2 text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-accent disabled:opacity-50"
                  >
                    {isCorrecting ? (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-lg leading-none" style={{ filter: 'grayscale(100%) brightness(1.2)' }}>✨</span>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Botão de gravação/envio */}
          {is24hWindowOpen === false && conversation?.inbox?.channel_type === 'whatsapp' ? (
            <button
              disabled
              className="p-2 bg-muted text-muted-foreground rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title="Janela de 24 horas fechada"
            >
              <Send className="w-5 h-5" />
            </button>
          ) : isRecording ? (
            <div className="flex items-center space-x-2">
              <div className="text-sm text-red-500 font-mono">
                {formatRecordingTime(recordingTime)}
              </div>
              <button
                onClick={cancelRecording}
                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                title="Cancelar gravação"
              >
                <Square className="w-5 h-5" />
              </button>
              <button
                onClick={stopRecording}
                className="p-2 text-green-500 hover:bg-green-50 dark:hover:bg-green-950 rounded-lg transition-colors"
                title="Parar gravação"
              >
                <MicOff className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button
              onClick={message.trim() ? handleSendMessage : startRecording}
              disabled={sendingMedia}
              className="p-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
              title={message.trim() ? "Enviar mensagem" : "Gravar áudio"}
            >
              {sendingMedia ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : message.trim() ? (
                <Send className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Modal de transferência */}
      {showTransferDropdown && (
        <Dialog open={showTransferDropdown} onOpenChange={setShowTransferDropdown}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Transferir Atendimento</DialogTitle>
              <DialogDescription>
                Selecione um atendente para transferir esta conversa.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {agents.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Nenhum atendente disponível
                </p>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleTransferToAgent(agent.id)}
                    className="w-full text-left p-3 hover:bg-accent rounded-lg transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm">
                          {(agent.first_name || agent.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background ${agentsStatus[agent.id] ? 'bg-green-500' : 'bg-gray-400'
                          }`} />
                      </div>
                      <div>
                        <div className="font-medium">
                          {agent.first_name || agent.username}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {agentsStatus[agent.id] ? 'Online' : 'Offline'}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de imagem */}
      {showImageModal && selectedImage && (
        <Dialog open={showImageModal} onOpenChange={setShowImageModal}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <div className="flex items-center justify-center">
              <img
                src={selectedImage}
                alt="Imagem ampliada"
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de Seleção de Reações */}
      {showReactionPicker && selectedMessageForReaction && selectedMessageForReaction.id && (
        <Dialog open={showReactionPicker} onOpenChange={setShowReactionPicker}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Escolha uma reação</DialogTitle>
              <DialogDescription className="sr-only">
                Selecione um emoji para reagir à mensagem selecionada.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {selectedMessageForReaction && (
                    <>
                      Reaja à mensagem: "{(() => {
                        const msg = selectedMessageForReaction;
                        if (msg.content) {
                          return msg.content.slice(0, 50);
                        }
                        if (msg.file_name) {
                          return `Arquivo: ${msg.file_name}`;
                        }
                        if (msg.message_type === 'image') return '[Imagem]';
                        if (msg.message_type === 'video') return '[Vídeo]';
                        if (msg.message_type === 'audio' || msg.message_type === 'ptt') return '[Áudio]';
                        if (msg.message_type === 'document') return '[Documento]';
                        return '[Mídia]';
                      })()}..."
                    </>
                  )}
                </p>
              </div>

              {/* Grid de emojis */}
              <div className="grid grid-cols-6 gap-2">
                {['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🤩', '🔥', '👏', '💯', '🎉', '😘', '🥰', '😍', '🤗', '🙌', '✨'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      if (selectedMessageForReaction && selectedMessageForReaction.id) {
                        sendReaction(selectedMessageForReaction.id, emoji);
                      }
                    }}
                    className="p-3 text-2xl hover:bg-accent rounded-lg transition-colors flex items-center justify-center"
                    title={`Reagir com ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Botão para remover reação */}
              {selectedMessageForReaction && selectedMessageForReaction.additional_attributes?.reaction && (
                <div className="border-t pt-4">
                  <button
                    onClick={() => {
                      if (selectedMessageForReaction && selectedMessageForReaction.id) {
                        sendReaction(selectedMessageForReaction.id, '');
                      }
                    }}
                    className="w-full p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Remover reação
                  </button>
                </div>
              )}

              {/* Botões de ação */}
              <div className="flex justify-end space-x-2 pt-4 border-t">
                <button
                  onClick={() => setShowReactionPicker(false)}
                  className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de Templates */}
      {showTemplatesModal && (
        <Dialog open={showTemplatesModal} onOpenChange={setShowTemplatesModal}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Templates Disponíveis
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-muted-foreground">Carregando templates...</span>
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Nenhum template encontrado</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Configure templates no WhatsApp Business Manager para usar esta funcionalidade.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {templates.map((template, index) => (
                    <div
                      key={index}
                      className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-foreground">{template.name}</h3>
                            {template.status && (
                              <span className={`text-xs px-2 py-1 rounded ${template.status === 'APPROVED'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                : template.status === 'PENDING'
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                                }`}>
                                {template.status === 'APPROVED' ? 'Aprovado' :
                                  template.status === 'PENDING' ? 'Pendente' : 'Rejeitado'}
                              </span>
                            )}
                          </div>
                          {template.language && (
                            <p className="text-xs text-muted-foreground mb-2">
                              Idioma: {template.language}
                            </p>
                          )}
                          {template.category && (
                            <p className="text-xs text-muted-foreground mb-2">
                              Categoria: {template.category}
                            </p>
                          )}
                          {template.components && template.components.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {template.components.map((comp, compIndex) => {
                                if (comp.type === 'HEADER' && comp.format === 'TEXT') {
                                  return (
                                    <div key={compIndex} className="text-sm">
                                      <span className="font-medium text-muted-foreground">Cabeçalho:</span>{' '}
                                      <span className="text-foreground">{comp.text || comp.example?.header_text?.[0]?.[0] || 'N/A'}</span>
                                    </div>
                                  );
                                }
                                if (comp.type === 'BODY') {
                                  return (
                                    <div key={compIndex} className="text-sm">
                                      <span className="font-medium text-muted-foreground">Corpo:</span>{' '}
                                      <span className="text-foreground">{comp.text || 'N/A'}</span>
                                    </div>
                                  );
                                }
                                if (comp.type === 'FOOTER') {
                                  return (
                                    <div key={compIndex} className="text-sm">
                                      <span className="font-medium text-muted-foreground">Rodapé:</span>{' '}
                                      <span className="text-foreground">{comp.text || 'N/A'}</span>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => sendTemplate(template)}
                          disabled={sendingTemplate || template.status !== 'APPROVED'}
                          className="ml-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                          title={template.status !== 'APPROVED' ? 'Template não aprovado' : 'Enviar template'}
                        >
                          {sendingTemplate ? (
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              <span>Enviando...</span>
                            </div>
                          ) : (
                            'Enviar'
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}
            <div className="flex justify-end mt-6 pt-4 border-t">
              <button
                onClick={() => {
                  setShowTemplatesModal(false);
                  setError('');
                }}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Fechar
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default ChatArea;