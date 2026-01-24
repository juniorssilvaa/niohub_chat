import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { buildWebSocketUrl } from '../utils/websocketUrl';
import axios from 'axios';
import { useAuth } from './AuthContext';

export const NotificationContext = createContext();

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications deve ser usado dentro de NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  // ✅ Usar usuário do AuthContext ao invés de buscar novamente
  const { user: authUser } = useAuth();
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [hasNewMessages, setHasNewMessages] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState(null);
  const websocketRef = React.useRef(null);
  const reconnectTimeoutRef = React.useRef(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const [painelWsConnected, setPainelWsConnected] = React.useState(false);
  const [unreadMessagesByUser, setUnreadMessagesByUser] = React.useState({});

  const internalChatWsRef = React.useRef(null);
  const [internalChatUnreadCount, setInternalChatUnreadCount] = React.useState(0);
  const [internalChatUnreadByUser, setInternalChatUnreadByUser] = React.useState({});
  const initializingRef = React.useRef(false);
  const painelWsRef = React.useRef(null);
  const painelReconnectRef = React.useRef(null);
  const connectionFailuresRef = React.useRef({ internalChat: 0, privateChat: 0 });
  const soundEnabledRef = React.useRef(false);
  const newMsgSoundRef = React.useRef('mixkit-bell-notification-933.wav');
  const newConvSoundRef = React.useRef('mixkit-digital-quick-tone-2866.wav');
  const audioRef = React.useRef(null);
  const faviconTimerRef = React.useRef(null);
  const isFaviconBlinkingRef = React.useRef(false);

  // ✅ Sincronizar usuário do AuthContext com currentUser local
  // Isso evita chamadas desnecessárias de /me
  React.useEffect(() => {
    if (authUser) {
      setCurrentUser(authUser);
      soundEnabledRef.current = !!authUser.sound_notifications_enabled;
      if (authUser.new_message_sound) newMsgSoundRef.current = authUser.new_message_sound;
      if (authUser.new_conversation_sound) newConvSoundRef.current = authUser.new_conversation_sound;
    } else {
      setCurrentUser(null);
    }
  }, [authUser]);

  useEffect(() => {
    if (currentUser?.id) {
      connectWebSocket();
      connectPainelWebSocket();
      connectInternalChatWebSocket();
      loadInternalChatUnreadCount();
      loadInternalChatUnreadByUser();
    }

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (painelWsRef.current) {
        painelWsRef.current.close();
      }
      if (painelReconnectRef.current) {
        clearTimeout(painelReconnectRef.current);
      }
      if (internalChatWsRef.current) {
        internalChatWsRef.current.close();
      }
    };
  }, [currentUser?.id]);

  // ✅ REMOVIDO: loadCurrentUser não é mais necessário
  // O usuário vem do AuthContext, evitando chamadas duplicadas de /me

  const loadInternalChatUnreadCount = async () => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      const response = await axios.get('/api/internal-chat-unread-count/', {
        headers: { Authorization: `Token ${token}` }
      });

      if (response.status === 200) {
        const data = response.data;
        const count = data.total_unread || 0;
        setInternalChatUnreadCount(count);

        if (count === 0) {
          localStorage.removeItem('internal_chat_unread_count');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar contador do chat interno:', error);
      setInternalChatUnreadCount(0);
    }
  };

  const loadInternalChatUnreadByUser = async () => {
    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      const response = await axios.get('/api/internal-chat-unread-by-user/', {
        headers: { Authorization: `Token ${token}` }
      });

      if (response.status === 200) {
        const data = response.data;
        setInternalChatUnreadByUser(data);
      }
    } catch (error) {
      console.error('Erro ao carregar contadores por usuário do chat interno:', error);
    }
  };

  const connectInternalChatWebSocket = () => {
    if (internalChatWsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (internalChatWsRef.current && internalChatWsRef.current.readyState !== WebSocket.CLOSED) {
      internalChatWsRef.current.close();
    }

    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      // CORREÇÃO: Usar função centralizada para construir URL de WebSocket
      const wsUrl = buildWebSocketUrl('/ws/internal-chat/notifications/', { token });

      internalChatWsRef.current = new WebSocket(wsUrl);

      internalChatWsRef.current.onopen = () => {
        // Resetar contador de falhas quando conectar com sucesso
        connectionFailuresRef.current.internalChat = 0;
        internalChatWsRef.current.send(JSON.stringify({
          type: 'join_notifications'
        }));
      };

      internalChatWsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'unread_count_update') {
            setInternalChatUnreadCount(data.total_unread || 0);
            if (data.unread_by_user) {
              setInternalChatUnreadByUser(data.unread_by_user);
            }
          }
        } catch (error) {
          // Erro silencioso - não logar para evitar poluição do console
        }
      };

      internalChatWsRef.current.onclose = (event) => {
        // Não tentar reconectar se foi fechado intencionalmente
        if (event.wasClean || event.code === 1000) {
          return;
        }
        
        // Limitar tentativas de reconexão para evitar spam de erros
        connectionFailuresRef.current.internalChat++;
        if (connectionFailuresRef.current.internalChat > 3) {
          // Parar de tentar reconectar após 3 falhas consecutivas
          return;
        }
        
        setTimeout(() => {
          if (currentUser?.id) {
            connectInternalChatWebSocket();
          }
        }, 5000);
      };

      internalChatWsRef.current.onerror = (error) => {
        // Suprimir erro nativo do navegador - não fazer nada para evitar poluição do console
        // O erro já será mostrado pelo navegador, não precisamos logar novamente
      };

    } catch (error) {
      // CORREÇÃO DE SEGURANÇA: Não expor detalhes do erro que podem conter token
      // Silenciar erro para não expor informações sensíveis
    }
  };

  const connectWebSocket = () => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (websocketRef.current && websocketRef.current.readyState !== WebSocket.CLOSED) {
      websocketRef.current.close();
    }

    try {
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      // CORREÇÃO: Usar função centralizada para construir URL de WebSocket
      const wsUrl = buildWebSocketUrl('/ws/private-chat/', { token });

      websocketRef.current = new WebSocket(wsUrl);

      websocketRef.current.onopen = () => {
        // Resetar contador de falhas quando conectar com sucesso
        connectionFailuresRef.current.privateChat = 0;
        setIsConnected(true);

        if (currentUser?.id) {
          websocketRef.current.send(JSON.stringify({
            type: 'join_notifications',
            user_id: currentUser.id
          }));
        }
      };

      websocketRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'new_private_message') {
            const recipientId = data.message?.recipient_id ?? data.message?.recipient?.id;
            if (recipientId === currentUser?.id) {
              const senderId = data.message?.sender?.id?.toString();
              setUnreadCount(prev => prev + 1);
              setHasNewMessages(true);
              if (senderId) {
                setUnreadMessagesByUser(prev => {
                  const newUnreadByUser = {
                    ...prev,
                    [senderId]: (prev[senderId] || 0) + 1
                  };
                  localStorage.setItem('unread_messages_by_user', JSON.stringify(newUnreadByUser));
                  window.dispatchEvent(new Event('unread-messages-changed'));
                  return newUnreadByUser;
                });
              }
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Nova Mensagem no Chat Interno', {
                  body: `${data.message?.sender?.name || 'Usuario'}: ${data.message?.content}`,
                  icon: '/favicon.ico',
                  tag: 'chat-interno'
                });
              }
            }
          }
        } catch (error) {
          // Erro silencioso - não logar para evitar poluição do console
        }
      };

      websocketRef.current.onclose = (event) => {
        setIsConnected(false);
        
        // Não tentar reconectar se foi fechado intencionalmente
        if (event.wasClean || event.code === 1000) {
          return;
        }
        
        // Limitar tentativas de reconexão para evitar spam de erros
        connectionFailuresRef.current.privateChat++;
        if (connectionFailuresRef.current.privateChat > 3) {
          // Parar de tentar reconectar após 3 falhas consecutivas
          return;
        }
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (currentUser?.id) {
            connectWebSocket();
          }
        }, 5000);
      };

      websocketRef.current.onerror = (error) => {
        // Suprimir erro nativo do navegador - não fazer nada para evitar poluição do console
        // O erro já será mostrado pelo navegador, não precisamos logar novamente
        setIsConnected(false);
      };

    } catch (error) {
      // Erro silencioso - não logar para evitar poluição do console
    }
  };

  const connectPainelWebSocket = () => {
    try {
      if (!currentUser?.provedor_id) return;
      // Priorizar auth_token que é o padrão salvo no Login, mas aceitar token também para compatibilidade
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (!token) return;
      // CORREÇÃO: Usar função centralizada para construir URL de WebSocket
      const wsUrl = buildWebSocketUrl(`/ws/painel/${currentUser.provedor_id}/`, { token });
      if (painelWsRef.current?.readyState === WebSocket.OPEN) return;
      if (painelWsRef.current && painelWsRef.current.readyState !== WebSocket.CLOSED) {
        painelWsRef.current.close();
      }
      const ws = new WebSocket(wsUrl);
      painelWsRef.current = ws;
      
      ws.onopen = () => {
        setPainelWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const evt = data.type || data.event_type || data.action;
          if (evt === 'new_message' || evt === 'message' || evt === 'chat_message' || evt === 'message_created' || evt === 'messages') {
            playSound(newMsgSoundRef.current);
            startBlinkingFavicon();
          } else if (evt === 'conversation_created' || evt === 'conversation_updated' || evt === 'conversation_event' || evt === 'update_conversation') {
            playSound(newConvSoundRef.current);
            startBlinkingFavicon();
          }
        } catch (_) {}
      };
      ws.onclose = (event) => {
        setPainelWsConnected(false);
        // Códigos que indicam erro permanente (não tentar reconectar)
        // 4001 = Unauthorized, 4003 = Forbidden
        const permanentErrorCodes = [4001, 4003];
        
        if (permanentErrorCodes.includes(event.code)) {
          // Erro de permissão ou autenticação - não tentar reconectar
          return;
        }
        
        // Apenas reconectar se não foi erro permanente
        painelReconnectRef.current = setTimeout(connectPainelWebSocket, 3000);
      };
      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };
    } catch (e) {
      // CORREÇÃO DE SEGURANÇA: Não expor detalhes do erro que podem conter token
      // Silenciar erro para não expor informações sensíveis
    }
  };

  const playSound = (fileName) => {
    if (!soundEnabledRef.current) return;
    try {
      const src = `/sounds/${fileName}`;
      if (!audioRef.current) {
        audioRef.current = new Audio(src);
      } else {
        audioRef.current.pause();
        audioRef.current.src = src;
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch (_) {}
  };

  const setFavicon = (hrefBase) => {
    try {
      const href = `${hrefBase}?v=${Date.now()}`;
      const links = Array.from(document.querySelectorAll("link[rel~='icon']"));
      if (links.length > 0) {
        links.forEach(l => { l.href = href; });
      } else {
        const l1 = document.createElement('link');
        l1.rel = 'icon'; l1.type = 'image/x-icon'; l1.href = href; document.head.appendChild(l1);
        const l2 = document.createElement('link');
        l2.rel = 'shortcut icon'; l2.type = 'image/x-icon'; l2.href = href; document.head.appendChild(l2);
      }
    } catch (_) {}
  };

  const startBlinkingFavicon = () => {
    if (isFaviconBlinkingRef.current) return;
    isFaviconBlinkingRef.current = true;
    const defaultIcon = '/favicon.ico';
    const notifyIcon = '/faviconnotifica.ico';
    let toggle = false;
    faviconTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
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

  const clearNotifications = () => {
    setUnreadCount(0);
    setHasNewMessages(false);
    setUnreadMessagesByUser({});
    localStorage.removeItem('unread_messages_by_user');
    window.dispatchEvent(new Event('unread-messages-changed'));
  };

  const markAsRead = (count = null, userId = null) => {
    if (userId) {
      setUnreadMessagesByUser(prev => {
        const userUnreadCount = prev[userId] || 0;
        const newUnreadByUser = { ...prev };
        delete newUnreadByUser[userId];
        setUnreadCount(prevTotal => Math.max(0, prevTotal - userUnreadCount));
        localStorage.setItem('unread_messages_by_user', JSON.stringify(newUnreadByUser));
        window.dispatchEvent(new Event('unread-messages-changed'));
        return newUnreadByUser;
      });
    } else if (count !== null) {
      setUnreadCount(prev => Math.max(0, prev - count));
    } else {
      clearNotifications();
    }
  };

  // ✅ REMOVIDO: useEffect que chamava connectWebSocket sem verificar usuário
  // A conexão agora é feita apenas quando há currentUser (linha 44-69)

  useEffect(() => {
    if (currentUser?.id && websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({
        type: 'join_notifications',
        user_id: currentUser.id
      }));
    }
  }, [currentUser]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

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

  const value = {
    unreadCount,
    hasNewMessages,
    currentUser,
    isConnected,
    painelWsConnected,
    unreadMessagesByUser,
    internalChatUnreadCount,
    internalChatUnreadByUser,
    loadInternalChatUnreadCount,
    loadInternalChatUnreadByUser,
    clearNotifications,
    markAsRead,
    websocket: websocketRef.current
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
