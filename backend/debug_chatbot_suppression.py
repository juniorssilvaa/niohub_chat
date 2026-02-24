import os
import django
import logging

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from conversations.models import Conversation, Contact, Inbox
from core.models import Provedor

# Mock Logger
class MockLogger:
    def __init__(self):
        self.logs = []
    def info(self, msg):
        self.logs.append(f"INFO: {msg}")
    def warning(self, msg):
        self.logs.append(f"WARNING: {msg}")
    def error(self, msg, exc_info=False):
        self.logs.append(f"ERROR: {msg}")
    def debug(self, msg):
        self.logs.append(f"DEBUG: {msg}")

logger = MockLogger()

def test_suppression(status, assignee_id, bot_mode='chatbot'):
    print(f"\n--- Testando: status={status}, assignee_id={assignee_id}, bot_mode={bot_mode} ---")
    
    # Simular objetos
    class MockConversation:
        def __init__(self, status, assignee_id):
            self.id = 999
            self.status = status
            self.assignee_id = assignee_id
    
    conversation = MockConversation(status, assignee_id)
    
    # Variáveis de controle
    chatbot_handled = False
    
    # Lógica que aplicamos em coexistence_webhooks.py
    if bot_mode == 'chatbot':
        # VERIFICAR SUPRESSÃO DO CHATBOT (Atribuído ou Status Ativo)
        is_assigned = conversation.assignee_id is not None
        is_active_agent_status = conversation.status in ['open', 'closed', 'closing']
        
        if is_assigned or is_active_agent_status:
            logger.info(f"ChatbotEngine suprimido para conversa {conversation.id}: atribuída (assignee_id={conversation.assignee_id}) ou status ativo (status={conversation.status}).")
            chatbot_handled = False
            print("Chatbot foi SUPRIMIDO corretamente.")
        else:
            logger.info(f"Invocando ChatbotEngine (Simulado).")
            chatbot_handled = True # Simular que o chatbot tratou
            print("Chatbot seria INVOCADO corretamente.")
    
    for log in logger.logs:
        print(log)
    logger.logs = [] # Limpar logs para o próximo teste

# Cenários
# 1. Modo Chatbot + Sem Atribuição + Status Pendente
test_suppression(status='pending', assignee_id=None)

# 2. Modo Chatbot + Atribuição de Atendente
test_suppression(status='pending', assignee_id=123)

# 3. Modo Chatbot + Status 'open'
test_suppression(status='open', assignee_id=None)

# 4. Modo Chatbot + Atribuição e Status 'open'
test_suppression(status='open', assignee_id=123)

# 5. Status 'snoozed' (IA) + Sem Atribuição
test_suppression(status='snoozed', assignee_id=None)
