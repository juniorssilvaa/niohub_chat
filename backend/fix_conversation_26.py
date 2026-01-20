#!/usr/bin/env python
"""Script para corrigir conversa 26"""
import os
import sys
import django

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from conversations.models import Conversation

print("Corrigindo conversa 26...")

conv = Conversation.objects.filter(id=26).first()
if not conv:
    print("Conversa 26 não encontrada!")
    sys.exit(1)

print(f"Antes: status={conv.status}, assignee_id={conv.assignee_id}")

# Desatribuir e colocar em pending para aparecer na fila
conv.assignee = None
conv.status = 'pending'
conv.save()

print(f"Depois: status={conv.status}, assignee_id={conv.assignee_id}")
print("✅ Conversa 26 corrigida! Agora deve aparecer na aba 'Não atribuídas'.")
