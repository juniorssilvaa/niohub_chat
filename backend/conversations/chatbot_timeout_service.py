import threading
import time
import logging
from datetime import timedelta
from django.utils import timezone
from django.db import close_old_connections, transaction
import os

logger = logging.getLogger(__name__)

class ChatbotTimeoutService:
    """
    Serviço de background nativo para monitorar inatividade no chatbot.
    Roda em uma thread separada dentro do processo principal do backend.
    """
    _instance = None
    _thread = None
    _stop_event = threading.Event()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ChatbotTimeoutService, cls).__new__(cls)
        return cls._instance

    def start(self):
        """Inicia o monitoramento se ainda não estiver rodando."""
        logger.info(f"🔍 [TIMEOUT_MONITOR] Tentando iniciar serviço (Thread status: {self._thread.is_alive() if self._thread else 'None'})")
        
        # Evitar múltiplas threads
        if self._thread is None or not self._thread.is_alive():
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_monitor, name="ChatbotTimeoutMonitor", daemon=True)
            self._thread.start()
            logger.info("💓 [TIMEOUT_MONITOR] Thread de monitoramento iniciada com sucesso.")
        else:
            logger.info("ℹ️ [TIMEOUT_MONITOR] Serviço já está rodando, pulando inicialização.")

    def stop(self):
        """Para o monitoramento."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
            logger.info("🛑 [TIMEOUT_MONITOR] Thread de monitoramento interrompida.")

    def _run_monitor(self):
        """Loop principal de monitoramento."""
        logger.info("💓 [TIMEOUT_MONITOR] Iniciando loop de varredura (Intervalo: 60s)...")
        
        # Delay inicial para garantir que o Django carregou tudo
        time.sleep(10)

        while not self._stop_event.is_set():
            try:
                # Importações tardias para evitar problemas de carregamento circular
                from conversations.models import Conversation, Team
                from core.models import ChatbotFlow
                from core.redis_memory_service import redis_memory_service
                from core.chatbot_engine import ChatbotEngine
                from conversations.closing_service import closing_service, stamp_automation_closure_trace
                from asgiref.sync import async_to_sync

                # Garantir que as conexões do banco estão limpas (importante para threads longas)
                close_old_connections()

                # 1. Buscar conversas ativas no bot (ocultas para atendentes)
                conversations = Conversation.objects.filter(
                    waiting_for_agent=False,
                    status__in=['snoozed', 'pending']
                ).select_related('inbox', 'inbox__provedor')

                for conv in conversations:
                    try:
                        provedor_id = conv.inbox.provedor_id
                        
                        # 2. Obter memória do chatbot (agora via DB)
                        state = redis_memory_service.get_ai_state_sync(
                            provedor_id, 
                            conv.id, 
                            conv.inbox.channel_type, 
                            conv.contact.phone
                        )
                        
                        node_id = state.get("chatbot_node_id")
                        if not node_id:
                            continue

                        # 3. Buscar fluxo ativo
                        flow = ChatbotFlow.objects.filter(
                            provedor_id=provedor_id,
                            canal_id=conv.inbox_id
                        ).first() or ChatbotFlow.objects.filter(
                            provedor_id=provedor_id,
                            canal__isnull=True
                        ).order_by('-updated_at').first()

                        if not flow:
                            continue

                        # 4. Encontrar o nó atual
                        node = next((n for n in flow.nodes if n.get('id') == node_id), None)
                        if not node or not node.get('data'):
                            continue

                        node_data = node.get('data')
                        inactivity_minutes = node_data.get('inactivityTime')
                        timeout_action = node_data.get('timeoutAction', 'nothing')
                        
                        if not inactivity_minutes or timeout_action == 'nothing':
                            continue

                        # 5. Calcular tempo de inatividade
                        last_msg_time = conv.last_message_at or conv.updated_at
                        if state.get("updated_at"):
                            try:
                                state_time = timezone.datetime.fromisoformat(state["updated_at"].replace('Z', '+00:00'))
                                if state_time > last_msg_time:
                                    last_msg_time = state_time
                            except:
                                pass

                        threshold = last_msg_time + timedelta(minutes=int(inactivity_minutes))
                        
                        if timezone.now() > threshold:
                            logger.info(f"⏳ [TIMEOUT] Conv {conv.id} inativa há >{inactivity_minutes}min. Ação: {timeout_action}")
                            
                            with transaction.atomic():
                                # Recarregar para garantir o estado mais recente antes de agir
                                conv.refresh_from_db()
                                if conv.waiting_for_agent: # Alguém já liberou manualmente?
                                    continue

                                if timeout_action == 'transfer':
                                    team_id = node_data.get('timeoutTeam')
                                    if team_id:
                                        team = Team.objects.filter(id=team_id).first()
                                        if team:
                                            conv.status = 'pending'
                                            conv.team = team
                                            conv.assignee = None
                                            conv.waiting_for_agent = True
                                            conv.save(update_fields=['status', 'team', 'assignee', 'waiting_for_agent'])
                                            
                                            # Notificar o cliente
                                            try:
                                                async_to_sync(ChatbotEngine.send_message_agnostic)(
                                                    conv=conv, 
                                                    text="Como você está um tempo sem responder, estou transferindo seu atendimento para nossa equipe humana poder te ajudar melhor."
                                                )
                                            except Exception as e:
                                                logger.warning(f"Falha ao enviar aviso de transferência (conv {conv.id}): {e}")
                                                
                                            # Limpar memória para o bot não interferir
                                            redis_memory_service.clear_memory_sync(provedor_id, conv.id, conv.inbox.channel_type, conv.contact.phone)
                                            logger.info(f"✅ [TIMEOUT] Conv {conv.id} transferida para equipe {team.name}")

                                elif timeout_action == 'close':
                                    try:
                                        async_to_sync(ChatbotEngine.send_message_agnostic)(
                                            conv=conv, 
                                            text="Seu atendimento foi encerrado por inatividade. Caso precise de algo, basta enviar uma nova mensagem!"
                                        )
                                    except:
                                        pass
                                    stamp_automation_closure_trace(conv, 'chatbot_inactivity_timeout')
                                    closing_service.request_closing(conv)
                                    logger.info(f"✅ [TIMEOUT] Conv {conv.id} encerrada automaticamente.")

                    except Exception as conv_err:
                        logger.error(f"❌ [TIMEOUT_MONITOR] Erro ao processar conversa {conv.id}: {conv_err}")

            except Exception as loop_err:
                logger.error(f"❌ [TIMEOUT_MONITOR] Erro no loop de monitoramento: {loop_err}")
            
            # Aguardar 60 segundos antes da próxima varredura
            time.sleep(60)

# Instância global
chatbot_timeout_service = ChatbotTimeoutService()
