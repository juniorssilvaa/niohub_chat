import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'niochat.settings')
django.setup()

from core.models import ChatbotFlow

def dump_flow(flow_id):
    try:
        flow = ChatbotFlow.objects.get(id=flow_id)
        data = {
            "id": flow.id,
            "nodes": flow.nodes,
            "edges": flow.edges
        }
        with open(f"flow_{flow_id}_dump.json", "w") as f:
            json.dump(data, f, indent=4)
        print(f"Flow {flow_id} dumped successfully.")
        
        print("\n--- NODES ---")
        for n in flow.nodes:
            print(f"ID: {n.get('id')} | Type: {n.get('type')} | Label: {n.get('data', {}).get('label') or n.get('data', {}).get('content', '')[:20]}")
            
        print("\n--- EDGES ---")
        for e in flow.edges:
            print(f"Source: {e.get('source')} -> Target: {e.get('target')} | Handle: {e.get('sourceHandle')}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    dump_flow(11)
