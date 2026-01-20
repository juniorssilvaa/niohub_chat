#!/usr/bin/env python
"""Script para analisar conversa 26 no banco de dados"""
import os
import sys
import django

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from conversations.models import Conversation, Message
from core.models import Provedor, User
from django.db.models import Count

print("=" * 80)
print("ANÁLISE DA CONVERSA 26")
print("=" * 80)

# Buscar conversa
conv = Conversation.objects.filter(id=26).first()
if not conv:
    print("\n❌ Conversa 26 não encontrada!")
    sys.exit(1)

print(f"\n✅ Conversa encontrada:")
print(f"   ID: {conv.id}")
print(f"   Status: {conv.status}")
print(f"   Assignee ID: {conv.assignee_id}")
print(f"   Assignee: {conv.assignee.username if conv.assignee else 'None'}")
print(f"   Provedor: {conv.inbox.provedor_id} ({conv.inbox.provedor.nome if conv.inbox and conv.inbox.provedor else 'N/A'})")
print(f"   Inbox: {conv.inbox.name if conv.inbox else 'N/A'}")
print(f"   Contato: {conv.contact.name if conv.contact else 'N/A'} ({conv.contact.phone if conv.contact else 'N/A'})")
print(f"   Criada em: {conv.created_at}")
print(f"   Atualizada em: {conv.updated_at}")
print(f"   Última mensagem em: {conv.last_message_at}")

# Contar mensagens
msg_count = Message.objects.filter(conversation_id=26).count()
print(f"\n📨 Mensagens: {msg_count}")

if msg_count > 0:
    last_msg = Message.objects.filter(conversation_id=26).order_by('-created_at').first()
    print(f"   Última mensagem:")
    print(f"     - ID: {last_msg.id}")
    print(f"     - Tipo: {last_msg.message_type}")
    print(f"     - De cliente: {last_msg.is_from_customer}")
    print(f"     - Conteúdo: {last_msg.content[:100] if last_msg.content else 'N/A'}")
    print(f"     - Criada em: {last_msg.created_at}")

# Verificar todos os usuários que podem ver essa conversa
print(f"\n👥 USUÁRIOS:")
provedor = conv.inbox.provedor if conv.inbox else None
if provedor:
    # Usuários admin do provedor
    admins = User.objects.filter(provedores_admin=provedor, user_type='admin')
    print(f"   Admins do provedor {provedor.id}:")
    for admin in admins:
        print(f"     - ID {admin.id}: {admin.username} ({admin.email})")
    
    # Usuários agentes do provedor
    agents = User.objects.filter(provedor=provedor, user_type='agent')
    print(f"   Agentes do provedor {provedor.id}:")
    for agent in agents:
        print(f"     - ID {agent.id}: {agent.username} ({agent.email})")

# Verificar filtros do frontend
print(f"\n🔍 FILTROS DO FRONTEND:")
print(f"   Conversa com status '{conv.status}' e assignee_id={conv.assignee_id}")
print(f"\n   Na aba 'Minhas' aparecerá se:")
print(f"     - assignee_id == usuário_logado.id")
print(f"   Na aba 'Não atribuídas' aparecerá se:")
print(f"     - assignee_id == None E status == 'pending' ou 'snoozed'")

# Verificar se a conversa aparece na API
print(f"\n📡 TESTE DA API:")
print(f"   Para usuário {conv.assignee_id} (atribuído):")
print(f"     - Deve aparecer na aba 'Minhas'")
print(f"   Para outros usuários:")
print(f"     - NÃO deve aparecer (está atribuída)")

# Listar todas as conversas recentes
print(f"\n📋 CONVERSAS RECENTES DO MESMO PROVEDOR:")
if provedor:
    recent_convs = Conversation.objects.filter(
        inbox__provedor=provedor
    ).exclude(
        status__in=['closed', 'encerrada', 'resolved', 'finalizada', 'closing']
    ).order_by('-last_message_at', '-created_at')[:10]
    
    for c in recent_convs:
        status_icon = "🟢" if c.status == 'open' else "🟡" if c.status == 'pending' else "🔵" if c.status == 'snoozed' else "⚪"
        assignee_str = f"@{c.assignee.username}" if c.assignee else "sem atribuição"
        print(f"   {status_icon} ID {c.id}: status={c.status}, assignee={assignee_str}, última msg={c.last_message_at}")

print("\n" + "=" * 80)
