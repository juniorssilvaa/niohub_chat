"""
Script de diagnóstico e fix direto no SQLite para adicionar aresta mensagem→SGP.
Execute com: python fix_edge.py (sem Django, só sqlite3)
"""
import sqlite3
import json
import uuid
import time

DB_PATH = 'db.sqlite3'

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# Pegar o fluxo mais recente
c.execute("SELECT id, nodes, edges FROM core_chatbotflow ORDER BY updated_at DESC LIMIT 3")
rows = c.fetchall()

for row in rows:
    flow_id, nodes_raw, edges_raw = row
    try:
        nodes = json.loads(nodes_raw) if isinstance(nodes_raw, str) else nodes_raw
        edges = json.loads(edges_raw) if isinstance(edges_raw, str) else edges_raw
    except Exception as ex:
        print(f"Erro ao parsear flow {flow_id}: {ex}")
        continue

    print(f"\n{'='*55}")
    print(f"FLOW ID: {flow_id}")
    print(f"Nodes ({len(nodes)}):")
    for n in nodes:
        print(f"  [{n.get('type'):10}] {n.get('id')} | {n.get('data',{}).get('label','')[:40]}")

    print(f"Edges ({len(edges)}):")
    for e in edges:
        print(f"  {e.get('source')} --> {e.get('target')} | handle={e.get('sourceHandle')}")

conn.close()
print("\n\nSe quiser adicionar a aresta, edite o script e rode novamente com ADD_EDGE=True")
