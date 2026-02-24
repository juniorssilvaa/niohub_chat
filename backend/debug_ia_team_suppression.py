import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from core.models import Provedor
from conversations.models import Team, Conversation, Contact, Inbox

def test_ia_team_logic(provedor_id, mode):
    result = []
    result.append(f"\n--- Testando provedor {provedor_id} em modo '{mode}' ---")
    
    provedor = Provedor.objects.get(id=provedor_id)
    # Mock bot_mode temporarily
    old_mode = provedor.bot_mode
    provedor.bot_mode = mode
    # Não salvar no banco para não afetar o sistema real, apenas usar o objeto em memória
    
    # Simular a lógica de coexistence_webhooks.py
    bot_mode = getattr(provedor, 'bot_mode', 'ia')
    ia_team = None
    if bot_mode == 'ia':
        ia_team = Team.get_or_create_ia_team(provedor)
        result.append(f"Equipe IA obtida/criada: {ia_team.name} (ID: {ia_team.id})")
    else:
        result.append("Modo 'chatbot' detectado. Pultando criação da equipe IA.")
    
    status = "snoozed" if bot_mode == 'ia' else "pending"
    result.append(f"Status resultante: {status}")
    result.append(f"Equipe resultante: {ia_team.name if ia_team else 'None'}")
    
    return result

with open('debug_ia_result.txt', 'w') as f:
    try:
        # Assumindo que o provedor 1 existe (visto anteriormente)
        f.write("\n".join(test_ia_team_logic(1, 'ia')))
        f.write("\n".join(test_ia_team_logic(1, 'chatbot')))
    except Exception as e:
        f.write(f"ERROR: {e}\n")
