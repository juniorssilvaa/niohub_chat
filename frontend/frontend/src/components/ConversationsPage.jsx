import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import ConversationList from './ConversationList';
import ChatArea from './ChatArea';
import logoImage from '../assets/logo.png';

const ConversationsPage = ({ selectedConversation, setSelectedConversation, provedorId, user: propUser }) => {
  const refreshConversationsRef = useRef(null);
  const [localUser, setLocalUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(!propUser);
  
  // Usar o usuário da prop se disponível, senão usar o local
  const user = propUser || localUser;
  
  // Buscar dados do usuário logado se não vier por prop
  useEffect(() => {
    if (propUser) {
      setLoadingUser(false);
      return;
    }

    const fetchUser = async () => {
      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        if (token) {
          const response = await axios.get('/api/auth/me/', {
            headers: { Authorization: `Token ${token}` }
          });
          setLocalUser(response.data);
        }
      } catch (error) {
        console.error('Erro ao buscar dados do usuário:', error);
      } finally {
        setLoadingUser(false);
      }
    };
    
    fetchUser();
  }, [propUser]);

  useEffect(() => {
    const handlePermissionsUpdate = () => {
      // Se tiver propUser, o App.jsx deve lidar com isso, mas vamos atualizar o local por garantia
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (token) {
        axios.get('/api/auth/me/', {
          headers: { Authorization: `Token ${token}` }
        }).then(res => setLocalUser(res.data));
      }
    };

    window.addEventListener('userPermissionsUpdated', handlePermissionsUpdate);
    return () => {
      window.removeEventListener('userPermissionsUpdated', handlePermissionsUpdate);
    };
  }, []);

  // Recuperar conversa selecionada do localStorage se não houver uma selecionada
  // CORREÇÃO: Verificar se a conversa não está fechada antes de restaurar
  useEffect(() => {
    if (!selectedConversation) {
      const savedConversation = localStorage.getItem('selectedConversation');
      if (savedConversation) {
        try {
          const parsed = JSON.parse(savedConversation);
          const status = parsed.status || parsed.additional_attributes?.status;
          const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
          
          // Só restaurar se a conversa não estiver fechada
          if (!closedStatuses.includes(status)) {
            setSelectedConversation(parsed);
          } else {
            // Limpar localStorage se a conversa estiver fechada
            localStorage.removeItem('selectedConversation');
          }
        } catch (e) {
          console.error('Erro ao recuperar conversa do localStorage:', e);
          localStorage.removeItem('selectedConversation');
        }
      }
    }
  }, [selectedConversation, setSelectedConversation]);

  const handleConversationClose = useCallback(() => {
    setSelectedConversation(null);
    localStorage.removeItem('selectedConversation');
    // Recarregar lista de conversas
    if (refreshConversationsRef.current) {
      refreshConversationsRef.current();
    }
  }, [setSelectedConversation]);

  const handleConversationUpdate = useCallback((refreshFunction) => {
    // CORREÇÃO: Se recebeu null, limpar seleção
    if (refreshFunction === null) {
      setSelectedConversation(null);
      localStorage.removeItem('selectedConversation');
      // Forçar atualização da lista de conversas
      if (refreshConversationsRef.current) {
        refreshConversationsRef.current();
      }
      return;
    }
    
    // Se recebeu uma função de refresh, armazena a referência
    if (typeof refreshFunction === 'function') {
      refreshConversationsRef.current = refreshFunction;
      return;
    }
    
    // Se recebeu dados de conversa atualizada, verificar se não está fechada
    if (refreshFunction && typeof refreshFunction === 'object') {
      const status = refreshFunction.status || refreshFunction.additional_attributes?.status;
      const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
      
      // Se a conversa foi fechada, limpar seleção
      if (closedStatuses.includes(status)) {
        setSelectedConversation(null);
        localStorage.removeItem('selectedConversation');
      } else {
        // Caso contrário, atualizar normalmente
        setSelectedConversation(refreshFunction);
        localStorage.setItem('selectedConversation', JSON.stringify(refreshFunction));
      }
    }
    
    // Forçar atualização da lista de conversas
    if (refreshConversationsRef.current) {
      refreshConversationsRef.current();
    }
  }, [setSelectedConversation]);

  if (loadingUser) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando dados do usuário...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-x-hidden min-w-0">
      <ConversationList
        onConversationSelect={(conversation) => {
          setSelectedConversation(conversation);
          // Salvar no localStorage
          localStorage.setItem('selectedConversation', JSON.stringify(conversation));
        }}
        selectedConversation={selectedConversation}
        provedorId={provedorId}
        onConversationUpdate={handleConversationUpdate}
        user={user}
      />
      {selectedConversation ? (
        <ChatArea
          conversation={selectedConversation}
          onConversationClose={handleConversationClose}
          onConversationUpdate={handleConversationUpdate}
          user={user}
        />
      ) : (
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
      )}
    </div>
  );
};

export default ConversationsPage;
