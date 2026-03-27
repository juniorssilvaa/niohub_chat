import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import ConversationList from './ConversationList';
import ChatArea from './ChatArea';
import logoImage from '../assets/logo.png';

const ConversationsPage = ({ selectedConversation, setSelectedConversation, provedorId, user: propUser }) => {
  const refreshConversationsRef = useRef(null);
  const [localUser, setLocalUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(!propUser);
  const isInitialLoadRef = useRef(true); // Ref para controlar a restauração inicial do localStorage
  
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

  // Recuperar conversa selecionada do localStorage APENAS NA PRIMEIRA MONTAGEM
  useEffect(() => {
    if (isInitialLoadRef.current && !selectedConversation) {
      const savedConversation = localStorage.getItem('selectedConversation');
      if (savedConversation) {
        try {
          const parsed = JSON.parse(savedConversation);
          const status = parsed.status || parsed.additional_attributes?.status;
          const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];
          
          if (!closedStatuses.includes(status)) {
            console.log(`[DEBUG-LOAD] Restaurando conversa inicial do localStorage: ${parsed.id}`);
            setSelectedConversation(parsed);
          } else {
            // Limpar localStorage se a conversa estiver fechada, mesmo na carga inicial
            localStorage.removeItem('selectedConversation');
          }
        } catch (error) {
          console.error('Erro ao restaurar conversa:', error);
          localStorage.removeItem('selectedConversation'); // Limpar em caso de erro de parsing
        }
      }
      isInitialLoadRef.current = false; // Marcar que a carga inicial foi processada
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
    
    // Se recebeu uma função, armazenar para uso posterior
    if (typeof refreshFunction === 'function') {
      refreshConversationsRef.current = refreshFunction;
    } 
    // LOG DE DEBUG PARA RASTREAR TROCAS AUTOMÁTICAS (REFRESH)
    if (refreshFunction && typeof refreshFunction === 'object') {
       const incomingId = String(refreshFunction.id);
       const currentId = selectedConversation ? String(selectedConversation.id) : null;
       
       const status = refreshFunction.status || refreshFunction.additional_attributes?.status;
       const closedStatuses = ['closed', 'encerrada', 'resolved', 'finalizada'];

       if (closedStatuses.includes(status)) {
         if (currentId === incomingId) {
           console.log(`[DEBUG-MATCH] LIMPANDO conversa ativa ${incomingId} (status: ${status})`);
           setSelectedConversation(null);
           localStorage.removeItem('selectedConversation');
         }
       } else {
         // SÓ ATUALIZAR SE OS IDs FORAREM IDÊNTICOS
         // Isso impede que mensagens de outros contatos troquem a sua tela atual
         if (currentId === incomingId) {
           setSelectedConversation(refreshFunction);
           localStorage.setItem('selectedConversation', JSON.stringify(refreshFunction));
         } else {
           // NÃO FAZER NADA com a seleção se os IDs não batem
           // apenas o refresh da lista abaixo cuidará de subir o contato no menu lateral
         }
       }
    }
    
    // Forçar atualização da lista de conversas para refletir nova mensagem e nova ordem
    if (refreshConversationsRef.current) {
      refreshConversationsRef.current();
    }
  }, [selectedConversation, setSelectedConversation]);

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
            <p className="text-base text-primary mb-2">
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
